use crate::models::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

pub const PROTOCOL_VERSION: &str = "v1";
pub const MAX_PAGE_SIZE: u64 = 10_000;

/// Commands sent from client to daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppCommand {
    // Auth
    Auth { token: String },

    // Session
    StartSession { project_root: PathBuf },
    EndSession { session_id: Uuid },
    ListSessions,

    // Runs
    StartRun {
        session_id: Uuid,
        prompt: String,
        mode: RunMode,
    },
    CancelRun {
        run_id: Uuid,
        reason: String,
    },
    RespondToBlocking {
        run_id: Uuid,
        response: String,
    },
    GetRunStatus {
        run_id: Uuid,
    },
    ListRuns {
        session_id: Uuid,
    },
    GetRunOutput {
        run_id: Uuid,
        offset: u64,
        limit: u64,
    },

    // Git operations (Phase 2)
    GetDiff { run_id: Uuid },
    RevertRun { run_id: Uuid },
    MergeRun { run_id: Uuid },

    // System
    GetStatus,
    Ping,
}

/// Events sent from daemon to client(s).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppEvent {
    // Auth
    AuthSuccess,
    AuthFailed { reason: String },

    // Run lifecycle
    RunStateChanged {
        run_id: Uuid,
        new_state: RunState,
    },
    RunOutput {
        run_id: Uuid,
        line: String,
        line_number: usize,
    },
    RunBlocking {
        run_id: Uuid,
        question: String,
        context: Vec<String>,
    },
    RunCompleted {
        run_id: Uuid,
        summary: RunSummary,
        diff_stat: Option<DiffStat>,
    },
    RunFailed {
        run_id: Uuid,
        error: String,
        phase: FailPhase,
    },
    RunCancelled {
        run_id: Uuid,
    },

    // Git results (Phase 2)
    RunDiff {
        run_id: Uuid,
        stat: DiffStat,
        diff: String,
    },
    RunReverted {
        run_id: Uuid,
    },
    RunMerged {
        run_id: Uuid,
        merge_result: MergeResult,
    },
    RunMergeConflict {
        run_id: Uuid,
        conflict_paths: Vec<PathBuf>,
    },

    // Session
    SessionStarted {
        session: SessionSummary,
    },
    SessionEnded {
        session_id: Uuid,
    },
    SessionList {
        sessions: Vec<SessionSummary>,
    },
    RunList {
        session_id: Uuid,
        runs: Vec<RunSummary>,
    },

    // Run output (paginated response)
    RunOutputPage {
        run_id: Uuid,
        offset: u64,
        lines: Vec<String>,
        has_more: bool,
    },

    // System
    StatusUpdate {
        active_runs: usize,
        session_count: usize,
    },
    Pong,
    Error {
        code: String,
        message: String,
    },
}

impl AppCommand {
    /// Clamp GetRunOutput limit to MAX_PAGE_SIZE.
    pub fn sanitize(self) -> Self {
        match self {
            AppCommand::GetRunOutput {
                run_id,
                offset,
                limit,
            } => AppCommand::GetRunOutput {
                run_id,
                offset,
                limit: if limit == 0 { MAX_PAGE_SIZE } else { limit.min(MAX_PAGE_SIZE) },
            },
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_tagged_serialization() {
        let cmd = AppCommand::Ping;
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"type\":\"Ping\""));
    }

    #[test]
    fn event_tagged_serialization() {
        let evt = AppEvent::Pong;
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("\"type\":\"Pong\""));
    }

    #[test]
    fn command_deserialization() {
        let json = r#"{"type":"StartRun","session_id":"550e8400-e29b-41d4-a716-446655440000","prompt":"hello","mode":"Free"}"#;
        let cmd: AppCommand = serde_json::from_str(json).unwrap();
        match cmd {
            AppCommand::StartRun { prompt, mode, .. } => {
                assert_eq!(prompt, "hello");
                assert_eq!(mode, RunMode::Free);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn sanitize_clamps_page_size() {
        let cmd = AppCommand::GetRunOutput {
            run_id: Uuid::new_v4(),
            offset: 0,
            limit: 999_999,
        };
        match cmd.sanitize() {
            AppCommand::GetRunOutput { limit, .. } => {
                assert_eq!(limit, MAX_PAGE_SIZE);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn sanitize_zero_limit_becomes_max() {
        let cmd = AppCommand::GetRunOutput {
            run_id: Uuid::new_v4(),
            offset: 0,
            limit: 0,
        };
        match cmd.sanitize() {
            AppCommand::GetRunOutput { limit, .. } => {
                assert_eq!(limit, MAX_PAGE_SIZE);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn get_diff_command_roundtrip() {
        let cmd = AppCommand::GetDiff { run_id: Uuid::new_v4() };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"type\":\"GetDiff\""));
        let _: AppCommand = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn run_merged_event_roundtrip() {
        let evt = AppEvent::RunMerged {
            run_id: Uuid::new_v4(),
            merge_result: MergeResult::FastForward,
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::RunMerged { merge_result, .. } => {
                assert_eq!(merge_result, MergeResult::FastForward);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn run_completed_with_diff_stat() {
        let evt = AppEvent::RunCompleted {
            run_id: Uuid::new_v4(),
            summary: RunSummary {
                id: Uuid::new_v4(),
                state: RunState::Completed { exit_code: 0 },
                prompt_preview: "test".into(),
                modified_file_count: 2,
                diff_stat: Some(DiffStat {
                    files_changed: 2,
                    insertions: 10,
                    deletions: 3,
                    file_stats: vec![],
                }),
                started_at: chrono::Utc::now(),
                ended_at: Some(chrono::Utc::now()),
            },
            diff_stat: Some(DiffStat {
                files_changed: 2,
                insertions: 10,
                deletions: 3,
                file_stats: vec![],
            }),
        };
        let json = serde_json::to_string(&evt).unwrap();
        let _: AppEvent = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn run_blocking_event_roundtrip() {
        let evt = AppEvent::RunBlocking {
            run_id: Uuid::new_v4(),
            question: "Which file?".into(),
            context: vec!["src/main.rs".into(), "src/lib.rs".into()],
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::RunBlocking { question, context, .. } => {
                assert_eq!(question, "Which file?");
                assert_eq!(context.len(), 2);
            }
            _ => panic!("wrong variant"),
        }
    }
}
