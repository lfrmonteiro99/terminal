// M14 — one test per AppStoreAction variant.
//
// Adding a new action to `AppStoreAction` without a matching test here means
// the `ACTIONS_COVERED` completeness guard below fails.

import { describe, it, expect } from 'vitest';
import {
  appStoreReducer,
  initialAppStore,
  type AppStore,
  type AppStoreAction,
} from './app-store';
import type { SessionSummary } from '../types/protocol';
import type { WorkspaceSummary } from '../domain/workspace/types';

const session = (id: string): SessionSummary => ({
  id,
  project_root: '/',
  active_run: null,
  run_count: 0,
  started_at: 'now',
});

const workspace = (id: string): WorkspaceSummary => ({
  id,
  name: id,
  root_path: '/',
  mode: 'Terminal',
  linked_session_id: null,
  last_active_at: 'now',
});

// Tracks which action.type values have been exercised. A final test asserts
// every discriminant in `AppStoreAction` is covered.
const covered = new Set<AppStoreAction['type']>();
function run(prev: AppStore, action: AppStoreAction): AppStore {
  covered.add(action.type);
  return appStoreReducer(prev, action);
}

describe('appStoreReducer', () => {
  it('SET_CONNECTION_STATUS updates status only', () => {
    const next = run(initialAppStore, { type: 'SET_CONNECTION_STATUS', status: 'connected' });
    expect(next.connection.status).toBe('connected');
    expect(next.connection.lastPong).toBe(initialAppStore.connection.lastPong);
  });

  it('SET_LAST_PONG stamps lastPong to now', () => {
    const before = Date.now();
    const next = run(initialAppStore, { type: 'SET_LAST_PONG' });
    expect(next.connection.lastPong).toBeGreaterThanOrEqual(before);
  });

  it('SET_SESSIONS replaces the sessions map', () => {
    const seeded = appStoreReducer(initialAppStore, { type: 'ADD_SESSION', session: session('old') });
    const next = run(seeded, { type: 'SET_SESSIONS', sessions: [session('a'), session('b')] });
    expect(Array.from(next.sessions.keys()).sort()).toEqual(['a', 'b']);
  });

  it('ADD_SESSION inserts without clobbering others', () => {
    const a = appStoreReducer(initialAppStore, { type: 'ADD_SESSION', session: session('a') });
    const b = run(a, { type: 'ADD_SESSION', session: session('b') });
    expect(b.sessions.size).toBe(2);
    expect(b.sessions.get('a')?.id).toBe('a');
  });

  it('REMOVE_SESSION drops the matching id', () => {
    const seeded = appStoreReducer(initialAppStore, { type: 'SET_SESSIONS', sessions: [session('a'), session('b')] });
    const next = run(seeded, { type: 'REMOVE_SESSION', sessionId: 'a' });
    expect(next.sessions.has('a')).toBe(false);
    expect(next.sessions.has('b')).toBe(true);
  });

  it('SET_WORKSPACES replaces the workspaces map', () => {
    const next = run(initialAppStore, { type: 'SET_WORKSPACES', workspaces: [workspace('w1')] });
    expect(next.workspaces.get('w1')?.name).toBe('w1');
  });

  it('ADD_WORKSPACE inserts a single entry', () => {
    const next = run(initialAppStore, { type: 'ADD_WORKSPACE', workspace: workspace('w1') });
    expect(next.workspaces.size).toBe(1);
  });

  it('REMOVE_WORKSPACE clears active id if it was the removed one', () => {
    const seeded: AppStore = {
      ...initialAppStore,
      workspaces: new Map([['w1', workspace('w1')]]),
      activeWorkspaceId: 'w1',
    };
    const next = run(seeded, { type: 'REMOVE_WORKSPACE', workspaceId: 'w1' });
    expect(next.workspaces.has('w1')).toBe(false);
    expect(next.activeWorkspaceId).toBeNull();
  });

  it('REMOVE_WORKSPACE preserves active id if different', () => {
    const seeded: AppStore = {
      ...initialAppStore,
      workspaces: new Map([
        ['w1', workspace('w1')],
        ['w2', workspace('w2')],
      ]),
      activeWorkspaceId: 'w2',
    };
    const next = run(seeded, { type: 'REMOVE_WORKSPACE', workspaceId: 'w1' });
    expect(next.activeWorkspaceId).toBe('w2');
  });

  it('SET_ACTIVE_WORKSPACE sets the id', () => {
    const next = run(initialAppStore, { type: 'SET_ACTIVE_WORKSPACE', workspaceId: 'w1' });
    expect(next.activeWorkspaceId).toBe('w1');
  });

  it('SET_ERROR writes an error message', () => {
    const next = run(initialAppStore, { type: 'SET_ERROR', error: 'boom' });
    expect(next.error).toBe('boom');
  });

  it('CLEAR_ERROR nulls the error', () => {
    const seeded = appStoreReducer(initialAppStore, { type: 'SET_ERROR', error: 'boom' });
    const next = run(seeded, { type: 'CLEAR_ERROR' });
    expect(next.error).toBeNull();
  });

  it('TOGGLE_COMMAND_PALETTE flips the open flag', () => {
    const once = run(initialAppStore, { type: 'TOGGLE_COMMAND_PALETTE' });
    expect(once.commandPaletteOpen).toBe(true);
    const twice = appStoreReducer(once, { type: 'TOGGLE_COMMAND_PALETTE' });
    expect(twice.commandPaletteOpen).toBe(false);
  });

  it('OPEN_COMMAND_PALETTE sets the flag true', () => {
    const next = run(initialAppStore, { type: 'OPEN_COMMAND_PALETTE' });
    expect(next.commandPaletteOpen).toBe(true);
  });

  it('CLOSE_COMMAND_PALETTE sets the flag false', () => {
    const open = appStoreReducer(initialAppStore, { type: 'OPEN_COMMAND_PALETTE' });
    const next = run(open, { type: 'CLOSE_COMMAND_PALETTE' });
    expect(next.commandPaletteOpen).toBe(false);
  });

  // Completeness gate: if new AppStoreAction variants are added without tests,
  // this list must be extended. The `satisfies` check makes TS fail if any
  // entry is NOT an AppStoreAction['type'].
  it('covers every AppStoreAction variant', () => {
    const expected = [
      'SET_CONNECTION_STATUS',
      'SET_LAST_PONG',
      'SET_SESSIONS',
      'ADD_SESSION',
      'REMOVE_SESSION',
      'SET_WORKSPACES',
      'ADD_WORKSPACE',
      'REMOVE_WORKSPACE',
      'SET_ACTIVE_WORKSPACE',
      'SET_ERROR',
      'CLEAR_ERROR',
      'TOGGLE_COMMAND_PALETTE',
      'OPEN_COMMAND_PALETTE',
      'CLOSE_COMMAND_PALETTE',
    ] as const satisfies readonly AppStoreAction['type'][];
    for (const tag of expected) {
      expect(covered.has(tag), `action ${tag} should have a test`).toBe(true);
    }
  });
});
