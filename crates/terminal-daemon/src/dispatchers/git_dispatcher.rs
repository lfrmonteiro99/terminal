// Git domain dispatcher — extended git operations (M1-04, M5-03, M5-04, M5-05)

use crate::daemon_context::DaemonContext;
use std::path::PathBuf;
use std::sync::Arc;
use terminal_core::protocol::v1::{AppCommand, AppEvent};
use tokio::sync::mpsc;
use tracing::warn;

pub struct GitDispatcher {
    ctx: Arc<DaemonContext>,
}

impl GitDispatcher {
    pub fn new(ctx: Arc<DaemonContext>) -> Self {
        Self { ctx }
    }

    async fn require_project_root(
        &self,
        operation: &str,
        reply_tx: &mpsc::Sender<AppEvent>,
    ) -> Option<PathBuf> {
        match self.ctx.find_active_project_root().await {
            Some(root) => Some(root),
            None => {
                let _ = reply_tx
                    .send(AppEvent::GitOperationFailed {
                        operation: operation.into(),
                        reason: "no active session".into(),
                    })
                    .await;
                None
            }
        }
    }

    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        match cmd {
            AppCommand::PushBranch { remote, branch } => {
                let Some(root) = self.require_project_root("push", &reply_tx).await else {
                    return;
                };
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
                let Some(root) = self.require_project_root("pull", &reply_tx).await else {
                    return;
                };
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
                let Some(root) = self.require_project_root("fetch", &reply_tx).await else {
                    return;
                };
                let remote = remote.unwrap_or_else(|| "origin".into());
                match crate::git_engine::fetch_remote(&root, &remote).await {
                    Ok(()) => {
                        let _ = reply_tx.send(AppEvent::FetchCompleted { remote }).await;
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
                let Some(root) = self
                    .require_project_root("get_merge_conflicts", &reply_tx)
                    .await
                else {
                    return;
                };
                match crate::git_engine::list_merge_conflicts(&root).await {
                    Ok(files) => {
                        let _ = reply_tx.send(AppEvent::MergeConflicts { files }).await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::GitOperationFailed {
                                operation: "get_merge_conflicts".into(),
                                reason: e.to_string(),
                            })
                            .await;
                    }
                }
            }

            AppCommand::ResolveConflict {
                file_path,
                resolution,
            } => {
                let Some(root) = self
                    .require_project_root("resolve_conflict", &reply_tx)
                    .await
                else {
                    return;
                };
                match crate::git_engine::resolve_conflict(&root, &file_path, &resolution).await {
                    Ok(()) => {
                        let _ = reply_tx
                            .send(AppEvent::ConflictResolved { file_path })
                            .await;
                    }
                    Err(e) => {
                        let _ = reply_tx
                            .send(AppEvent::GitOperationFailed {
                                operation: "resolve_conflict".into(),
                                reason: e.to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use terminal_core::config::DaemonConfig;
    use terminal_core::protocol::v1::ConflictResolution;
    use tokio::sync::broadcast;

    fn make_dispatcher(tmp: &TempDir) -> GitDispatcher {
        let cfg = DaemonConfig {
            data_dir: tmp.path().to_path_buf(),
            ..Default::default()
        };
        let (event_tx, _) = broadcast::channel::<String>(8);
        let persistence =
            Arc::new(crate::persistence::Persistence::new(tmp.path().to_path_buf()).unwrap());
        let ctx = Arc::new(DaemonContext::new(cfg, event_tx, persistence));
        GitDispatcher::new(ctx)
    }

    async fn assert_no_active_session_failure(cmd: AppCommand, expected_operation: &str) {
        let tmp = TempDir::new().unwrap();
        let dispatcher = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(4);

        dispatcher.handle(cmd, tx).await;

        let event = rx.recv().await.expect("expected one event");
        match event {
            AppEvent::GitOperationFailed { operation, reason } => {
                assert_eq!(operation, expected_operation);
                assert_eq!(reason, "no active session");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_without_active_session_returns_typed_failure() {
        assert_no_active_session_failure(
            AppCommand::PushBranch {
                remote: None,
                branch: None,
            },
            "push",
        )
        .await;
    }

    #[tokio::test]
    async fn pull_without_active_session_returns_typed_failure() {
        assert_no_active_session_failure(
            AppCommand::PullBranch {
                remote: None,
                branch: None,
            },
            "pull",
        )
        .await;
    }

    #[tokio::test]
    async fn fetch_without_active_session_returns_typed_failure() {
        assert_no_active_session_failure(AppCommand::FetchRemote { remote: None }, "fetch").await;
    }

    #[tokio::test]
    async fn get_merge_conflicts_without_active_session_returns_typed_failure() {
        let tmp = TempDir::new().unwrap();
        let dispatcher = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(4);

        dispatcher.handle(AppCommand::GetMergeConflicts, tx).await;

        let event = rx.recv().await.expect("expected one event");
        match event {
            AppEvent::GitOperationFailed { operation, reason } => {
                assert_eq!(operation, "get_merge_conflicts");
                assert_eq!(reason, "no active session");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[tokio::test]
    async fn resolve_conflict_without_active_session_returns_typed_failure() {
        let tmp = TempDir::new().unwrap();
        let dispatcher = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(4);

        dispatcher
            .handle(
                AppCommand::ResolveConflict {
                    file_path: PathBuf::from("foo.rs"),
                    resolution: ConflictResolution::TakeOurs,
                },
                tx,
            )
            .await;

        let event = rx.recv().await.expect("expected one event");
        match event {
            AppEvent::GitOperationFailed { operation, reason } => {
                assert_eq!(operation, "resolve_conflict");
                assert_eq!(reason, "no active session");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }
}
