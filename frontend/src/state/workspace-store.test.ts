// M14 — one test per WorkspaceAction variant.
//
// Covers every action in the discriminated union via a `covered` set with a
// final completeness check. TS ensures the expected list only contains valid
// action tags via `satisfies readonly WorkspaceAction['type'][]`.

import { describe, it, expect } from 'vitest';
import {
  createWorkspaceStore,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceStore,
} from './workspace-store';
import type {
  BranchInfo,
  CommitEntry,
  FileChange,
  FileTreeEntry,
  MergeConflictFile,
  RestorableTerminalSession,
  RunSummary,
  StashEntry,
  TerminalSessionSummary,
} from '../types/protocol';

const covered = new Set<WorkspaceAction['type']>();
function run(prev: WorkspaceStore, action: WorkspaceAction): WorkspaceStore {
  covered.add(action.type);
  return workspaceReducer(prev, action);
}

const base = () => createWorkspaceStore('w1');

const runSummary = (id: string): RunSummary => ({
  id,
  state: { type: 'Running' },
  prompt_preview: 'p',
  modified_file_count: 0,
  started_at: 'now',
  ended_at: null,
  diff_stat: null,
});

const termSession = (id: string): TerminalSessionSummary => ({
  session_id: id,
  workspace_id: 'w1',
  shell: 'bash',
  cwd: '/',
  created_at: 'now',
  last_active_at: 'now',
});

const restorable = (id: string): RestorableTerminalSession => ({
  session_id: id,
  pane_id: 'pane-1',
  cwd: '/',
  last_active_at: 'now',
});

