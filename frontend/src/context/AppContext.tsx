import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import type { AppEvent, BranchInfo, CommitEntry, DiffStat, DirtyStatus, FileChange, FileTreeEntry, MergeConflictFile, PreflightError, RepoStatus, RunMetrics, RunMode, RunState, RunSummary, SearchMatch, SessionSummary, StashEntry, ToolCall } from '../types/protocol';
import { publishTerminalEvent } from '../core/events/terminalBus';

// --- State ---

export interface AppState {
  connection: {
    status: 'connecting' | 'connected' | 'disconnected';
    lastPong: number;
  };
  sessions: Map<string, SessionSummary>;
  activeSession: string | null;
  activeRun: string | null;
  runState: RunState | null;
  // Bounded output buffer — NOT the full run output
  outputLines: string[];
  error: string | null;
  runs: Map<string, RunSummary>;
  selectedRun: string | null;
  diffCache: Map<string, { stat: DiffStat; diff: string }>;
  mergeConflict: { runId: string; paths: string[] } | null;
  mergeConflicts: MergeConflictFile[];
  stashes: StashEntry[];
  stashFiles: Map<number, FileChange[]>;
  stashDiffs: Map<string, { diff: string; stat: DiffStat | null }>;
  dirtyWarning: { status: DirtyStatus; session_id: string; prompt: string; mode: RunMode } | null;
  stashDrawerOpen: boolean;
  // Sidebar layout
  activeSidebarView: 'explorer' | 'changes' | 'git';
  sidebarCollapsed: boolean;
  // Phase 3: Sidebar state
  changesContext: { mode: 'working' | 'run'; runId?: string };
  changedFiles: { context: { mode: 'working' | 'run'; runId?: string }; files: FileChange[] } | null;
  repoStatus: RepoStatus | null;
  commitHistory: CommitEntry[];
  explorerTree: Map<string, FileTreeEntry[]>;
  diffPanel: { open: boolean; mode: 'split' | 'overlay' | 'inline'; file: string | null; diff: string | null; stat: DiffStat | null };

  // AI run structured events (TERMINAL-055)
  /** Tool calls for the active run, keyed by tool_id. Cleared when a new run starts. */
  runToolCalls: Map<string, ToolCall>;
  /** Final metrics for the active/last run, populated when the result event arrives. */
  runMetrics: RunMetrics | null;
  /** Preflight error surfaced when the Claude binary is missing/unauthenticated. */
  preflightError: PreflightError | null;

  // Direct-to-state slices added by C3 (replacing window.dispatchEvent workarounds)
  /** Branch list last reported by the daemon. Consumed by CommandPalette. */
  branches: BranchInfo[];
  /** Currently-viewed file + optional read error. Consumed by FileViewerPane. */
  fileViewer:
    | {
        path: string;
        content: string;
        language: string;
        truncated: boolean;
        size_bytes: number;
      }
    | { path: string; error: string }
    | null;
  /** Most recent search result. Consumed by SearchPane. */
  searchResult: {
    query: string;
    matches: SearchMatch[];
    total_matches: number;
    files_searched: number;
    truncated: boolean;
    duration_ms: number;
  } | null;
  /** Transient git-operation toast (push/pull/fetch/error). Auto-dismissed by the StatusBar. */
  gitToast: { kind: 'push' | 'pull' | 'fetch' | 'error'; message: string; timestamp: number } | null;
  /** Last-known dirty state snapshot for the active project. */
  dirtyState: DirtyStatus | null;
}

