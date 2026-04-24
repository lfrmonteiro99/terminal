#[allow(unused_imports)]
use crate::models::{
    AutonomyLevel, BranchInfo, CommitEntry, DiffStat, DirtyFile, DirtyStatus, FailPhase,
    FileChange, FileStatus, FileTreeEntry, MergeConflictFile, MergeResult, RepoStatusSnapshot,
    RestorableTerminalSession, RunKind, RunMode, RunState, RunSummary, SearchMatch, SessionSummary,
    SshConfig, StashEntry, TerminalSessionSummary, WorkspaceMode, WorkspaceSummary,
};
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
        #[serde(default)]
        skip_dirty_check: bool,
        /// Autonomy level for this run (defaults to `Autonomous` if the
        /// client omits the field — keeps legacy requests working).
        #[serde(default)]
        autonomy: AutonomyLevel,
        /// OneShot (default) or Chat.
        #[serde(default)]
        kind: RunKind,
    },
    CancelRun {
        run_id: Uuid,
        reason: String,
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

    // Stash operations (Phase 2.1)
    ListStashes,
    GetStashFiles {
        stash_index: usize,
    },
    GetStashDiff {
        stash_index: usize,
        file_path: Option<PathBuf>,
    },
    CheckDirtyState,
    StashAndRun {
        session_id: Uuid,
        prompt: String,
        mode: RunMode,
        stash_message: String,
    },

    // Chat mode
    SendChatMessage {
        run_id: Uuid,
        prompt: String,
    },
    EndChat {
        run_id: Uuid,
    },
    ApprovePlan {
        run_id: Uuid,
    },
    RejectPlan {
        run_id: Uuid,
        feedback: String,
    },

    // Stash mutations (M4)
    PopStash { index: usize },
    ApplyStash { index: usize },
    DropStash { index: usize },

    // Branch operations
    ListBranches,

    // Sidebar commands (Phase 3)
    ListDirectory { path: PathBuf },
    GetChangedFiles {
        mode: String,
        run_id: Option<Uuid>,
    },
    GetFileDiff {
        file_path: PathBuf,
        mode: String,
        run_id: Option<Uuid>,
    },
    GetRepoStatus,
    GetCommitHistory { limit: usize },
    StageFile { path: PathBuf },
    UnstageFile { path: PathBuf },
    CreateCommit { message: String },
    CheckoutBranch { name: String },
    CreateBranch {
        name: String,
        from: Option<String>,
    },

    // Workspace (M1-01)
    ListWorkspaces,
    CreateWorkspace {
        name: String,
        root_path: PathBuf,
        mode: WorkspaceMode,
    },
    CloseWorkspace {
        workspace_id: Uuid,
    },
    ActivateWorkspace {
        workspace_id: Uuid,
    },

    // PTY / Terminal (M4-01)
    CreateTerminalSession {
        workspace_id: Uuid,
        shell: Option<String>,
        cwd: Option<PathBuf>,
        env: Option<Vec<(String, String)>>,
        #[serde(default)]
        ssh: Option<SshConfig>,
    },
    CloseTerminalSession {
        session_id: Uuid,
    },
    WriteTerminalInput {
        session_id: Uuid,
        data: String,
    },
    ResizeTerminal {
        session_id: Uuid,
        cols: u16,
        rows: u16,
    },
    ListTerminalSessions {
        workspace_id: Uuid,
    },

    // PTY persistence (M4-06)
    RestoreTerminalSession {
        previous_session_id: Uuid,
        workspace_id: Uuid,
    },
    ListRestoredTerminalSessions {
        workspace_id: Uuid,
    },

    // Git extended (M5-03, M5-04)
    PushBranch {
        remote: Option<String>,
        branch: Option<String>,
    },
    PullBranch {
        remote: Option<String>,
        branch: Option<String>,
    },
    FetchRemote {
        remote: Option<String>,
    },
    GetMergeConflicts,
    ResolveConflict {
        file_path: PathBuf,
        resolution: ConflictResolution,
    },

    // File viewer (TERMINAL-005)
    ReadFile {
        path: String,
        #[serde(default)]
        max_bytes: Option<u64>,
    },

    // Search (TERMINAL-006)
    SearchFiles {
        query: String,
        #[serde(default)]
        is_regex: bool,
        #[serde(default)]
        case_sensitive: bool,
        #[serde(default)]
        include_glob: Option<String>,
        #[serde(default)]
        exclude_glob: Option<String>,
        #[serde(default)]
        max_results: Option<usize>,
        #[serde(default)]
        context_lines: Option<usize>,
    },

    // System
    GetStatus,
    Ping,
}

