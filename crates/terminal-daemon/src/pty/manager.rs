// PTY session manager
// Uses openpty(2) via the `nix` crate for real pseudo-terminal support.
// Supports interactive programs (vim, htop, less), signal delivery (Ctrl+C),
// and terminal resize via TIOCSWINSZ.

use std::collections::HashMap;
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::models::{TerminalSessionMeta, TerminalSessionSummary};
use terminal_core::protocol::v1::AppEvent;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::info;
use uuid::Uuid;

/// A live PTY session.
pub struct PtySession {
    pub meta: TerminalSessionMeta,
    pub stdin_tx: mpsc::Sender<Vec<u8>>,
    pub close_tx: mpsc::Sender<()>,
    /// Raw master fd kept alive for TIOCSWINSZ ioctls.
    pub master_raw_fd: i32,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<Uuid, PtySession>>>,
    /// Global event broadcast (workspace-scoped routing happens in caller)
    event_tx: broadcast::Sender<String>,
}

impl PtyManager {
    pub fn new(event_tx: broadcast::Sender<String>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    /// Create a new PTY session using a real pseudo-terminal via openpty(2).
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

        // Open PTY pair. openpty returns master + slave OwnedFds.
        let pty_result = nix::pty::openpty(None, None)
            .map_err(|e| format!("openpty failed: {}", e))?;

        let master_fd = pty_result.master;
        let slave_fd = pty_result.slave;

        let master_raw = master_fd.as_raw_fd();
        let slave_raw = slave_fd.as_raw_fd();

        // Set initial window size on master.
        let ws = nix::libc::winsize {
            ws_row: 40,
            ws_col: 120,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        unsafe { nix::libc::ioctl(master_raw, nix::libc::TIOCSWINSZ, &ws) };

        // Build the command. pre_exec sets up the child side of the PTY.
        let mut cmd = Command::new(&shell_path);
        cmd.current_dir(&work_dir)
            .env("TERM", "xterm-256color")
            .kill_on_drop(true)
            // Suppress Tokio's default piped stdio — we handle it via PTY.
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        // Apply caller-supplied environment variables.
        if let Some(ref env_vars) = env {
            for (k, v) in env_vars {
                cmd.env(k, v);
            }
        }

        // SAFETY: pre_exec runs after fork() but before exec() in the child.
        // All operations here are async-signal-safe (setsid, ioctl, dup2, close).
        unsafe {
            cmd.pre_exec(move || {
                // Create a new session so the slave becomes the controlling terminal.
                nix::libc::setsid();
                // Set the slave PTY as the controlling terminal of the new session.
                nix::libc::ioctl(slave_raw, nix::libc::TIOCSCTTY, 0_i32);
                // Wire slave fd to stdin/stdout/stderr.
                nix::libc::dup2(slave_raw, 0);
                nix::libc::dup2(slave_raw, 1);
                nix::libc::dup2(slave_raw, 2);
                // Close the original slave fd if it isn't one of 0/1/2.
                if slave_raw > 2 {
                    nix::libc::close(slave_raw);
                }
                // Close master in child — only the parent uses master.
                nix::libc::close(master_raw);
                Ok(())
            });
        }

        let child = cmd.spawn().map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Drop slave in parent — parent only ever touches master.
        drop(slave_fd);

        // Build async read/write halves from the master fd.
        // SAFETY: master_fd is a valid, open file descriptor owned by this scope.
        // We transfer ownership to std::fs::File which then hands it to Tokio.
        let master_file_read = unsafe { std::fs::File::from_raw_fd(master_raw) };
        let master_file_write = master_file_read
            .try_clone()
            .map_err(|e| format!("clone master fd: {}", e))?;

        // Prevent OwnedFd from closing master_raw when it drops — File now owns it.
        std::mem::forget(master_fd);

        let master_read = tokio::fs::File::from_std(master_file_read);
        let master_write = tokio::fs::File::from_std(master_file_write);

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

        // Spawn stdin writer task (writes to PTY master).
        tokio::spawn(Self::stdin_writer(master_write, stdin_rx, close_rx));

        // Spawn stdout reader task (reads from PTY master — single stream, PTY merges stdout+stderr).
        let event_tx_clone = self.event_tx.clone();
        tokio::spawn(Self::stdout_reader(session_id, master_read, event_tx_clone));

        // Spawn process watcher — removes session on child exit.
        let sessions_for_watcher = Arc::clone(&self.sessions);
        let event_tx_for_watcher = self.event_tx.clone();
        tokio::spawn(async move {
            let mut child = child;
            let _ = child.wait().await;
            sessions_for_watcher.lock().await.remove(&session_id);
            let json = serde_json::to_string(&AppEvent::TerminalSessionClosed { session_id })
                .expect("serialization");
            let _ = event_tx_for_watcher.send(json);
            info!("PTY session {} exited", session_id);
        });

        let session = PtySession {
            meta,
            stdin_tx,
            close_tx,
            master_raw_fd: master_raw,
        };
        self.sessions.lock().await.insert(session_id, session);

        // Suppress unused warning — summary is available for callers who need it.
        let _ = summary;

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
        mut writer: tokio::fs::File,
        mut rx: mpsc::Receiver<Vec<u8>>,
        mut close: mpsc::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                Some(data) = rx.recv() => {
                    if writer.write_all(&data).await.is_err() { break; }
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
                    // Real PTY line discipline handles \n → \r\n; no manual replacement needed.
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

    /// Resize the PTY window via TIOCSWINSZ ioctl on the master fd.
    pub async fn resize(&self, session_id: Uuid, cols: u16, rows: u16) {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(&session_id) {
            let ws = nix::libc::winsize {
                ws_row: rows,
                ws_col: cols,
                ws_xpixel: 0,
                ws_ypixel: 0,
            };
            unsafe {
                nix::libc::ioctl(session.master_raw_fd, nix::libc::TIOCSWINSZ, &ws);
            }
            info!("PTY session {} resized to {}x{}", session_id, cols, rows);
        }
    }

    /// Close a PTY session.
    pub async fn close_session(&self, session_id: Uuid) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(&session_id) {
            let _ = session.close_tx.send(()).await;
            // Closing the master fd signals EOF to the shell, causing it to exit.
            unsafe { nix::libc::close(session.master_raw_fd) };
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
