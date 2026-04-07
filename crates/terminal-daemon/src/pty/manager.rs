// PTY session manager (M4-01)
// Manages pseudo-terminal sessions for Terminal Mode panes.
// Uses `script` / `bash` via tokio::process — no libpseudo, works on Linux.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::models::{TerminalSessionMeta, TerminalSessionSummary};
use terminal_core::protocol::v1::AppEvent;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::info;
use uuid::Uuid;

/// A live PTY session.
pub struct PtySession {
    pub meta: TerminalSessionMeta,
    pub stdin_tx: mpsc::Sender<Vec<u8>>,
    pub close_tx: mpsc::Sender<()>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<Uuid, PtySession>>>,
    /// Global event broadcast (M1-05: workspace-scoped routing happens in caller)
    event_tx: broadcast::Sender<String>,
}

impl PtyManager {
    pub fn new(event_tx: broadcast::Sender<String>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    /// Create a new PTY session using a subprocess with piped stdin/stdout.
    pub async fn create_session(
        &self,
        workspace_id: Uuid,
        pane_id: String,
        shell: Option<String>,
        cwd: Option<PathBuf>,
        env: Option<Vec<(String, String)>>,
    ) -> Result<Uuid, String> {
        let session_id = Uuid::new_v4();
        let shell_path = shell
            .map(PathBuf::from)
            .or_else(|| std::env::var("SHELL").ok().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("/bin/bash"));

        let work_dir = cwd.unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"))
        });

        let mut cmd = Command::new(&shell_path);
        cmd.arg("-i") // Force interactive mode (shows prompt even with piped stdin)
            .current_dir(&work_dir)
            .env("TERM", "xterm-256color")
            .env("PS1", "\\w $ ")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // Apply environment
        if let Some(ref env_vars) = env {
            for (k, v) in env_vars {
                cmd.env(k, v);
            }
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");
        let stdin = child.stdin.take().expect("stdin piped");

        let (stdin_tx, stdin_rx) = mpsc::channel::<Vec<u8>>(64);
        let (close_tx, close_rx) = mpsc::channel::<()>(1);

        let now = chrono::Utc::now();
        let meta = TerminalSessionMeta {
            session_id,
            workspace_id,
            pane_id: pane_id.clone(),
            shell_path: shell_path.clone(),
            cwd: work_dir.clone(),
            env_snapshot: env.unwrap_or_default(),
            created_at: now,
            last_active_at: now,
        };

        let summary = TerminalSessionSummary {
            session_id,
            workspace_id,
            shell: shell_path.to_string_lossy().to_string(),
            cwd: work_dir.clone(),
            created_at: now,
            last_active_at: now,
        };

        // Spawn stdin writer task
        tokio::spawn(Self::stdin_writer(stdin, stdin_rx, close_rx));

        // Spawn stdout reader task
        let event_tx_clone = self.event_tx.clone();
        tokio::spawn(Self::stdout_reader(
            session_id,
            stdout,
            event_tx_clone.clone(),
        ));

        // Spawn stderr reader task
        tokio::spawn(Self::stdout_reader(session_id, stderr, event_tx_clone));

        // Spawn process watcher
        let sessions_for_watcher = Arc::clone(&self.sessions);
        let event_tx_for_watcher = self.event_tx.clone();
        tokio::spawn(async move {
            let _ = child.wait().await;
            sessions_for_watcher.lock().await.remove(&session_id);
            let json = serde_json::to_string(&AppEvent::TerminalSessionClosed { session_id })
                .expect("serialization");
            let _ = event_tx_for_watcher.send(json);
            info!("PTY session {} exited", session_id);
        });

        let session = PtySession { meta, stdin_tx, close_tx };
        self.sessions.lock().await.insert(session_id, session);

        let created_event = AppEvent::TerminalSessionCreated {
            session_id,
            workspace_id,
            shell: shell_path.to_string_lossy().to_string(),
            cwd: work_dir,
        };
        let json = serde_json::to_string(&created_event).expect("serialization");
        let _ = self.event_tx.send(json);

        info!("PTY session {} created for workspace {}", session_id, workspace_id);
        Ok(session_id)
    }

    async fn stdin_writer(
        mut stdin: ChildStdin,
        mut rx: mpsc::Receiver<Vec<u8>>,
        mut close: mpsc::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                Some(data) = rx.recv() => {
                    if stdin.write_all(&data).await.is_err() { break; }
                }
                _ = close.recv() => { break; }
            }
        }
    }

    async fn stdout_reader(
        session_id: Uuid,
        mut reader: impl AsyncReadExt + Unpin,
        event_tx: broadcast::Sender<String>,
    ) {
        let mut buf = vec![0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let event = AppEvent::TerminalOutput { session_id, data };
                    let json = serde_json::to_string(&event).expect("serialization");
                    let _ = event_tx.send(json);
                }
            }
        }
    }

    /// Write data to a PTY session's stdin.
    pub async fn write_input(&self, session_id: Uuid, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(&session_id) {
            session
                .stdin_tx
                .send(data.as_bytes().to_vec())
                .await
                .map_err(|e| e.to_string())
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }

    /// Resize is a no-op in this pipe-based implementation; PTY resize would require OS-level ioctl.
    pub async fn resize(&self, session_id: Uuid, cols: u16, rows: u16) {
        // In a full PTY implementation this would call ioctl(TIOCSWINSZ).
        // For now just log.
        info!("Resize request for session {} → {}x{}", session_id, cols, rows);
    }

    /// Close a PTY session.
    pub async fn close_session(&self, session_id: Uuid) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(&session_id) {
            let _ = session.close_tx.send(()).await;
            let json = serde_json::to_string(&AppEvent::TerminalSessionClosed { session_id })
                .expect("serialization");
            let _ = self.event_tx.send(json);
            Ok(())
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }

    /// List all sessions for a workspace.
    pub async fn list_sessions(&self, workspace_id: Uuid) -> Vec<TerminalSessionSummary> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .filter(|s| s.meta.workspace_id == workspace_id)
            .map(|s| TerminalSessionSummary {
                session_id: s.meta.session_id,
                workspace_id: s.meta.workspace_id,
                shell: s.meta.shell_path.to_string_lossy().to_string(),
                cwd: s.meta.cwd.clone(),
                created_at: s.meta.created_at,
                last_active_at: s.meta.last_active_at,
            })
            .collect()
    }
}