const initialState: AppState = {
  connection: { status: 'disconnected', lastPong: 0 },
  sessions: new Map(),
  activeSession: null,
  activeRun: null,
  runState: null,
  outputLines: [],
  error: null,
  runs: new Map(),
  selectedRun: null,
  diffCache: new Map(),
  mergeConflict: null,
  mergeConflicts: [],
  stashes: [],
  stashFiles: new Map(),
  stashDiffs: new Map(),
  dirtyWarning: null,
  stashDrawerOpen: false,
  activeSidebarView: 'changes',
  sidebarCollapsed: false,
  changesContext: { mode: 'working' },
  changedFiles: null,
  repoStatus: null,
  commitHistory: [],
  explorerTree: new Map(),
  diffPanel: {
    open: false,
    mode: (localStorage.getItem('diff-mode') as 'split' | 'overlay' | 'inline') || 'split',
    file: null,
    diff: null,
    stat: null,
  },
  runToolCalls: new Map(),
  runMetrics: null,
  preflightError: null,
  branches: [],
  fileViewer: null,
  searchResult: null,
  gitToast: null,
  dirtyState: null,
};

// --- Actions ---

type Action =
  | { type: 'SET_CONNECTION_STATUS'; status: AppState['connection']['status'] }
  | { type: 'HANDLE_EVENT'; event: AppEvent }
  | { type: 'SET_ACTIVE_SESSION'; sessionId: string }
  | { type: 'SELECT_RUN'; runId: string | null }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TOGGLE_STASH_DRAWER' }
  | { type: 'DISMISS_DIRTY_WARNING' }
  | { type: 'DISMISS_PREFLIGHT' }
  | { type: 'SET_SIDEBAR_VIEW'; view: AppState['activeSidebarView'] }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_CHANGES_CONTEXT'; context: AppState['changesContext'] }
  | { type: 'OPEN_DIFF'; file: string }
  | { type: 'CLOSE_DIFF' }
  | { type: 'SET_DIFF_MODE'; mode: AppState['diffPanel']['mode'] }
  | { type: 'DISMISS_GIT_TOAST' };

const MAX_OUTPUT_LINES = 2000;

/** Compile-time exhaustiveness guard for AppEvent variants.
 *  Adding a new variant without a matching `case` in HANDLE_EVENT breaks TS
 *  compilation at the call site. At runtime we log and let the caller fall
 *  back to the unchanged state. */
