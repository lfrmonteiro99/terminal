use crate::claude_runner::{output_file_path, RunnerEvent};
use crate::daemon_context::{ActiveRun, ClientId, DaemonContext};
use crate::guards::ConcurrencyGuard;
use crate::persistence::Persistence;
use crate::pty::PtyManager;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::config::DaemonConfig;
use terminal_core::models::*;
use terminal_core::protocol::v1::*;
use tokio::sync::{broadcast, mpsc};
use tracing::{info, warn};
use uuid::Uuid;

pub struct Dispatcher {
    context: Arc<DaemonContext>,
    pty_manager: Arc<PtyManager>,
}

fn concurrency_key_for_run(
    project_root: &std::path::Path,
    worktree_path: Option<&std::path::Path>,
) -> PathBuf {
    worktree_path
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| project_root.to_path_buf())
}

impl Dispatcher {
    pub fn new(
        config: DaemonConfig,
        event_tx: broadcast::Sender<String>,
        persistence: Arc<Persistence>,
    ) -> Self {
        let context = Arc::new(DaemonContext::new(config, event_tx.clone(), persistence));
        let pty_manager = Arc::new(
            PtyManager::new(event_tx).with_workspace_channels(context.workspace_channels.clone()),
        );
        Self {
            context,
            pty_manager,
        }
    }

    /// Broadcast an event to all connected clients.
    fn broadcast(&self, event: &AppEvent) {
        self.context.broadcast(event);
    }

    /// Load persisted workspaces from disk into the in-memory registry and
    /// create a broadcast channel for each. Called once at startup (C5b,
    /// issue #98).
    pub async fn recover_workspaces(&self) {
        let persisted = match self.context.persistence.list_workspaces() {
            Ok(v) => v,
            Err(e) => {
                warn!("recover_workspaces: list failed: {}", e);
                return;
            }
        };
        if persisted.is_empty() {
            return;
        }
        let mut workspaces = self.context.workspaces.lock().await;
        let mut channels = self.context.workspace_channels.lock().await;
        for ws in persisted {
            let id = ws.id;
            channels
                .entry(id)
                .or_insert_with(|| broadcast::channel(512).0);
            workspaces.insert(id, ws);
        }
        info!("Recovered {} persisted workspace(s)", workspaces.len());
    }

    /// Borrow the shared daemon context (used by `server.rs` to reach
    /// per-client state like `active_workspaces`).
    pub fn context(&self) -> Arc<DaemonContext> {
        self.context.clone()
    }

    /// Handle a command and send response to the requesting client.
    pub async fn handle(
        &self,
        client_id: ClientId,
        cmd: AppCommand,
        reply_tx: mpsc::Sender<AppEvent>,
    ) {
        let _ = client_id; // forwarded to workspace_dispatcher; suppressed elsewhere
        match cmd {
            AppCommand::Auth { .. } => {
                // Auth is handled at the server level, not here
            }

            // --- File viewer (TERMINAL-005) ---
            AppCommand::ReadFile { path, max_bytes } => {
                let limit = max_bytes.unwrap_or(1_048_576u64); // 1 MB default

                // Resolve against active project root when path is relative
                let project_root = self.find_active_project_root().await;
                let resolved: PathBuf = {
                    let p = PathBuf::from(&path);
                    if p.is_absolute() {
                        p
                    } else if let Some(ref root) = project_root {
                        root.join(&p)
                    } else {
                        p
                    }
                };

                // Validate path stays within project root (if we have one)
                if let Some(ref root) = project_root {
                    if let Err(e) = crate::safety::validate_path(root, &resolved) {
                        let _ = reply_tx
                            .send(AppEvent::FileReadError { path, error: e })
                            .await;
                        return;
                    }
                }

                match tokio::fs::metadata(&resolved).await {
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::FileReadError {
                                path,
                                error: e.to_string(),
                            })
                            .await;
                    }
                    Ok(meta) => {
                        let size_bytes = meta.len();

                        // Cap the actual bytes pulled from disk, not just the
                        // returned slice. Previously `tokio::fs::read` pulled
                        // the whole file into memory before truncation, so a
                        // 10 GB file (or a pseudo-file like /dev/zero, whose
                        // metadata reports size 0) would OOM the daemon.
                        let read_limit = (limit.max(8192)) as usize;
                        let raw = {
                            use tokio::io::AsyncReadExt;
                            let file = match tokio::fs::File::open(&resolved).await {
                                Ok(f) => f,
                                Err(e) => {
                                    let _ = reply_tx
                                        .send(AppEvent::FileReadError {
                                            path,
                                            error: e.to_string(),
                                        })
                                        .await;
                                    return;
                                }
                            };
                            let mut buf = Vec::with_capacity(read_limit.min(64 * 1024));
                            // `take` caps reads at read_limit bytes. One extra
                            // byte would be needed to *detect* truncation, but
                            // size_bytes already tells us that for regular files.
                            if let Err(e) = file.take(read_limit as u64).read_to_end(&mut buf).await
                            {
                                let _ = reply_tx
                                    .send(AppEvent::FileReadError {
                                        path,
                                        error: e.to_string(),
                                    })
                                    .await;
                                return;
                            }
                            buf
                        };

                        // Binary detection: null byte in first 8 KB
                        let probe_end = raw.len().min(8192);
                        if raw[..probe_end].contains(&0u8) {
                            let _ = reply_tx
                                .send(AppEvent::FileReadError {
                                    path,
                                    error: "Binary file — cannot display".into(),
                                })
                                .await;
                            return;
                        }

                        // Content is already capped by the bounded read above.
                        let text = String::from_utf8_lossy(&raw).into_owned();

                        const MAX_LINES: usize = 10_000;
                        let (content, truncated) = {
                            let line_count = text.lines().count();
                            if size_bytes > limit || line_count > MAX_LINES {
                                let truncated_text: String =
                                    text.lines().take(MAX_LINES).collect::<Vec<_>>().join("\n");
                                (truncated_text + "\n[truncated]", true)
                            } else {
                                (text, false)
                            }
                        };

                        let language = detect_language(&resolved);

                        let _ = reply_tx
                            .send(AppEvent::FileContent {
                                path,
                                content,
                                language,
                                truncated,
                                size_bytes,
                            })
                            .await;
                    }
                }
            }