/// How to resolve a merge conflict for a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictResolution {
    TakeOurs,
    TakeTheirs,
    Manual { content: String },
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

    // Structured stream events (Claude Code stream-json)
    /// A tool invocation (Edit / Write / Bash / Read / Grep / ...) started.
    /// `tool_input_preview` is a short one-line summary for UI display;
    /// the full input is available in the raw output log.
    RunToolUse {
        run_id: Uuid,
        tool_id: String,
        tool_name: String,
        tool_input_preview: String,
    },
    /// Result of a previously-announced tool invocation.
    RunToolResult {
        run_id: Uuid,
        tool_id: String,
        is_error: bool,
        preview: String,
    },
    /// Usage metrics reported at run completion.
    RunMetrics {
        run_id: Uuid,
        num_turns: u32,
        cost_usd: f64,
        input_tokens: u64,
        output_tokens: u64,
    },
    /// Claude binary is missing, unauthenticated, or otherwise unusable.
    /// Emitted before any run is spawned.
    RunPreflightFailed {
        run_id: Uuid,
        reason: String,
        suggestion: String,
    },
    /// Chat-only: a turn finished while the process remains alive.
    ChatTurnEnded {
        run_id: Uuid,
    },
    /// Plan-mode chat: Claude proposed a plan that needs approval.
    PlanProposed {
        run_id: Uuid,
        plan: String,
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

    // Stash results (Phase 2.1)
    StashList {
        stashes: Vec<StashEntry>,
    },
    StashFiles {
        stash_index: usize,
        files: Vec<FileChange>,
    },
    StashDiff {
        stash_index: usize,
        diff: String,
        stat: Option<DiffStat>,
    },
    StashApplied { index: usize, had_conflicts: bool },
    StashDropped { index: usize },
    DirtyState {
        status: DirtyStatus,
    },
    DirtyWarning {
        status: DirtyStatus,
        session_id: Uuid,
        prompt: String,
        mode: RunMode,
    },

    // Sidebar events (Phase 3)
    DirectoryListing {
        path: PathBuf,
        entries: Vec<FileTreeEntry>,
    },
    ChangedFilesList {
        mode: String,
        run_id: Option<Uuid>,
        files: Vec<FileChange>,
    },
    FileDiffResult {
        file_path: PathBuf,
        diff: String,
        stat: Option<DiffStat>,
    },
    RepoStatusResult {
        status: RepoStatusSnapshot,
    },
    CommitHistoryResult {
        commits: Vec<CommitEntry>,
    },
    CommitCreated {
        hash: String,
    },
    BranchChanged {
        name: String,
    },
    BranchList {
        branches: Vec<BranchInfo>,
        current: Option<String>,
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

    // Workspace events (M1-01)
    WorkspaceList {
        workspaces: Vec<WorkspaceSummary>,
    },
    WorkspaceCreated {
        workspace: WorkspaceSummary,
    },
    WorkspaceClosed {
        workspace_id: Uuid,
    },
    WorkspaceActivated {
        workspace_id: Uuid,
    },

    // PTY events (M4-01)
    TerminalSessionCreated {
        session_id: Uuid,
        workspace_id: Uuid,
        shell: String,
        cwd: PathBuf,
        #[serde(default)]
        is_ssh: bool,
        #[serde(default)]
        ssh_host: Option<String>,
    },
    TerminalSessionClosed {
        session_id: Uuid,
    },
    TerminalOutput {
        session_id: Uuid,
        data: String,
    },
    TerminalSessionList {
        workspace_id: Uuid,
        sessions: Vec<TerminalSessionSummary>,
    },

    // PTY persistence (M4-06)
    TerminalSessionRestored {
        previous_session_id: Uuid,
        new_session_id: Uuid,
        cwd: PathBuf,
        workspace_id: Uuid,
    },
    TerminalSessionRestoreFailed {
        previous_session_id: Uuid,
        reason: String,
    },
    RestorableTerminalSessions {
        workspace_id: Uuid,
        sessions: Vec<RestorableTerminalSession>,
    },

    // Git extended (M5-04)
    PushCompleted {
        branch: String,
        remote: String,
    },
    PullCompleted {
        branch: String,
        commits_applied: usize,
    },
    FetchCompleted {
        remote: String,
    },
    GitOperationFailed {
        operation: String,
        reason: String,
    },
    MergeConflicts {
        files: Vec<MergeConflictFile>,
    },
    ConflictResolved {
        file_path: PathBuf,
    },

    // File viewer (TERMINAL-005)
    FileContent {
        path: String,
        content: String,
        language: String,
        truncated: bool,
        size_bytes: u64,
    },
    FileReadError {
        path: String,
        error: String,
    },

    // Search (TERMINAL-006)
    SearchResults {
        query: String,
        matches: Vec<SearchMatch>,
        total_matches: usize,
        files_searched: usize,
        truncated: bool,
        duration_ms: u64,
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
            AppCommand::StartRun { prompt, mode, skip_dirty_check, .. } => {
                assert_eq!(prompt, "hello");
                assert_eq!(mode, RunMode::Free);
                assert!(!skip_dirty_check, "skip_dirty_check should default to false");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn start_run_with_skip_dirty_check() {
        let json = r#"{"type":"StartRun","session_id":"550e8400-e29b-41d4-a716-446655440000","prompt":"hello","mode":"Free","skip_dirty_check":true}"#;
        let cmd: AppCommand = serde_json::from_str(json).unwrap();
        match cmd {
            AppCommand::StartRun { skip_dirty_check, .. } => {
                assert!(skip_dirty_check, "skip_dirty_check should be true when explicitly set");
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
    fn start_run_with_autonomy_field_roundtrip() {
        let cmd = AppCommand::StartRun {
            session_id: Uuid::new_v4(),
            prompt: "do the thing".into(),
            mode: RunMode::Free,
            skip_dirty_check: false,
            autonomy: AutonomyLevel::ReviewPlan,
            kind: RunKind::OneShot,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"autonomy\":\"ReviewPlan\""));
        let back: AppCommand = serde_json::from_str(&json).unwrap();
        match back {
            AppCommand::StartRun { autonomy, .. } => {
                assert_eq!(autonomy, AutonomyLevel::ReviewPlan);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn start_run_without_autonomy_defaults_to_autonomous() {
        // Old client payload that predates the autonomy field.
        let legacy_json = serde_json::json!({
            "type": "StartRun",
            "session_id": Uuid::new_v4(),
            "prompt": "hi",
            "mode": "Free",
        })
        .to_string();
        let cmd: AppCommand = serde_json::from_str(&legacy_json).unwrap();
        match cmd {
            AppCommand::StartRun { autonomy, skip_dirty_check, .. } => {
                assert_eq!(autonomy, AutonomyLevel::Autonomous);
                assert!(!skip_dirty_check);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn start_run_without_kind_defaults_to_oneshot() {
        let legacy_json = serde_json::json!({
            "type": "StartRun",
            "session_id": Uuid::new_v4(),
            "prompt": "hi",
            "mode": "Free",
        })
        .to_string();

        let cmd: AppCommand = serde_json::from_str(&legacy_json).unwrap();
        match cmd {
            AppCommand::StartRun { kind, .. } => assert_eq!(kind, RunKind::OneShot),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn start_run_with_kind_chat_roundtrip() {
        let cmd = AppCommand::StartRun {
            session_id: Uuid::new_v4(),
            prompt: "talk".into(),
            mode: RunMode::Free,
            skip_dirty_check: false,
            autonomy: AutonomyLevel::Autonomous,
            kind: RunKind::Chat,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"kind\":\"Chat\""));
        let back: AppCommand = serde_json::from_str(&json).unwrap();
        match back {
            AppCommand::StartRun { kind, .. } => assert_eq!(kind, RunKind::Chat),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn chat_commands_roundtrip() {
        let run_id = Uuid::new_v4();
        let commands = vec![
            AppCommand::SendChatMessage {
                run_id,
                prompt: "continue".into(),
            },
            AppCommand::EndChat { run_id },
            AppCommand::ApprovePlan { run_id },
            AppCommand::RejectPlan {
                run_id,
                feedback: "revise the approach".into(),
            },
        ];

        for cmd in commands {
            let json = serde_json::to_string(&cmd).unwrap();
            let back: AppCommand = serde_json::from_str(&json).unwrap();
            assert_eq!(serde_json::to_string(&back).unwrap(), json);
        }
    }

    #[test]
    fn chat_events_roundtrip() {
        let run_id = Uuid::new_v4();
        let events = vec![
            AppEvent::ChatTurnEnded { run_id },
            AppEvent::PlanProposed {
                run_id,
                plan: "do it carefully".into(),
            },
        ];

        for event in events {
            let json = serde_json::to_string(&event).unwrap();
            let back: AppEvent = serde_json::from_str(&json).unwrap();
            assert_eq!(serde_json::to_string(&back).unwrap(), json);
        }
    }

    #[test]
    fn run_tool_use_event_roundtrip() {
        let evt = AppEvent::RunToolUse {
            run_id: Uuid::new_v4(),
            tool_id: "toolu_01".into(),
            tool_name: "Edit".into(),
            tool_input_preview: "src/main.rs".into(),
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("\"type\":\"RunToolUse\""));
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::RunToolUse { tool_name, .. } => assert_eq!(tool_name, "Edit"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn run_tool_result_event_roundtrip() {
        let evt = AppEvent::RunToolResult {
            run_id: Uuid::new_v4(),
            tool_id: "toolu_01".into(),
            is_error: false,
            preview: "ok".into(),
        };
        let json = serde_json::to_string(&evt).unwrap();
        let _: AppEvent = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn run_metrics_event_roundtrip() {
        let evt = AppEvent::RunMetrics {
            run_id: Uuid::new_v4(),
            num_turns: 3,
            cost_usd: 0.042,
            input_tokens: 1000,
            output_tokens: 500,
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::RunMetrics { num_turns, cost_usd, input_tokens, output_tokens, .. } => {
                assert_eq!(num_turns, 3);
                assert!((cost_usd - 0.042).abs() < 1e-9);
                assert_eq!(input_tokens, 1000);
                assert_eq!(output_tokens, 500);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn run_preflight_failed_event_roundtrip() {
        let evt = AppEvent::RunPreflightFailed {
            run_id: Uuid::new_v4(),
            reason: "claude binary not found".into(),
            suggestion: "install Claude Code and ensure `claude` is on PATH".into(),
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("\"type\":\"RunPreflightFailed\""));
        let _: AppEvent = serde_json::from_str(&json).unwrap();
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
                autonomy: AutonomyLevel::default(),
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
    fn list_stashes_command_roundtrip() {
        let cmd = AppCommand::ListStashes;
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"type\":\"ListStashes\""));
        let _: AppCommand = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn get_stash_files_command_roundtrip() {
        let cmd = AppCommand::GetStashFiles { stash_index: 2 };
        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: AppCommand = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppCommand::GetStashFiles { stash_index } => assert_eq!(stash_index, 2),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn get_stash_diff_command_roundtrip() {
        let cmd = AppCommand::GetStashDiff {
            stash_index: 0,
            file_path: Some(PathBuf::from("src/main.rs")),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: AppCommand = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppCommand::GetStashDiff { stash_index, file_path } => {
                assert_eq!(stash_index, 0);
                assert_eq!(file_path, Some(PathBuf::from("src/main.rs")));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn check_dirty_state_command_roundtrip() {
        let cmd = AppCommand::CheckDirtyState;
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"type\":\"CheckDirtyState\""));
        let _: AppCommand = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn stash_and_run_command_roundtrip() {
        let cmd = AppCommand::StashAndRun {
            session_id: Uuid::new_v4(),
            prompt: "fix bug".into(),
            mode: RunMode::Free,
            stash_message: "pre-run stash".into(),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: AppCommand = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppCommand::StashAndRun { prompt, mode, stash_message, .. } => {
                assert_eq!(prompt, "fix bug");
                assert_eq!(mode, RunMode::Free);
                assert_eq!(stash_message, "pre-run stash");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn stash_list_event_roundtrip() {
        let evt = AppEvent::StashList {
            stashes: vec![StashEntry {
                index: 0,
                message: "WIP on main".into(),
                branch: Some("main".into()),
                date: "2026-02-19".into(),
            }],
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::StashList { stashes } => {
                assert_eq!(stashes.len(), 1);
                assert_eq!(stashes[0].index, 0);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn stash_files_event_roundtrip() {
        let evt = AppEvent::StashFiles {
            stash_index: 1,
            files: vec![FileChange {
                path: PathBuf::from("src/lib.rs"),
                status: FileStatus::Modified,
            }],
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::StashFiles { stash_index, files } => {
                assert_eq!(stash_index, 1);
                assert_eq!(files.len(), 1);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn stash_diff_event_roundtrip() {
        let evt = AppEvent::StashDiff {
            stash_index: 0,
            diff: "--- a/file\n+++ b/file\n".into(),
            stat: Some(DiffStat {
                files_changed: 1,
                insertions: 5,
                deletions: 2,
                file_stats: vec![],
            }),
        };
        let json = serde_json::to_string(&evt).unwrap();
        let _: AppEvent = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn dirty_state_event_roundtrip() {
        let evt = AppEvent::DirtyState {
            status: DirtyStatus {
                staged: vec![DirtyFile {
                    path: PathBuf::from("src/main.rs"),
                    status: FileStatus::Modified,
                }],
                unstaged: vec![],
            },
        };
        let json = serde_json::to_string(&evt).unwrap();
        let _: AppEvent = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn dirty_warning_event_roundtrip() {
        let evt = AppEvent::DirtyWarning {
            status: DirtyStatus {
                staged: vec![],
                unstaged: vec![DirtyFile {
                    path: PathBuf::from("Cargo.toml"),
                    status: FileStatus::Modified,
                }],
            },
            session_id: Uuid::new_v4(),
            prompt: "run tests".into(),
            mode: RunMode::Guided,
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::DirtyWarning { status, prompt, mode, .. } => {
                assert_eq!(status.unstaged.len(), 1);
                assert_eq!(prompt, "run tests");
                assert_eq!(mode, RunMode::Guided);
            }
            _ => panic!("wrong variant"),
        }
    }

    // --- New protocol variant tests (M1-01) ---

    #[test]
    fn create_workspace_command_roundtrip() {
        let cmd = AppCommand::CreateWorkspace {
            name: "My Project".into(),
            root_path: PathBuf::from("/home/user/project"),
            mode: WorkspaceMode::AiSession,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: AppCommand = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppCommand::CreateWorkspace { name, mode, .. } => {
                assert_eq!(name, "My Project");
                assert_eq!(mode, WorkspaceMode::AiSession);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn workspace_created_event_roundtrip() {
        let evt = AppEvent::WorkspaceCreated {
            workspace: WorkspaceSummary {
                id: Uuid::new_v4(),
                name: "test".into(),
                root_path: PathBuf::from("/tmp/test"),
                mode: WorkspaceMode::Terminal,
                linked_session_id: None,
                last_active_at: chrono::Utc::now(),
            },
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("\"type\":\"WorkspaceCreated\""));
        let _: AppEvent = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn terminal_session_commands_roundtrip() {
        let cmd = AppCommand::CreateTerminalSession {
            workspace_id: Uuid::new_v4(),
            shell: Some("/bin/zsh".into()),
            cwd: Some(PathBuf::from("/home/user")),
            env: None,
            ssh: None,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"type\":\"CreateTerminalSession\""));
        let _: AppCommand = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn create_terminal_session_ssh_roundtrip() {
        use crate::models::SshConfig;
        let cmd = AppCommand::CreateTerminalSession {
            workspace_id: Uuid::new_v4(),
            shell: None,
            cwd: None,
            env: None,
            ssh: Some(SshConfig {
                host: "myserver.com".into(),
                port: 22,
                username: "deploy".into(),
                identity_file: Some(PathBuf::from("/home/user/.ssh/id_ed25519")),
            }),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: AppCommand = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppCommand::CreateTerminalSession { ssh: Some(cfg), .. } => {
                assert_eq!(cfg.host, "myserver.com");
                assert_eq!(cfg.port, 22);
                assert_eq!(cfg.username, "deploy");
            }
            _ => panic!("wrong variant or missing ssh config"),
        }
    }

    #[test]
    fn create_terminal_session_backward_compat_no_ssh_field() {
        // JSON without the ssh field should deserialize with ssh: None (backward compat)
        let json = r#"{"type":"CreateTerminalSession","workspace_id":"550e8400-e29b-41d4-a716-446655440000","shell":null,"cwd":null,"env":null}"#;
        let cmd: AppCommand = serde_json::from_str(json).unwrap();
        match cmd {
            AppCommand::CreateTerminalSession { ssh, .. } => {
                assert!(ssh.is_none(), "ssh should default to None when absent");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn terminal_session_created_event_with_ssh_fields() {
        let evt = AppEvent::TerminalSessionCreated {
            session_id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            shell: "ssh".into(),
            cwd: PathBuf::from("/"),
            is_ssh: true,
            ssh_host: Some("deploy@myserver.com".into()),
        };
        let json = serde_json::to_string(&evt).unwrap();
        let deserialized: AppEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            AppEvent::TerminalSessionCreated { is_ssh, ssh_host, .. } => {
                assert!(is_ssh);
                assert_eq!(ssh_host.as_deref(), Some("deploy@myserver.com"));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn terminal_session_created_backward_compat_no_ssh_fields() {
        // Old events without is_ssh / ssh_host should deserialize with defaults
        let json = r#"{"type":"TerminalSessionCreated","session_id":"550e8400-e29b-41d4-a716-446655440001","workspace_id":"550e8400-e29b-41d4-a716-446655440000","shell":"/bin/bash","cwd":"/"}"#;
        let evt: AppEvent = serde_json::from_str(json).unwrap();
        match evt {
            AppEvent::TerminalSessionCreated { is_ssh, ssh_host, .. } => {
                assert!(!is_ssh, "is_ssh should default to false");
                assert!(ssh_host.is_none(), "ssh_host should default to None");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn conflict_resolution_roundtrip() {
        let take_ours = ConflictResolution::TakeOurs;
        let json = serde_json::to_string(&take_ours).unwrap();
        let _: ConflictResolution = serde_json::from_str(&json).unwrap();

        let manual = ConflictResolution::Manual { content: "resolved content".into() };
        let json2 = serde_json::to_string(&manual).unwrap();
        let deser: ConflictResolution = serde_json::from_str(&json2).unwrap();
        match deser {
            ConflictResolution::Manual { content } => assert_eq!(content, "resolved content"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn push_branch_command_roundtrip() {
        let cmd = AppCommand::PushBranch { remote: Some("origin".into()), branch: None };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"type\":\"PushBranch\""));
        let _: AppCommand = serde_json::from_str(&json).unwrap();
    }

    // --- Exhaustive roundtrip coverage (issue #88, Minor2) ---------------
    //
    // These two tests construct one instance of every `AppCommand` /
    // `AppEvent` variant, serialize and deserialize it, and verify the tag
    // survives. The inner exhaustive `match` against each enum means adding
    // a new variant without extending this list fails to compile, which
    // satisfies the "missing variant fails CI" acceptance criterion.

    fn roundtrip_command(cmd: &AppCommand) -> String {
        let json = serde_json::to_string(cmd).expect("serialize");
        let back: AppCommand = serde_json::from_str(&json).expect("deserialize");
        let json2 = serde_json::to_string(&back).expect("re-serialize");
        assert_eq!(json, json2, "roundtrip stability failed for {json}");
        json
    }

    fn roundtrip_event(evt: &AppEvent) -> String {
        let json = serde_json::to_string(evt).expect("serialize");
        let back: AppEvent = serde_json::from_str(&json).expect("deserialize");
        let json2 = serde_json::to_string(&back).expect("re-serialize");
        assert_eq!(json, json2, "roundtrip stability failed for {json}");
        json
    }

    #[test]
    fn every_app_command_variant_roundtrips() {
        let uuid = || Uuid::new_v4();
        let path = || PathBuf::from("/tmp/x");
        let commands: Vec<AppCommand> = vec![
            AppCommand::Auth { token: "tok".into() },
            AppCommand::StartSession { project_root: path() },
            AppCommand::EndSession { session_id: uuid() },
            AppCommand::ListSessions,
            AppCommand::StartRun {
                session_id: uuid(),
                prompt: "p".into(),
                mode: RunMode::Free,
                skip_dirty_check: false,
                autonomy: AutonomyLevel::default(),
                kind: RunKind::OneShot,
            },
            AppCommand::CancelRun { run_id: uuid(), reason: "user".into() },
            AppCommand::GetRunStatus { run_id: uuid() },
            AppCommand::ListRuns { session_id: uuid() },
            AppCommand::GetRunOutput { run_id: uuid(), offset: 0, limit: 100 },
            AppCommand::GetDiff { run_id: uuid() },
            AppCommand::RevertRun { run_id: uuid() },
            AppCommand::MergeRun { run_id: uuid() },
            AppCommand::ListStashes,
            AppCommand::GetStashFiles { stash_index: 0 },
            AppCommand::GetStashDiff { stash_index: 0, file_path: None },
            AppCommand::CheckDirtyState,
            AppCommand::StashAndRun {
                session_id: uuid(),
                prompt: "p".into(),
                mode: RunMode::Free,
                stash_message: "m".into(),
            },
            AppCommand::SendChatMessage { run_id: uuid(), prompt: "next".into() },
            AppCommand::EndChat { run_id: uuid() },
            AppCommand::ApprovePlan { run_id: uuid() },
            AppCommand::RejectPlan { run_id: uuid(), feedback: "revise".into() },
            AppCommand::ListBranches,
            AppCommand::ListDirectory { path: path() },
            AppCommand::GetChangedFiles { mode: "working".into(), run_id: None },
            AppCommand::GetFileDiff {
                file_path: path(),
                mode: "working".into(),
                run_id: None,
            },
            AppCommand::GetRepoStatus,
            AppCommand::GetCommitHistory { limit: 20 },
            AppCommand::StageFile { path: path() },
            AppCommand::UnstageFile { path: path() },
            AppCommand::CreateCommit { message: "msg".into() },
            AppCommand::CheckoutBranch { name: "main".into() },
            AppCommand::CreateBranch { name: "feat".into(), from: Some("main".into()) },
            AppCommand::ListWorkspaces,
            AppCommand::CreateWorkspace {
                name: "w".into(),
                root_path: path(),
                mode: WorkspaceMode::AiSession,
            },
            AppCommand::CloseWorkspace { workspace_id: uuid() },
            AppCommand::ActivateWorkspace { workspace_id: uuid() },
            AppCommand::CreateTerminalSession {
                workspace_id: uuid(),
                shell: None,
                cwd: None,
                env: None,
                ssh: None,
            },
            AppCommand::CloseTerminalSession { session_id: uuid() },
            AppCommand::WriteTerminalInput { session_id: uuid(), data: "ls\n".into() },
            AppCommand::ResizeTerminal { session_id: uuid(), cols: 80, rows: 24 },
            AppCommand::ListTerminalSessions { workspace_id: uuid() },
            AppCommand::RestoreTerminalSession {
                previous_session_id: uuid(),
                workspace_id: uuid(),
            },
            AppCommand::ListRestoredTerminalSessions { workspace_id: uuid() },
            AppCommand::PushBranch { remote: None, branch: None },
            AppCommand::PullBranch { remote: None, branch: None },
            AppCommand::FetchRemote { remote: None },
            AppCommand::GetMergeConflicts,
            AppCommand::ResolveConflict {
                file_path: path(),
                resolution: ConflictResolution::TakeOurs,
            },
            AppCommand::ReadFile { path: "x".into(), max_bytes: None },
            AppCommand::SearchFiles {
                query: "q".into(),
                is_regex: false,
                case_sensitive: false,
                include_glob: None,
                exclude_glob: None,
                max_results: None,
                context_lines: None,
            },
            AppCommand::GetStatus,
            AppCommand::Ping,
            AppCommand::PopStash { index: 0 },
            AppCommand::ApplyStash { index: 0 },
            AppCommand::DropStash { index: 0 },
        ];

        // Exhaustive match — future variants MUST appear here or compilation
        // fails, which is exactly the CI gate Minor2 asks for.
        fn ensure_exhaustive(c: &AppCommand) -> &'static str {
            match c {
                AppCommand::Auth { .. } => "Auth",
                AppCommand::StartSession { .. } => "StartSession",
                AppCommand::EndSession { .. } => "EndSession",
                AppCommand::ListSessions => "ListSessions",
                AppCommand::StartRun { .. } => "StartRun",
                AppCommand::CancelRun { .. } => "CancelRun",
                AppCommand::GetRunStatus { .. } => "GetRunStatus",
                AppCommand::ListRuns { .. } => "ListRuns",
                AppCommand::GetRunOutput { .. } => "GetRunOutput",
                AppCommand::GetDiff { .. } => "GetDiff",
                AppCommand::RevertRun { .. } => "RevertRun",
                AppCommand::MergeRun { .. } => "MergeRun",
                AppCommand::ListStashes => "ListStashes",
                AppCommand::GetStashFiles { .. } => "GetStashFiles",
                AppCommand::GetStashDiff { .. } => "GetStashDiff",
                AppCommand::CheckDirtyState => "CheckDirtyState",
                AppCommand::StashAndRun { .. } => "StashAndRun",
                AppCommand::SendChatMessage { .. } => "SendChatMessage",
                AppCommand::EndChat { .. } => "EndChat",
                AppCommand::ApprovePlan { .. } => "ApprovePlan",
                AppCommand::RejectPlan { .. } => "RejectPlan",
                AppCommand::ListBranches => "ListBranches",
                AppCommand::ListDirectory { .. } => "ListDirectory",
                AppCommand::GetChangedFiles { .. } => "GetChangedFiles",
                AppCommand::GetFileDiff { .. } => "GetFileDiff",
                AppCommand::GetRepoStatus => "GetRepoStatus",
                AppCommand::GetCommitHistory { .. } => "GetCommitHistory",
                AppCommand::StageFile { .. } => "StageFile",
                AppCommand::UnstageFile { .. } => "UnstageFile",
                AppCommand::CreateCommit { .. } => "CreateCommit",
                AppCommand::CheckoutBranch { .. } => "CheckoutBranch",
                AppCommand::CreateBranch { .. } => "CreateBranch",
                AppCommand::ListWorkspaces => "ListWorkspaces",
                AppCommand::CreateWorkspace { .. } => "CreateWorkspace",
                AppCommand::CloseWorkspace { .. } => "CloseWorkspace",
                AppCommand::ActivateWorkspace { .. } => "ActivateWorkspace",
                AppCommand::CreateTerminalSession { .. } => "CreateTerminalSession",
                AppCommand::CloseTerminalSession { .. } => "CloseTerminalSession",
                AppCommand::WriteTerminalInput { .. } => "WriteTerminalInput",
                AppCommand::ResizeTerminal { .. } => "ResizeTerminal",
                AppCommand::ListTerminalSessions { .. } => "ListTerminalSessions",
                AppCommand::RestoreTerminalSession { .. } => "RestoreTerminalSession",
                AppCommand::ListRestoredTerminalSessions { .. } => "ListRestoredTerminalSessions",
                AppCommand::PushBranch { .. } => "PushBranch",
                AppCommand::PullBranch { .. } => "PullBranch",
                AppCommand::FetchRemote { .. } => "FetchRemote",
                AppCommand::GetMergeConflicts => "GetMergeConflicts",
                AppCommand::ResolveConflict { .. } => "ResolveConflict",
                AppCommand::ReadFile { .. } => "ReadFile",
                AppCommand::SearchFiles { .. } => "SearchFiles",
                AppCommand::GetStatus => "GetStatus",
                AppCommand::Ping => "Ping",
                AppCommand::PopStash { .. } => "PopStash",
                AppCommand::ApplyStash { .. } => "ApplyStash",
                AppCommand::DropStash { .. } => "DropStash",
            }
        }

        use std::collections::HashSet;
        let mut seen = HashSet::new();
        for cmd in &commands {
            let tag = ensure_exhaustive(cmd);
            seen.insert(tag);
            let json = roundtrip_command(cmd);
            assert!(
                json.contains(&format!("\"type\":\"{tag}\"")),
                "expected tag {tag} in {json}"
            );
        }
        // Sanity-check the table covers every tag the exhaustive match knows.
        assert_eq!(
            seen.len(),
            commands.len(),
            "duplicate or missing variant in commands list"
        );
    }

    #[test]
    fn every_app_event_variant_roundtrips() {
        let uuid = || Uuid::new_v4();
        let path = || PathBuf::from("/tmp/x");
        let diff_stat = || DiffStat {
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            file_stats: vec![],
        };
        let events: Vec<AppEvent> = vec![
            AppEvent::AuthSuccess,
            AppEvent::AuthFailed { reason: "bad".into() },
            AppEvent::RunStateChanged {
                run_id: uuid(),
                new_state: RunState::Running,
            },
            AppEvent::RunOutput {
                run_id: uuid(),
                line: "x".into(),
                line_number: 1,
            },
            AppEvent::RunCompleted {
                run_id: uuid(),
                summary: RunSummary {
                    id: uuid(),
                    state: RunState::Completed { exit_code: 0 },
                    prompt_preview: "p".into(),
                    modified_file_count: 0,
                    diff_stat: None,
                    started_at: chrono::Utc::now(),
                    ended_at: None,
                    autonomy: AutonomyLevel::default(),
                },
                diff_stat: None,
            },
            AppEvent::RunFailed {
                run_id: uuid(),
                error: "e".into(),
                phase: FailPhase::Execution,
            },
            AppEvent::RunCancelled { run_id: uuid() },
            AppEvent::RunToolUse {
                run_id: uuid(),
                tool_id: "t".into(),
                tool_name: "Edit".into(),
                tool_input_preview: "x".into(),
            },
            AppEvent::RunToolResult {
                run_id: uuid(),
                tool_id: "t".into(),
                is_error: false,
                preview: "ok".into(),
            },
            AppEvent::RunMetrics {
                run_id: uuid(),
                num_turns: 1,
                cost_usd: 0.1,
                input_tokens: 1,
                output_tokens: 1,
            },
            AppEvent::RunPreflightFailed {
                run_id: uuid(),
                reason: "r".into(),
                suggestion: "s".into(),
            },
            AppEvent::ChatTurnEnded { run_id: uuid() },
            AppEvent::PlanProposed { run_id: uuid(), plan: "plan".into() },
            AppEvent::RunDiff {
                run_id: uuid(),
                stat: diff_stat(),
                diff: "".into(),
            },
            AppEvent::RunReverted { run_id: uuid() },
            AppEvent::RunMerged {
                run_id: uuid(),
                merge_result: MergeResult::FastForward,
            },
            AppEvent::RunMergeConflict {
                run_id: uuid(),
                conflict_paths: vec![path()],
            },
            AppEvent::StashList { stashes: vec![] },
            AppEvent::StashFiles { stash_index: 0, files: vec![] },
            AppEvent::StashDiff {
                stash_index: 0,
                diff: "".into(),
                stat: None,
            },
            AppEvent::DirtyState {
                status: DirtyStatus { staged: vec![], unstaged: vec![] },
            },
            AppEvent::DirtyWarning {
                status: DirtyStatus { staged: vec![], unstaged: vec![] },
                session_id: uuid(),
                prompt: "p".into(),
                mode: RunMode::Free,
            },
            AppEvent::DirectoryListing { path: path(), entries: vec![] },
            AppEvent::ChangedFilesList {
                mode: "working".into(),
                run_id: None,
                files: vec![],
            },
            AppEvent::FileDiffResult {
                file_path: path(),
                diff: "".into(),
                stat: None,
            },
            AppEvent::RepoStatusResult {
                status: RepoStatusSnapshot {
                    branch: "main".into(),
                    head: "abc123".into(),
                    clean: true,
                    staged_count: 0,
                    unstaged_count: 0,
                },
            },
            AppEvent::CommitHistoryResult { commits: vec![] },
            AppEvent::CommitCreated { hash: "abc".into() },
            AppEvent::BranchChanged { name: "main".into() },
            AppEvent::BranchList { branches: vec![], current: None },
            AppEvent::SessionStarted {
                session: SessionSummary {
                    id: uuid(),
                    project_root: path(),
                    active_run: None,
                    run_count: 0,
                    started_at: chrono::Utc::now(),
                },
            },
            AppEvent::SessionEnded { session_id: uuid() },
            AppEvent::SessionList { sessions: vec![] },
            AppEvent::RunList { session_id: uuid(), runs: vec![] },
            AppEvent::RunOutputPage {
                run_id: uuid(),
                offset: 0,
                lines: vec![],
                has_more: false,
            },
            AppEvent::WorkspaceList { workspaces: vec![] },
            AppEvent::WorkspaceCreated {
                workspace: WorkspaceSummary {
                    id: uuid(),
                    name: "w".into(),
                    root_path: path(),
                    mode: WorkspaceMode::AiSession,
                    linked_session_id: None,
                    last_active_at: chrono::Utc::now(),
                },
            },
            AppEvent::WorkspaceClosed { workspace_id: uuid() },
            AppEvent::WorkspaceActivated { workspace_id: uuid() },
            AppEvent::TerminalSessionCreated {
                session_id: uuid(),
                workspace_id: uuid(),
                shell: "sh".into(),
                cwd: path(),
                is_ssh: false,
                ssh_host: None,
            },
            AppEvent::TerminalSessionClosed { session_id: uuid() },
            AppEvent::TerminalOutput { session_id: uuid(), data: "x".into() },
            AppEvent::TerminalSessionList {
                workspace_id: uuid(),
                sessions: vec![],
            },
            AppEvent::TerminalSessionRestored {
                previous_session_id: uuid(),
                new_session_id: uuid(),
                cwd: path(),
                workspace_id: uuid(),
            },
            AppEvent::TerminalSessionRestoreFailed {
                previous_session_id: uuid(),
                reason: "r".into(),
            },
            AppEvent::RestorableTerminalSessions {
                workspace_id: uuid(),
                sessions: vec![],
            },
            AppEvent::PushCompleted {
                branch: "main".into(),
                remote: "origin".into(),
            },
            AppEvent::PullCompleted {
                branch: "main".into(),
                commits_applied: 0,
            },
            AppEvent::FetchCompleted { remote: "origin".into() },
            AppEvent::GitOperationFailed {
                operation: "push".into(),
                reason: "r".into(),
            },
            AppEvent::MergeConflicts { files: vec![] },
            AppEvent::ConflictResolved { file_path: path() },
            AppEvent::FileContent {
                path: "x".into(),
                content: "y".into(),
                language: "rust".into(),
                truncated: false,
                size_bytes: 0,
            },
            AppEvent::FileReadError { path: "x".into(), error: "e".into() },
            AppEvent::SearchResults {
                query: "q".into(),
                matches: vec![],
                total_matches: 0,
                files_searched: 0,
                truncated: false,
                duration_ms: 0,
            },
            AppEvent::StatusUpdate { active_runs: 0, session_count: 0 },
            AppEvent::Pong,
            AppEvent::Error { code: "c".into(), message: "m".into() },
            AppEvent::StashApplied { index: 0, had_conflicts: false },
            AppEvent::StashDropped { index: 0 },
        ];

        fn ensure_exhaustive(e: &AppEvent) -> &'static str {
            match e {
                AppEvent::AuthSuccess => "AuthSuccess",
                AppEvent::AuthFailed { .. } => "AuthFailed",
                AppEvent::RunStateChanged { .. } => "RunStateChanged",
                AppEvent::RunOutput { .. } => "RunOutput",
                AppEvent::RunCompleted { .. } => "RunCompleted",
                AppEvent::RunFailed { .. } => "RunFailed",
                AppEvent::RunCancelled { .. } => "RunCancelled",
                AppEvent::RunToolUse { .. } => "RunToolUse",
                AppEvent::RunToolResult { .. } => "RunToolResult",
                AppEvent::RunMetrics { .. } => "RunMetrics",
                AppEvent::RunPreflightFailed { .. } => "RunPreflightFailed",
                AppEvent::ChatTurnEnded { .. } => "ChatTurnEnded",
                AppEvent::PlanProposed { .. } => "PlanProposed",
                AppEvent::RunDiff { .. } => "RunDiff",
                AppEvent::RunReverted { .. } => "RunReverted",
                AppEvent::RunMerged { .. } => "RunMerged",
                AppEvent::RunMergeConflict { .. } => "RunMergeConflict",
                AppEvent::StashList { .. } => "StashList",
                AppEvent::StashFiles { .. } => "StashFiles",
                AppEvent::StashDiff { .. } => "StashDiff",
                AppEvent::DirtyState { .. } => "DirtyState",
                AppEvent::DirtyWarning { .. } => "DirtyWarning",
                AppEvent::DirectoryListing { .. } => "DirectoryListing",
                AppEvent::ChangedFilesList { .. } => "ChangedFilesList",
                AppEvent::FileDiffResult { .. } => "FileDiffResult",
                AppEvent::RepoStatusResult { .. } => "RepoStatusResult",
                AppEvent::CommitHistoryResult { .. } => "CommitHistoryResult",
                AppEvent::CommitCreated { .. } => "CommitCreated",
                AppEvent::BranchChanged { .. } => "BranchChanged",
                AppEvent::BranchList { .. } => "BranchList",
                AppEvent::SessionStarted { .. } => "SessionStarted",
                AppEvent::SessionEnded { .. } => "SessionEnded",
                AppEvent::SessionList { .. } => "SessionList",
                AppEvent::RunList { .. } => "RunList",
                AppEvent::RunOutputPage { .. } => "RunOutputPage",
                AppEvent::WorkspaceList { .. } => "WorkspaceList",
                AppEvent::WorkspaceCreated { .. } => "WorkspaceCreated",
                AppEvent::WorkspaceClosed { .. } => "WorkspaceClosed",
                AppEvent::WorkspaceActivated { .. } => "WorkspaceActivated",
                AppEvent::TerminalSessionCreated { .. } => "TerminalSessionCreated",
                AppEvent::TerminalSessionClosed { .. } => "TerminalSessionClosed",
                AppEvent::TerminalOutput { .. } => "TerminalOutput",
                AppEvent::TerminalSessionList { .. } => "TerminalSessionList",
                AppEvent::TerminalSessionRestored { .. } => "TerminalSessionRestored",
                AppEvent::TerminalSessionRestoreFailed { .. } => "TerminalSessionRestoreFailed",
                AppEvent::RestorableTerminalSessions { .. } => "RestorableTerminalSessions",
                AppEvent::PushCompleted { .. } => "PushCompleted",
                AppEvent::PullCompleted { .. } => "PullCompleted",
                AppEvent::FetchCompleted { .. } => "FetchCompleted",
                AppEvent::GitOperationFailed { .. } => "GitOperationFailed",
                AppEvent::MergeConflicts { .. } => "MergeConflicts",
                AppEvent::ConflictResolved { .. } => "ConflictResolved",
                AppEvent::FileContent { .. } => "FileContent",
                AppEvent::FileReadError { .. } => "FileReadError",
                AppEvent::SearchResults { .. } => "SearchResults",
                AppEvent::StatusUpdate { .. } => "StatusUpdate",
                AppEvent::Pong => "Pong",
                AppEvent::Error { .. } => "Error",
                AppEvent::StashApplied { .. } => "StashApplied",
                AppEvent::StashDropped { .. } => "StashDropped",
            }
        }

        use std::collections::HashSet;
        let mut seen = HashSet::new();
        for evt in &events {
            let tag = ensure_exhaustive(evt);
            seen.insert(tag);
            let json = roundtrip_event(evt);
            assert!(
                json.contains(&format!("\"type\":\"{tag}\"")),
                "expected tag {tag} in {json}"
            );
        }
        assert_eq!(
            seen.len(),
            events.len(),
            "duplicate or missing variant in events list"
        );
    }
}
