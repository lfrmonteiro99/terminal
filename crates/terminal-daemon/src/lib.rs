pub mod claude_runner;
pub mod daemon_context;
pub mod dispatcher;
pub mod dispatchers;
pub mod git_engine;
pub mod guards;
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&config.data_dir, std::fs::Permissions::from_mode(0o700)).await?;
    }

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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&token_path, std::fs::Permissions::from_mode(0o600)).await?;
        }
    }

    // Event broadcast channel
    let (event_tx, _) = broadcast::channel::<String>(256);

    // Command channel (from WS clients to dispatcher) — (ClientId, command, reply)
    let (command_tx, mut command_rx) =
        mpsc::channel::<(ClientId, terminal_core::protocol::v1::AppCommand, mpsc::Sender<terminal_core::protocol::v1::AppEvent>)>(64);

    // Initialize persistence
    let persistence = Arc::new(Persistence::new(config.data_dir.clone())?);

    // Command dispatcher — constructed early so the WS handler can share its
    // `active_workspaces` map (M5b, issue #100).
    let dispatcher = Arc::new(Dispatcher::new(
        config.clone(),
        event_tx.clone(),
        persistence.clone(),
    ));

    let state = Arc::new(DaemonState {
        auth_token: token.clone(),
        event_tx: event_tx.clone(),
        command_tx,
        active_workspaces: dispatcher.context().active_workspaces.clone(),
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&port_path, std::fs::Permissions::from_mode(0o600)).await?;
        }
    }

    // Recovery on startup — synchronous pass (metadata + run-state fixes).
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

    // Async pass: physically prune worktree directories whose metadata still
    // exists but whose on-disk directory is gone (or the inverse). Keeps
    // `git worktree list` clean across daemon restarts. See issue #86 (M17).
    prune_orphan_worktrees_on_disk(&persistence).await;

    // Startup recovery: re-hydrate persisted workspaces (C5b, issue #98).
    dispatcher.recover_workspaces().await;
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

/// Physically remove worktree directories whose metadata indicates they
/// should be gone, and delete metadata whose worktree directory has been
/// removed out-of-band. Best-effort: never fails startup.
async fn prune_orphan_worktrees_on_disk(persistence: &Persistence) {
    let metas = match persistence.list_worktree_metas() {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("prune_orphan_worktrees_on_disk: list failed: {}", e);
            return;
        }
    };

    for (run_id, meta) in metas {
        let dir_exists = meta.worktree_path.exists();
        // Look up whether the run is still alive in the on-disk run record.
        let run_terminal = match persistence.load_run(run_id) {
            Ok(run) => run.state.is_terminal(),
            // No run record at all — metadata is orphaned, safe to delete.
            Err(_) => true,
        };

        if !dir_exists {
            // Worktree dir gone but metadata lingered; drop the metadata.
            if let Err(e) = persistence.delete_worktree_meta(run_id) {
                tracing::warn!(
                    "prune_orphan_worktrees_on_disk: delete meta {} failed: {}",
                    run_id,
                    e
                );
            } else {
                tracing::info!(
                    "prune_orphan_worktrees_on_disk: removed stale metadata for missing worktree {:?}",
                    meta.worktree_path
                );
            }
            continue;
        }

        if run_terminal {
            // Run is done but the worktree dir still exists — prune it.
            let repo_root = meta
                .repo_root
                .clone()
                .or_else(|| derive_repo_root_from_worktree(&meta.worktree_path));
            if let Some(root) = repo_root {
                if let Err(e) =
                    crate::git_engine::worktree_remove(&root, &meta.worktree_path).await
                {
                    tracing::warn!(
                        "prune_orphan_worktrees_on_disk: worktree_remove failed for {:?}: {}",
                        meta.worktree_path,
                        e
                    );
                } else {
                    tracing::info!(
                        "prune_orphan_worktrees_on_disk: pruned worktree {:?}",
                        meta.worktree_path
                    );
                }
            } else {
                tracing::warn!(
                    "prune_orphan_worktrees_on_disk: no repo_root for {:?}, skipping worktree_remove",
                    meta.worktree_path
                );
            }
            if let Err(e) = persistence.delete_worktree_meta(run_id) {
                tracing::warn!(
                    "prune_orphan_worktrees_on_disk: delete meta {} failed: {}",
                    run_id,
                    e
                );
            }
        }
    }
}

/// Derive the main repo root from a worktree path created under the
/// convention `<repo_root>/.terminal-worktrees/<short_uuid>`. Returns None
/// when the path doesn't match that layout.
fn derive_repo_root_from_worktree(worktree_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let parent = worktree_path.parent()?;
    if parent.file_name().and_then(|s| s.to_str()) != Some(".terminal-worktrees") {
        return None;
    }
    parent.parent().map(|p| p.to_path_buf())
}
