use crate::claude_runner::{output_file_path, ClaudeRunner, RunnerEvent};
use std::collections::HashMap;
use std::sync::Arc;
use terminal_core::config::DaemonConfig;
use terminal_core::models::*;
use terminal_core::protocol::v1::*;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{info, warn};
use uuid::Uuid;

/// Internal state for tracking active runs.
struct ActiveRun {
    #[allow(dead_code)]
    run: Run,
    cancel_tx: mpsc::Sender<String>,
    stdin_tx: mpsc::Sender<String>,
}

pub struct Dispatcher {
    config: DaemonConfig,
    event_tx: broadcast::Sender<String>,
    runner: ClaudeRunner,
    active_runs: Arc<Mutex<HashMap<Uuid, ActiveRun>>>,
    sessions: Arc<Mutex<HashMap<Uuid, Session>>>,
}

impl Dispatcher {
    pub fn new(config: DaemonConfig, event_tx: broadcast::Sender<String>) -> Self {
        let runner = ClaudeRunner::new(config.clone());
        Self {
            config,
            event_tx,
            runner,
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Broadcast an event to all connected clients.
    fn broadcast(&self, event: &AppEvent) {
        let json = serde_json::to_string(event).unwrap();
        let _ = self.event_tx.send(json);
    }

    /// Handle a command and send response to the requesting client.
    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        match cmd {
            AppCommand::Auth { .. } => {
                // Auth is handled at the server level, not here
            }

            AppCommand::GetStatus => {
                let runs = self.active_runs.lock().await;
                let sessions = self.sessions.lock().await;
                let _ = reply_tx
                    .send(AppEvent::StatusUpdate {
                        active_runs: runs.len(),
                        session_count: sessions.len(),
                    })
                    .await;
            }

            AppCommand::Ping => {
                let _ = reply_tx.send(AppEvent::Pong).await;
            }

            AppCommand::StartSession { project_root } => {
                let session_id = Uuid::new_v4();
                let session = Session {
                    id: session_id,
                    project_root: project_root.clone(),
                    initial_head: String::new(), // Phase 2: read from git
                    active_run: None,
                    runs: vec![],
                    commands: vec![],
                    started_at: chrono::Utc::now(),
                    ended_at: None,
                };

                let summary = SessionSummary {
                    id: session_id,
                    project_root,
                    active_run: None,
                    run_count: 0,
                    started_at: session.started_at,
                };

                self.sessions.lock().await.insert(session_id, session);
                let _ = reply_tx
                    .send(AppEvent::SessionStarted { session: summary })
                    .await;
            }

            AppCommand::EndSession { session_id } => {
                let mut sessions = self.sessions.lock().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.ended_at = Some(chrono::Utc::now());
                    let _ = reply_tx
                        .send(AppEvent::SessionEnded { session_id })
                        .await;
                } else {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "SESSION_NOT_FOUND".into(),
                            message: format!("Session {} not found", session_id),
                        })
                        .await;
                }
            }

            AppCommand::ListSessions => {
                let sessions = self.sessions.lock().await;
                let summaries: Vec<SessionSummary> = sessions
                    .values()
                    .map(|s| SessionSummary {
                        id: s.id,
                        project_root: s.project_root.clone(),
                        active_run: s.active_run,
                        run_count: s.runs.len(),
                        started_at: s.started_at,
                    })
                    .collect();
                let _ = reply_tx
                    .send(AppEvent::SessionList {
                        sessions: summaries,
                    })
                    .await;
            }

