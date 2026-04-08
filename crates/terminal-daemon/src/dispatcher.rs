use crate::claude_runner::{output_file_path, RunnerEvent};
use crate::daemon_context::{ActiveRun, DaemonContext};
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

impl Dispatcher {
    pub fn new(
        config: DaemonConfig,
        event_tx: broadcast::Sender<String>,
        persistence: Arc<Persistence>,
    ) -> Self {
        let context = Arc::new(DaemonContext::new(config, event_tx.clone(), persistence));
        let pty_manager = Arc::new(PtyManager::new(event_tx));
        Self { context, pty_manager }
    }

    /// Broadcast an event to all connected clients.
    fn broadcast(&self, event: &AppEvent) {
        self.context.broadcast(event);
    }

    /// Handle a command and send response to the requesting client.
    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        match cmd {
            AppCommand::Auth { .. } => {
                // Auth is handled at the server level, not here
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

                self.context.sessions.lock().await.insert(session_id, session);
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
                        let persisted_runs = self.context.persistence.list_runs_for_session(session_id)
                            .unwrap_or_else(|e| {
                                warn!("Failed to load persisted runs for session {}: {}", session_id, e);
                                vec![]
                            });

                        // Get active runs (these have more current state)
                        let active_runs = self.context.active_runs.lock().await;

                        // Build summaries: active runs override persisted ones
                        let mut summaries_map: HashMap<Uuid, RunSummary> = HashMap::new();

                        // First, add persisted runs
                        for run in &persisted_runs {
                            summaries_map.insert(run.id, RunSummary {
                                id: run.id,
                                state: run.state.clone(),
                                prompt_preview: run.prompt.chars().take(100).collect(),
                                modified_file_count: run.modified_files.len(),
                                diff_stat: None,
                                started_at: run.started_at,
                                ended_at: run.ended_at,
                            });
                        }

                        // Then, override with active runs (more current state)
                        for active in active_runs.values() {
                            if active.run.session_id == session_id {
                                summaries_map.insert(active.run.id, RunSummary {
                                    id: active.run.id,
                                    state: active.run.state.clone(),
                                    prompt_preview: active.run.prompt.chars().take(100).collect(),
                                    modified_file_count: active.run.modified_files.len(),
                                    diff_stat: None,
                                    started_at: active.run.started_at,
                                    ended_at: active.run.ended_at,
                                });
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
                let runs = self.context.active_runs.lock().await;
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
                skip_dirty_check,
            } => {
                self.do_start_run(session_id, prompt, mode, skip_dirty_check, reply_tx).await;
            }

            AppCommand::CancelRun { run_id, reason } => {
                let runs = self.context.active_runs.lock().await;
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
                let runs = self.context.active_runs.lock().await;
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
                            &meta.worktree_path, &meta.base_head, &wt_head
                        ).await {
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
                            &meta.worktree_path, &meta.base_head, &wt_head
                        ).await {
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
                            .send(AppEvent::RunDiff {
                                run_id,
                                stat,
                                diff,
                            })
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
                    if let Err(e) = crate::git_engine::worktree_remove(&project_root, &meta.worktree_path).await {
                        warn!("Failed to remove worktree for run {}: {}", run_id, e);
                    }
                }

                // Delete branch (force)
                if let Err(e) = crate::git_engine::branch_delete(&project_root, &meta.branch_name, true).await {
                    warn!("Failed to delete branch {} for run {}: {}", meta.branch_name, run_id, e);
                }

                // Delete worktree metadata
                if let Err(e) = self.context.persistence.delete_worktree_meta(run_id) {
                    warn!("Failed to delete worktree metadata for run {}: {}", run_id, e);
                }

                // Broadcast RunReverted
                self.broadcast(&AppEvent::RunReverted { run_id });
                let _ = reply_tx
                    .send(AppEvent::RunReverted { run_id })
                    .await;
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
                    if let Err(e) = crate::git_engine::worktree_remove(&project_root, &meta.worktree_path).await {
                        warn!("Failed to remove worktree before merge for run {}: {}", run_id, e);
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
                        if let Err(e) = crate::git_engine::branch_delete(&project_root, &meta.branch_name, true).await {
                            warn!("Failed to delete branch after merge for run {}: {}", run_id, e);
                        }
                        if let Err(e) = self.context.persistence.delete_worktree_meta(run_id) {
                            warn!("Failed to delete worktree metadata after merge for run {}: {}", run_id, e);
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

                // Stash succeeded -- proceed with start run, skipping dirty check
                self.do_start_run(session_id, prompt, mode, true, reply_tx).await;
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
                        let _ = reply_tx
                            .send(AppEvent::StashList { stashes })
                            .await;
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

            AppCommand::GetStashDiff { stash_index, file_path } => {
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
                        let _ = reply_tx
                            .send(AppEvent::DirtyState { status })
                            .await;
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
                if let Some(root) = self.find_active_project_root().await {
                    let full_path = root.join(&path);
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
            }

            AppCommand::GetChangedFiles { mode, run_id } => {
                if let Some(root) = self.find_active_project_root().await {
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
            }

            AppCommand::GetFileDiff {
                file_path,
                mode,
                run_id,
            } => {
                if let Some(root) = self.find_active_project_root().await {
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
            }

            AppCommand::GetRepoStatus => {
                if let Some(root) = self.find_active_project_root().await {
                    match crate::git_engine::repo_status_snapshot(&root).await {
                        Ok(status) => {
                            let _ = reply_tx
                                .send(AppEvent::RepoStatusResult { status })
                                .await;
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
            }

            AppCommand::GetCommitHistory { limit } => {
                if let Some(root) = self.find_active_project_root().await {
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
            }

            AppCommand::StageFile { path } => {
                if let Some(root) = self.find_active_project_root().await {
                    if let Err(e) = crate::git_engine::stage_file(&root, &path).await {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "STAGE_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::UnstageFile { path } => {
                if let Some(root) = self.find_active_project_root().await {
                    if let Err(e) = crate::git_engine::unstage_file(&root, &path).await {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                    code: "UNSTAGE_FAILED".into(),
                                    message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::CreateCommit { message } => {
                if let Some(root) = self.find_active_project_root().await {
                    match crate::git_engine::create_commit(&root, &message).await {
                        Ok(hash) => {
                            let _ = reply_tx
                                .send(AppEvent::CommitCreated { hash })
                                .await;
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
            }

            AppCommand::ListBranches => {
                if let Some(root) = self.find_active_project_root().await {
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
            }

            AppCommand::CheckoutBranch { name } => {
                if let Some(root) = self.find_active_project_root().await {
                    match crate::git_engine::checkout_branch(&root, &name).await {
                        Ok(()) => {
                            let _ = reply_tx
                                .send(AppEvent::BranchChanged { name })
                                .await;
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
            }

            AppCommand::CreateBranch { name, from } => {
                if let Some(root) = self.find_active_project_root().await {
                    match crate::git_engine::create_branch(&root, &name, from.as_deref()).await {
                        Ok(()) => {
                            let _ = reply_tx
                                .send(AppEvent::BranchChanged { name })
                                .await;
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
            }

            // --- Workspace commands (M1-01, M1-04) ---
            AppCommand::ListWorkspaces
            | AppCommand::CreateWorkspace { .. }
            | AppCommand::CloseWorkspace { .. }
            | AppCommand::ActivateWorkspace { .. } => {
                let dispatcher = crate::dispatchers::workspace_dispatcher::WorkspaceDispatcher::new(
                    self.context.clone(),
                );
                dispatcher.handle(cmd, reply_tx).await;
            }

            // --- PTY commands (M4-01) ---
            AppCommand::CreateTerminalSession { workspace_id, shell, cwd, env } => {
                let pane_id = format!("terminal-{}", workspace_id);
                let result = self.pty_manager
                    .create_session(workspace_id, pane_id, shell, cwd, env)
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

            AppCommand::ResizeTerminal { session_id, cols, rows } => {
                self.pty_manager.resize(session_id, cols, rows).await;
            }

            AppCommand::ListTerminalSessions { workspace_id } => {
                let sessions = self.pty_manager.list_sessions(workspace_id).await;
                let _ = reply_tx
                    .send(AppEvent::TerminalSessionList { workspace_id, sessions })
                    .await;
            }

            AppCommand::RestoreTerminalSession { previous_session_id, workspace_id } => {
                // Placeholder: PTY sessions can't persist across daemon restarts in pipe mode.
                // Full persistence handled in M4-06.
                let _ = reply_tx
                    .send(AppEvent::TerminalSessionRestoreFailed {
                        previous_session_id,
                        reason: "Session restoration not yet supported in pipe mode".into(),
                    })
                    .await;
            }

            AppCommand::ListRestoredTerminalSessions { workspace_id } => {
                let _ = reply_tx
                    .send(AppEvent::RestorableTerminalSessions {
                        workspace_id,
                        sessions: vec![],
                    })
                    .await;
            }

            // --- Extended git commands (M5-03, M5-04, M5-05) ---
            AppCommand::PushBranch { .. }
            | AppCommand::PullBranch { .. }
            | AppCommand::FetchRemote { .. }
            | AppCommand::GetMergeConflicts
            | AppCommand::ResolveConflict { .. } => {
                let dispatcher = crate::dispatchers::git_dispatcher::GitDispatcher::new(
                    self.context.clone(),
                );
                dispatcher.handle(cmd, reply_tx).await;
            }
        }
    }

    /// Core StartRun logic, shared by both `StartRun` and `StashAndRun` commands.
    async fn do_start_run(
        &self,
        session_id: Uuid,
        prompt: String,
        mode: RunMode,
        skip_dirty_check: bool,
        reply_tx: mpsc::Sender<AppEvent>,
    ) {
        // Check session exists and has no active run
        let mut sessions = self.context.sessions.lock().await;
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

        let project_root = session.project_root.clone();
        let is_git = crate::git_engine::is_git_repo(&project_root).await;

        // Git worktree setup
        let mut branch_name = String::new();
        let mut worktree_path: Option<PathBuf> = None;
        let mut base_head = String::new();
        let mut actual_working_dir = project_root.clone();

        if is_git {
            // Check concurrency: lock -> check -> insert -> unlock (no await gap)
            {
                let mut conc = self.context.concurrency.lock().await;
                if let Some(existing_run_id) = conc.get(&project_root) {
                    let _ = reply_tx
                        .send(AppEvent::Error {
                            code: "REPO_BUSY".into(),
                            message: format!(
                                "Repository {} already has active run {}",
                                project_root.display(),
                                existing_run_id
                            ),
                        })
                        .await;
                    return;
                }
                conc.insert(project_root.clone(), run_id);
            }

            // Guard repo state
            if let Err(e) = crate::git_engine::guard_repo_state(&project_root).await {
                // Cleanup concurrency
                self.context.concurrency.lock().await.remove(&project_root);
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
                    // Release concurrency lock before returning
                    self.context.concurrency.lock().await.remove(&project_root);
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
                    self.context.concurrency.lock().await.remove(&project_root);
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
            if let Err(e) = tokio::fs::create_dir_all(wt_path.parent().unwrap()).await {
                self.context.concurrency.lock().await.remove(&project_root);
                let _ = reply_tx
                    .send(AppEvent::Error {
                        code: "IO_ERROR".into(),
                        message: format!("Failed to create worktrees dir: {}", e),
                    })
                    .await;
                return;
            }

            // Create worktree
            if let Err(e) = crate::git_engine::worktree_add(&project_root, &wt_path, &branch_name).await {
                self.context.concurrency.lock().await.remove(&project_root);
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
            };
            if let Err(e) = self.context.persistence.save_worktree_meta(run_id, &meta) {
                warn!("Failed to persist worktree meta for run {}: {}", run_id, e);
            }

            actual_working_dir = wt_path.clone();
            worktree_path = Some(wt_path);
        }

        let run = Run {
            id: run_id,
            session_id,
            branch: branch_name.clone(),
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
            last_modified: chrono::Utc::now(),
        };

        // Persist run (state: Preparing)
        if let Err(e) = self.context.persistence.save_run(&run) {
            warn!("Failed to persist run {}: {}", run_id, e);
        }

        session.active_run = Some(run_id);
        session.runs.push(run_id);

        // Broadcast state change
        self.broadcast(&AppEvent::RunStateChanged {
            run_id,
            new_state: RunState::Preparing,
        });

        drop(sessions); // Release lock before spawning

        // Spawn claude process in actual_working_dir (worktree if git)
        match self.context.runner.spawn(run_id, &prompt, &mode, &actual_working_dir) {
            Ok((mut event_rx, stdin_tx, mut child)) => {
                let (cancel_tx, mut cancel_rx) = mpsc::channel::<String>(1);

                let active_run = ActiveRun {
                    run: run.clone(),
                    cancel_tx,
                    stdin_tx: stdin_tx.clone(),
                };
                self.context.active_runs.lock().await.insert(run_id, active_run);

                // Transition to Running
                self.broadcast(&AppEvent::RunStateChanged {
                    run_id,
                    new_state: RunState::Running,
                });

                // Supervisor task
                let event_tx = self.context.event_tx.clone();
                let active_runs = self.context.active_runs.clone();
                let sessions = self.context.sessions.clone();
                let timeout_secs = self.context.config.run_timeout_secs;
                let persistence = self.context.persistence.clone();
                let concurrency = self.context.concurrency.clone();
                let project_root_clone = project_root.clone();
                let base_head_clone = base_head.clone();
                let branch_name_clone = branch_name.clone();
                let worktree_path_clone = worktree_path.clone();
                let is_git_run = is_git;
                let run_started_at = run.started_at;

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
                                        // Channel closed -- process exited
                                        let exit_code = child.wait().await
                                            .map(|s| s.code().unwrap_or(-1))
                                            .unwrap_or(-1);

                                        // Compute git diff info if this was a git run
                                        let mut modified_files_list = vec![];
                                        let mut run_diff_stat = None;

                                        if is_git_run {
                                            if let Some(ref wt_path) = worktree_path_clone {
                                                // Get current HEAD in worktree
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
                                            ended_at: Some(chrono::Utc::now()),
                                        };
                                        let evt = AppEvent::RunCompleted {
                                            run_id,
                                            summary,
                                            diff_stat: run_diff_stat.clone(),
                                        };
                                        let json = serde_json::to_string(&evt).unwrap();
                                        let _ = event_tx.send(json);

                                        // Persist completed run
                                        let completed_run = Run {
                                            id: run_id,
                                            session_id,
                                            branch: branch_name_clone.clone(),
                                            mode,
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
                    // Remove from concurrency registry
                    if is_git_run {
                        concurrency.lock().await.remove(&project_root_clone);
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
                let mut sessions = self.context.sessions.lock().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.active_run = None;
                }
                // Cleanup concurrency and worktree on spawn failure
                if is_git {
                    self.context.concurrency.lock().await.remove(&project_root);
                    if let Some(ref wt_path) = worktree_path {
                        if let Err(e) = crate::git_engine::worktree_remove(&project_root, wt_path).await {
                            warn!("Failed to cleanup worktree on spawn failure: {}", e);
                        }
                        if let Err(e) = crate::git_engine::branch_delete(&project_root, &branch_name, true).await {
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
}