function assertExhaustive(event: never): void {
  const e = event as { type?: string };
  console.warn('[AppContext] unhandled AppEvent variant', e.type);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONNECTION_STATUS':
      return { ...state, connection: { ...state.connection, status: action.status } };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSession: action.sessionId };

    case 'SELECT_RUN':
      return { ...state, selectedRun: action.runId };

    case 'TOGGLE_STASH_DRAWER':
      return { ...state, stashDrawerOpen: !state.stashDrawerOpen };

    case 'DISMISS_DIRTY_WARNING':
      return { ...state, dirtyWarning: null };

    case 'DISMISS_PREFLIGHT':
      return { ...state, preflightError: null };

    case 'SET_SIDEBAR_VIEW':
      return { ...state, activeSidebarView: action.view, sidebarCollapsed: false };

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case 'SET_CHANGES_CONTEXT':
      return { ...state, changesContext: action.context, changedFiles: null };

    case 'OPEN_DIFF':
      return { ...state, diffPanel: { ...state.diffPanel, open: true, file: action.file, diff: null, stat: null } };

    case 'CLOSE_DIFF':
      return { ...state, diffPanel: { ...state.diffPanel, open: false, file: null, diff: null, stat: null } };

    case 'SET_DIFF_MODE':
      return { ...state, diffPanel: { ...state.diffPanel, mode: action.mode } };

    case 'DISMISS_GIT_TOAST':
      return { ...state, gitToast: null };

    case 'HANDLE_EVENT': {
      const event = action.event;

      switch (event.type) {
        case 'AuthSuccess':
          return { ...state, connection: { ...state.connection, status: 'connected' } };

        case 'AuthFailed':
          return {
            ...state,
            connection: { ...state.connection, status: 'disconnected' },
            error: `Auth failed: ${event.reason}`,
          };

        case 'Pong':
          return { ...state, connection: { ...state.connection, lastPong: Date.now() } };

        case 'SessionStarted': {
          const sessions = new Map(state.sessions);
          sessions.set(event.session.id, event.session);
          return { ...state, sessions, activeSession: event.session.id };
        }

        case 'SessionEnded': {
          const sessions = new Map(state.sessions);
          sessions.delete(event.session_id);
          return {
            ...state,
            sessions,
            activeSession: state.activeSession === event.session_id ? null : state.activeSession,
          };
        }

        case 'SessionList': {
          const sessions = new Map<string, SessionSummary>();
          for (const s of event.sessions) {
            sessions.set(s.id, s);
          }
          return { ...state, sessions };
        }

        case 'RunStateChanged': {
          // When a new run begins (or we're switching to a different run),
          // clear per-run accumulated state so the UI doesn't show stale
          // tool calls / metrics from an earlier run.
          const switchingRun = state.activeRun !== event.run_id;
          const startingFresh =
            switchingRun && (event.new_state.type === 'Preparing' || event.new_state.type === 'Running');
          return {
            ...state,
            activeRun: event.run_id,
            runState: event.new_state,
            runToolCalls: startingFresh ? new Map() : state.runToolCalls,
            runMetrics: startingFresh ? null : state.runMetrics,
            preflightError: startingFresh ? null : state.preflightError,
            outputLines: startingFresh ? [] : state.outputLines,
          };
        }

        case 'RunOutput': {
          const lines = [...state.outputLines, event.line];
          // Keep bounded
          const trimmed = lines.length > MAX_OUTPUT_LINES
            ? lines.slice(lines.length - MAX_OUTPUT_LINES)
            : lines;
          return { ...state, outputLines: trimmed };
        }

        case 'RunCompleted': {
          const runs = new Map(state.runs);
          runs.set(event.run_id, event.summary);
          return {
            ...state,
            activeRun: null,
            runState: { type: 'Completed', exit_code: event.summary.state.type === 'Completed' ? event.summary.state.exit_code : 0 },
            runs,
          };
        }

        case 'RunFailed':
          return {
            ...state,
            activeRun: null,
            runState: { type: 'Failed', error: event.error, phase: event.phase },
          };

        case 'RunCancelled':
          return {
            ...state,
            activeRun: null,
            runState: { type: 'Cancelled', reason: 'User cancelled' },
          };

        case 'RunList': {
          const runs = new Map(state.runs);
          for (const r of event.runs) {
            runs.set(r.id, r);
          }
          return { ...state, runs };
        }

        case 'RunDiff': {
          const diffCache = new Map(state.diffCache);
          diffCache.set(event.run_id, { stat: event.stat, diff: event.diff });
          return { ...state, diffCache };
        }

        case 'RunReverted': {
          return {
            ...state,
            selectedRun: state.selectedRun === event.run_id ? null : state.selectedRun,
          };
        }

        case 'RunMerged': {
          return { ...state, mergeConflict: null };
        }

        case 'RunMergeConflict': {
          return {
            ...state,
            mergeConflict: { runId: event.run_id, paths: event.conflict_paths },
          };
        }

        case 'MergeConflicts':
          return { ...state, mergeConflicts: event.files };

        case 'ConflictResolved':
          return {
            ...state,
            mergeConflicts: state.mergeConflicts.filter(f => f.path !== event.file_path),
          };

        case 'StatusUpdate':
          return state;

        case 'Error':
          return { ...state, error: `${event.code}: ${event.message}` };

        case 'StashList':
          return { ...state, stashes: event.stashes };

        case 'StashFiles': {
          const stashFiles = new Map(state.stashFiles);
          stashFiles.set(event.stash_index, event.files);
          return { ...state, stashFiles };
        }

        case 'StashDiff': {
          const stashDiffs = new Map(state.stashDiffs);
          const key = event.stash_index.toString();
          stashDiffs.set(key, { diff: event.diff, stat: event.stat });
          return { ...state, stashDiffs };
        }

        case 'DirtyWarning':
          return {
            ...state,
            dirtyWarning: {
              status: event.status,
              session_id: event.session_id,
              prompt: event.prompt,
              mode: event.mode,
            },
          };

        case 'DirectoryListing': {
          const explorerTree = new Map(state.explorerTree);
          explorerTree.set(event.path, event.entries);
          return { ...state, explorerTree };
        }

        case 'ChangedFilesList': {
          // Fix 1: Guard against stale response — only commit if context matches
          const ctx = state.changesContext;
          if (event.mode !== ctx.mode) return state;
          if (event.mode === 'run' && event.run_id !== ctx.runId) return state;
          return {
            ...state,
            changedFiles: {
              context: { mode: event.mode, runId: event.run_id },
              files: event.files,
            },
          };
        }

        case 'FileDiffResult': {
          // Fix 2: Guard against stale diff response from rapid clicks
          if (event.file_path !== state.diffPanel.file) return state;
          return {
            ...state,
            diffPanel: { ...state.diffPanel, diff: event.diff, stat: event.stat },
          };
        }

        case 'RepoStatusResult':
          return { ...state, repoStatus: event.status };

        case 'CommitHistoryResult':
          return { ...state, commitHistory: event.commits };

        case 'CommitCreated':
          return state;

        case 'BranchChanged':
          return { ...state, repoStatus: state.repoStatus ? { ...state.repoStatus, branch: event.name } : null };

        // --- AI run structured events (TERMINAL-055) ---

        case 'RunToolUse': {
          if (event.run_id !== state.activeRun) return state;
          const next = new Map(state.runToolCalls);
          next.set(event.tool_id, {
            tool_id: event.tool_id,
            tool_name: event.tool_name,
            input_preview: event.tool_input_preview,
            status: 'pending',
          });
          return { ...state, runToolCalls: next };
        }

        case 'RunToolResult': {
          if (event.run_id !== state.activeRun) return state;
          const existing = state.runToolCalls.get(event.tool_id);
          if (!existing) return state;
          const next = new Map(state.runToolCalls);
          next.set(event.tool_id, {
            ...existing,
            status: event.is_error ? 'error' : 'ok',
            result_preview: event.preview,
          });
          return { ...state, runToolCalls: next };
        }

        case 'RunMetrics': {
          return {
            ...state,
            runMetrics: {
              num_turns: event.num_turns,
              cost_usd: event.cost_usd,
              input_tokens: event.input_tokens,
              output_tokens: event.output_tokens,
            },
          };
        }

        case 'RunPreflightFailed': {
          return {
            ...state,
            preflightError: { reason: event.reason, suggestion: event.suggestion },
          };
        }

        // --- Run history pagination (C3) ---
        case 'RunOutputPage': {
          // Treat as append-only history for the active run. Callers that
          // want fresh pages dispatch CLEAR_OUTPUT first.
          if (event.run_id !== state.activeRun) return state;
          const lines = [...state.outputLines, ...event.lines];
          const trimmed =
            lines.length > MAX_OUTPUT_LINES ? lines.slice(lines.length - MAX_OUTPUT_LINES) : lines;
          return { ...state, outputLines: trimmed };
        }

        // --- Branch list (C3) — replaces window CustomEvent workaround ---
        case 'BranchList':
          return { ...state, branches: event.branches };

        // --- File viewer (C3) — replaces window CustomEvent workaround ---
        case 'FileContent':
          return {
            ...state,
            fileViewer: {
              path: event.path,
              content: event.content,
              language: event.language,
              truncated: event.truncated,
              size_bytes: event.size_bytes,
            },
          };

        case 'FileReadError':
          return {
            ...state,
            fileViewer: { path: event.path, error: event.error },
          };

        // --- Search (C3) — replaces window CustomEvent workaround ---
        case 'SearchResults':
          return {
            ...state,
            searchResult: {
              query: event.query,
              matches: event.matches,
              total_matches: event.total_matches,
              files_searched: event.files_searched,
              truncated: event.truncated,
              duration_ms: event.duration_ms,
            },
          };

        // --- Git extended (C3) ---
        case 'PushCompleted':
          return {
            ...state,
            gitToast: {
              kind: 'push',
              message: `Pushed ${event.branch} → ${event.remote}`,
              timestamp: Date.now(),
            },
          };

        case 'PullCompleted':
          return {
            ...state,
            gitToast: {
              kind: 'pull',
              message:
                event.commits_applied === 0
                  ? `${event.branch} is up to date`
                  : `Pulled ${event.commits_applied} commit(s) into ${event.branch}`,
              timestamp: Date.now(),
            },
          };

        case 'FetchCompleted':
          return {
            ...state,
            gitToast: {
              kind: 'fetch',
              message: `Fetched from ${event.remote}`,
              timestamp: Date.now(),
            },
          };

        case 'GitOperationFailed':
          return {
            ...state,
            gitToast: {
              kind: 'error',
              message: `${event.operation} failed: ${event.reason}`,
              timestamp: Date.now(),
            },
          };

        // --- Dirty state snapshot (C3) ---
        case 'DirtyState':
          return { ...state, dirtyState: event.status };

        // --- Terminal (C3) — the bounded xterm stream still flows via
        // terminalBus; we also fire the publish as a side effect in the
        // `HANDLE_EVENT` wrapper below. These reducer arms are noops so the
        // default case only triggers for truly unhandled variants.
        case 'TerminalSessionCreated':
        case 'TerminalOutput':
        case 'TerminalSessionClosed':
          return state;

        case 'TerminalSessionList':
          // intentionally ignored: listing is consumed directly by panes via dedicated query
          return state;

        case 'TerminalSessionRestored':
          // intentionally ignored: restoration re-uses the Created pathway on the pane side
          return state;

        case 'TerminalSessionRestoreFailed':
          return {
            ...state,
            error: `Terminal restore failed: ${event.reason}`,
          };

        case 'RestorableTerminalSessions':
          // intentionally ignored: only surfaced on demand via a pane query
          return state;

        case 'StashApplied':
          // intentionally ignored: UI refreshes via follow-up ListStashes/GetRepoStatus
          return state;

        case 'StashDropped':
          // intentionally ignored: UI refreshes via follow-up ListStashes
          return state;

        // --- Workspace lifecycle (routed by App.tsx to workspace state store;
        //     the legacy reducer doesn't mirror workspace state — it only
        //     knows about the AI session workspace. Intentionally ignored
        //     here so they flow through the dedicated WorkspaceSwitcher). ---
        case 'WorkspaceList':
        case 'WorkspaceCreated':
        case 'WorkspaceClosed':
        case 'WorkspaceActivated':
          return state;

        default:
          assertExhaustive(event);
          return state;
      }
    }

    default:
      return state;
  }
}

