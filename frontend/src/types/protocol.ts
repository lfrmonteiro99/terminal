// --- Workspace / Pane types (M1-01) ---

export type { WorkspaceSummary, Workspace, WorkspaceMode } from '../domain/workspace/types';
export type { PaneLayout, PaneDefinition, PaneKind, SplitDirection } from '../domain/pane/types';

// --- Terminal Session types (M4-01) ---

export interface TerminalSessionSummary {
  session_id: string;
  workspace_id: string;
  shell: string;
  cwd: string;
  created_at: string;
  last_active_at: string;
}

export interface RestorableTerminalSession {
  session_id: string;
  pane_id: string;
  cwd: string;
  last_active_at: string;
}

// --- Merge Conflict types (M5-05) ---

export interface MergeConflictFile {
  path: string;
  ours: string;
  theirs: string;
  base: string | null;
}

export type ConflictResolution =
  | { type: 'TakeOurs' }
  | { type: 'TakeTheirs' }
  | { type: 'Manual'; content: string };

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

export interface FileTreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
}

export interface CommitEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface RepoStatus {
  branch: string;
  head: string;
  clean: boolean;
  staged_count: number;
  unstaged_count: number;
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
  | { type: 'StashAndRun'; session_id: string; prompt: string; mode: RunMode; stash_message: string }
  // Phase 3: Sidebar commands
  | { type: 'ListDirectory'; path: string }
  | { type: 'GetChangedFiles'; mode: 'working' | 'run'; run_id?: string }
  | { type: 'GetFileDiff'; file_path: string; mode: 'working' | 'run'; run_id?: string }
  | { type: 'GetRepoStatus' }
  | { type: 'GetCommitHistory'; limit: number }
  | { type: 'StageFile'; path: string }
  | { type: 'UnstageFile'; path: string }
  | { type: 'CreateCommit'; message: string }
  | { type: 'CheckoutBranch'; name: string }
  | { type: 'CreateBranch'; name: string; from?: string }
  // Workspace commands (M1-01)
  | { type: 'ListWorkspaces' }
  | { type: 'CreateWorkspace'; name: string; root_path: string; mode: WorkspaceMode }
  | { type: 'CloseWorkspace'; workspace_id: string }
  | { type: 'ActivateWorkspace'; workspace_id: string }
  // PTY commands (M4-01)
  | { type: 'CreateTerminalSession'; workspace_id: string; shell?: string; cwd?: string; env?: [string, string][] }
  | { type: 'CloseTerminalSession'; session_id: string }
  | { type: 'WriteTerminalInput'; session_id: string; data: string }
  | { type: 'ResizeTerminal'; session_id: string; cols: number; rows: number }
  | { type: 'ListTerminalSessions'; workspace_id: string }
  | { type: 'RestoreTerminalSession'; previous_session_id: string; workspace_id: string }
  | { type: 'ListRestoredTerminalSessions'; workspace_id: string }
  // Git extended (M5-03, M5-04)
  | { type: 'PushBranch'; remote?: string; branch?: string }
  | { type: 'PullBranch'; remote?: string; branch?: string }
  | { type: 'FetchRemote'; remote?: string }
  | { type: 'GetMergeConflicts' }
  | { type: 'ResolveConflict'; file_path: string; resolution: ConflictResolution };

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
  | { type: 'DirtyWarning'; status: DirtyStatus; session_id: string; prompt: string; mode: RunMode }
  // Phase 3: Sidebar events
  | { type: 'DirectoryListing'; path: string; entries: FileTreeEntry[] }
  | { type: 'ChangedFilesList'; mode: 'working' | 'run'; run_id?: string; files: FileChange[] }
  | { type: 'FileDiffResult'; file_path: string; diff: string; stat: DiffStat | null }
  | { type: 'RepoStatusResult'; status: RepoStatus }
  | { type: 'CommitHistoryResult'; commits: CommitEntry[] }
  | { type: 'CommitCreated'; hash: string }
  | { type: 'BranchChanged'; name: string }
  // Workspace events (M1-01)
  | { type: 'WorkspaceList'; workspaces: WorkspaceSummary[] }
  | { type: 'WorkspaceCreated'; workspace: WorkspaceSummary }
  | { type: 'WorkspaceClosed'; workspace_id: string }
  | { type: 'WorkspaceActivated'; workspace_id: string }
  // PTY events (M4-01)
  | { type: 'TerminalSessionCreated'; session_id: string; workspace_id: string; shell: string; cwd: string }
  | { type: 'TerminalSessionClosed'; session_id: string }
  | { type: 'TerminalOutput'; session_id: string; data: string }
  | { type: 'TerminalSessionList'; workspace_id: string; sessions: TerminalSessionSummary[] }
  | { type: 'TerminalSessionRestored'; previous_session_id: string; new_session_id: string; cwd: string; workspace_id: string }
  | { type: 'TerminalSessionRestoreFailed'; previous_session_id: string; reason: string }
  | { type: 'RestorableTerminalSessions'; workspace_id: string; sessions: RestorableTerminalSession[] }
  // Git extended (M5-04)
  | { type: 'PushCompleted'; branch: string; remote: string }
  | { type: 'PullCompleted'; branch: string; commits_applied: number }
  | { type: 'FetchCompleted'; remote: string }
  | { type: 'GitOperationFailed'; operation: string; reason: string }
  | { type: 'MergeConflicts'; files: MergeConflictFile[] }
  | { type: 'ConflictResolved'; file_path: string };
