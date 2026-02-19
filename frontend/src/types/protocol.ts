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
  | { type: 'StartRun'; session_id: string; prompt: string; mode: RunMode }
  | { type: 'CancelRun'; run_id: string; reason: string }
  | { type: 'RespondToBlocking'; run_id: string; response: string }
  | { type: 'GetRunStatus'; run_id: string }
  | { type: 'ListRuns'; session_id: string }
  | { type: 'GetRunOutput'; run_id: string; offset: number; limit: number }
  | { type: 'GetStatus' }
  | { type: 'Ping' };

// --- Events (Daemon -> Client) ---

export type AppEvent =
  | { type: 'AuthSuccess' }
  | { type: 'AuthFailed'; reason: string }
  | { type: 'RunStateChanged'; run_id: string; new_state: RunState }
  | { type: 'RunOutput'; run_id: string; line: string; line_number: number }
  | { type: 'RunBlocking'; run_id: string; question: string; context: string[] }
  | { type: 'RunCompleted'; run_id: string; summary: RunSummary }
  | { type: 'RunFailed'; run_id: string; error: string; phase: FailPhase }
  | { type: 'RunCancelled'; run_id: string }
  | { type: 'SessionStarted'; session: SessionSummary }
  | { type: 'SessionEnded'; session_id: string }
  | { type: 'SessionList'; sessions: SessionSummary[] }
  | { type: 'RunList'; session_id: string; runs: RunSummary[] }
  | { type: 'RunOutputPage'; run_id: string; offset: number; lines: string[]; has_more: boolean }
  | { type: 'StatusUpdate'; active_runs: number; session_count: number }
  | { type: 'Pong' }
  | { type: 'Error'; code: string; message: string };