            // --- Search (TERMINAL-006) ---
            AppCommand::SearchFiles {
                query,
                is_regex,
                case_sensitive,
                include_glob,
                exclude_glob,
                max_results,
                context_lines,
            } => {
                if let Some(root) = self.find_active_project_root().await {
                    let result = crate::search_engine::search_files(
                        &root,
                        &query,
                        is_regex,
                        case_sensitive,
                        include_glob.as_deref(),
                        exclude_glob.as_deref(),
                        max_results.unwrap_or(500),
                        context_lines.unwrap_or(1),
                    )
                    .await;
                    match result {
                        Ok(event) => {
                            let _ = reply_tx.send(event).await;
                        }
                        Err(e) => {
                            let _ = reply_tx
                                .send(AppEvent::Error {
                                    code: "SEARCH_ERROR".into(),
                                    message: e.to_string(),
                                })
                                .await;
                        }
                    }
                } else {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "NO_SESSION".into(),
                            message: "No active session — start a session first".into(),
                        })
                        .await;
                }
            }

            AppCommand::GetStatus => {
                let runs = self.context.active_runs.lock().await;
                let sessions = self.context.sessions.lock().await;
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

                // Read initial_head from git if applicable
                let initial_head = if crate::git_engine::is_git_repo(&project_root).await {
                    match crate::git_engine::head_oid(&project_root).await {
                        Ok(oid) => oid,
                        Err(e) => {
                            warn!("Failed to read HEAD for {}: {}", project_root.display(), e);
                            String::new()
                        }
                    }
                } else {
                    String::new()
                };

                let session = Session {
                    id: session_id,
                    project_root: project_root.clone(),
                    initial_head,
                    active_run: None,
                    runs: vec![],
                    commands: vec![],
                    started_at: chrono::Utc::now(),
                    ended_at: None,
                    last_modified: chrono::Utc::now(),
                };

                // Persist session
                if let Err(e) = self.context.persistence.save_session(&session) {
                    warn!("Failed to persist session {}: {}", session_id, e);
                }

                let summary = SessionSummary {
                    id: session_id,
                    project_root,
                    active_run: None,
                    run_count: 0,
                    started_at: session.started_at,
                };

                self.context
                    .sessions
                    .lock()
                    .await
                    .insert(session_id, session);
                let _ = reply_tx
                    .send(AppEvent::SessionStarted { session: summary })
                    .await;
            }

            AppCommand::EndSession { session_id } => {
                let mut sessions = self.context.sessions.lock().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.ended_at = Some(chrono::Utc::now());
                    session.last_modified = chrono::Utc::now();

                    // Persist updated session
                    if let Err(e) = self.context.persistence.save_session(session) {
                        warn!("Failed to persist ended session {}: {}", session_id, e);
                    }

                    let _ = reply_tx.send(AppEvent::SessionEnded { session_id }).await;
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
                let sessions = self.context.sessions.lock().await;
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
                let sessions = self.context.sessions.lock().await;
                match sessions.get(&session_id) {
                    Some(_session) => {
                        // Load persisted runs
                        let persisted_runs = self
                            .context
                            .persistence
                            .list_runs_for_session(session_id)
                            .unwrap_or_else(|e| {
                                warn!(
                                    "Failed to load persisted runs for session {}: {}",
                                    session_id, e
                                );
                                vec![]
                            });

                        // Get active runs (these have more current state)
                        let active_runs = self.context.active_runs.lock().await;

                        // Build summaries: active runs override persisted ones
                        let mut summaries_map: HashMap<Uuid, RunSummary> = HashMap::new();

                        // First, add persisted runs
                        for run in &persisted_runs {
                            summaries_map.insert(
                                run.id,
                                RunSummary {
                                    id: run.id,
                                    state: run.state.clone(),
                                    prompt_preview: run.prompt.chars().take(100).collect(),
                                    modified_file_count: run.modified_files.len(),
                                    diff_stat: None,
                                    started_at: run.started_at,
                                    ended_at: run.ended_at,
                                    autonomy: run.autonomy,
                                },
                            );
                        }

                        // Then, override with active runs (more current state)
                        for active in active_runs.values() {
                            if active.run.session_id == session_id {
                                summaries_map.insert(
                                    active.run.id,
                                    RunSummary {
                                        id: active.run.id,
                                        state: active.run.state.clone(),
                                        prompt_preview: active
                                            .run
                                            .prompt
                                            .chars()
                                            .take(100)
                                            .collect(),
                                        modified_file_count: active.run.modified_files.len(),
                                        diff_stat: None,
                                        started_at: active.run.started_at,
                                        ended_at: active.run.ended_at,
                                        autonomy: active.run.autonomy,
                                    },
                                );
                            }
                        }

                        let mut summaries: Vec<RunSummary> = summaries_map.into_values().collect();
                        summaries.sort_by_key(|r| r.started_at);

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
                // Read the state, then release the lock before awaiting the
                // reply send — don't hold active_runs across a channel await.
                let state = self
                    .context
                    .active_runs
                    .lock()
                    .await
                    .get(&run_id)
                    .map(|a| a.run.state.clone());
                match state {
                    Some(new_state) => {
                        let _ = reply_tx
                            .send(AppEvent::RunStateChanged { run_id, new_state })
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
                skip_dirty_check,
                autonomy,
                kind: _,
            } => {
                self.do_start_run(
                    client_id,
                    session_id,
                    prompt,
                    mode,
                    autonomy,
                    skip_dirty_check,
                    reply_tx,
                )
                .await;
            }

            AppCommand::SendChatMessage { run_id, .. }
            | AppCommand::EndChat { run_id }
            | AppCommand::ApprovePlan { run_id }
            | AppCommand::RejectPlan { run_id, .. } => {
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "CHAT_MODE_NOT_IMPLEMENTED".into(),
                        message: format!("Chat mode command for run {run_id} is not implemented yet"),
                    })
                    .await;
            }

            AppCommand::CancelRun { run_id, reason } => {
                // Clone the sender and release the lock before awaiting send —
                // cancel_tx has capacity 1 and a blocked send would hold the
                // active_runs lock, starving the supervisor that needs it to
                // remove the entry on completion.
                let sender = self
                    .context
                    .active_runs
                    .lock()
                    .await
                    .get(&run_id)
                    .map(|r| r.cancel_tx.clone());
                match sender {
                    Some(tx) => {
                        let _ = tx.send(reason).await;
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

            AppCommand::GetRunOutput {
                run_id,
                offset,
                limit,
            } => {
                let output_path = output_file_path(&self.context.config.data_dir, &run_id);
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

            AppCommand::GetDiff { run_id } => {
                // Load worktree metadata for this run
                match self.context.persistence.load_worktree_meta(run_id) {
                    Ok(meta) => {
                        // Compute diff_stat and diff_full from worktree
                        let wt_head = match crate::git_engine::head_oid(&meta.worktree_path).await {
                            Ok(oid) => oid,
                            Err(e) => {
                                let _ = reply_tx
                                    .send(AppEvent::Error {
                                        code: "GIT_ERROR".into(),
                                        message: format!("Failed to read worktree HEAD: {}", e),
                                    })
                                    .await;
                                return;
                            }
                        };

                        let stat = match crate::git_engine::diff_stat(
                            &meta.worktree_path,
                            &meta.base_head,
                            &wt_head,
                        )
                        .await
                        {
                            Ok(s) => s,
                            Err(e) => {
                                let _ = reply_tx
                                    .send(AppEvent::Error {
                                        code: "GIT_ERROR".into(),
                                        message: format!("Failed to compute diff stat: {}", e),
                                    })
                                    .await;
                                return;
                            }
                        };

                        let diff = match crate::git_engine::diff_full(
                            &meta.worktree_path,
                            &meta.base_head,
                            &wt_head,
                        )
                        .await
                        {
                            Ok(d) => d,
                            Err(e) => {
                                let _ = reply_tx
                                    .send(AppEvent::Error {
                                        code: "GIT_ERROR".into(),
                                        message: format!("Failed to compute full diff: {}", e),
                                    })
                                    .await;
                                return;
                            }
                        };

                        let _ = reply_tx
                            .send(AppEvent::RunDiff { run_id, stat, diff })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NOT_FOUND".into(),
                                message: format!("No worktree metadata for run {}: {}", run_id, e),
                            })
                            .await;
                    }
                }
            }

            AppCommand::RevertRun { run_id } => {
                // Load worktree metadata
                let meta = match self.context.persistence.load_worktree_meta(run_id) {
                    Ok(m) => m,
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NOT_FOUND".into(),
                                message: format!("No worktree metadata for run {}: {}", run_id, e),
                            })
                            .await;
                        return;
                    }
                };

                // Find project_root: try persistence first (load_run -> load_session)
                let project_root = self.find_project_root(run_id).await;
                let project_root = match project_root {
                    Some(pr) => pr,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NOT_FOUND".into(),
                                message: format!("Cannot find project root for run {}", run_id),
                            })
                            .await;
                        return;
                    }
                };

                // Remove worktree if it exists
                if meta.worktree_path.exists() {
                    if let Err(e) =
                        crate::git_engine::worktree_remove(&project_root, &meta.worktree_path).await
                    {
                        warn!("Failed to remove worktree for run {}: {}", run_id, e);
                    }
                }

                // Delete branch (force)
                if let Err(e) =
                    crate::git_engine::branch_delete(&project_root, &meta.branch_name, true).await
                {
                    warn!(
                        "Failed to delete branch {} for run {}: {}",
                        meta.branch_name, run_id, e
                    );
                }

                // Delete worktree metadata
                if let Err(e) = self.context.persistence.delete_worktree_meta(run_id) {
                    warn!(
                        "Failed to delete worktree metadata for run {}: {}",
                        run_id, e
                    );
                }

                // Broadcast RunReverted
                self.broadcast(&AppEvent::RunReverted { run_id });
                let _ = reply_tx.send(AppEvent::RunReverted { run_id }).await;
            }

            AppCommand::MergeRun { run_id } => {
                // Load worktree metadata
                let meta = match self.context.persistence.load_worktree_meta(run_id) {
                    Ok(m) => m,
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NOT_FOUND".into(),
                                message: format!("No worktree metadata for run {}: {}", run_id, e),
                            })
                            .await;
                        return;
                    }
                };

                // Find project_root
                let project_root = self.find_project_root(run_id).await;
                let project_root = match project_root {
                    Some(pr) => pr,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NOT_FOUND".into(),
                                message: format!("Cannot find project root for run {}", run_id),
                            })
                            .await;
                        return;
                    }
                };

                // Remove worktree before merging (can't merge into a checked-out branch)
                if meta.worktree_path.exists() {
                    if let Err(e) =
                        crate::git_engine::worktree_remove(&project_root, &meta.worktree_path).await
                    {
                        warn!(
                            "Failed to remove worktree before merge for run {}: {}",
                            run_id, e
                        );
                    }
                }

                // Attempt merge
                match crate::git_engine::merge_branch(&project_root, &meta.branch_name).await {
                    Ok(MergeResult::Conflict(conflict_paths)) => {
                        // Abort merge on conflict
                        if let Err(e) = crate::git_engine::merge_abort(&project_root).await {
                            warn!("Failed to abort merge for run {}: {}", run_id, e);
                        }

                        self.broadcast(&AppEvent::RunMergeConflict {
                            run_id,
                            conflict_paths: conflict_paths.clone(),
                        });
                        let _ = reply_tx
                            .send(AppEvent::RunMergeConflict {
                                run_id,
                                conflict_paths,
                            })
                            .await;
                    }
                    Ok(merge_result) => {
                        // Success: clean up branch and metadata
                        if let Err(e) =
                            crate::git_engine::branch_delete(&project_root, &meta.branch_name, true)
                                .await
                        {
                            warn!(
                                "Failed to delete branch after merge for run {}: {}",
                                run_id, e
                            );
                        }
                        if let Err(e) = self.context.persistence.delete_worktree_meta(run_id) {
                            warn!(
                                "Failed to delete worktree metadata after merge for run {}: {}",
                                run_id, e
                            );
                        }

                        self.broadcast(&AppEvent::RunMerged {
                            run_id,
                            merge_result: merge_result.clone(),
                        });
                        let _ = reply_tx
                            .send(AppEvent::RunMerged {
                                run_id,
                                merge_result,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "GIT_ERROR".into(),
                                message: format!("Merge failed for run {}: {}", run_id, e),
                            })
                            .await;
                    }
                }
            }

            // --- Stash operations (Phase 2.1) ---
            AppCommand::StashAndRun {
                session_id,
                prompt,
                mode,
                stash_message,
            } => {
                // Look up project_root from session
                let project_root = {
                    let sessions = self.context.sessions.lock().await;
                    match sessions.get(&session_id) {
                        Some(s) => s.project_root.clone(),
                        None => {
                            let _ = reply_tx
                                .send(AppEvent::Error {
                                    code: "SESSION_NOT_FOUND".into(),
                                    message: format!("Session {} not found", session_id),
                                })
                                .await;
                            return;
                        }
                    }
                };

                // Attempt to stash
                if let Err(e) = crate::git_engine::stash_push(&project_root, &stash_message).await {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "GIT_ERROR".into(),
                            message: format!("Failed to stash changes: {}", e),
                        })
                        .await;
                    return;
                }

                // Stash succeeded -- proceed with start run, skipping dirty check.
                // Stash-and-run flows default to Autonomous (legacy behaviour).
                self.do_start_run(
                    client_id,
                    session_id,
                    prompt,
                    mode,
                    AutonomyLevel::default(),
                    true,
                    reply_tx,
                )
                .await;
            }

            AppCommand::ListStashes => {
                let project_root = match self.find_active_project_root().await {
                    Some(pr) => pr,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NO_ACTIVE_SESSION".into(),
                                message: "No active session to resolve project root".into(),
                            })
                            .await;
                        return;
                    }
                };

                match crate::git_engine::stash_list(&project_root).await {
                    Ok(stashes) => {
                        let _ = reply_tx.send(AppEvent::StashList { stashes }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "GIT_ERROR".into(),
                                message: format!("Failed to list stashes: {}", e),
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetStashFiles { stash_index } => {
                let project_root = match self.find_active_project_root().await {
                    Some(pr) => pr,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NO_ACTIVE_SESSION".into(),
                                message: "No active session to resolve project root".into(),
                            })
                            .await;
                        return;
                    }
                };

                match crate::git_engine::stash_show_files(&project_root, stash_index).await {
                    Ok(files) => {
                        let _ = reply_tx
                            .send(AppEvent::StashFiles { stash_index, files })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "GIT_ERROR".into(),
                                message: format!("Failed to get stash files: {}", e),
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetStashDiff {
                stash_index,
                file_path,
            } => {
                let project_root = match self.find_active_project_root().await {
                    Some(pr) => pr,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NO_ACTIVE_SESSION".into(),
                                message: "No active session to resolve project root".into(),
                            })
                            .await;
                        return;
                    }
                };

                let diff = if let Some(ref fp) = file_path {
                    crate::git_engine::stash_show_file_diff(&project_root, stash_index, fp).await
                } else {
                    crate::git_engine::stash_show_diff(&project_root, stash_index).await
                };

                match diff {
                    Ok(diff_text) => {
                        let stat = crate::git_engine::stash_show_stat(&project_root, stash_index)
                            .await
                            .ok();
                        let _ = reply_tx
                            .send(AppEvent::StashDiff {
                                stash_index,
                                diff: diff_text,
                                stat,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "GIT_ERROR".into(),
                                message: format!("Failed to get stash diff: {}", e),
                            })
                            .await;
                    }
                }
            }

            AppCommand::CheckDirtyState => {
                let project_root = match self.find_active_project_root().await {
                    Some(pr) => pr,
                    None => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "NO_ACTIVE_SESSION".into(),
                                message: "No active session to resolve project root".into(),
                            })
                            .await;
                        return;
                    }
                };

                match crate::git_engine::working_dir_status(&project_root).await {
                    Ok(status) => {
                        let _ = reply_tx.send(AppEvent::DirtyState { status }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "GIT_ERROR".into(),
                                message: format!("Failed to check dirty state: {}", e),
                            })
                            .await;
                    }
                }
            }

            // --- Sidebar commands (Phase 3) ---
            AppCommand::ListDirectory { path } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                // Keep the listing confined to the project root. Without
                // validation, an absolute path or one with `..` components
                // would let a client enumerate any directory on the host
                // filesystem.
                let full_path =
                    match crate::safety::validate_path(&root, std::path::Path::new(&path)) {
                        Ok(p) => p,
                        Err(e) => {
                            let _ = reply_tx
                                .send(AppEvent::Error {
                                    code: "LIST_DIR_FAILED".into(),
                                    message: e,
                                })
                                .await;
                            return;
                        }
                    };
                match crate::git_engine::list_directory(&full_path).await {
                    Ok(entries) => {
                        let _ = reply_tx
                            .send(AppEvent::DirectoryListing { path, entries })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "LIST_DIR_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetChangedFiles { mode, run_id } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                let result: std::result::Result<Vec<FileChange>, String> = if mode == "working" {
                    match crate::git_engine::working_dir_status(&root).await {
                        Ok(s) => {
                            let mut files: Vec<FileChange> = s
                                .staged
                                .into_iter()
                                .map(|f| FileChange {
                                    path: f.path,
                                    status: f.status,
                                })
                                .collect();
                            files.extend(s.unstaged.into_iter().map(|f| FileChange {
                                path: f.path,
                                status: f.status,
                            }));
                            Ok(files)
                        }
                        Err(e) => Err(e.to_string()),
                    }
                } else if let Some(rid) = run_id {
                    match self.context.persistence.load_worktree_meta(rid) {
                        Ok(meta) => {
                            crate::git_engine::changed_files(&root, &meta.base_head, "HEAD")
                                .await
                                .map_err(|e| e.to_string())
                        }
                        Err(e) => Err(format!("worktree meta: {}", e)),
                    }
                } else {
                    Ok(vec![])
                };

                match result {
                    Ok(files) => {
                        let _ = reply_tx
                            .send(AppEvent::ChangedFilesList {
                                mode,
                                run_id,
                                files,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "CHANGED_FILES_FAILED".into(),
                                message: e,
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetFileDiff {
                file_path,
                mode,
                run_id,
            } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                let result: std::result::Result<String, String> = if mode == "working" {
                    crate::git_engine::working_dir_file_diff(&root, &file_path)
                        .await
                        .map_err(|e| e.to_string())
                } else if let Some(rid) = run_id {
                    match self.context.persistence.load_worktree_meta(rid) {
                        Ok(meta) => crate::git_engine::diff_full(&root, &meta.base_head, "HEAD")
                            .await
                            .map_err(|e| e.to_string()),
                        Err(e) => Err(format!("worktree meta: {}", e)),
                    }
                } else {
                    Ok(String::new())
                };

                match result {
                    Ok(diff) => {
                        let _ = reply_tx
                            .send(AppEvent::FileDiffResult {
                                file_path,
                                diff,
                                stat: None,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "FILE_DIFF_FAILED".into(),
                                message: e,
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetRepoStatus => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::repo_status_snapshot(&root).await {
                    Ok(status) => {
                        let _ = reply_tx.send(AppEvent::RepoStatusResult { status }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "REPO_STATUS_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetCommitHistory { limit } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::commit_history(&root, limit).await {
                    Ok(commits) => {
                        let _ = reply_tx
                            .send(AppEvent::CommitHistoryResult { commits })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "COMMIT_HISTORY_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::StageFile { path } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                if let Err(e) = crate::git_engine::stage_file(&root, &path).await {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "STAGE_FAILED".into(),
                            message: e.to_string(),
                        })
                        .await;
                } else if let Ok(status) = crate::git_engine::repo_status_snapshot(&root).await {
                    let _ = reply_tx.send(AppEvent::RepoStatusResult { status }).await;
                }
            }

            AppCommand::UnstageFile { path } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                if let Err(e) = crate::git_engine::unstage_file(&root, &path).await {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "UNSTAGE_FAILED".into(),
                            message: e.to_string(),
                        })
                        .await;
                } else if let Ok(status) = crate::git_engine::repo_status_snapshot(&root).await {
                    let _ = reply_tx.send(AppEvent::RepoStatusResult { status }).await;
                }
            }

            AppCommand::CreateCommit { message } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::create_commit(&root, &message).await {
                    Ok(hash) => {
                        let _ = reply_tx.send(AppEvent::CommitCreated { hash }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "COMMIT_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::ListBranches => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::list_branches(&root).await {
                    Ok((branches, current)) => {
                        let _ = reply_tx
                            .send(AppEvent::BranchList { branches, current })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "GIT_ERROR".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::CheckoutBranch { name } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::checkout_branch(&root, &name).await {
                    Ok(()) => {
                        let _ = reply_tx.send(AppEvent::BranchChanged { name }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "CHECKOUT_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::CreateBranch { name, from } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::create_branch(&root, &name, from.as_deref()).await {
                    Ok(()) => {
                        let _ = reply_tx.send(AppEvent::BranchChanged { name }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "CREATE_BRANCH_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            // --- Workspace commands (M1-01, M1-04) ---
            AppCommand::ListWorkspaces
            | AppCommand::CreateWorkspace { .. }
            | AppCommand::CloseWorkspace { .. }
            | AppCommand::ActivateWorkspace { .. } => {
                let dispatcher = crate::dispatchers::workspace_dispatcher::WorkspaceDispatcher::new(
                    self.context.clone(),
                );
                dispatcher.handle(client_id, cmd, reply_tx).await;
            }

            // --- PTY commands (M4-01) ---
            AppCommand::CreateTerminalSession {
                workspace_id,
                shell,
                cwd,
                env,
                ssh,
            } => {
                let pane_id = format!("terminal-{}", workspace_id);
                let result = self
                    .pty_manager
                    .create_session(workspace_id, pane_id, shell, cwd, env, ssh)
                    .await;
                match result {
                    Ok(_session_id) => {}
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "PTY_CREATE_FAILED".into(),
                                message: e,
                            })
                            .await;
                    }
                }
            }

            AppCommand::CloseTerminalSession { session_id } => {
                if let Err(e) = self.pty_manager.close_session(session_id).await {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "PTY_CLOSE_FAILED".into(),
                            message: e,
                        })
                        .await;
                }
            }

            AppCommand::WriteTerminalInput { session_id, data } => {
                if let Err(e) = self.pty_manager.write_input(session_id, &data).await {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "PTY_WRITE_FAILED".into(),
                            message: e,
                        })
                        .await;
                }
            }

            AppCommand::ResizeTerminal {
                session_id,
                cols,
                rows,
            } => match self.pty_manager.resize(session_id, cols, rows).await {
                Ok(()) => {}
                Err(e) => {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "RESIZE_FAILED".into(),
                            message: e,
                        })
                        .await;
                }
            },

            AppCommand::ListTerminalSessions { workspace_id } => {
                let sessions = self.pty_manager.list_sessions(workspace_id).await;
                let _ = reply_tx
                    .send(AppEvent::TerminalSessionList {
                        workspace_id,
                        sessions,
                    })
                    .await;
            }

            AppCommand::RestoreTerminalSession {
                previous_session_id,
                workspace_id,
            } => {
                let meta = match self
                    .context
                    .persistence
                    .load_terminal_session(previous_session_id)
                {
                    Ok(m) => m,
                    Err(crate::persistence::PersistenceError::NotFound(_)) => {
                        let _ = reply_tx
                            .send(AppEvent::TerminalSessionRestoreFailed {
                                previous_session_id,
                                reason: "No saved session with that id".into(),
                            })
                            .await;
                        return;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::TerminalSessionRestoreFailed {
                                previous_session_id,
                                reason: format!("Load failed: {}", e),
                            })
                            .await;
                        return;
                    }
                };
                let shell = meta.shell_path.to_string_lossy().to_string();
                let cwd = meta.cwd.clone();
                let pane_id = format!("terminal-restored-{}", workspace_id);
                match self
                    .pty_manager
                    .create_session(
                        workspace_id,
                        pane_id,
                        Some(shell.clone()),
                        Some(cwd.clone()),
                        None,
                        None,
                    )
                    .await
                {
                    Ok(new_session_id) => {
                        let _ = self
                            .context
                            .persistence
                            .delete_terminal_session(previous_session_id);
                        let _ = reply_tx
                            .send(AppEvent::TerminalSessionRestored {
                                previous_session_id,
                                new_session_id,
                                cwd,
                                workspace_id,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::TerminalSessionRestoreFailed {
                                previous_session_id,
                                reason: format!("Failed to spawn PTY: {}", e),
                            })
                            .await;
                    }
                }
            }

            AppCommand::ListRestoredTerminalSessions { workspace_id } => {
                match self
                    .context
                    .persistence
                    .list_terminal_sessions(workspace_id)
                {
                    Ok(sessions) => {
                        let _ = reply_tx
                            .send(AppEvent::RestorableTerminalSessions {
                                workspace_id,
                                sessions,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "RESTORE_LIST_FAILED".into(),
                                message: format!("Failed to list terminal sessions: {}", e),
                            })
                            .await;
                    }
                }
            }

            // --- Stash mutations (M4) ---
            AppCommand::PopStash { index } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::stash_pop(&root, index).await {
                    Ok(had_conflicts) => {
                        let _ = reply_tx
                            .send(AppEvent::StashApplied {
                                index,
                                had_conflicts,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "STASH_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::ApplyStash { index } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::stash_apply(&root, index).await {
                    Ok(had_conflicts) => {
                        let _ = reply_tx
                            .send(AppEvent::StashApplied {
                                index,
                                had_conflicts,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "STASH_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::DropStash { index } => {
                let Some(root) = self.active_root_or_err(&reply_tx).await else {
                    return;
                };
                match crate::git_engine::stash_drop(&root, index).await {
                    Ok(()) => {
                        let _ = reply_tx.send(AppEvent::StashDropped { index }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "STASH_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            // --- Extended git commands (M5-03, M5-04, M5-05) ---
            AppCommand::PushBranch { .. }
            | AppCommand::PullBranch { .. }
            | AppCommand::FetchRemote { .. }
            | AppCommand::GetMergeConflicts
            | AppCommand::ResolveConflict { .. } => {
                let dispatcher =
                    crate::dispatchers::git_dispatcher::GitDispatcher::new(self.context.clone());
                dispatcher.handle(cmd, reply_tx).await;
            }
        }
    }

    /// Core StartRun logic, shared by both `StartRun` and `StashAndRun` commands.
    #[allow(clippy::too_many_arguments)]
    async fn do_start_run(
        &self,
        client_id: ClientId,
        session_id: Uuid,
        prompt: String,
        mode: RunMode,
        autonomy: AutonomyLevel,
        skip_dirty_check: bool,
        reply_tx: mpsc::Sender<AppEvent>,
    ) {
        // Resolve the workspace this run belongs to (SEC-02 event routing).
        let workspace_id: Option<Uuid> = self
            .context
            .active_workspaces
            .lock()
            .await
            .get(&client_id.0)
            .copied();

        // Read session data then release the lock before any async IO or git
        // subprocess — previously the lock was held for several seconds blocking
        // all other session-touching handlers.
        let (project_root, already_active) = {
            let sessions = self.context.sessions.lock().await;
            match sessions.get(&session_id) {
                Some(s) => (s.project_root.clone(), s.active_run.is_some()),
                None => {
                    drop(sessions);
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "SESSION_NOT_FOUND".into(),
                            message: format!("Session {} not found", session_id),
                        })
                        .await;
                    return;
                }
            }
        };

        if already_active {
            let _ = reply_tx
                .send(AppEvent::Error {
                    code: "RUN_ALREADY_ACTIVE".into(),
                    message: "Session already has an active run".into(),
                })
                .await;
            return;
        }

        let run_id = Uuid::new_v4();
        let output_path = output_file_path(&self.context.config.data_dir, &run_id);

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

        let is_git = crate::git_engine::is_git_repo(&project_root).await;

        // Git worktree setup (delegated to helper)
        let mut branch_name = String::new();
        let mut worktree_path: Option<PathBuf> = None;
        let mut base_head = String::new();
        let mut actual_working_dir = project_root.clone();

        // RAII concurrency guard — dropped on early return, `forget()` once
        // the supervisor task takes ownership of cleanup on successful spawn.
        let mut concurrency_guard: Option<ConcurrencyGuard>;

        if is_git {
            // Guard repo state
            if let Err(e) = crate::git_engine::guard_repo_state(&project_root).await {
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "GIT_STATE_ERROR".into(),
                        message: format!("Repository not in clean state: {}", e),
                    })
                    .await;
                return;
            }

            // Dirty working directory check (unless explicitly skipped)
            if !skip_dirty_check {
                let dirty = crate::git_engine::working_dir_status(&project_root)
                    .await
                    .unwrap_or_else(|_| DirtyStatus {
                        staged: vec![],
                        unstaged: vec![],
                    });

                if !dirty.staged.is_empty() || !dirty.unstaged.is_empty() {
                    // Send DirtyWarning event -- frontend will show modal
                    let _ = reply_tx
                        .send(AppEvent::DirtyWarning {
                            status: dirty,
                            session_id,
                            prompt: prompt.clone(),
                            mode: mode.clone(),
                        })
                        .await;
                    return;
                }
            }

            // Get base HEAD
            match crate::git_engine::head_oid(&project_root).await {
                Ok(oid) => base_head = oid,
                Err(e) => {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "GIT_ERROR".into(),
                            message: format!("Failed to read HEAD: {}", e),
                        })
                        .await;
                    return;
                }
            }

            // Generate branch name and worktree path
            let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            let short_uuid = &run_id.to_string()[..8];
            branch_name = format!("llm/{}-{}", timestamp, short_uuid);
            let wt_path = project_root.join(".terminal-worktrees").join(short_uuid);

            // Create .terminal-worktrees/ dir
            let wt_parent = match wt_path.parent() {
                Some(p) => p,
                None => {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "IO_ERROR".into(),
                            message: "Invalid worktree path: no parent directory".into(),
                        })
                        .await;
                    return;
                }
            };
            if let Err(e) = tokio::fs::create_dir_all(wt_parent).await {
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "IO_ERROR".into(),
                        message: format!("Failed to create worktrees dir: {}", e),
                    })
                    .await;
                return;
            }

            // Create worktree
            if let Err(e) =
                crate::git_engine::worktree_add(&project_root, &wt_path, &branch_name).await
            {
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "GIT_ERROR".into(),
                        message: format!("Failed to create worktree: {}", e),
                    })
                    .await;
                return;
            }

            // Save worktree metadata
            let meta = WorktreeMeta {
                worktree_path: wt_path.clone(),
                branch_name: branch_name.clone(),
                base_head: base_head.clone(),
                merge_base: base_head.clone(),
                last_modified: chrono::Utc::now(),
                repo_root: Some(project_root.clone()),
            };
            if let Err(e) = self.context.persistence.save_worktree_meta(run_id, &meta) {
                warn!("Failed to persist worktree meta for run {}: {}", run_id, e);
            }

            actual_working_dir = wt_path.clone();
            worktree_path = Some(wt_path);
        }
        let concurrency_key = concurrency_key_for_run(&project_root, worktree_path.as_deref());

        // Concurrency guard (see crate::guards): removes the entry on
        // any early return below without manual cleanup.
        let guard = match ConcurrencyGuard::acquire(
            self.context.concurrency.clone(),
            concurrency_key.clone(),
            run_id,
        )
        .await
        {
            Some(g) => g,
            None => {
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "WORKING_DIR_BUSY".into(),
                        message: format!(
                            "Working directory {} already has an active run",
                            concurrency_key.display()
                        ),
                    })
                    .await;
                return;
            }
        };
        concurrency_guard = Some(guard);

        let run = Run {
            id: run_id,
            session_id,
            branch: branch_name.clone(),
            mode: mode.clone(),
            autonomy,
            kind: RunKind::OneShot,
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
            last_modified: chrono::Utc::now(),
        };

        // Persist run (state: Preparing)
        if let Err(e) = self.context.persistence.save_run(&run) {
            warn!("Failed to persist run {}: {}", run_id, e);
        }

        // Re-acquire the sessions lock just for the mutation, then release.
        // With the earlier refactor we no longer hold it across the git
        // preparation work.
        {
            let mut sessions = self.context.sessions.lock().await;
            if let Some(session) = sessions.get_mut(&session_id) {
                session.active_run = Some(run_id);
                session.runs.push(run_id);
            } else {
                // Session disappeared mid-setup (StartRun racing with
                // EndSession). Clean up what we already created.
                if let Some(ref wt_path) = worktree_path {
                    let _ = crate::git_engine::worktree_remove(&project_root, wt_path).await;
                    let _ =
                        crate::git_engine::branch_delete(&project_root, &branch_name, true).await;
                }
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "SESSION_NOT_FOUND".into(),
                        message: format!("Session {} disappeared during setup", session_id),
                    })
                    .await;
                return;
            }
        }

        // Route run lifecycle events through workspace isolation (SEC-02).
        self.context
            .send_run_event(
                workspace_id,
                &reply_tx,
                AppEvent::RunStateChanged {
                    run_id,
                    new_state: RunState::Preparing,
                },
            )
            .await;

        // Pre-flight check (delegated to helper)
        if self
            .run_preflight(run_id, &run, workspace_id, &reply_tx)
            .await
            .is_err()
        {
            return;
        }

        // Spawn claude process in actual_working_dir (worktree if git).
        // Ownership of the concurrency entry transfers to the supervisor task
        // on success; `forget()` prevents the guard from clearing it on drop.
        match self
            .context
            .runner
            .spawn(run_id, &prompt, &mode, autonomy, &actual_working_dir)
        {
            Ok((mut event_rx, mut child)) => {
                if let Some(g) = concurrency_guard.take() {
                    g.forget();
                }
                let (cancel_tx, mut cancel_rx) = mpsc::channel::<String>(1);

                let active_run = ActiveRun {
                    run: run.clone(),
                    cancel_tx,
                };
                self.context
                    .active_runs
                    .lock()
                    .await
                    .insert(run_id, active_run);

                // Transition to Running
                self.context
                    .send_run_event(
                        workspace_id,
                        &reply_tx,
                        AppEvent::RunStateChanged {
                            run_id,
                            new_state: RunState::Running,
                        },
                    )
                    .await;

                // Supervisor task
                let run_event_context = self.context.clone();
                let run_reply_tx = reply_tx.clone();
                let active_runs = self.context.active_runs.clone();
                let sessions = self.context.sessions.clone();
                let timeout_secs = self.context.config.run_timeout_secs;
                let persistence = self.context.persistence.clone();
                let concurrency = self.context.concurrency.clone();
                let project_root_clone = project_root.clone();
                let concurrency_key_clone = concurrency_key.clone();
                let base_head_clone = base_head.clone();
                let branch_name_clone = branch_name.clone();
                let worktree_path_clone = worktree_path.clone();
                let is_git_run = is_git;
                let run_started_at = run.started_at;
                let autonomy_clone = autonomy;
                let supervisor_workspace_id = workspace_id;

                tokio::spawn(async move {
                    // Helper: route run events through workspace isolation.
                    let broadcast_ws = {
                        let context = run_event_context.clone();
                        let reply_tx = run_reply_tx.clone();
                        let ws_id = supervisor_workspace_id;
                        move |evt: &AppEvent| {
                            let context = context.clone();
                            let reply_tx = reply_tx.clone();
                            let evt = evt.clone();
                            tokio::spawn(async move {
                                context.send_run_event(ws_id, &reply_tx, evt).await;
                            });
                        }
                    };

                    let mut line_number: usize = 0;
                    let mut result_event_seen = false;
                    let mut output_file = match tokio::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&output_path)
                        .await
                    {
                        Ok(f) => Some(f),
                        Err(e) => {
                            // Previously this was `.ok()` which silently
                            // dropped the error — a permission or disk-space
                            // failure at open time meant the run streamed to
                            // clients live but left no persisted output, so
                            // GetRunOutput after a reload returned nothing
                            // with no indication why.
                            warn!(
                                "run {}: could not open output file {:?}: {} — output will not be persisted",
                                run_id, output_path, e
                            );
                            None
                        }
                    };

                    let timeout = tokio::time::sleep(std::time::Duration::from_secs(timeout_secs));
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
                                        // Broadcast to workspace clients (SEC-02)
                                        let evt = AppEvent::RunOutput {
                                            run_id,
                                            line,
                                            line_number,
                                        };
                                        broadcast_ws(&evt);
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
                                        broadcast_ws(&evt);
                                    }
                                    Some(RunnerEvent::AssistantText(text)) => {
                                        line_number += 1;
                                        if let Some(ref mut f) = output_file {
                                            let _ = tokio::io::AsyncWriteExt::write_all(
                                                f,
                                                text.as_bytes(),
                                            ).await;
                                        }
                                        let evt = AppEvent::RunOutput {
                                            run_id,
                                            line: text.trim_end_matches('\n').to_string(),
                                            line_number,
                                        };
                                        broadcast_ws(&evt);
                                    }
                                    Some(RunnerEvent::ToolUse { id, name, input_preview }) => {
                                        line_number += 1;
                                        let log_line = format!("▸ tool: {name} {input_preview}");
                                        if let Some(ref mut f) = output_file {
                                            let _ = tokio::io::AsyncWriteExt::write_all(
                                                f,
                                                format!("{}\n", log_line).as_bytes(),
                                            ).await;
                                        }
                                        let out_evt = AppEvent::RunOutput {
                                            run_id,
                                            line: log_line,
                                            line_number,
                                        };
                                        broadcast_ws(&out_evt);
                                        let tool_evt = AppEvent::RunToolUse {
                                            run_id,
                                            tool_id: id,
                                            tool_name: name,
                                            tool_input_preview: input_preview,
                                        };
                                        broadcast_ws(&tool_evt);
                                    }
                                    Some(RunnerEvent::ToolResult { tool_use_id, is_error, preview }) => {
                                        line_number += 1;
                                        let tag = if is_error { "error" } else { "ok" };
                                        let log_line = format!("◂ tool result [{tag}]: {preview}");
                                        if let Some(ref mut f) = output_file {
                                            let _ = tokio::io::AsyncWriteExt::write_all(
                                                f,
                                                format!("{}\n", log_line).as_bytes(),
                                            ).await;
                                        }
                                        let out_evt = AppEvent::RunOutput {
                                            run_id,
                                            line: log_line,
                                            line_number,
                                        };
                                        broadcast_ws(&out_evt);
                                        let result_evt = AppEvent::RunToolResult {
                                            run_id,
                                            tool_id: tool_use_id,
                                            is_error,
                                            preview,
                                        };
                                        broadcast_ws(&result_evt);
                                    }
                                    Some(RunnerEvent::SessionInit { model, session_id }) => {
                                        line_number += 1;
                                        let log_line = format!(
                                            "session init: model={} session_id={}",
                                            model.as_deref().unwrap_or("?"),
                                            session_id.as_deref().unwrap_or("?"),
                                        );
                                        if let Some(ref mut f) = output_file {
                                            let _ = tokio::io::AsyncWriteExt::write_all(
                                                f,
                                                format!("{}\n", log_line).as_bytes(),
                                            ).await;
                                        }
                                        let evt = AppEvent::RunOutput { run_id, line: log_line, line_number };
                                        broadcast_ws(&evt);
                                    }
                                    Some(RunnerEvent::Metrics { num_turns, cost_usd, input_tokens, output_tokens }) => {
                                        let evt = AppEvent::RunMetrics {
                                            run_id,
                                            num_turns,
                                            cost_usd,
                                            input_tokens,
                                            output_tokens,
                                        };
                                        broadcast_ws(&evt);
                                    }
                                    Some(RunnerEvent::ResultSeen) => {
                                        // Stream-json result event received — run completed normally.
                                        result_event_seen = true;
                                    }
                                    Some(RunnerEvent::Preflight { reason, suggestion }) => {
                                        let evt = AppEvent::RunPreflightFailed {
                                            run_id,
                                            reason,
                                            suggestion,
                                        };
                                        broadcast_ws(&evt);
                                    }
                                    Some(RunnerEvent::SpawnError(e)) => {
                                        let evt = AppEvent::RunFailed {
                                            run_id,
                                            error: e,
                                            phase: FailPhase::Execution,
                                        };
                                        broadcast_ws(&evt);
                                        break;
                                    }
                                    Some(RunnerEvent::ProcessExited { .. }) => {
                                        // Handled via channel close (None) below
                                    }
                                    None => {
                                        // Channel closed -- process exited
                                        let exit_code = child.wait().await
                                            .map(|s| s.code().unwrap_or(-1))
                                            .unwrap_or(-1);

                                        // If stream ended without a result event, the run failed
                                        // mid-stream (AI-BUG-01: #113).
                                        if !result_event_seen {
                                            let evt = AppEvent::RunFailed {
                                                run_id,
                                                error: format!(
                                                    "stream ended without result event (exit_code={})",
                                                    exit_code
                                                ),
                                                phase: FailPhase::Execution,
                                            };
                                            broadcast_ws(&evt);
                                            break;
                                        }

                                        // Compute git diff info if this was a git run
                                        let mut modified_files_list = vec![];
                                        let mut run_diff_stat = None;

                                        if is_git_run {
                                            if let Some(ref wt_path) = worktree_path_clone {
                                                match crate::git_engine::head_oid(wt_path).await {
                                                    Ok(wt_head) => {
                                                        if let Ok(changes) = crate::git_engine::changed_files(
                                                            wt_path, &base_head_clone, &wt_head
                                                        ).await {
                                                            modified_files_list = changes
                                                                .iter()
                                                                .map(|c| c.path.clone())
                                                                .collect();
                                                        }
                                                        if let Ok(stat) = crate::git_engine::diff_stat(
                                                            wt_path, &base_head_clone, &wt_head
                                                        ).await {
                                                            run_diff_stat = Some(stat);
                                                        }
                                                    }
                                                    Err(e) => {
                                                        warn!("Failed to read worktree HEAD for run {}: {}", run_id, e);
                                                    }
                                                }
                                            }
                                        }

                                        let summary = RunSummary {
                                            id: run_id,
                                            state: RunState::Completed { exit_code },
                                            prompt_preview: String::new(),
                                            modified_file_count: modified_files_list.len(),
                                            diff_stat: run_diff_stat.clone(),
                                            started_at: run_started_at,
                                            autonomy: autonomy_clone,
                                            ended_at: Some(chrono::Utc::now()),
                                        };
                                        let evt = AppEvent::RunCompleted {
                                            run_id,
                                            summary,
                                            diff_stat: run_diff_stat.clone(),
                                        };
                                        broadcast_ws(&evt);

                                        // Persist completed run
                                        let completed_run = Run {
                                            id: run_id,
                                            session_id,
                                            branch: branch_name_clone.clone(),
                                            mode,
                                            autonomy: autonomy_clone,
                                            kind: RunKind::OneShot,
                                            state: RunState::Completed { exit_code },
                                            prompt,
                                            provided_files: vec![],
                                            modified_files: modified_files_list,
                                            expanded_files: vec![],
                                            output_path,
                                            output_line_count: line_number,
                                            output_byte_count: 0,
                                            started_at: run_started_at,
                                            ended_at: Some(chrono::Utc::now()),
                                            last_modified: chrono::Utc::now(),
                                        };
                                        if let Err(e) = persistence.save_run(&completed_run) {
                                            warn!("Failed to persist completed run {}: {}", run_id, e);
                                        }

                                        break;
                                    }
                                }
                            }
                            reason = cancel_rx.recv() => {
                                if let Some(reason) = reason {
                                    info!("Cancelling run {}: {}", run_id, reason);
                                    let _ = child.kill().await;
                                    // Wait for child to exit (BUG-01: #123) before emitting event.
                                    let _ = tokio::time::timeout(
                                        std::time::Duration::from_secs(5),
                                        child.wait(),
                                    ).await;
                                    let evt = AppEvent::RunCancelled { run_id };
                                    broadcast_ws(&evt);
                                    break;
                                }
                            }
                            _ = &mut timeout => {
                                warn!("Run {} timed out", run_id);
                                let _ = child.kill().await;
                                let _ = tokio::time::timeout(
                                    std::time::Duration::from_secs(5),
                                    child.wait(),
                                ).await;
                                // Teardown worktree on timeout (BUG-01: #123).
                                if is_git_run {
                                    if let Some(ref wt_path) = worktree_path_clone {
                                        let repo_root = project_root_clone.clone();
                                        if let Err(e) = crate::git_engine::worktree_remove(&repo_root, wt_path).await {
                                            warn!("Failed to remove worktree {:?} on timeout: {}", wt_path, e);
                                        }
                                    }
                                    if let Err(e) = persistence.delete_worktree_meta(run_id) {
                                        warn!("Failed to delete worktree meta {} on timeout: {}", run_id, e);
                                    }
                                }
                                let evt = AppEvent::RunFailed {
                                    run_id,
                                    error: "Run timed out".into(),
                                    phase: FailPhase::Execution,
                                };
                                broadcast_ws(&evt);
                                break;
                            }
                        }
                    }

                    // Cleanup
                    active_runs.lock().await.remove(&run_id);
                    if let Some(session) = sessions.lock().await.get_mut(&session_id) {
                        session.active_run = None;
                    }
                    // Remove from concurrency registry
                    concurrency.lock().await.remove(&concurrency_key_clone);
                    info!("Run {} finished", run_id);
                });
            }
            Err(e) => {
                // Cleanup session
                let mut sessions = self.context.sessions.lock().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.active_run = None;
                }
                // Concurrency entry is released automatically when
                // `concurrency_guard` drops at end of scope.
                if is_git {
                    if let Some(ref wt_path) = worktree_path {
                        if let Err(e) =
                            crate::git_engine::worktree_remove(&project_root, wt_path).await
                        {
                            warn!("Failed to cleanup worktree on spawn failure: {}", e);
                        }
                        if let Err(e) =
                            crate::git_engine::branch_delete(&project_root, &branch_name, true)
                                .await
                        {
                            warn!("Failed to cleanup branch on spawn failure: {}", e);
                        }
                    }
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

    /// Find the project root for a given run_id.
    /// Tries persistence first (load_run -> load_session), falls back to in-memory sessions.
    async fn find_project_root(&self, run_id: Uuid) -> Option<PathBuf> {
        // Try persistence: load run -> get session_id -> load session -> project_root
        if let Ok(run) = self.context.persistence.load_run(run_id) {
            if let Ok(session) = self.context.persistence.load_session(run.session_id) {
                return Some(session.project_root);
            }
            // Fall back to in-memory sessions with the session_id from persisted run
            let sessions = self.context.sessions.lock().await;
            if let Some(session) = sessions.get(&run.session_id) {
                return Some(session.project_root.clone());
            }
        }

        // Last resort: scan in-memory sessions for a run matching run_id
        let sessions = self.context.sessions.lock().await;
        for session in sessions.values() {
            if session.runs.contains(&run_id) {
                return Some(session.project_root.clone());
            }
        }

        None
    }

    /// Find the project root from any active in-memory session.
    /// Used by sessionless commands (ListStashes, CheckDirtyState, etc.)
    /// that need a project root but don't carry a session_id.
    ///
    /// Returns the project_root from the most recently started session,
    /// or None if there are no sessions.
    async fn find_active_project_root(&self) -> Option<PathBuf> {
        let sessions = self.context.sessions.lock().await;
        // Prefer the most recently started session
        sessions
            .values()
            .filter(|s| s.ended_at.is_none())
            .max_by_key(|s| s.started_at)
            .or_else(|| sessions.values().max_by_key(|s| s.started_at))
            .map(|s| s.project_root.clone())
    }

    /// Like `find_active_project_root`, but emits an Error event and returns None if no session found.
    async fn active_root_or_err(&self, reply_tx: &mpsc::Sender<AppEvent>) -> Option<PathBuf> {
        match self.find_active_project_root().await {
            Some(p) => Some(p),
            None => {
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "NO_ACTIVE_SESSION".into(),
                        message: "No active session — start a session before calling this command"
                            .into(),
                    })
                    .await;
                None
            }
        }
    }

    /// Run the Claude binary preflight check and emit structured events on failure.
    ///
    /// Returns `Ok(())` when preflight passes, `Err(())` when it fails (events already broadcast).
    async fn run_preflight(
        &self,
        run_id: Uuid,
        run: &Run,
        workspace_id: Option<Uuid>,
        reply_tx: &mpsc::Sender<AppEvent>,
    ) -> Result<(), ()> {
        if let Err(pf) = self.context.runner.preflight().await {
            self.context
                .send_run_event(
                    workspace_id,
                    reply_tx,
                    AppEvent::RunPreflightFailed {
                        run_id,
                        reason: pf.reason.clone(),
                        suggestion: pf.suggestion.clone(),
                    },
                )
                .await;
            self.context
                .send_run_event(
                    workspace_id,
                    reply_tx,
                    AppEvent::RunFailed {
                        run_id,
                        error: pf.reason,
                        phase: FailPhase::Preflight,
                    },
                )
                .await;
            let failed_run = Run {
                state: RunState::Failed {
                    error: pf.suggestion,
                    phase: FailPhase::Preflight,
                },
                ended_at: Some(chrono::Utc::now()),
                last_modified: chrono::Utc::now(),
                ..run.clone()
            };
            if let Err(e) = self.context.persistence.save_run(&failed_run) {
                warn!("failed to persist preflight-failed run {}: {}", run_id, e);
            }
            return Err(());
        }
        Ok(())
    }
}

