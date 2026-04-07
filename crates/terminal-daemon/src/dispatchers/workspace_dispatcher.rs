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

    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
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
                let exists = self.ctx.workspaces.lock().await.contains_key(&workspace_id);
                if exists {
                    *self.ctx.active_workspace_id.lock().await = Some(workspace_id);
                    self.ctx.broadcast(&AppEvent::WorkspaceActivated { workspace_id });
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
