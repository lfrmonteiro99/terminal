use terminal_core::config::DaemonConfig;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = DaemonConfig::default(); // mode: Standalone
    let handle = terminal_daemon::start_server(config)
        .await
        .expect("Failed to start daemon");

    tracing::info!("Daemon listening on port {}", handle.port);

    // Block until ctrl-c
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for ctrl-c");

    tracing::info!("Shutting down...");
    handle.shutdown();
}
