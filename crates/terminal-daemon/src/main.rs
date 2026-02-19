mod claude_runner;
mod dispatcher;
mod git_engine;
mod parser;
mod persistence;
mod server;

use crate::persistence::Persistence;
use dispatcher::Dispatcher;
use rand::Rng;
use server::{build_router, DaemonState};
use std::sync::Arc;
use terminal_core::config::DaemonConfig;
use tokio::sync::{broadcast, mpsc};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = DaemonConfig::default();

    // Create data directory
    tokio::fs::create_dir_all(&config.data_dir)
        .await
        .expect("Failed to create data dir");

    // Generate auth token
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // Write auth token
    let token_path = config.data_dir.join("auth_token");
    tokio::fs::write(&token_path, &token)
        .await
        .expect("Failed to write auth token");

    // Event broadcast channel
    let (event_tx, _) = broadcast::channel::<String>(256);

    // Command channel (from WS clients to dispatcher)
    let (command_tx, mut command_rx) = mpsc::channel(64);

    let state = Arc::new(DaemonState {
        auth_token: token,
        event_tx: event_tx.clone(),
        command_tx,
    });

    let app = build_router(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");

    let actual_addr = listener.local_addr().unwrap();
    tracing::info!("Daemon listening on {}", actual_addr);

    // Write port file
    let port_path = config.data_dir.join("port");
    tokio::fs::write(&port_path, actual_addr.port().to_string())
        .await
        .expect("Failed to write port file");

    // Initialize persistence
    let persistence = Arc::new(
        Persistence::new(config.data_dir.clone())
            .expect("Failed to initialize persistence"),
    );

    // Recovery on startup
    match persistence.recover() {
        Ok(report) => {
            if report.orphaned_runs > 0 || report.orphaned_worktrees > 0 {
                tracing::warn!(
                    "Recovery: {} orphaned runs, {} orphaned worktrees, {} cleaned metadata",
                    report.orphaned_runs,
                    report.orphaned_worktrees,
                    report.cleaned_metadata
                );
            }
        }
        Err(e) => tracing::error!("Recovery failed: {}", e),
    }

    // Command dispatcher
    let dispatcher = Arc::new(Dispatcher::new(config.clone(), event_tx.clone(), persistence.clone()));
    tokio::spawn(async move {
        while let Some((cmd, reply_tx)) = command_rx.recv().await {
            dispatcher.handle(cmd, reply_tx).await;
        }
    });

    axum::serve(listener, app).await.unwrap();
}
