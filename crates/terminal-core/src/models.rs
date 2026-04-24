use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

// --- Workspace / Mode / Pane Domain Models (M1-01) ---

/// The mode a workspace is operating in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkspaceMode {
    AiSession,
    Terminal,
    Git,
    Browser,
}

/// A persistent workspace — root directory + active mode + pane layout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub root_path: PathBuf,
    pub mode: WorkspaceMode,
    pub layout: PaneLayout,
    pub linked_session_id: Option<Uuid>,
    #[serde(default)]
    pub mcp_config: Option<PathBuf>,
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
}

/// Wire-safe summary of a workspace (no full layout).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: Uuid,
    pub name: String,
    pub root_path: PathBuf,
    pub mode: WorkspaceMode,
    pub linked_session_id: Option<Uuid>,
    pub last_active_at: DateTime<Utc>,
}

impl From<&Workspace> for WorkspaceSummary {
    fn from(ws: &Workspace) -> Self {
        WorkspaceSummary {
            id: ws.id,
            name: ws.name.clone(),
            root_path: ws.root_path.clone(),
            mode: ws.mode.clone(),
            linked_session_id: ws.linked_session_id,
            last_active_at: ws.last_active_at,
        }
    }
}

/// The type of content a pane renders.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PaneKind {
    AiRun,
    Terminal,
    GitStatus,
    GitHistory,
    FileExplorer,
    Browser,
    Diff,
}

/// A single pane in the layout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneDefinition {
    pub id: String,
    pub kind: PaneKind,
    /// Optional link to a resource (run_id, session_id, terminal_session_id, etc.)
    pub resource_id: Option<Uuid>,
}

/// Split direction for a layout node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

/// Recursive pane layout tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaneLayout {
    Single(PaneDefinition),
    Split {
        direction: SplitDirection,
        ratio: f32,
        first: Box<PaneLayout>,
        second: Box<PaneLayout>,
    },
}

impl PaneLayout {
    pub fn default_ai_session() -> Self {
        PaneLayout::Single(PaneDefinition {
            id: "ai-run".into(),
            kind: PaneKind::AiRun,
            resource_id: None,
        })
    }

    pub fn default_terminal() -> Self {
        PaneLayout::Single(PaneDefinition {
            id: "terminal-0".into(),
            kind: PaneKind::Terminal,
            resource_id: None,
        })
    }

    pub fn default_git() -> Self {
        PaneLayout::Split {
            direction: SplitDirection::Horizontal,
            ratio: 0.4,
            first: Box::new(PaneLayout::Single(PaneDefinition {
                id: "git-status".into(),
                kind: PaneKind::GitStatus,
                resource_id: None,
            })),
            second: Box::new(PaneLayout::Single(PaneDefinition {
                id: "git-history".into(),
                kind: PaneKind::GitHistory,
                resource_id: None,
            })),
        }
    }
}

// --- Run State Machine ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RunState {
    Preparing,
    Running,
    Pausing {
        reason: PauseReason,
    },
    WaitingInput {
        question: String,
        context: Vec<String>,
    },
    /// Chat-only: a completed turn is waiting for the next user message.
    AwaitingUserInput,
    /// Plan-mode chat: a proposed plan is waiting for approval or feedback.
    AwaitingPlanApproval {
        plan: String,
    },
    Completed {
        exit_code: i32,
    },
    Failed {
        error: String,
        phase: FailPhase,
    },
    Cancelled {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PauseReason {
    BlockingQuestion,
    SupervisorIntervention,
    PolicyViolation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FailPhase {
    Preflight,
    Preparation,
    Execution,
    Parsing,
    Cleanup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RunMode {
    Free,
    Guided,
    Strict,
}

/// How much autonomy the run has over the worktree.
///
/// - `Autonomous`: Claude is free to edit files, run bash, etc. Because runs
///   execute inside an isolated git worktree, the user can still review and
///   revert at the end. Maps to `--permission-mode bypassPermissions`.
/// - `ReviewPlan`: Claude produces a plan describing what it *would* do but
///   does not execute any edit/write/bash tools. The UI surfaces an
///   "Approve & execute" button that fires a fresh autonomous run with the
///   same prompt. Maps to `--permission-mode plan`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub enum AutonomyLevel {
    #[default]
    Autonomous,
    ReviewPlan,
}

/// How the run is driven.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub enum RunKind {
    #[default]
    OneShot,
    Chat,
}
// --- Output ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OutputKind {
    Stdout,
    Stderr,
    Delimiter(String),
    BlockingSignal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputChunkMeta {
    pub timestamp: DateTime<Utc>,
    pub kind: OutputKind,
    pub byte_offset: u64,
    pub byte_length: u64,
    pub line_number: usize,
}

// --- Run ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: Uuid,
    pub session_id: Uuid,
    pub branch: String,
    pub mode: RunMode,
    /// User-facing autonomy choice. Absent in old persisted runs → Autonomous.
    #[serde(default)]
    pub autonomy: AutonomyLevel,
    /// Run driving strategy. Defaults to OneShot for old persisted runs.
    #[serde(default)]
    pub kind: RunKind,
    pub state: RunState,
    pub prompt: String,
    pub provided_files: Vec<PathBuf>,
    pub modified_files: Vec<PathBuf>,
    pub expanded_files: Vec<PathBuf>,
    pub output_path: PathBuf,
    pub output_line_count: usize,
    pub output_byte_count: u64,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub last_modified: DateTime<Utc>,
}

