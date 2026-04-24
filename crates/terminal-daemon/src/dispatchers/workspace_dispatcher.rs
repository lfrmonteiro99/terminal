// Workspace domain dispatcher (M1-04, M1-05)

use crate::daemon_context::{ClientId, DaemonContext};
use std::sync::Arc;
use terminal_core::models::{PaneLayout, Workspace, WorkspaceSummary};
use terminal_core::protocol::v1::{AppCommand, AppEvent};
use tokio::sync::{broadcast, mpsc};
use tracing::{info, warn};
use uuid::Uuid;

pub struct WorkspaceDispatcher {
    ctx: Arc<DaemonContext>,
}

impl WorkspaceDispatcher {
    pub fn new(ctx: Arc<DaemonContext>) -> Self {
        Self { ctx }
    }

    pub async fn handle(&self, client_id: ClientId, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        match cmd {
            AppCommand::ListWorkspaces => {
                let workspaces = self.ctx.workspaces.lock().await;
                let summaries: Vec<WorkspaceSummary> =
                    workspaces.values().map(WorkspaceSummary::from).collect();
                let _ = reply_tx
                    .send(AppEvent::WorkspaceList { workspaces: summaries })
                    .await;
            }

            AppCommand::CreateWorkspace { name, root_path, mode } => {
                let id = Uuid::new_v4();
                let now = chrono::Utc::now();
                let layout = match mode {
                    terminal_core::models::WorkspaceMode::AiSession => PaneLayout::default_ai_session(),
                    terminal_core::models::WorkspaceMode::Terminal => PaneLayout::default_terminal(),
                    terminal_core::models::WorkspaceMode::Git => PaneLayout::default_git(),
                    terminal_core::models::WorkspaceMode::Browser => PaneLayout::default_ai_session(),
                };

                let ws = Workspace {
                    id,
                    name,
                    root_path: root_path.clone(),
                    mode: mode.clone(),
                    layout,
                    linked_session_id: None,
                    mcp_config: None,
                    allowed_tools: None,
                    disallowed_tools: None,
                    created_at: now,
                    last_active_at: now,
                };

                let summary = WorkspaceSummary::from(&ws);

                // Persist before any in-memory registration. If the write
                // fails, we must not expose the workspace to clients —
                // otherwise the client sees a workspace that disappears on
                // next daemon restart (the scenario the earlier comment was
                // meant to prevent).
                if let Err(e) = self.ctx.persistence.save_workspace(&ws) {
                    warn!("Failed to persist workspace {}: {}", id, e);
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "WORKSPACE_PERSIST_FAILED".into(),
                            message: format!("Failed to persist workspace: {}", e),
                        })
                        .await;
                    return;
                }

                // Create a dedicated broadcast channel for this workspace (M1-05)
                let (ws_tx, _) = broadcast::channel(512);
                self.ctx.workspace_channels.lock().await.insert(id, ws_tx);
                self.ctx.workspaces.lock().await.insert(id, ws);

                info!("Workspace created: {} ({:?}) at {}", id, mode, root_path.display());

                self.ctx.broadcast(&AppEvent::WorkspaceCreated { workspace: summary.clone() });
                let _ = reply_tx
                    .send(AppEvent::WorkspaceCreated { workspace: summary })
                    .await;
            }

