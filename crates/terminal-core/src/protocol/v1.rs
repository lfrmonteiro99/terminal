use crate::models::{
    BranchInfo, CommitEntry, DiffStat, DirtyFile, DirtyStatus, FailPhase, FileChange, FileStatus,
    FileTreeEntry, MergeConflictFile, MergeResult, RepoStatusSnapshot, RestorableTerminalSession,
    RunMode, RunState, RunSummary, SearchMatch, SessionSummary, SshConfig, StashEntry,
    TerminalSessionSummary, WorkspaceMode, WorkspaceSummary,
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
}