// --- Context ---

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<Action>>(() => {});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Keep a ref pointed at the latest state so side-effect closures can read
  // the freshest gitToast timestamp without re-running on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Fix 3: Persist diffPanel.mode to localStorage via useEffect (not in reducer)
  useEffect(() => {
    localStorage.setItem('diff-mode', state.diffPanel.mode);
  }, [state.diffPanel.mode]);

  // Auto-dismiss git toast after 4s so users always see completion feedback
  // without leaving stale state in the UI.
  useEffect(() => {
    if (!state.gitToast) return;
    const ts = state.gitToast.timestamp;
    const timer = setTimeout(() => {
      if (stateRef.current.gitToast?.timestamp === ts) {
        dispatch({ type: 'DISMISS_GIT_TOAST' });
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [state.gitToast]);

  // Wrap dispatch so high-frequency terminal events are also broadcast on the
  // in-memory terminalBus (consumed directly by TerminalPane's xterm writer).
  const wrappedDispatch: Dispatch<Action> = (action) => {
    if (action.type === 'HANDLE_EVENT') {
      const e = action.event;
      if (
        e.type === 'TerminalSessionCreated' ||
        e.type === 'TerminalOutput' ||
        e.type === 'TerminalSessionClosed'
      ) {
        publishTerminalEvent(e);
      }
    }
    dispatch(action);
  };

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={wrappedDispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppState() {
  return useContext(AppStateContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppDispatch() {
  return useContext(AppDispatchContext);
}