// --- Session ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandRecord {
    pub timestamp: DateTime<Utc>,
    pub command: String,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub project_root: PathBuf,
    pub initial_head: String,
    pub active_run: Option<Uuid>,
    pub runs: Vec<Uuid>,
    pub commands: Vec<CommandRecord>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub last_modified: DateTime<Utc>,
}

// --- Summaries (for wire protocol) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSummary {
    pub id: Uuid,
    pub state: RunState,
    pub prompt_preview: String,
    pub modified_file_count: usize,
    pub diff_stat: Option<DiffStat>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    /// Autonomy mode this run was executed under. Lets the UI decide whether
    /// to show the "Approve & execute" follow-up after a plan run.
    #[serde(default)]
    pub autonomy: AutonomyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: Uuid,
    pub project_root: PathBuf,
    pub active_run: Option<Uuid>,
    pub run_count: usize,
    pub started_at: DateTime<Utc>,
}

// --- Git Types ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RepoState {
    Clean,
    Merge,
    Rebase,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed(PathBuf),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileChange {
    pub path: PathBuf,
    pub status: FileStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffStat {
    pub path: PathBuf,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStat {
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
    pub file_stats: Vec<FileDiffStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MergeResult {
    FastForward,
    Merged,
    Conflict(Vec<PathBuf>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeMeta {
    pub worktree_path: PathBuf,
    pub branch_name: String,
    pub base_head: String,
    pub merge_base: String,
    pub last_modified: DateTime<Utc>,
    /// Main repository root this worktree belongs to. Needed so cleanup
    /// paths (crash recovery, startup reconcile) can invoke `git worktree
    /// remove`. Optional for backward compatibility with older JSON files;
    /// when absent, callers fall back to deriving it from `worktree_path`.
    #[serde(default)]
    pub repo_root: Option<PathBuf>,
}

// --- Sidebar Types (Phase 3) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitEntry {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStatusSnapshot {
    pub branch: String,
    pub head: String,
    pub clean: bool,
    pub staged_count: usize,
    pub unstaged_count: usize,
}

// --- SSH Config (TERMINAL-051) ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub identity_file: Option<PathBuf>,
}

// --- Terminal Session Types (M4-01, M4-06) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionMeta {
    pub session_id: Uuid,
    pub workspace_id: Uuid,
    pub pane_id: String,
    pub shell_path: PathBuf,
    pub cwd: PathBuf,
    pub env_snapshot: Vec<(String, String)>,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionSummary {
    pub session_id: Uuid,
    pub workspace_id: Uuid,
    pub shell: String,
    pub cwd: PathBuf,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestorableTerminalSession {
    pub session_id: Uuid,
    pub pane_id: String,
    pub cwd: PathBuf,
    pub last_active_at: DateTime<Utc>,
}

// --- Merge Conflict Types (M5-05) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflictFile {
    pub path: PathBuf,
    pub ours: String,
    pub theirs: String,
    pub base: Option<String>,
}

// --- Search Types (TERMINAL-006) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file_path: PathBuf,
    pub line_number: usize,
    pub line_content: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

// --- Branch Types ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub last_commit_summary: Option<String>,
}

// --- Stash / Dirty State Types ---

/// Git stash entry
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub branch: Option<String>,
    pub date: String,
}

/// Dirty working directory status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DirtyStatus {
    pub staged: Vec<DirtyFile>,
    pub unstaged: Vec<DirtyFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DirtyFile {
    pub path: PathBuf,
    pub status: FileStatus,
}

impl RunState {
    /// Returns true if this state represents a terminal (final) state.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RunState::Completed { .. } | RunState::Failed { .. } | RunState::Cancelled { .. }
        )
    }

    /// Returns true if this state represents an active (non-terminal) state.
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            RunState::Preparing
                | RunState::Running
                | RunState::Pausing { .. }
                | RunState::WaitingInput { .. }
                | RunState::AwaitingUserInput
                | RunState::AwaitingPlanApproval { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_kind_defaults_to_oneshot() {
        let kind: RunKind = Default::default();
        assert_eq!(kind, RunKind::OneShot);
    }

    #[test]
    fn run_kind_serde_roundtrip() {
        let json = serde_json::to_string(&RunKind::Chat).unwrap();
        assert_eq!(json, "\"Chat\"");
        let back: RunKind = serde_json::from_str(&json).unwrap();
        assert_eq!(back, RunKind::Chat);
    }

    #[test]
    fn legacy_run_without_kind_defaults_to_oneshot() {
        let run_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let json = format!(
            r#"{{
                "id": "{run_id}",
                "session_id": "{session_id}",
                "branch": "main",
                "mode": "Free",
                "autonomy": "Autonomous",
                "state": "Running",
                "prompt": "hello",
                "provided_files": [],
                "modified_files": [],
                "expanded_files": [],
                "output_path": "/tmp/run.log",
                "output_line_count": 0,
                "output_byte_count": 0,
                "started_at": "2026-01-01T00:00:00Z",
                "ended_at": null,
                "last_modified": "2026-01-01T00:00:00Z"
            }}"#
        );

        let run: Run = serde_json::from_str(&json).unwrap();
        assert_eq!(run.kind, RunKind::OneShot);
    }

    #[test]
    fn awaiting_user_input_is_active_not_terminal() {
        let state = RunState::AwaitingUserInput;
        assert!(state.is_active());
        assert!(!state.is_terminal());
    }

    #[test]
    fn awaiting_plan_approval_is_active_not_terminal() {
        let state = RunState::AwaitingPlanApproval { plan: "test".into() };
        assert!(state.is_active());
        assert!(!state.is_terminal());
    }

    #[test]
    fn run_state_terminal_states() {
        assert!(RunState::Completed { exit_code: 0 }.is_terminal());
        assert!(RunState::Failed {
            error: "err".into(),
            phase: FailPhase::Execution,
        }
        .is_terminal());
        assert!(RunState::Cancelled {
            reason: "user".into(),
        }
        .is_terminal());
    }

    #[test]
    fn run_state_active_states() {
        assert!(RunState::Preparing.is_active());
        assert!(RunState::Running.is_active());
        assert!(RunState::Pausing {
            reason: PauseReason::BlockingQuestion,
        }
        .is_active());
        assert!(RunState::WaitingInput {
            question: "q".into(),
            context: vec![],
        }
        .is_active());
    }

    #[test]
    fn run_state_serialization_roundtrip() {
        let state = RunState::WaitingInput {
            question: "Need file path".into(),
            context: vec!["src/main.rs".into()],
        };
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: RunState = serde_json::from_str(&json).unwrap();
        assert_eq!(state, deserialized);
    }

    #[test]
    fn run_mode_serialization() {
        let mode = RunMode::Guided;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, "\"Guided\"");
    }

    #[test]
    fn diff_stat_serialization() {
        let stat = DiffStat {
            files_changed: 3,
            insertions: 42,
            deletions: 7,
            file_stats: vec![FileDiffStat {
                path: PathBuf::from("src/main.rs"),
                insertions: 42,
                deletions: 7,
            }],
        };
        let json = serde_json::to_string(&stat).unwrap();
        let deserialized: DiffStat = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.files_changed, 3);
    }

    #[test]
    fn merge_result_serialization() {
        let conflict = MergeResult::Conflict(vec![PathBuf::from("src/lib.rs")]);
        let json = serde_json::to_string(&conflict).unwrap();
        let deserialized: MergeResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, conflict);
    }

    #[test]
    fn stash_entry_serialization_roundtrip() {
        let entry = StashEntry {
            index: 0,
            message: "WIP on main: abc1234 some work".into(),
            branch: Some("main".into()),
            date: "2026-02-19 12:00:00 +0000".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: StashEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry, deserialized);
    }

    #[test]
    fn dirty_status_serialization_roundtrip() {
        let status = DirtyStatus {
            staged: vec![DirtyFile {
                path: PathBuf::from("src/main.rs"),
                status: FileStatus::Modified,
            }],
            unstaged: vec![DirtyFile {
                path: PathBuf::from("README.md"),
                status: FileStatus::Added,
            }],
        };
        let json = serde_json::to_string(&status).unwrap();
        let deserialized: DirtyStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, deserialized);
    }

    #[test]
    fn dirty_status_empty_is_clean() {
        let status = DirtyStatus {
            staged: vec![],
            unstaged: vec![],
        };
        let json = serde_json::to_string(&status).unwrap();
        let deserialized: DirtyStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.staged.len(), 0);
        assert_eq!(deserialized.unstaged.len(), 0);
    }

    #[test]
    fn worktree_meta_serialization() {
        let meta = WorktreeMeta {
            worktree_path: PathBuf::from("/tmp/wt"),
            branch_name: "llm/test".into(),
            base_head: "abc123".into(),
            merge_base: "abc123".into(),
            last_modified: chrono::Utc::now(),
            repo_root: Some(PathBuf::from("/tmp/project")),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: WorktreeMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.branch_name, "llm/test");
        assert_eq!(
            deserialized.repo_root.as_deref(),
            Some(std::path::Path::new("/tmp/project"))
        );
    }

    #[test]
    fn worktree_meta_backward_compat_without_repo_root() {
        // Older JSON payloads (pre-M17) had no repo_root field.
        let legacy_json = r#"{
            "worktree_path": "/tmp/wt",
            "branch_name": "llm/test",
            "base_head": "abc123",
            "merge_base": "abc123",
            "last_modified": "2024-01-01T00:00:00Z"
        }"#;
        let meta: WorktreeMeta = serde_json::from_str(legacy_json).unwrap();
        assert!(meta.repo_root.is_none());
    }

    #[test]
    fn workspace_serialization_roundtrip() {
        let ws = Workspace {
            id: Uuid::new_v4(),
            name: "My Project".into(),
            root_path: PathBuf::from("/home/user/project"),
            mode: WorkspaceMode::AiSession,
            layout: PaneLayout::default_ai_session(),
            linked_session_id: None,
            mcp_config: None,
            allowed_tools: None,
            disallowed_tools: None,
            created_at: chrono::Utc::now(),
            last_active_at: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&ws).unwrap();
        let deserialized: Workspace = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "My Project");
        assert_eq!(deserialized.mode, WorkspaceMode::AiSession);
    }

    #[test]
    fn workspace_mcp_fields_default_when_missing_from_json() {
        let json = format!(
            r#"{{
                "id": "{}",
                "name": "Repo",
                "root_path": "/repo",
                "mode": "AiSession",
                "layout": {{ "Single": {{ "id": "main", "kind": "AiRun", "resource_id": null }} }},
                "linked_session_id": null,
                "created_at": "2026-01-01T00:00:00Z",
                "last_active_at": "2026-01-01T00:00:00Z"
            }}"#,
            Uuid::new_v4()
        );

        let ws: Workspace = serde_json::from_str(&json).unwrap();

        assert_eq!(ws.mcp_config, None);
        assert_eq!(ws.allowed_tools, None);
        assert_eq!(ws.disallowed_tools, None);
    }

    #[test]
    fn workspace_summary_from_workspace() {
        let ws = Workspace {
            id: Uuid::new_v4(),
            name: "Test".into(),
            root_path: PathBuf::from("/tmp/test"),
            mode: WorkspaceMode::Terminal,
            layout: PaneLayout::default_terminal(),
            linked_session_id: None,
            mcp_config: None,
            allowed_tools: None,
            disallowed_tools: None,
            created_at: chrono::Utc::now(),
            last_active_at: chrono::Utc::now(),
        };
        let summary = WorkspaceSummary::from(&ws);
        assert_eq!(summary.name, ws.name);
        assert_eq!(summary.mode, WorkspaceMode::Terminal);
    }

    #[test]
    fn pane_layout_default_git() {
        let layout = PaneLayout::default_git();
        let json = serde_json::to_string(&layout).unwrap();
        let deserialized: PaneLayout = serde_json::from_str(&json).unwrap();
        match deserialized {
            PaneLayout::Split { direction, .. } => {
                assert_eq!(direction, SplitDirection::Horizontal);
            }
            _ => panic!("expected Split layout"),
        }
    }

    #[test]
    fn terminal_session_meta_roundtrip() {
        let meta = TerminalSessionMeta {
            session_id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            pane_id: "terminal-0".into(),
            shell_path: PathBuf::from("/bin/bash"),
            cwd: PathBuf::from("/home/user"),
            env_snapshot: vec![("TERM".into(), "xterm-256color".into())],
            created_at: chrono::Utc::now(),
            last_active_at: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: TerminalSessionMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.pane_id, "terminal-0");
        assert_eq!(deserialized.env_snapshot.len(), 1);
    }

    #[test]
    fn workspace_mode_all_variants_serialize() {
        let modes = [
            WorkspaceMode::AiSession,
            WorkspaceMode::Terminal,
            WorkspaceMode::Git,
            WorkspaceMode::Browser,
        ];
        for mode in modes {
            let json = serde_json::to_string(&mode).unwrap();
            let deserialized: WorkspaceMode = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, mode);
        }
    }
}
