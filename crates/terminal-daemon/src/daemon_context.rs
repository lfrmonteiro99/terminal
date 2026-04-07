// DaemonContext — shared state across all domain dispatchers (M1-04)

use crate::claude_runner::ClaudeRunner;
use crate::persistence::Persistence;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::config::DaemonConfig;
use terminal_core::models::{Session, Workspace};
use terminal_core::protocol::v1::AppEvent;
use tokio::sync::{broadcast, mpsc, Mutex};
use uuid::Uuid;

/// Internal state for tracking active runs.
pub struct ActiveRun {
    #[allow(dead_code)]
    pub run: terminal_core::models::Run,
    pub cancel_tx: mpsc::Sender<String>,
    pub stdin_tx: mpsc::Sender<String>,
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
    /// Active workspace id per client (simplified: global for now)
    pub active_workspace_id: Arc<Mutex<Option<Uuid>>>,
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
            active_workspace_id: Arc::new(Mutex::new(None)),
            workspace_channels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Broadcast an event to all connected clients (global channel).
    pub fn broadcast(&self, event: &AppEvent) {
        let json = serde_json::to_string(event).expect("event serialization never fails");
        let _ = self.event_tx.send(json);
    }

    /// Broadcast an event to a specific workspace channel, falling back to global.
    pub async fn broadcast_workspace(&self, workspace_id: Uuid, event: &AppEvent) {
        let json = serde_json::to_string(event).expect("event serialization never fails");
        let channels = self.workspace_channels.lock().await;
        if let Some(tx) = channels.get(&workspace_id) {
            let _ = tx.send(json);
        } else {
            let _ = self.event_tx.send(json);
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
