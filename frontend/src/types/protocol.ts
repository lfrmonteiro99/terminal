// --- Workspace / Pane types (M1-01) ---

export type { WorkspaceSummary, Workspace, WorkspaceMode } from '../domain/workspace/types';
import type { WorkspaceSummary, WorkspaceMode } from '../domain/workspace/types';
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

// --- Search types (TERMINAL-006) ---

export interface SearchMatch {
  file_path: string;
  line_number: number;
  line_content: string;
  context_before: string[];
  context_after: string[];
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

/**
 * The daemon serialises `RunState` as an externally-tagged enum — `"Running"`,
 * `{"Completed":{"exit_code":0}}` — while this UI models it as
 * `{ type: 'Completed', exit_code: 0 }`. Convert at the edge so no consumer
 * (post-run summary, session strip, status dot) has to know the wire shape.
 */
export function normalizeRunState(raw: unknown): RunState {
  if (typeof raw === 'string') return { type: raw } as RunState;
  if (raw && typeof raw === 'object') {
    const [tag, payload] = Object.entries(raw as Record<string, unknown>)[0] ?? [];
    if (typeof tag === 'string') {
      return (payload && typeof payload === 'object'
        ? { type: tag, ...(payload as Record<string, unknown>) }
        : { type: tag }) as RunState;
    }
  }
  return { type: 'Preparing' } as RunState;
}
export type FailPhase = 'Preflight' | 'Preparation' | 'Execution' | 'Parsing' | 'Cleanup';

/** Severity of a run notice — chrome shown beside a run, never inside its log. */
export type NoticeLevel = 'Info' | 'Warning' | 'Error';

/** A notice as the panel consumes it, tagged with the run it belongs to so a
 *  late event from a previous run cannot land in the current one. */
export interface RunNotice {
  runId: string;
  level: NoticeLevel;
  message: string;
  at: number;
}
export type RunMode = 'Free' | 'Guided' | 'Strict';

/**
 * Autonomy level for an AI run.
 *
 * - `Autonomous`: Claude runs freely inside the worktree; user reviews the
 *   final diff and decides merge/revert.
 * - `ReviewPlan`: Claude produces a plan but does not execute edits/bash;
 *   user clicks "Approve & execute" to spawn a follow-up autonomous run.
 */
export type AutonomyLevel = 'Autonomous' | 'ReviewPlan';

export interface RunSummary {
  id: string;
  state: RunState;
  prompt_preview: string;
  modified_file_count: number;
  started_at: string;
  ended_at: string | null;
  diff_stat: DiffStat | null;
  autonomy?: AutonomyLevel;
  /**
   * Session that owns the run. A project's history spans one session per
   * `StartSession`, so a run has to be able to say where it came from.
   */
  session_id: string;
  /** Branch the run's worktree lives on. Empty when the run never got that far. */
  branch: string;
  /** Agent that drove the run; `null` = the implicit default (Claude CLI). */
  agent_id: string | null;
  /**
   * The full prompt, not `prompt_preview`. Re-running must resubmit what the
   * user actually asked for; the preview is capped at 100 chars and would
   * silently rewrite the request.
   */
  prompt: string;
  mode: RunMode;
  /**
   * Whether the run's worktree still exists on disk — i.e. whether its work is
   * still awaiting a merge or a revert. Merge and revert delete the metadata
   * but leave the run's own state untouched, so this is the only honest way to
   * tell reviewed work from unreviewed work.
   */
  worktree_present: boolean;
}

export interface RunMetrics {
  num_turns: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ToolCall {
  tool_id: string;
  tool_name: string;
  input_preview: string;
  status: 'pending' | 'ok' | 'error';
  result_preview?: string;
}

export interface PreflightError {
  reason: string;
  suggestion: string;
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

export interface BranchInfo {
  name: string;
  is_head: boolean;
  upstream: string | null;
  last_commit_summary: string | null;
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

// --- SSH Config ---

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  identity_file?: string;
}

// --- Agents ---

/** Which CLI drives an agent's runs. */
export type Runner = 'Claude' | 'Hermes';

/** A reusable role: the base mission an agent inherits. Catalogue-backed, so
 *  the list is whatever the daemon seeded plus whatever the operator added. */
export interface Role {
  id: string;
  name: string;
  instructions: string;
  builtin: boolean;
  created_at: string;
  updated_at: string;
}

/** A reusable personality: the tone, layered on top of a role. */
export interface Personality {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  role_id: string | null;
  personality_id: string | null;
  runner: Runner;
  description: string;
  model: string | null;
  /** Inference provider (`--provider`). Hermes runner only. */
  provider: string | null;
  /** Hermes profile (`-p <name>`). Hermes runner only. */
  profile: string | null;
  default_autonomy: AutonomyLevel;
  instructions: string;
  updated_at: string;
}

// --- Commands (Client -> Daemon) ---

export type AppCommand =
  | { type: 'Auth'; token: string }
  | { type: 'StartSession'; project_root: string }
  | { type: 'EndSession'; session_id: string }
  | { type: 'ListSessions' }
  | { type: 'StartRun'; session_id: string; prompt: string; mode: RunMode; skip_dirty_check?: boolean; autonomy?: AutonomyLevel; agent_id?: string }
  | { type: 'CancelRun'; run_id: string; reason: string }
  | { type: 'GetRunStatus'; run_id: string }
  | { type: 'ListRuns'; session_id: string; all_sessions?: boolean }
  | { type: 'GetRunOutput'; run_id: string; offset: number; limit: number }
  | { type: 'ListAgents' }
  | {
      type: 'CreateAgent';
      name: string;
      role_id?: string;
      personality_id?: string;
      runner?: Runner;
      description?: string;
      instructions?: string;
      model?: string | null;
      /** Hermes-only: inference provider (`--provider`). */
      provider?: string | null;
      /** Hermes-only: profile name (`-p <name>`). */
      profile?: string | null;
      default_autonomy?: AutonomyLevel;
    }
  | {
      type: 'UpdateAgent';
      agent_id: string;
      name?: string;
      /** Empty string clears the reference; omit to leave it untouched. */
      role_id?: string;
      personality_id?: string;
      runner?: Runner;
      description?: string;
      instructions?: string;
      model?: string | null;
      provider?: string | null;
      profile?: string | null;
      default_autonomy?: AutonomyLevel;
    }
  | { type: 'DeleteAgent'; agent_id: string }
  | { type: 'ListCatalog' }
  | { type: 'SaveRole'; role: Role }
  | { type: 'DeleteRole'; id: string }
  | { type: 'SavePersonality'; personality: Personality }
  | { type: 'DeletePersonality'; id: string }
  | { type: 'GetDiff'; run_id: string }
  | { type: 'RevertRun'; run_id: string }
  | { type: 'MergeRun'; run_id: string }
  | { type: 'GetStatus' }
  | { type: 'Ping' }
  | { type: 'ListStashes' }
  | { type: 'GetStashFiles'; stash_index: number }
  | { type: 'GetStashDiff'; stash_index: number; file_path: string | null }
  | { type: 'CheckDirtyState' }
  | { type: 'PopStash'; index: number }
  | { type: 'ApplyStash'; index: number }
  | { type: 'DropStash'; index: number }
  | { type: 'StashAndRun'; session_id: string; prompt: string; mode: RunMode; stash_message: string; autonomy?: AutonomyLevel; agent_id?: string }
  // Phase 3: Sidebar commands
  | { type: 'ListDirectory'; path: string }
  | { type: 'GetChangedFiles'; mode: 'working' | 'run'; run_id?: string }
  | { type: 'GetFileDiff'; file_path: string; mode: 'working' | 'run'; run_id?: string }
  | { type: 'GetRepoStatus' }
  | { type: 'GetCommitHistory'; limit: number }
  | { type: 'StageFile'; path: string }
  | { type: 'UnstageFile'; path: string }
  | { type: 'CreateCommit'; message: string }
  | { type: 'ListBranches' }
  | { type: 'CheckoutBranch'; name: string }
  | { type: 'CreateBranch'; name: string; from?: string }
  // Workspace commands (M1-01)
  | { type: 'ListWorkspaces' }
  | { type: 'CreateWorkspace'; name: string; root_path: string; mode: WorkspaceMode }
  | { type: 'CloseWorkspace'; workspace_id: string }
  | { type: 'ActivateWorkspace'; workspace_id: string }
  // PTY commands (M4-01)
  | { type: 'CreateTerminalSession'; workspace_id: string; shell?: string; cwd?: string; env?: [string, string][]; ssh?: SshConfig }
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
  | { type: 'ResolveConflict'; file_path: string; resolution: ConflictResolution }
  // File viewer (TERMINAL-005)
  | { type: 'ReadFile'; path: string; max_bytes?: number }
  // Search (TERMINAL-006)
  | {
      type: 'SearchFiles';
      query: string;
      is_regex?: boolean;
      case_sensitive?: boolean;
      include_glob?: string;
      exclude_glob?: string;
      max_results?: number;
      context_lines?: number;
    };

// --- Events (Daemon -> Client) ---

export type AppEvent =
  | { type: 'AuthSuccess' }
  | { type: 'AuthFailed'; reason: string }
  | { type: 'RunStateChanged'; run_id: string; new_state: RunState }
  | { type: 'RunOutput'; run_id: string; line: string; line_number: number }
  | { type: 'RunCompleted'; run_id: string; summary: RunSummary; diff_stat: DiffStat | null }
  | { type: 'RunDiff'; run_id: string; stat: DiffStat; diff: string }
  | { type: 'RunReverted'; run_id: string }
  | { type: 'RunMerged'; run_id: string; merge_result: MergeResult }
  | { type: 'RunMergeConflict'; run_id: string; conflict_paths: string[] }
  | { type: 'RunFailed'; run_id: string; error: string; phase: FailPhase }
  | { type: 'RunCancelled'; run_id: string }
  | { type: 'RunToolUse'; run_id: string; tool_id: string; tool_name: string; tool_input_preview: string }
  | { type: 'RunToolResult'; run_id: string; tool_id: string; is_error: boolean; preview: string }
  | { type: 'RunMetrics'; run_id: string; num_turns: number; cost_usd: number; input_tokens: number; output_tokens: number }
  | { type: 'RunPreflightFailed'; run_id: string; reason: string; suggestion: string }
  /** Token-level text delta. Rendered in the panel's live buffer and dropped
   *  when the committed RunOutput for the same text arrives. */
  | { type: 'RunOutputDelta'; run_id: string; text: string }
  /** Run chrome (rate limits, compaction, unmodelled stream events). Never part
   *  of the output log — the panel shows it beside the run, not inside it. */
  | { type: 'RunNotice'; run_id: string; level: NoticeLevel; message: string }
  /** What the supervisor is doing before any output exists (`worktree`,
   *  `preflight`, `streaming`). This is what stops the panel looking frozen. */
  | { type: 'RunProgress'; run_id: string; phase: string; detail: string | null }
  | { type: 'SessionStarted'; session: SessionSummary }
  | { type: 'SessionEnded'; session_id: string }
  | { type: 'SessionList'; sessions: SessionSummary[] }
  | { type: 'RunList'; session_id: string; runs: RunSummary[] }
  | { type: 'AgentList'; agents: AgentSummary[] }
  | { type: 'AgentCreated'; agent: AgentSummary }
  | { type: 'AgentUpdated'; agent: AgentSummary }
  | { type: 'AgentDeleted'; agent_id: string }
  | { type: 'CatalogUpdated'; roles: Role[]; personalities: Personality[] }
  | { type: 'RunOutputPage'; run_id: string; offset: number; lines: string[]; has_more: boolean }
  | { type: 'StatusUpdate'; active_runs: number; session_count: number }
  | { type: 'Pong' }
  | { type: 'Error'; code: string; message: string }
  | { type: 'StashList'; stashes: StashEntry[] }
  | { type: 'StashFiles'; stash_index: number; files: FileChange[] }
  | { type: 'StashDiff'; stash_index: number; diff: string; stat: DiffStat | null }
  | { type: 'StashApplied'; index: number; had_conflicts: boolean }
  | { type: 'StashDropped'; index: number }
  | { type: 'DirtyState'; status: DirtyStatus }
  | { type: 'DirtyWarning'; status: DirtyStatus; session_id: string; prompt: string; mode: RunMode; autonomy?: AutonomyLevel; agent_id?: string }
  // Phase 3: Sidebar events
  | { type: 'DirectoryListing'; path: string; entries: FileTreeEntry[] }
  | { type: 'ChangedFilesList'; mode: 'working' | 'run'; run_id?: string; files: FileChange[] }
  | { type: 'FileDiffResult'; file_path: string; diff: string; stat: DiffStat | null }
  | { type: 'RepoStatusResult'; status: RepoStatus }
  | { type: 'CommitHistoryResult'; commits: CommitEntry[] }
  | { type: 'CommitCreated'; hash: string }
  | { type: 'BranchChanged'; name: string }
  | { type: 'BranchList'; branches: BranchInfo[]; current: string | null }
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
  | { type: 'ConflictResolved'; file_path: string }
  // File viewer (TERMINAL-005)
  | { type: 'FileContent'; path: string; content: string; language: string; truncated: boolean; size_bytes: number }
  | { type: 'FileReadError'; path: string; error: string }
  // Search (TERMINAL-006)
  | { type: 'SearchResults'; query: string; matches: SearchMatch[]; total_matches: number; files_searched: number; truncated: boolean; duration_ms: number };
