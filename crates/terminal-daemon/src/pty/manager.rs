// PTY session manager
// Uses openpty(2) via the `nix` crate for real pseudo-terminal support.
// Supports interactive programs (vim, htop, less), signal delivery (Ctrl+C),
// and terminal resize via TIOCSWINSZ.

use std::collections::HashMap;
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::models::{SshConfig, TerminalSessionMeta, TerminalSessionSummary};
use terminal_core::protocol::v1::AppEvent;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{info, warn};
use uuid::Uuid;
use crate::safety::broadcast_event;

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
    /// Global event broadcast — used as fallback when no workspace-scoped
    /// channel is available.
    event_tx: broadcast::Sender<String>,
    /// Shared workspace-scoped broadcast channels (M5c, issue #101). Kept as
    /// an `Option` so tests that don't wire this can still run.
    workspace_channels:
        Option<Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>>,
}

impl PtyManager {
    pub fn new(event_tx: broadcast::Sender<String>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            workspace_channels: None,
        }
    }

    /// Attach the shared workspace broadcast channel map. When set, terminal
    /// events route to the owning workspace only, with fallback to the global
    /// channel if the workspace has no subscribers.
    pub fn with_workspace_channels(
        mut self,
        channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
    ) -> Self {
        self.workspace_channels = Some(channels);
        self
    }

    async fn emit(&self, workspace_id: Uuid, event: &AppEvent) {
        Self::emit_via(
            &self.event_tx,
            self.workspace_channels.as_ref(),
            workspace_id,
            event,
        )
        .await;
    }

    async fn emit_via(
        global: &broadcast::Sender<String>,
        channels: Option<&Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>>,
        workspace_id: Uuid,
        event: &AppEvent,
    ) {
        if let Some(map) = channels {
            let json = match serde_json::to_string(event) {
                Ok(j) => j,
                Err(e) => {
                    warn!("PTY event serialization failed: {}", e);
                    return;
                }
            };
            let guard = map.lock().await;
            if let Some(tx) = guard.get(&workspace_id) {
                let _ = tx.send(json);
                return;
            }
            drop(guard);
            // Fallback to global channel so we don't drop events.
            let _ = global.send(json);
            return;
        }
        broadcast_event(global, event);
    }

    /// Create a new PTY session using a real pseudo-terminal via openpty(2).
    pub async fn create_session(
        &self,
        workspace_id: Uuid,
        pane_id: String,
        shell: Option<String>,
        cwd: Option<PathBuf>,
        env: Option<Vec<(String, String)>>,
        ssh: Option<SshConfig>,
    ) -> Result<Uuid, String> {
        let session_id = Uuid::new_v4();

        // Determine command path, args, and whether this is an SSH session.
        let (shell_path, extra_args, is_ssh, ssh_host_label) = if let Some(ref ssh_cfg) = ssh {
            // Reject values that would be interpreted as OpenSSH flags.
            // Without this, a crafted username like "-oProxyCommand=..." or a
            // host starting with "-" turns into an argv element that ssh
            // parses as a flag rather than a destination. The arg order
            // (flags before the destination) partly mitigates this, but ssh
            // still honors flag-shaped tokens anywhere before `--`; we prefer
            // to fail explicitly.
            if ssh_cfg.username.starts_with('-') {
                return Err(format!(
                    "SSH username '{}' looks like a flag — rejected",
                    ssh_cfg.username
                ));
            }
            if ssh_cfg.host.starts_with('-') {
                return Err(format!(
                    "SSH host '{}' looks like a flag — rejected",
                    ssh_cfg.host
                ));
            }
            let mut args = vec![
                "-p".to_string(),
                ssh_cfg.port.to_string(),
                "-o".to_string(),
                "ServerAliveInterval=30".to_string(),
                "-o".to_string(),
                "ServerAliveCountMax=3".to_string(),
                "-o".to_string(),
                "StrictHostKeyChecking=accept-new".to_string(),
            ];
            if let Some(ref key) = ssh_cfg.identity_file {
                args.push("-i".to_string());
                args.push(key.to_string_lossy().to_string());
            }
            // End-of-options marker so user@host is never confused with a flag.
            args.push("--".to_string());
            args.push(format!("{}@{}", ssh_cfg.username, ssh_cfg.host));
            let label = format!("{}@{}", ssh_cfg.username, ssh_cfg.host);
            (PathBuf::from("ssh"), args, true, Some(label))
        } else {
            let path = shell
                .map(PathBuf::from)
                .or_else(|| std::env::var("SHELL").ok().map(PathBuf::from))
                .unwrap_or_else(|| PathBuf::from("/bin/bash"));
            (path, vec!["-i".to_string()], false, None)
        };

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

        // Set initial window size on master. Failure is non-fatal (the subsequent
        // resize from the frontend will correct it), but we log so silent
        // misbehavior (e.g. tiny initial size) is diagnosable.
        let ws = nix::libc::winsize {
            ws_row: 40,
            ws_col: 120,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let rc = unsafe { nix::libc::ioctl(master_raw, nix::libc::TIOCSWINSZ, &ws) };
        if rc != 0 {
            warn!(
                "initial TIOCSWINSZ failed on master fd {}: {}",
                master_raw,
                std::io::Error::last_os_error()
            );
        }

        // Build the command. pre_exec sets up the child side of the PTY.
        let mut cmd = Command::new(&shell_path);
        cmd.args(&extra_args)
            .current_dir(&work_dir)
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
        let workspace_channels_reader = self.workspace_channels.clone();
        tokio::spawn(Self::stdout_reader(
            session_id,
            workspace_id,
            master_read,
            event_tx_clone,
            workspace_channels_reader,
        ));

        // Spawn process watcher — removes session on child exit.
        // Only emits TerminalSessionClosed if the entry is still in the map;
        // an explicit close_session() removes the entry first and emits the
        // event itself, so we'd otherwise double-emit when the shell exits
        // in response to the EOF we just sent it.
        let sessions_for_watcher = Arc::clone(&self.sessions);
        let event_tx_for_watcher = self.event_tx.clone();
        let workspace_channels_watcher = self.workspace_channels.clone();
        tokio::spawn(async move {
            let mut child = child;
            let _ = child.wait().await;
            let was_present = sessions_for_watcher
                .lock()
                .await
                .remove(&session_id)
                .is_some();
            if was_present {
                Self::emit_via(
                    &event_tx_for_watcher,
                    workspace_channels_watcher.as_ref(),
                    workspace_id,
                    &AppEvent::TerminalSessionClosed { session_id },
                )
                .await;
            }
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
            is_ssh,
            ssh_host: ssh_host_label,
        };
        self.emit(workspace_id, &created_event).await;

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
        workspace_id: Uuid,
        mut reader: impl AsyncReadExt + Unpin,
        event_tx: broadcast::Sender<String>,
        workspace_channels:
            Option<Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>>,
    ) {
        let mut buf = vec![0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Real PTY line discipline handles \n → \r\n; no manual replacement needed.
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let event = AppEvent::TerminalOutput { session_id, data };
                    Self::emit_via(
                        &event_tx,
                        workspace_channels.as_ref(),
                        workspace_id,
                        &event,
                    )
                    .await;
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
    pub async fn resize(&self, session_id: Uuid, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("session not found: {}", session_id))?;

        let ws = nix::libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };

        let rc = unsafe { nix::libc::ioctl(session.master_raw_fd, nix::libc::TIOCSWINSZ, &ws) };
        if rc != 0 {
            let err = std::io::Error::last_os_error();
            warn!("PTY session {} resize failed: {}", session_id, err);
            return Err(format!("ioctl TIOCSWINSZ failed: {}", err));
        }

        info!("PTY session {} resized to {}x{}", session_id, cols, rows);
        Ok(())
    }

    /// Close a PTY session.
    pub async fn close_session(&self, session_id: Uuid) -> Result<(), String> {
        // Remove under the lock, then release before awaiting the close
        // channel send. close_tx is bounded; keeping the lock across a full
        // send could starve the watcher task that also needs `sessions`.
        let removed = self.sessions.lock().await.remove(&session_id);
        if let Some(session) = removed {
            let workspace_id = session.meta.workspace_id;
            // Signal the stdin_writer task to exit; it will drop its tokio::fs::File,
            // closing the write half of the master PTY and sending EOF to the shell.
            // The stdout_reader task will exit when it sees EOF/error.
            // We do NOT call nix::libc::close() here — the Tokio Files own the fds.
            let _ = session.close_tx.send(()).await;
            self.emit(workspace_id, &AppEvent::TerminalSessionClosed { session_id })
                .await;
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast;

    #[tokio::test]
    async fn close_nonexistent_session_returns_error() {
        let (tx, _) = broadcast::channel::<String>(16);
        let manager = PtyManager::new(tx);
        let fake_id = Uuid::new_v4();
        let result = manager.close_session(fake_id).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn write_input_nonexistent_session_returns_error() {
        let (tx, _) = broadcast::channel::<String>(16);
        let manager = PtyManager::new(tx);
        let fake_id = Uuid::new_v4();
        let result = manager.write_input(fake_id, "hello").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_sessions_empty_workspace() {
        let (tx, _) = broadcast::channel::<String>(16);
        let manager = PtyManager::new(tx);
        let sessions = manager.list_sessions(Uuid::new_v4()).await;
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn create_session_emits_event() {
        let (tx, mut rx) = broadcast::channel::<String>(16);
        let manager = PtyManager::new(tx);
        let workspace_id = Uuid::new_v4();

        let result = manager.create_session(
            workspace_id,
            "pane-1".to_string(),
            Some("/bin/sh".to_string()),
            Some(PathBuf::from("/tmp")),
            None,
            None,
        ).await;

        assert!(result.is_ok(), "create_session failed: {:?}", result.err());
        let session_id = result.unwrap();

        // Drain events until we find TerminalSessionCreated
        let mut found = false;
        for _ in 0..10 {
            if let Ok(msg) = rx.try_recv() {
                if msg.contains("TerminalSessionCreated") {
                    found = true;
                    assert!(msg.contains(&session_id.to_string()));
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(found, "Expected TerminalSessionCreated event");

        // Cleanup
        let _ = manager.close_session(session_id).await;
    }
}
