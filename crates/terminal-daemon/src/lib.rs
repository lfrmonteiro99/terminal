pub mod claude_runner;
pub mod daemon_context;
pub mod dispatcher;
pub mod dispatchers;
pub mod git_engine;
pub mod parser;
pub mod persistence;
pub mod pty;
pub mod safety;
pub mod search_engine;
pub mod server;

use crate::daemon_context::ClientId;
use crate::persistence::Persistence;
use dispatcher::Dispatcher;
use rand::Rng;
use server::{build_router, DaemonState};
use std::sync::Arc;
use terminal_core::config::{DaemonConfig, DaemonMode};
use tokio::sync::{broadcast, mpsc, oneshot};

/// Handle returned by `start_server`, providing the bound port, auth token,
/// and a mechanism to request graceful shutdown.
pub struct DaemonHandle {
    pub port: u16,
    pub token: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl DaemonHandle {
    /// Send shutdown signal to the daemon. Consumes the sender so it can only be called once.
    pub fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Start the daemon server.
///
/// - In `Standalone` mode: writes port and auth_token files to `config.data_dir`.
/// - In `Embedded` mode: keeps port/token in memory only, no disk writes.
///
/// Returns a `DaemonHandle` on success. The server runs until `shutdown()` is called
/// or the process exits.
pub async fn start_server(
    config: DaemonConfig,
) -> Result<DaemonHandle, Box<dyn std::error::Error + Send + Sync>> {
    // Create data directory (needed for persistence in both modes)
    tokio::fs::create_dir_all(&config.data_dir).await?;

    // Use TERMINAL_AUTH_TOKEN env var if set, otherwise generate random
    let token: String = std::env::var("TERMINAL_AUTH_TOKEN").unwrap_or_else(|_| {
        rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect()
    });

    // Standalone mode: write token to disk
    if config.mode == DaemonMode::Standalone {
        let token_path = config.data_dir.join("auth_token");
        tokio::fs::write(&token_path, &token).await?;
    }

    // Event broadcast channel
    let (event_tx, _) = broadcast::channel::<String>(256);

    // Command channel (from WS clients to dispatcher) — (ClientId, command, reply)
    let (command_tx, mut command_rx) =
        mpsc::channel::<(ClientId, terminal_core::protocol::v1::AppCommand, mpsc::Sender<terminal_core::protocol::v1::AppEvent>)>(64);

    let state = Arc::new(DaemonState {
        auth_token: token.clone(),
        event_tx: event_tx.clone(),
        command_tx,
    });

    let app = build_router(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let actual_port = listener.local_addr()?.port();

    tracing::info!("Daemon listening on {}:{}", config.host, actual_port);

    // Standalone mode: write port to disk
    if config.mode == DaemonMode::Standalone {
        let port_path = config.data_dir.join("port");
        tokio::fs::write(&port_path, actual_port.to_string()).await?;
    }

    // Initialize persistence
    let persistence = Arc::new(Persistence::new(config.data_dir.clone())?);

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
    let dispatcher = Arc::new(Dispatcher::new(
        config.clone(),
        event_tx.clone(),
        persistence.clone(),
    ));
    tokio::spawn(async move {
        while let Some((client_id, cmd, reply_tx)) = command_rx.recv().await {
            dispatcher.handle(client_id, cmd, reply_tx).await;
        }
    });

    // Shutdown signal
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Spawn axum server with graceful shutdown
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
                tracing::info!("Daemon received shutdown signal");
            })
            .await
            .ok();
    });

    Ok(DaemonHandle {
        port: actual_port,
        token,
        shutdown_tx: Some(shutdown_tx),
    })
}
