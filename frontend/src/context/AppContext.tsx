import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import type { AppEvent, CommitEntry, DiffStat, DirtyStatus, FileChange, FileTreeEntry, MergeConflictFile, RepoStatus, RunMode, RunState, RunSummary, SessionSummary, StashEntry } from '../types/protocol';

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
  blocking: { question: string; context: string[] } | null;
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
}

const initialState: AppState = {
  connection: { status: 'disconnected', lastPong: 0 },
  sessions: new Map(),
  activeSession: null,
  activeRun: null,
  runState: null,
  outputLines: [],
  blocking: null,
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
  | { type: 'SET_SIDEBAR_VIEW'; view: AppState['activeSidebarView'] }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_CHANGES_CONTEXT'; context: AppState['changesContext'] }
  | { type: 'OPEN_DIFF'; file: string }
  | { type: 'CLOSE_DIFF' }
  | { type: 'SET_DIFF_MODE'; mode: AppState['diffPanel']['mode'] };

const MAX_OUTPUT_LINES = 2000;

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

        case 'RunStateChanged':
          return {
            ...state,
            activeRun: event.run_id,
            runState: event.new_state,
            // Clear blocking when transitioning back to Running
            blocking: event.new_state.type === 'Running' ? null : state.blocking,
          };

        case 'RunOutput': {
          const lines = [...state.outputLines, event.line];
          // Keep bounded
          const trimmed = lines.length > MAX_OUTPUT_LINES
            ? lines.slice(lines.length - MAX_OUTPUT_LINES)
            : lines;
          return { ...state, outputLines: trimmed };
        }

        case 'RunBlocking':
          return {
            ...state,
            blocking: { question: event.question, context: event.context },
          };

        case 'RunCompleted': {
          const runs = new Map(state.runs);
          runs.set(event.run_id, event.summary);
          return {
            ...state,
            activeRun: null,
            runState: { type: 'Completed', exit_code: event.summary.state.type === 'Completed' ? event.summary.state.exit_code : 0 },
            blocking: null,
            runs,
          };
        }

        case 'RunFailed':
          return {
            ...state,
            activeRun: null,
            runState: { type: 'Failed', error: event.error, phase: event.phase },
            blocking: null,
          };

        case 'RunCancelled':
          return {
            ...state,
            activeRun: null,
            runState: { type: 'Cancelled', reason: 'User cancelled' },
            blocking: null,
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

        case 'DirtyState':
          return state;

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

        default:
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

  // Fix 3: Persist diffPanel.mode to localStorage via useEffect (not in reducer)
  useEffect(() => {
    localStorage.setItem('diff-mode', state.diffPanel.mode);
  }, [state.diffPanel.mode]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
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