            AppCommand::CloseWorkspace { workspace_id } => {
                let removed = self.ctx.workspaces.lock().await.remove(&workspace_id);
                if let Some(ws) = removed {
                    // Remove workspace channel
                    self.ctx.workspace_channels.lock().await.remove(&workspace_id);
                    // Scrub every client's active pointer that targeted this one (M5b).
                    {
                        let mut active = self.ctx.active_workspaces.lock().await;
                        active.retain(|_, wid| *wid != workspace_id);
                    }
                    // Physically prune worktrees whose repo_root matches this
                    // workspace (#86 M17). Previously the dirs were left on disk
                    // until the next daemon restart, which could leak gigabytes
                    // for long-lived installations.
                    prune_workspace_worktrees(&self.ctx, &ws.root_path).await;
                    if let Err(e) = self.ctx.persistence.delete_workspace(workspace_id) {
                        warn!("Failed to delete persisted workspace {}: {}", workspace_id, e);
                    }
                    info!("Workspace closed: {}", workspace_id);
                    self.ctx.broadcast(&AppEvent::WorkspaceClosed { workspace_id });
                    let _ = reply_tx
                        .send(AppEvent::WorkspaceClosed { workspace_id })
                        .await;
                } else {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "WORKSPACE_NOT_FOUND".into(),
                            message: format!("Workspace {} not found", workspace_id),
                        })
                        .await;
                }
            }

            AppCommand::ActivateWorkspace { workspace_id } => {
                let updated_ws = {
                    let mut map = self.ctx.workspaces.lock().await;
                    map.get_mut(&workspace_id).map(|ws| {
                        ws.last_active_at = chrono::Utc::now();
                        ws.clone()
                    })
                };
                if let Some(ws) = updated_ws {
                    self.ctx
                        .active_workspaces
                        .lock()
                        .await
                        .insert(client_id.0, workspace_id);
                    if let Err(e) = self.ctx.persistence.save_workspace(&ws) {
                        warn!("Failed to persist workspace activation {}: {}", workspace_id, e);
                    }
                    // M5c: WorkspaceActivated is per-client — never broadcast.
                    let _ = reply_tx
                        .send(AppEvent::WorkspaceActivated { workspace_id })
                        .await;
                } else {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "WORKSPACE_NOT_FOUND".into(),
                            message: format!("Workspace {} not found", workspace_id),
                        })
                        .await;
                }
            }

            _ => {
                warn!("WorkspaceDispatcher received non-workspace command");
            }
        }
    }
}