describe('workspaceReducer', () => {
  it('SET_ACTIVE_SESSION', () => {
    const next = run(base(), { type: 'SET_ACTIVE_SESSION', sessionId: 's1' });
    expect(next.activeSession).toBe('s1');
  });

  it('SET_ACTIVE_RUN', () => {
    const next = run(base(), { type: 'SET_ACTIVE_RUN', runId: 'r1' });
    expect(next.activeRun).toBe('r1');
  });

  it('SET_RUN_STATE', () => {
    const next = run(base(), { type: 'SET_RUN_STATE', runState: { type: 'Running' } });
    expect(next.runState).toEqual({ type: 'Running' });
  });


  it('START_PENDING_RUN / CLEAR_PENDING_RUN', () => {
    const started = run(base(), { type: 'START_PENDING_RUN', startedAt: 123 });
    expect(started.pendingRunStartedAt).toBe(123);
    const cleared = run(started, { type: 'CLEAR_PENDING_RUN' });
    expect(cleared.pendingRunStartedAt).toBeNull();
  });

  it('APPEND_OUTPUT appends up to the max', () => {
    const once = run(base(), { type: 'APPEND_OUTPUT', line: 'a' });
    expect(once.outputLines).toEqual(['a']);
    let s = once;
    for (let i = 0; i < 2500; i++) s = workspaceReducer(s, { type: 'APPEND_OUTPUT', line: `${i}` });
    expect(s.outputLines.length).toBe(2000);
    expect(s.outputLines.at(-1)).toBe('2499');
  });

  it('CLEAR_OUTPUT empties the buffer', () => {
    const seeded = workspaceReducer(base(), { type: 'APPEND_OUTPUT', line: 'x' });
    const next = run(seeded, { type: 'CLEAR_OUTPUT' });
    expect(next.outputLines).toEqual([]);
  });

  it('UPSERT_RUN / SET_RUNS', () => {
    const one = run(base(), { type: 'UPSERT_RUN', run: runSummary('r1') });
    expect(one.runs.get('r1')).toBeDefined();
    const many = run(one, { type: 'SET_RUNS', runs: [runSummary('a'), runSummary('b')] });
    expect(Array.from(many.runs.keys()).sort()).toEqual(['a', 'b']);
  });

  it('SELECT_RUN', () => {
    const next = run(base(), { type: 'SELECT_RUN', runId: 'r1' });
    expect(next.selectedRun).toBe('r1');
  });

  it('SET_DIFF caches by runId', () => {
    const next = run(base(), {
      type: 'SET_DIFF',
      runId: 'r1',
      stat: { files_changed: 1, insertions: 1, deletions: 0, file_stats: [] },
      diff: 'diff-body',
    });
    expect(next.diffCache.get('r1')?.diff).toBe('diff-body');
  });

  it('SET_MERGE_CONFLICT / CLEAR_MERGE_CONFLICT', () => {
    const set = run(base(), { type: 'SET_MERGE_CONFLICT', runId: 'r1', paths: ['a'] });
    expect(set.mergeConflict?.paths).toEqual(['a']);
    const clr = run(set, { type: 'CLEAR_MERGE_CONFLICT' });
    expect(clr.mergeConflict).toBeNull();
  });

  it('ADD_TOOL_CALL / UPDATE_TOOL_RESULT — gated by activeRun', () => {
    const seeded = workspaceReducer(base(), { type: 'SET_ACTIVE_RUN', runId: 'r1' });
    const add = run(seeded, {
      type: 'ADD_TOOL_CALL',
      runId: 'r1',
      toolCall: { tool_id: 't1', tool_name: 'bash', input_preview: 'ls', status: 'pending' },
    });
    expect(add.runToolCalls.get('t1')?.status).toBe('pending');
    const res = run(add, {
      type: 'UPDATE_TOOL_RESULT',
      runId: 'r1',
      toolId: 't1',
      isError: false,
      resultPreview: 'ok',
    });
    expect(res.runToolCalls.get('t1')?.status).toBe('ok');
    // Non-active-run updates are ignored.
    const ignored = workspaceReducer(res, {
      type: 'ADD_TOOL_CALL',
      runId: 'other',
      toolCall: { tool_id: 'x', tool_name: 'y', input_preview: '', status: 'pending' },
    });
    expect(ignored.runToolCalls.has('x')).toBe(false);
  });

  it('SET_RUN_METRICS', () => {
    const withActiveRun = run(base(), { type: 'SET_ACTIVE_RUN', runId: 'r1' });
    const next = run(withActiveRun, {
      type: 'SET_RUN_METRICS',
      runId: 'r1',
      metrics: { num_turns: 1, cost_usd: 0.1, input_tokens: 10, output_tokens: 20 },
    });
    expect(next.runMetrics?.num_turns).toBe(1);
  });

  it('SET_PREFLIGHT_ERROR', () => {
    const next = run(base(), {
      type: 'SET_PREFLIGHT_ERROR',
      error: { reason: 'x', suggestion: 'y' },
    });
    expect(next.preflightError?.reason).toBe('x');
  });

  it('SET_STASHES', () => {
    const stashes: StashEntry[] = [
      { index: 0, message: 'm', branch: 'b', date: 'now' },
    ];
    const next = run(base(), { type: 'SET_STASHES', stashes });
    expect(next.stashes).toHaveLength(1);
  });

  it('SET_STASH_FILES', () => {
    const files: FileChange[] = [{ path: 'a', status: 'Modified' }];
    const next = run(base(), { type: 'SET_STASH_FILES', stashIndex: 0, files });
    expect(next.stashFiles.get(0)).toHaveLength(1);
  });

  it('SET_STASH_DIFF', () => {
    const next = run(base(), {
      type: 'SET_STASH_DIFF',
      stashIndex: 0,
      diff: 'body',
      stat: null,
    });
    expect(next.stashDiffs.get('0')?.diff).toBe('body');
  });

  it('SET_DIRTY_WARNING / DISMISS_DIRTY_WARNING', () => {
    const set = run(base(), {
      type: 'SET_DIRTY_WARNING',
      status: { staged: [], unstaged: [] },
      session_id: 's1',
      prompt: 'p',
      mode: 'Free',
    });
    expect(set.dirtyWarning?.session_id).toBe('s1');
    const clr = run(set, { type: 'DISMISS_DIRTY_WARNING' });
    expect(clr.dirtyWarning).toBeNull();
  });

  it('SET_DIRTY_STATE', () => {
    const next = run(base(), {
      type: 'SET_DIRTY_STATE',
      status: { staged: [], unstaged: [] },
    });
    expect(next.dirtyState).toEqual({ staged: [], unstaged: [] });
  });

  it('TOGGLE_STASH_DRAWER flips open flag', () => {
    const once = run(base(), { type: 'TOGGLE_STASH_DRAWER' });
    expect(once.stashDrawerOpen).toBe(true);
    const twice = workspaceReducer(once, { type: 'TOGGLE_STASH_DRAWER' });
    expect(twice.stashDrawerOpen).toBe(false);
  });

  it('SET_SIDEBAR_VIEW expands collapsed sidebar', () => {
    const collapsed: WorkspaceStore = { ...base(), sidebarCollapsed: true };
    const next = run(collapsed, { type: 'SET_SIDEBAR_VIEW', view: 'git' });
    expect(next.activeSidebarView).toBe('git');
    expect(next.sidebarCollapsed).toBe(false);
  });

  it('TOGGLE_SIDEBAR', () => {
    const once = run(base(), { type: 'TOGGLE_SIDEBAR' });
    expect(once.sidebarCollapsed).toBe(true);
  });

  it('SET_CHANGES_CONTEXT resets files', () => {
    const seeded = workspaceReducer(base(), {
      type: 'SET_CHANGED_FILES',
      context: { mode: 'working' },
      files: [{ path: 'a', status: 'Modified' }],
    });
    const next = run(seeded, { type: 'SET_CHANGES_CONTEXT', context: { mode: 'run', runId: 'r1' } });
    expect(next.changedFiles).toBeNull();
    expect(next.changesContext).toEqual({ mode: 'run', runId: 'r1' });
  });

  it('SET_CHANGED_FILES — gated by context match', () => {
    const start = base();
    const match = run(start, {
      type: 'SET_CHANGED_FILES',
      context: { mode: 'working' },
      files: [{ path: 'a', status: 'Modified' }],
    });
    expect(match.changedFiles?.files).toHaveLength(1);
    // Mismatched context (different mode) is dropped.
    const mismatch = workspaceReducer(match, {
      type: 'SET_CHANGED_FILES',
      context: { mode: 'run', runId: 'x' },
      files: [{ path: 'b', status: 'Modified' }],
    });
    expect(mismatch.changedFiles?.files[0]?.path).toBe('a');
  });

  it('SET_REPO_STATUS', () => {
    const next = run(base(), {
      type: 'SET_REPO_STATUS',
      status: { branch: 'main', head: 'abc', clean: true, staged_count: 0, unstaged_count: 0 },
    });
    expect(next.repoStatus?.branch).toBe('main');
  });

  it('SET_COMMIT_HISTORY', () => {
    const commits: CommitEntry[] = [
      { hash: 'abc', message: 'm', author: 'a', date: 'now' },
    ];
    const next = run(base(), { type: 'SET_COMMIT_HISTORY', commits });
    expect(next.commitHistory).toHaveLength(1);
  });

  it('SET_DIRECTORY', () => {
    const entries: FileTreeEntry[] = [{ name: 'a', path: '/a', is_dir: false }];
    const next = run(base(), { type: 'SET_DIRECTORY', path: '/', entries });
    expect(next.explorerTree.get('/')).toHaveLength(1);
  });

  it('OPEN_DIFF / SET_DIFF_CONTENT / CLOSE_DIFF', () => {
    const open = run(base(), { type: 'OPEN_DIFF', file: 'a' });
    expect(open.diffPanel).toMatchObject({ open: true, file: 'a' });
    const set = run(open, { type: 'SET_DIFF_CONTENT', file: 'a', diff: 'body', stat: null });
    expect(set.diffPanel.diff).toBe('body');
    // Mismatched file is ignored.
    const mismatched = workspaceReducer(set, {
      type: 'SET_DIFF_CONTENT',
      file: 'other',
      diff: 'nope',
      stat: null,
    });
    expect(mismatched.diffPanel.diff).toBe('body');
    const close = run(set, { type: 'CLOSE_DIFF' });
    expect(close.diffPanel).toMatchObject({ open: false, file: null });
  });

  it('SET_DIFF_MODE', () => {
    const next = run(base(), { type: 'SET_DIFF_MODE', mode: 'overlay' });
    expect(next.diffPanel.mode).toBe('overlay');
  });

  it('SET_BRANCH_NAME', () => {
    const seeded = workspaceReducer(base(), {
      type: 'SET_REPO_STATUS',
      status: { branch: 'old', head: 'h', clean: true, staged_count: 0, unstaged_count: 0 },
    });
    const next = run(seeded, { type: 'SET_BRANCH_NAME', name: 'feature' });
    expect(next.currentBranch).toBe('feature');
    expect(next.repoStatus?.branch).toBe('feature');
  });

  it('SET_BRANCH_LIST', () => {
    const branches: BranchInfo[] = [
      { name: 'main', is_head: true, upstream: null, last_commit_summary: null },
    ];
    const next = run(base(), { type: 'SET_BRANCH_LIST', branches, current: 'main' });
    expect(next.branches).toHaveLength(1);
    expect(next.currentBranch).toBe('main');
  });

  it('SET_GIT_TOAST', () => {
    const next = run(base(), {
      type: 'SET_GIT_TOAST',
      toast: { kind: 'push', message: 'ok' },
    });
    expect(next.gitToast?.message).toBe('ok');
  });

  it('ADD / REMOVE / SET_TERMINAL_SESSIONS', () => {
    const add = run(base(), { type: 'ADD_TERMINAL_SESSION', session: termSession('t1') });
    expect(add.terminalSessions.size).toBe(1);
    const set = run(add, {
      type: 'SET_TERMINAL_SESSIONS',
      sessions: [termSession('a'), termSession('b')],
    });
    expect(set.terminalSessions.size).toBe(2);
    const del = run(set, { type: 'REMOVE_TERMINAL_SESSION', sessionId: 'a' });
    expect(del.terminalSessions.has('a')).toBe(false);
  });

  it('SET_RESTORABLE_TERMINALS', () => {
    const next = run(base(), {
      type: 'SET_RESTORABLE_TERMINALS',
      sessions: [restorable('r1')],
    });
    expect(next.restorableTerminals).toHaveLength(1);
  });

  it('SET_MERGE_CONFLICTS / REMOVE_CONFLICT', () => {
    const files: MergeConflictFile[] = [
      { path: 'a', ours: '', theirs: '', base: null },
      { path: 'b', ours: '', theirs: '', base: null },
    ];
    const set = run(base(), { type: 'SET_MERGE_CONFLICTS', files });
    expect(set.mergeConflicts).toHaveLength(2);
    const del = run(set, { type: 'REMOVE_CONFLICT', filePath: 'a' });
    expect(del.mergeConflicts.map((f) => f.path)).toEqual(['b']);
  });

  it('SET_FILE_CONTENT / SET_FILE_ERROR', () => {
    const set = run(base(), {
      type: 'SET_FILE_CONTENT',
      path: 'f',
      content: 'hello',
      language: 'ts',
      truncated: false,
      sizeBytes: 5,
    });
    expect(set.fileViewer?.content).toBe('hello');
    const err = run(set, { type: 'SET_FILE_ERROR', path: 'f', error: 'oops' });
    expect(err.fileViewer?.error).toBe('oops');
    expect(err.fileViewer?.content).toBeUndefined();
  });

  it('SET_SEARCH_RESULTS', () => {
    const next = run(base(), {
      type: 'SET_SEARCH_RESULTS',
      result: {
        query: 'q',
        matches: [],
        total_matches: 0,
        files_searched: 0,
        truncated: false,
        duration_ms: 1,
      },
    });
    expect(next.searchResult?.query).toBe('q');
  });

  it('unknown action returns state unchanged (default branch)', () => {
    const start = base();
    // @ts-expect-error — probing the default arm.
    const next = workspaceReducer(start, { type: '__UNKNOWN__' });
    expect(next).toBe(start);
  });

  // Completeness gate. `satisfies readonly WorkspaceAction['type'][]` means a
  // stale entry (renamed/removed action) triggers a TS error at compile time.
  it('covers every WorkspaceAction variant', () => {
    const expected = [
      'SET_ACTIVE_SESSION',
      'SET_ACTIVE_RUN',
      'SET_RUN_STATE',
      'START_PENDING_RUN',
      'CLEAR_PENDING_RUN',
      'APPEND_OUTPUT',
      'CLEAR_OUTPUT',
      'UPSERT_RUN',
      'SET_RUNS',
      'SELECT_RUN',
      'SET_DIFF',
      'SET_MERGE_CONFLICT',
      'CLEAR_MERGE_CONFLICT',
      'ADD_TOOL_CALL',
      'UPDATE_TOOL_RESULT',
      'SET_RUN_METRICS',
      'SET_PREFLIGHT_ERROR',
      'SET_STASHES',
      'SET_STASH_FILES',
      'SET_STASH_DIFF',
      'SET_DIRTY_WARNING',
      'DISMISS_DIRTY_WARNING',
      'SET_DIRTY_STATE',
      'TOGGLE_STASH_DRAWER',
      'SET_SIDEBAR_VIEW',
      'TOGGLE_SIDEBAR',
      'SET_CHANGES_CONTEXT',
      'SET_CHANGED_FILES',
      'SET_REPO_STATUS',
      'SET_COMMIT_HISTORY',
      'SET_DIRECTORY',
      'OPEN_DIFF',
      'CLOSE_DIFF',
      'SET_DIFF_CONTENT',
      'SET_DIFF_MODE',
      'SET_BRANCH_NAME',
      'SET_BRANCH_LIST',
      'SET_GIT_TOAST',
      'ADD_TERMINAL_SESSION',
      'REMOVE_TERMINAL_SESSION',
      'SET_TERMINAL_SESSIONS',
      'SET_RESTORABLE_TERMINALS',
      'SET_MERGE_CONFLICTS',
      'REMOVE_CONFLICT',
      'SET_FILE_CONTENT',
      'SET_FILE_ERROR',
      'SET_SEARCH_RESULTS',
    ] as const satisfies readonly WorkspaceAction['type'][];
    for (const tag of expected) {
      expect(covered.has(tag), `action ${tag} should have a test`).toBe(true);
    }
  });
});
