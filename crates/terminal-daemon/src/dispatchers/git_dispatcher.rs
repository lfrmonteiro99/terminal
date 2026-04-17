// Git domain dispatcher — extended git operations (M1-04, M5-03, M5-04, M5-05)

use crate::daemon_context::DaemonContext;
use std::sync::Arc;
use terminal_core::protocol::v1::{AppEvent, AppCommand};
use tokio::sync::mpsc;
use tracing::warn;

pub struct GitDispatcher {
    ctx: Arc<DaemonContext>,
}

impl GitDispatcher {
    pub fn new(ctx: Arc<DaemonContext>) -> Self {
        Self { ctx }
    }

    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        // Every handler needs an active project root. Resolve once so the
        // failure path is uniform: emit NO_ACTIVE_SESSION and return rather
        // than silently dropping the command (which leaves the client
        // waiting indefinitely for a reply event).
        let root = match self.ctx.find_active_project_root().await {
            Some(r) => r,
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

        match cmd {
            AppCommand::PushBranch { remote, branch } => {
                let remote = remote.unwrap_or_else(|| "origin".into());
                let branch_name = branch.unwrap_or_else(|| "HEAD".into());
                match crate::git_engine::push_branch(&root, &remote, &branch_name).await {
                    Ok(actual_branch) => {
                        let _ = reply_tx
                            .send(AppEvent::PushCompleted {
                                branch: actual_branch,
                                remote,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::GitOperationFailed {
                                operation: "push".into(),
                                reason: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::PullBranch { remote, branch } => {
                let remote = remote.unwrap_or_else(|| "origin".into());
                match crate::git_engine::pull_branch(&root, &remote, branch.as_deref()).await {
                    Ok(commits_applied) => {
                        let branch_name = branch.unwrap_or_else(|| "HEAD".into());
                        let _ = reply_tx
                            .send(AppEvent::PullCompleted {
                                branch: branch_name,
                                commits_applied,
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::GitOperationFailed {
                                operation: "pull".into(),
                                reason: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::FetchRemote { remote } => {
                let remote = remote.unwrap_or_else(|| "origin".into());
                match crate::git_engine::fetch_remote(&root, &remote).await {
                    Ok(()) => {
                        let _ = reply_tx
                            .send(AppEvent::FetchCompleted { remote })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::GitOperationFailed {
                                operation: "fetch".into(),
                                reason: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::GetMergeConflicts => {
                match crate::git_engine::list_merge_conflicts(&root).await {
                    Ok(files) => {
                        let _ = reply_tx
                            .send(AppEvent::MergeConflicts { files })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "MERGE_CONFLICTS_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::ResolveConflict { file_path, resolution } => {
                match crate::git_engine::resolve_conflict(&root, &file_path, &resolution).await {
                    Ok(()) => {
                        let _ = reply_tx
                            .send(AppEvent::ConflictResolved { file_path })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::Error {
                                code: "RESOLVE_CONFLICT_FAILED".into(),
                                message: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            _ => {
                warn!("GitDispatcher received unexpected command");
            }
        }
    }
}
