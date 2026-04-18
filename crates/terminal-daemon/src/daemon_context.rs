// DaemonContext — shared state across all domain dispatchers (M1-04)

use crate::claude_runner::ClaudeRunner;
use crate::persistence::Persistence;
use crate::safety::broadcast_event;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::config::DaemonConfig;
use terminal_core::models::{Session, Workspace};
use terminal_core::protocol::v1::AppEvent;
use tokio::sync::{broadcast, mpsc, Mutex};
use uuid::Uuid;

/// Opaque identifier for a connected WebSocket client.
/// Generated per-connection in server.rs and threaded through the command channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ClientId(pub Uuid);

impl ClientId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

/// Internal state for tracking active runs.
pub struct ActiveRun {
    #[allow(dead_code)]
    pub run: terminal_core::models::Run,
    pub cancel_tx: mpsc::Sender<String>,
}

/// Shared daemon state passed to all domain dispatchers.
pub struct DaemonContext {
    pub config: DaemonConfig,
    pub event_tx: broadcast::Sender<String>,
    pub persistence: Arc<Persistence>,
    pub sessions: Arc<Mutex<HashMap<Uuid, Session>>>,
    pub active_runs: Arc<Mutex<HashMap<Uuid, ActiveRun>>>,
    /// project_root -> run_id (concurrency guard)
    pub concurrency: Arc<Mutex<HashMap<PathBuf, Uuid>>>,
    pub runner: Arc<ClaudeRunner>,
    /// Workspaces registry (M1-05)
    pub workspaces: Arc<Mutex<HashMap<Uuid, Workspace>>>,
    /// Per-client active workspace map (M5b, issue #100).
    /// client_id -> workspace_id. Removed on client disconnect by the WS handler.
    pub active_workspaces: Arc<Mutex<HashMap<Uuid, Uuid>>>,
    /// Workspace-scoped broadcast channels (M1-05)
    pub workspace_channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
}

impl DaemonContext {
    pub fn new(
        config: DaemonConfig,
        event_tx: broadcast::Sender<String>,
        persistence: Arc<Persistence>,
    ) -> Self {
        let runner = Arc::new(ClaudeRunner::new(config.clone()));
        Self {
            config,
            event_tx,
            persistence,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            concurrency: Arc::new(Mutex::new(HashMap::new())),
            runner,
            workspaces: Arc::new(Mutex::new(HashMap::new())),
            active_workspaces: Arc::new(Mutex::new(HashMap::new())),
            workspace_channels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Broadcast an event to all connected clients (global channel).
    pub fn broadcast(&self, event: &AppEvent) {
        broadcast_event(&self.event_tx, event);
    }

    /// Broadcast an event to a specific workspace channel. Falls back to the
    /// global channel if the workspace is unknown — typically a race during
    /// close/restart. A warning is logged so we notice leaks (M5c).
    pub async fn broadcast_workspace(&self, workspace_id: Uuid, event: &AppEvent) {
        match serde_json::to_string(event) {
            Ok(json) => {
                // Clone the sender out of the mutex before calling send() so
                // the lock is not held across the channel operation (BUG-02).
                let tx = {
                    let channels = self.workspace_channels.lock().await;
                    channels.get(&workspace_id).cloned()
                };
                if let Some(tx) = tx {
                    let _ = tx.send(json);
                } else {
                    tracing::warn!(
                        "broadcast_workspace: no channel for workspace {}, \
                         falling back to global (likely a close/create race)",
                        workspace_id,
                    );
                    let _ = self.event_tx.send(json);
                }
            }
            Err(e) => tracing::error!("Failed to serialize workspace event: {}", e),
        }
    }

    /// Find the project root for the first active session (legacy helper).
    pub async fn find_active_project_root(&self) -> Option<PathBuf> {
        let sessions = self.sessions.lock().await;
        sessions.values().next().map(|s| s.project_root.clone())
    }

    /// Find project root for a given run id.
    pub async fn find_project_root(&self, run_id: Uuid) -> Option<PathBuf> {
        // Check active runs
        {
            let active = self.active_runs.lock().await;
            if let Some(ar) = active.get(&run_id) {
                let sessions = self.sessions.lock().await;
                if let Some(s) = sessions.get(&ar.run.session_id) {
                    return Some(s.project_root.clone());
                }
            }
        }
        // Try persistence
        if let Ok(run) = self.persistence.load_run(run_id) {
            let sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get(&run.session_id) {
                return Some(s.project_root.clone());
            }
            // Try loading from persisted sessions
            if let Ok(session) = self.persistence.load_session(run.session_id) {
                return Some(session.project_root);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_ctx(tmp: &TempDir) -> Arc<DaemonContext> {
        let cfg = DaemonConfig {
            data_dir: tmp.path().to_path_buf(),
            ..Default::default()
        };
        let (tx, _) = broadcast::channel::<String>(64);
        let persistence = Arc::new(Persistence::new(tmp.path().to_path_buf()).unwrap());
        Arc::new(DaemonContext::new(cfg, tx, persistence))
    }

    #[tokio::test]
    async fn broadcast_workspace_only_reaches_subscribed_client() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let ws_a = Uuid::new_v4();
        let ws_b = Uuid::new_v4();
        let (tx_a, mut rx_a) = broadcast::channel::<String>(16);
        let (tx_b, mut rx_b) = broadcast::channel::<String>(16);
        ctx.workspace_channels.lock().await.insert(ws_a, tx_a);
        ctx.workspace_channels.lock().await.insert(ws_b, tx_b);

        ctx.broadcast_workspace(ws_a, &AppEvent::AuthSuccess).await;

        let msg_a = rx_a.recv().await.expect("ws_a should receive");
        assert!(msg_a.contains("AuthSuccess"));
        assert!(
            rx_b.try_recv().is_err(),
            "ws_b should NOT receive events targeted at ws_a"
        );
    }

    #[tokio::test]
    async fn broadcast_workspace_falls_back_to_global_when_unknown() {
        let tmp = TempDir::new().unwrap();
        let ctx = make_ctx(&tmp);
        let mut global_rx = ctx.event_tx.subscribe();

        ctx.broadcast_workspace(Uuid::new_v4(), &AppEvent::AuthSuccess)
            .await;

        let msg = global_rx.recv().await.expect("global fallback");
        assert!(msg.contains("AuthSuccess"));
    }
}