            AppCommand::ListRuns { session_id } => {
                let sessions = self.sessions.lock().await;
                match sessions.get(&session_id) {
                    Some(_session) => {
                        // Phase 1: only active runs tracked in memory
                        let runs = self.active_runs.lock().await;
                        let summaries: Vec<RunSummary> = runs
                            .values()
                            .filter(|r| r.run.session_id == session_id)
                            .map(|r| RunSummary {
                                id: r.run.id,
                                state: r.run.state.clone(),
                                prompt_preview: r.run.prompt.chars().take(100).collect(),
                                modified_file_count: r.run.modified_files.len(),
                                started_at: r.run.started_at,
                                ended_at: r.run.ended_at,
                            })
                            .collect();
                        let _ = reply_tx
                            .send(AppEvent::RunList {
                                session_id,
                                runs: summaries,
                            })
                            .await;
                    }
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "SESSION_NOT_FOUND".into(),
                                message: format!("Session {} not found", session_id),
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetRunStatus { run_id } => {
                let runs = self.active_runs.lock().await;
                match runs.get(&run_id) {
                    Some(active) => {
                        let _ = reply_tx
                            .send(AppEvent::RunStateChanged {
                                run_id,
                                new_state: active.run.state.clone(),
                            })
                            .await;
                    }
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "RUN_NOT_FOUND".into(),
                                message: format!("No active run {}", run_id),
                            })
                            .await;
                    }
                }
            }

            AppCommand::StartRun {
                session_id,
                prompt,
                mode,
            } => {
                // Check session exists and has no active run
                let mut sessions = self.sessions.lock().await;
                let session = match sessions.get_mut(&session_id) {
                    Some(s) => s,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "SESSION_NOT_FOUND".into(),
                                message: format!("Session {} not found", session_id),
                            })
                            .await;
                        return;
                    }
                };

                if session.active_run.is_some() {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "RUN_ALREADY_ACTIVE".into(),
                            message: "Session already has an active run".into(),
                        })
                        .await;
                    return;
                }

                let run_id = Uuid::new_v4();
                let output_path = output_file_path(&self.config.data_dir, &run_id);

                // Create output directory
                if let Some(parent) = output_path.parent() {
                    if let Err(e) = tokio::fs::create_dir_all(parent).await {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "IO_ERROR".into(),
                                message: format!("Failed to create output dir: {}", e),
                            })
                            .await;
                        return;
                    }
                }

                let run = Run {
                    id: run_id,
                    session_id,
                    branch: String::new(), // Phase 2: sandbox branch
                    mode: mode.clone(),
                    state: RunState::Preparing,
                    prompt: prompt.clone(),
                    provided_files: vec![],
                    modified_files: vec![],
                    expanded_files: vec![],
                    output_path: output_path.clone(),
                    output_line_count: 0,
                    output_byte_count: 0,
                    started_at: chrono::Utc::now(),
                    ended_at: None,
                };

                session.active_run = Some(run_id);
                session.runs.push(run_id);

                // Broadcast state change
                self.broadcast(&AppEvent::RunStateChanged {
                    run_id,
                    new_state: RunState::Preparing,
                });

                let working_dir = session.project_root.clone();
                drop(sessions); // Release lock before spawning

                // Spawn claude process
                match self.runner.spawn(run_id, &prompt, &mode, &working_dir) {
                    Ok((mut event_rx, stdin_tx, mut child)) => {
                        let (cancel_tx, mut cancel_rx) = mpsc::channel::<String>(1);

                        let active_run = ActiveRun {
                            run: run.clone(),
                            cancel_tx,
                            stdin_tx: stdin_tx.clone(),
                        };
                        self.active_runs.lock().await.insert(run_id, active_run);

                        // Transition to Running
                        self.broadcast(&AppEvent::RunStateChanged {
                            run_id,
                            new_state: RunState::Running,
                        });

                        // Supervisor task
                        let event_tx = self.event_tx.clone();
                        let active_runs = self.active_runs.clone();
                        let sessions = self.sessions.clone();
                        let timeout_secs = self.config.run_timeout_secs;

                        tokio::spawn(async move {
                            let mut line_number: usize = 0;
                            let mut output_file = tokio::fs::OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(&output_path)
                                .await
                                .ok();

                            let timeout =
                                tokio::time::sleep(std::time::Duration::from_secs(timeout_secs));
                            tokio::pin!(timeout);

                            loop {
                                tokio::select! {
                                    event = event_rx.recv() => {
                                        match event {
                                            Some(RunnerEvent::StdoutLine(line)) => {
                                                line_number += 1;
                                                // Write to disk
                                                if let Some(ref mut f) = output_file {
                                                    let _ = tokio::io::AsyncWriteExt::write_all(
                                                        f,
                                                        format!("{}\n", line).as_bytes(),
                                                    ).await;
                                                }
                                                // Broadcast to clients
                                                let evt = AppEvent::RunOutput {
                                                    run_id,
                                                    line,
                                                    line_number,
                                                };
                                                let json = serde_json::to_string(&evt).unwrap();
                                                let _ = event_tx.send(json);
                                            }
                                            Some(RunnerEvent::StderrLine(line)) => {
                                                line_number += 1;
                                                if let Some(ref mut f) = output_file {
                                                    let _ = tokio::io::AsyncWriteExt::write_all(
                                                        f,
                                                        format!("[stderr] {}\n", line).as_bytes(),
                                                    ).await;
                                                }
                                                let evt = AppEvent::RunOutput {
                                                    run_id,
                                                    line: format!("[stderr] {}", line),
                                                    line_number,
                                                };
                                                let json = serde_json::to_string(&evt).unwrap();
                                                let _ = event_tx.send(json);
                                            }
                                            Some(RunnerEvent::BlockingDetected(question)) => {
                                                let evt = AppEvent::RunBlocking {
                                                    run_id,
                                                    question: question.clone(),
                                                    context: vec![],
                                                };
                                                let json = serde_json::to_string(&evt).unwrap();
                                                let _ = event_tx.send(json);
                                                let state_evt = AppEvent::RunStateChanged {
                                                    run_id,
                                                    new_state: RunState::WaitingInput {
                                                        question,
                                                        context: vec![],
                                                    },
                                                };
                                                let json = serde_json::to_string(&state_evt).unwrap();
                                                let _ = event_tx.send(json);
                                            }
                                            Some(RunnerEvent::MalformedOutput { partial }) => {
                                                warn!("Malformed output for run {}: {}", run_id, partial);
                                            }
                                            Some(RunnerEvent::SpawnError(e)) => {
                                                let evt = AppEvent::RunFailed {
                                                    run_id,
                                                    error: e,
                                                    phase: FailPhase::Execution,
                                                };
                                                let json = serde_json::to_string(&evt).unwrap();
                                                let _ = event_tx.send(json);
                                                break;
                                            }
                                            Some(RunnerEvent::ProcessExited { .. }) => {
                                                // Handled via channel close (None) below
                                            }
                                            None => {
                                                // Channel closed — process exited
                                                let exit_code = child.wait().await
                                                    .map(|s| s.code().unwrap_or(-1))
                                                    .unwrap_or(-1);

                                                let summary = RunSummary {
                                                    id: run_id,
                                                    state: RunState::Completed { exit_code },
                                                    prompt_preview: String::new(),
                                                    modified_file_count: 0,
                                                    started_at: chrono::Utc::now(),
                                                    ended_at: Some(chrono::Utc::now()),
                                                };
                                                let evt = AppEvent::RunCompleted { run_id, summary };
                                                let json = serde_json::to_string(&evt).unwrap();
                                                let _ = event_tx.send(json);
                                                break;
                                            }
                                        }
                                    }
                                    reason = cancel_rx.recv() => {
                                        if let Some(reason) = reason {
                                            info!("Cancelling run {}: {}", run_id, reason);
                                            let _ = child.kill().await;
                                            let evt = AppEvent::RunCancelled { run_id };
                                            let json = serde_json::to_string(&evt).unwrap();
                                            let _ = event_tx.send(json);
                                            break;
                                        }
                                    }
                                    _ = &mut timeout => {
                                        warn!("Run {} timed out", run_id);
                                        let _ = child.kill().await;
                                        let evt = AppEvent::RunFailed {
                                            run_id,
                                            error: "Run timed out".into(),
                                            phase: FailPhase::Execution,
                                        };
                                        let json = serde_json::to_string(&evt).unwrap();
                                        let _ = event_tx.send(json);
                                        break;
                                    }
                                }
                            }

                            // Cleanup
                            active_runs.lock().await.remove(&run_id);
                            if let Some(session) = sessions.lock().await.get_mut(&session_id) {
                                session.active_run = None;
                            }
                            info!("Run {} finished", run_id);
                        });

                        let _ = reply_tx
                            .send(AppEvent::RunStateChanged {
                                run_id,
                                new_state: RunState::Running,
                            })
                            .await;
                    }
                    Err(e) => {
                        // Cleanup session
                        let mut sessions = self.sessions.lock().await;
                        if let Some(session) = sessions.get_mut(&session_id) {
                            session.active_run = None;
                        }
                        let _ = reply_tx
                            .send(AppEvent::RunFailed {
                                run_id,
                                error: e,
                                phase: FailPhase::Preparation,
                            })
                            .await;
                    }
                }
            }

            AppCommand::CancelRun { run_id, reason } => {
                let runs = self.active_runs.lock().await;
                if let Some(active) = runs.get(&run_id) {
                    let _ = active.cancel_tx.send(reason).await;
                } else {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "RUN_NOT_FOUND".into(),
                            message: format!("No active run {}", run_id),
                        })
                        .await;
                }
            }

            AppCommand::RespondToBlocking { run_id, response } => {
                let runs = self.active_runs.lock().await;
                if let Some(active) = runs.get(&run_id) {
                    let _ = active.stdin_tx.send(response).await;
                    self.broadcast(&AppEvent::RunStateChanged {
                        run_id,
                        new_state: RunState::Running,
                    });
                } else {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "RUN_NOT_FOUND".into(),
                            message: format!("No active run {}", run_id),
                        })
                        .await;
                }
            }

            AppCommand::GetRunOutput {
                run_id,
                offset,
                limit,
            } => {
                let output_path = output_file_path(&self.config.data_dir, &run_id);
                match tokio::fs::read_to_string(&output_path).await {
                    Ok(content) => {
                        let all_lines: Vec<String> =
                            content.lines().map(|l| l.to_string()).collect();
                        let start = offset as usize;
                        let end = (start + limit as usize).min(all_lines.len());
                        let page = if start < all_lines.len() {
                            all_lines[start..end].to_vec()
                        } else {
                            vec![]
                        };
                        let has_more = end < all_lines.len();

                        let _ = reply_tx
                            .send(AppEvent::RunOutputPage {
                                run_id,
                                offset,
                                lines: page,
                                has_more,
                            })
                            .await;
                    }
                    Err(_) => {
                        let _ = reply_tx
                            .send(AppEvent::RunOutputPage {
                                run_id,
                                offset,
                                lines: vec![],
                                has_more: false,
                            })
                            .await;
                    }
                }
            }

        }
    }
}
