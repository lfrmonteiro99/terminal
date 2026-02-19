// --- Models ---

export type RunState =
  | { type: 'Preparing' }
  | { type: 'Running' }
  | { type: 'Pausing'; reason: PauseReason }
  | { type: 'WaitingInput'; question: string; context: string[] }
  | { type: 'Completed'; exit_code: number }
  | { type: 'Failed'; error: string; phase: FailPhase }
  | { type: 'Cancelled'; reason: string };

export type PauseReason = 'BlockingQuestion' | 'SupervisorIntervention' | 'PolicyViolation';
export type FailPhase = 'Preparation' | 'Execution' | 'Parsing' | 'Cleanup';
export type RunMode = 'Free' | 'Guided' | 'Strict';

export interface RunSummary {
  id: string;
  state: RunState;
  prompt_preview: string;
  modified_file_count: number;
  started_at: string;
  ended_at: string | null;
  diff_stat: DiffStat | null;
}

// --- Git Types (Phase 2) ---

export interface FileDiffStat {
  path: string;
  insertions: number;
  deletions: number;
}

export interface DiffStat {
  files_changed: number;
  insertions: number;
  deletions: number;
  file_stats: FileDiffStat[];
}

export type MergeResult =
  | 'FastForward'
  | 'Merged'
  | { Conflict: string[] };

// --- Stash Types (Phase 2.1) ---

export interface StashEntry {
  index: number;
  message: string;
  branch: string | null;
  date: string;
}

export interface DirtyFile {
  path: string;
  status: FileStatus;
}

export type FileStatus = 'Added' | 'Modified' | 'Deleted' | { Renamed: string };

export interface DirtyStatus {
  staged: DirtyFile[];
  unstaged: DirtyFile[];
}

export interface FileChange {
  path: string;
  status: FileStatus;
}

export interface SessionSummary {
  id: string;
  project_root: string;
  active_run: string | null;
  run_count: number;
  started_at: string;
}

// --- Commands (Client -> Daemon) ---

export type AppCommand =
  | { type: 'Auth'; token: string }
  | { type: 'StartSession'; project_root: string }
  | { type: 'EndSession'; session_id: string }
  | { type: 'ListSessions' }
  | { type: 'StartRun'; session_id: string; prompt: string; mode: RunMode; skip_dirty_check?: boolean }
  | { type: 'CancelRun'; run_id: string; reason: string }
  | { type: 'RespondToBlocking'; run_id: string; response: string }
  | { type: 'GetRunStatus'; run_id: string }
  | { type: 'ListRuns'; session_id: string }
  | { type: 'GetRunOutput'; run_id: string; offset: number; limit: number }
  | { type: 'GetDiff'; run_id: string }
  | { type: 'RevertRun'; run_id: string }
  | { type: 'MergeRun'; run_id: string }
  | { type: 'GetStatus' }
  | { type: 'Ping' }
  | { type: 'ListStashes' }
  | { type: 'GetStashFiles'; stash_index: number }
  | { type: 'GetStashDiff'; stash_index: number; file_path: string | null }
  | { type: 'CheckDirtyState' }
  | { type: 'StashAndRun'; session_id: string; prompt: string; mode: RunMode; stash_message: string };

// --- Events (Daemon -> Client) ---

export type AppEvent =
  | { type: 'AuthSuccess' }
  | { type: 'AuthFailed'; reason: string }
  | { type: 'RunStateChanged'; run_id: string; new_state: RunState }
  | { type: 'RunOutput'; run_id: string; line: string; line_number: number }
  | { type: 'RunBlocking'; run_id: string; question: string; context: string[] }
  | { type: 'RunCompleted'; run_id: string; summary: RunSummary; diff_stat: DiffStat | null }
  | { type: 'RunDiff'; run_id: string; stat: DiffStat; diff: string }
  | { type: 'RunReverted'; run_id: string }
  | { type: 'RunMerged'; run_id: string; merge_result: MergeResult }
  | { type: 'RunMergeConflict'; run_id: string; conflict_paths: string[] }
  | { type: 'RunFailed'; run_id: string; error: string; phase: FailPhase }
  | { type: 'RunCancelled'; run_id: string }
  | { type: 'SessionStarted'; session: SessionSummary }
  | { type: 'SessionEnded'; session_id: string }
  | { type: 'SessionList'; sessions: SessionSummary[] }
  | { type: 'RunList'; session_id: string; runs: RunSummary[] }
  | { type: 'RunOutputPage'; run_id: string; offset: number; lines: string[]; has_more: boolean }
  | { type: 'StatusUpdate'; active_runs: number; session_count: number }
  | { type: 'Pong' }
  | { type: 'Error'; code: string; message: string }
  | { type: 'StashList'; stashes: StashEntry[] }
  | { type: 'StashFiles'; stash_index: number; files: FileChange[] }
  | { type: 'StashDiff'; stash_index: number; diff: string; stat: DiffStat | null }
  | { type: 'DirtyState'; status: DirtyStatus }
  | { type: 'DirtyWarning'; status: DirtyStatus; session_id: string; prompt: string; mode: RunMode };
