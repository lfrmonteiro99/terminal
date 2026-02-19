use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

// --- Run State Machine ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RunState {
    Preparing,
    Running,
    Pausing { reason: PauseReason },
    WaitingInput { question: String, context: Vec<String> },
    Completed { exit_code: i32 },
    Failed { error: String, phase: FailPhase },
    Cancelled { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PauseReason {
    BlockingQuestion,
    SupervisorIntervention,
    PolicyViolation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FailPhase {
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
        !self.is_terminal()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: WorktreeMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.branch_name, "llm/test");
    }
}