/// Remove every worktree dir whose metadata has a `repo_root` under the given
/// workspace root, plus its metadata file. Best-effort: individual failures are
/// logged but do not block workspace close. Shared with the startup prune pass
/// in `lib.rs` in spirit, but scoped to one workspace.
async fn prune_workspace_worktrees(ctx: &DaemonContext, workspace_root: &std::path::Path) {
    let metas = match ctx.persistence.list_worktree_metas() {
        Ok(m) => m,
        Err(e) => {
            warn!("CloseWorkspace: list_worktree_metas failed: {}", e);
            return;
        }
    };

    // Canonicalize once so `/foo` and `/foo/` and `/./foo` all compare equal.
    let canonical_ws = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());

    for (run_id, meta) in metas {
        let Some(repo_root) = meta.repo_root.as_ref() else {
            continue;
        };
        let canonical_repo = repo_root
            .canonicalize()
            .unwrap_or_else(|_| repo_root.clone());
        if canonical_repo != canonical_ws {
            continue;
        }

        if meta.worktree_path.exists() {
            if let Err(e) =
                crate::git_engine::worktree_remove(repo_root, &meta.worktree_path).await
            {
                warn!(
                    "CloseWorkspace: worktree_remove failed for run {} ({:?}): {}",
                    run_id, meta.worktree_path, e
                );
                // Fall through to metadata deletion anyway — otherwise a
                // permanently-failing remove would leak the meta forever.
            }
        }

        if let Err(e) = ctx.persistence.delete_worktree_meta(run_id) {
            warn!(
                "CloseWorkspace: delete_worktree_meta failed for run {}: {}",
                run_id, e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Persistence;
    use std::path::PathBuf;
    use terminal_core::config::DaemonConfig;
    use terminal_core::models::WorkspaceMode;
    use tempfile::TempDir;

    fn make_ctx(tmp: &TempDir) -> Arc<DaemonContext> {
        let config = DaemonConfig {
            data_dir: tmp.path().to_path_buf(),
            ..Default::default()
        };
        let (tx, _) = broadcast::channel::<String>(64);
        let persistence = Arc::new(Persistence::new(tmp.path().to_path_buf()).unwrap());
        Arc::new(DaemonContext::new(config, tx, persistence))
    }

    #[tokio::test]
    async fn create_workspace_persists_to_disk() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let dispatcher = WorkspaceDispatcher::new(ctx.clone());
        let (tx, _rx) = mpsc::channel(8);

        dispatcher
            .handle(
                ClientId::new(),
                AppCommand::CreateWorkspace {
                    name: "demo".into(),
                    root_path: PathBuf::from("/tmp/demo"),
                    mode: WorkspaceMode::Terminal,
                },
                tx,
            )
            .await;

        let persisted = ctx.persistence.list_workspaces().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].name, "demo");
    }

    #[tokio::test]
    async fn close_workspace_removes_from_disk() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let dispatcher = WorkspaceDispatcher::new(ctx.clone());
        let (tx, _rx) = mpsc::channel(8);
        let client = ClientId::new();

        dispatcher
            .handle(
                client,
                AppCommand::CreateWorkspace {
                    name: "demo".into(),
                    root_path: PathBuf::from("/tmp/demo"),
                    mode: WorkspaceMode::Terminal,
                },
                tx.clone(),
            )
            .await;

        let id = *ctx.workspaces.lock().await.keys().next().unwrap();
        dispatcher
            .handle(client, AppCommand::CloseWorkspace { workspace_id: id }, tx)
            .await;

        assert!(ctx.persistence.list_workspaces().unwrap().is_empty());
        assert!(!ctx.workspaces.lock().await.contains_key(&id));
    }

    #[tokio::test]
    async fn two_clients_have_independent_active_workspaces() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let dispatcher = WorkspaceDispatcher::new(ctx.clone());
        let (tx, _rx) = mpsc::channel(32);

        // Create two workspaces
        dispatcher
            .handle(
                ClientId::new(),
                AppCommand::CreateWorkspace {
                    name: "X".into(),
                    root_path: PathBuf::from("/tmp/x"),
                    mode: WorkspaceMode::Terminal,
                },
                tx.clone(),
            )
            .await;
        dispatcher
            .handle(
                ClientId::new(),
                AppCommand::CreateWorkspace {
                    name: "Y".into(),
                    root_path: PathBuf::from("/tmp/y"),
                    mode: WorkspaceMode::Terminal,
                },
                tx.clone(),
            )
            .await;

        let ids: Vec<_> = ctx.workspaces.lock().await.keys().copied().collect();
        let (x_id, y_id) = (ids[0], ids[1]);
        let client_a = ClientId::new();
        let client_b = ClientId::new();

        dispatcher
            .handle(
                client_a,
                AppCommand::ActivateWorkspace { workspace_id: x_id },
                tx.clone(),
            )
            .await;
        dispatcher
            .handle(
                client_b,
                AppCommand::ActivateWorkspace { workspace_id: y_id },
                tx.clone(),
            )
            .await;

        let active = ctx.active_workspaces.lock().await;
        assert_eq!(active.get(&client_a.0), Some(&x_id));
        assert_eq!(active.get(&client_b.0), Some(&y_id));
    }

    #[tokio::test]
    async fn closing_workspace_scrubs_active_entries_for_all_clients() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let dispatcher = WorkspaceDispatcher::new(ctx.clone());
        let (tx, _rx) = mpsc::channel(32);

        dispatcher
            .handle(
                ClientId::new(),
                AppCommand::CreateWorkspace {
                    name: "demo".into(),
                    root_path: PathBuf::from("/tmp/demo"),
                    mode: WorkspaceMode::Terminal,
                },
                tx.clone(),
            )
            .await;
        let id = *ctx.workspaces.lock().await.keys().next().unwrap();

        let a = ClientId::new();
        let b = ClientId::new();
        dispatcher
            .handle(a, AppCommand::ActivateWorkspace { workspace_id: id }, tx.clone())
            .await;
        dispatcher
            .handle(b, AppCommand::ActivateWorkspace { workspace_id: id }, tx.clone())
            .await;
        assert_eq!(ctx.active_workspaces.lock().await.len(), 2);

        dispatcher
            .handle(a, AppCommand::CloseWorkspace { workspace_id: id }, tx)
            .await;
        assert!(ctx.active_workspaces.lock().await.is_empty());
    }
}
