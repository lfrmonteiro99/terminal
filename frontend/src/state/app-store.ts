// App-level state — global, shared across all workspaces (M1-02)

import type { WorkspaceSummary } from '../domain/workspace/types';
import type { SessionSummary } from '../types/protocol';

export interface ConnectionState {
  status: 'connecting' | 'connected' | 'disconnected' | 'authenticating';
  lastPong: number;
}

export interface AppStore {
  connection: ConnectionState;
  /** All known sessions (global resource). */
  sessions: Map<string, SessionSummary>;
  /** All known workspaces. */
  workspaces: Map<string, WorkspaceSummary>;
  /** Currently active workspace id. */
  activeWorkspaceId: string | null;
  /** App-level error message. */
  error: string | null;
  /** Whether command palette is open. */
  commandPaletteOpen: boolean;
}

export const initialAppStore: AppStore = {
  connection: { status: 'disconnected', lastPong: 0 },
  sessions: new Map(),
  workspaces: new Map(),
  activeWorkspaceId: null,
  error: null,
  commandPaletteOpen: false,
};

export type AppStoreAction =
  | { type: 'SET_CONNECTION_STATUS'; status: ConnectionState['status'] }
  | { type: 'SET_LAST_PONG' }
  | { type: 'SET_SESSIONS'; sessions: SessionSummary[] }
  | { type: 'ADD_SESSION'; session: SessionSummary }
  | { type: 'REMOVE_SESSION'; sessionId: string }
  | { type: 'SET_WORKSPACES'; workspaces: WorkspaceSummary[] }
  | { type: 'ADD_WORKSPACE'; workspace: WorkspaceSummary }
  | { type: 'REMOVE_WORKSPACE'; workspaceId: string }
  | { type: 'SET_ACTIVE_WORKSPACE'; workspaceId: string | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TOGGLE_COMMAND_PALETTE' }
  | { type: 'OPEN_COMMAND_PALETTE' }
  | { type: 'CLOSE_COMMAND_PALETTE' };

export function appStoreReducer(state: AppStore, action: AppStoreAction): AppStore {
  switch (action.type) {
    case 'SET_CONNECTION_STATUS':
      return { ...state, connection: { ...state.connection, status: action.status } };

    case 'SET_LAST_PONG':
      return { ...state, connection: { ...state.connection, lastPong: Date.now() } };

    case 'SET_SESSIONS': {
      const sessions = new Map<string, SessionSummary>();
      for (const s of action.sessions) sessions.set(s.id, s);
      return { ...state, sessions };
    }

    case 'ADD_SESSION': {
      const sessions = new Map(state.sessions);
      sessions.set(action.session.id, action.session);
      return { ...state, sessions };
    }

    case 'REMOVE_SESSION': {
      const sessions = new Map(state.sessions);
      sessions.delete(action.sessionId);
      return { ...state, sessions };
    }

    case 'SET_WORKSPACES': {
      const workspaces = new Map<string, WorkspaceSummary>();
      for (const w of action.workspaces) workspaces.set(w.id, w);
      return { ...state, workspaces };
    }

    case 'ADD_WORKSPACE': {
      const workspaces = new Map(state.workspaces);
      workspaces.set(action.workspace.id, action.workspace);
      return { ...state, workspaces };
    }

    case 'REMOVE_WORKSPACE': {
      const workspaces = new Map(state.workspaces);
      workspaces.delete(action.workspaceId);
      return {
        ...state,
        workspaces,
        activeWorkspaceId:
          state.activeWorkspaceId === action.workspaceId ? null : state.activeWorkspaceId,
      };
    }

    case 'SET_ACTIVE_WORKSPACE':
      return { ...state, activeWorkspaceId: action.workspaceId };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'TOGGLE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: !state.commandPaletteOpen };

    case 'OPEN_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: true };

    case 'CLOSE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: false };

    default:
      return state;
  }
}
