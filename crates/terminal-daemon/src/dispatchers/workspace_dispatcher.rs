// Workspace domain dispatcher (M1-04, M1-05)

use crate::daemon_context::DaemonContext;
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

    pub async fn handle(
        &self,
        cmd: AppCommand,
        client_id: Uuid,
        reply_tx: mpsc::Sender<AppEvent>,
    ) {
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
                    created_at: now,
                    last_active_at: now,
                };

                // Create a dedicated broadcast channel for this workspace (M1-05)
                let (ws_tx, _) = broadcast::channel(512);
                self.ctx.workspace_channels.lock().await.insert(id, ws_tx);

                let summary = WorkspaceSummary::from(&ws);

                // Persist before registering in-memory so a crash doesn't leave a
                // ghost workspace that can't be recovered (C5b, issue #98).
                if let Err(e) = self.ctx.persistence.save_workspace(&ws) {
                    warn!("Failed to persist workspace {}: {}", id, e);
                }
                self.ctx.workspaces.lock().await.insert(id, ws);

                info!("Workspace created: {} ({:?}) at {}", id, mode, root_path.display());

                self.ctx.broadcast(&AppEvent::WorkspaceCreated { workspace: summary.clone() });
                let _ = reply_tx
                    .send(AppEvent::WorkspaceCreated { workspace: summary })
                    .await;
            }

            AppCommand::CloseWorkspace { workspace_id } => {
                let removed = self.ctx.workspaces.lock().await.remove(&workspace_id);
                if removed.is_some() {
                    // Remove workspace channel
                    self.ctx.workspace_channels.lock().await.remove(&workspace_id);
                    // Scrub every client's active pointer that targeted this one (M5b).
                    {
                        let mut active = self.ctx.active_workspaces.lock().await;
                        active.retain(|_, wid| *wid != workspace_id);
                    }
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
                        .insert(client_id, workspace_id);
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
                AppCommand::CreateWorkspace {
                    name: "demo".into(),
                    root_path: PathBuf::from("/tmp/demo"),
                    mode: WorkspaceMode::Terminal,
                },
                Uuid::new_v4(),
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
        let client = Uuid::new_v4();

        dispatcher
            .handle(
                AppCommand::CreateWorkspace {
                    name: "demo".into(),
                    root_path: PathBuf::from("/tmp/demo"),
                    mode: WorkspaceMode::Terminal,
                },
                client,
                tx.clone(),
            )
            .await;

        let id = *ctx.workspaces.lock().await.keys().next().unwrap();
        dispatcher
            .handle(AppCommand::CloseWorkspace { workspace_id: id }, client, tx)
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
                AppCommand::CreateWorkspace {
                    name: "X".into(),
                    root_path: PathBuf::from("/tmp/x"),
                    mode: WorkspaceMode::Terminal,
                },
                Uuid::new_v4(),
                tx.clone(),
            )
            .await;
        dispatcher
            .handle(
                AppCommand::CreateWorkspace {
                    name: "Y".into(),
                    root_path: PathBuf::from("/tmp/y"),
                    mode: WorkspaceMode::Terminal,
                },
                Uuid::new_v4(),
                tx.clone(),
            )
            .await;

        let ids: Vec<_> = ctx.workspaces.lock().await.keys().copied().collect();
        let (x_id, y_id) = (ids[0], ids[1]);
        let client_a = Uuid::new_v4();
        let client_b = Uuid::new_v4();

        dispatcher
            .handle(
                AppCommand::ActivateWorkspace { workspace_id: x_id },
                client_a,
                tx.clone(),
            )
            .await;
        dispatcher
            .handle(
                AppCommand::ActivateWorkspace { workspace_id: y_id },
                client_b,
                tx.clone(),
            )
            .await;

        let active = ctx.active_workspaces.lock().await;
        assert_eq!(active.get(&client_a), Some(&x_id));
        assert_eq!(active.get(&client_b), Some(&y_id));
    }

    #[tokio::test]
    async fn closing_workspace_scrubs_active_entries_for_all_clients() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let dispatcher = WorkspaceDispatcher::new(ctx.clone());
        let (tx, _rx) = mpsc::channel(32);

        dispatcher
            .handle(
                AppCommand::CreateWorkspace {
                    name: "demo".into(),
                    root_path: PathBuf::from("/tmp/demo"),
                    mode: WorkspaceMode::Terminal,
                },
                Uuid::new_v4(),
                tx.clone(),
            )
            .await;
        let id = *ctx.workspaces.lock().await.keys().next().unwrap();

        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        dispatcher
            .handle(AppCommand::ActivateWorkspace { workspace_id: id }, a, tx.clone())
            .await;
        dispatcher
            .handle(AppCommand::ActivateWorkspace { workspace_id: id }, b, tx.clone())
            .await;
        assert_eq!(ctx.active_workspaces.lock().await.len(), 2);

        dispatcher
            .handle(AppCommand::CloseWorkspace { workspace_id: id }, a, tx)
            .await;
        assert!(ctx.active_workspaces.lock().await.is_empty());
    }
}
