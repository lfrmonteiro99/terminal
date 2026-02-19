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
}

// --- Summaries (for wire protocol) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSummary {
    pub id: Uuid,
    pub state: RunState,
    pub prompt_preview: String,
    pub modified_file_count: usize,
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
}
