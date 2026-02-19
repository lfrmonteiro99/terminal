import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { AppEvent, DiffStat, RunState, RunSummary, SessionSummary } from '../types/protocol';

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
};

// --- Actions ---

type Action =
  | { type: 'SET_CONNECTION_STATUS'; status: AppState['connection']['status'] }
  | { type: 'HANDLE_EVENT'; event: AppEvent }
  | { type: 'SET_ACTIVE_SESSION'; sessionId: string }
  | { type: 'SELECT_RUN'; runId: string | null }
  | { type: 'CLEAR_ERROR' };

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

        case 'StatusUpdate':
          return state;

        case 'Error':
          return { ...state, error: `${event.code}: ${event.message}` };

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

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}