/// Detect a display language name from a file path's extension.
fn detect_language(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| match ext {
            "rs" => "rust",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "json" => "json",
            "md" => "markdown",
            "css" => "css",
            "html" | "htm" => "html",
            "toml" => "toml",
            "yaml" | "yml" => "yaml",
            "sh" | "bash" => "bash",
            other => other,
        })
        .unwrap_or("plaintext")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::concurrency_key_for_run;
    use crate::safety::validate_path;
    use std::path::PathBuf;

    #[test]
    fn readfile_path_traversal_blocked() {
        let root = PathBuf::from("/home/user/project");
        let attack = PathBuf::from("../../etc/passwd");
        assert!(validate_path(&root, &attack).is_err());
    }

    #[test]
    fn readfile_absolute_outside_root_blocked() {
        let root = PathBuf::from("/home/user/project");
        let attack = PathBuf::from("/etc/shadow");
        assert!(validate_path(&root, &attack).is_err());
    }

    #[test]
    fn readfile_normal_relative_path_allowed() {
        let root = PathBuf::from("/home/user/project");
        let normal = PathBuf::from("src/main.rs");
        let result = validate_path(&root, &normal);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), root.join("src/main.rs"));
    }

    #[test]
    fn readfile_dotdot_within_root_still_valid() {
        let root = PathBuf::from("/home/user/project");
        let tricky = PathBuf::from("src/../Cargo.toml");
        let result = validate_path(&root, &tricky);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), root.join("Cargo.toml"));
    }

    #[test]
    fn concurrency_key_uses_project_root_when_no_worktree() {
        let root = PathBuf::from("/repo");
        let key = concurrency_key_for_run(&root, None);
        assert_eq!(key, root);
    }

    #[test]
    fn concurrency_key_prefers_worktree_when_present() {
        let root = PathBuf::from("/repo");
        let wt = PathBuf::from("/repo/.terminal-worktrees/abc12345");
        let key = concurrency_key_for_run(&root, Some(&wt));
        assert_eq!(key, wt);
    }
    #[test]
    fn run_supervisor_treats_missing_result_as_failed() {
        let source = include_str!("dispatcher.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap();

        assert!(production_source.contains("let mut result_event_seen = false"));
        assert!(production_source.contains("Some(RunnerEvent::ResultSeen)"));
        assert!(production_source.contains("if !result_event_seen"));
        assert!(production_source.contains("AppEvent::RunFailed"));
        assert!(production_source.contains("stream ended without result event"));
        assert!(production_source.contains("phase: FailPhase::Execution"));
    }

}
