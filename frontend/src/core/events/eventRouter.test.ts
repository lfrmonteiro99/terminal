// C3 acceptance test — every AppEvent variant must flow through the router
// without throwing, either dispatching an action or hitting a deliberate
// `intentionally ignored` arm. Adding a new variant without a corresponding
// case will fail TS compilation in eventRouter.ts (`assertNever`) — this
// test is the runtime safety net.

import { describe, it, expect, vi } from 'vitest';
import { EventRouter } from './eventRouter';
import type { AppEvent } from '../../types/protocol';

function makeRouter() {
  const appDispatch = vi.fn();
  const workspaceDispatch = vi.fn();
  const router = new EventRouter(appDispatch, workspaceDispatch, () => 'ws-1');
  return { router, appDispatch, workspaceDispatch };
}

// One sample payload per AppEvent variant. Kept intentionally small.
// When a new variant is added, TS will fail at `AppEvent` assignment if this
// table is missed, OR the router's `assertNever` will break compilation.
const SAMPLES: Record<AppEvent['type'], AppEvent> = {
  AuthSuccess: { type: 'AuthSuccess' },
  AuthFailed: { type: 'AuthFailed', reason: 'nope' },
  RunStateChanged: { type: 'RunStateChanged', run_id: 'r1', new_state: { type: 'Running' } },
  RunOutput: { type: 'RunOutput', run_id: 'r1', line: 'hi', line_number: 1 },
  RunBlocking: { type: 'RunBlocking', run_id: 'r1', question: 'ok?', context: [] },
  RunCompleted: {
    type: 'RunCompleted',
    run_id: 'r1',
    summary: {
      id: 'r1',
      state: { type: 'Completed', exit_code: 0 },
      prompt_preview: 'p',
      modified_file_count: 0,
      started_at: 'x',
      ended_at: null,
      diff_stat: null,
    },
    diff_stat: null,
  },
  RunDiff: {
    type: 'RunDiff',
    run_id: 'r1',
    stat: { files_changed: 0, insertions: 0, deletions: 0, file_stats: [] },
    diff: '',
  },
  RunReverted: { type: 'RunReverted', run_id: 'r1' },
  RunMerged: { type: 'RunMerged', run_id: 'r1', merge_result: 'Merged' },
  RunMergeConflict: { type: 'RunMergeConflict', run_id: 'r1', conflict_paths: [] },
  RunFailed: { type: 'RunFailed', run_id: 'r1', error: 'boom', phase: 'Execution' },
  RunCancelled: { type: 'RunCancelled', run_id: 'r1' },
  RunToolUse: {
    type: 'RunToolUse',
    run_id: 'r1',
    tool_id: 't1',
    tool_name: 'bash',
    tool_input_preview: 'ls',
  },
  RunToolResult: {
    type: 'RunToolResult',
    run_id: 'r1',
    tool_id: 't1',
    is_error: false,
    preview: 'ok',
  },
  RunMetrics: {
    type: 'RunMetrics',
    run_id: 'r1',
    num_turns: 1,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
  },
  RunPreflightFailed: { type: 'RunPreflightFailed', run_id: 'r1', reason: 'x', suggestion: 'y' },
  SessionStarted: {
    type: 'SessionStarted',
    session: {
      id: 's1',
      project_root: '/',
      active_run: null,
      run_count: 0,
      started_at: 'now',
    },
  },
  SessionEnded: { type: 'SessionEnded', session_id: 's1' },
  SessionList: { type: 'SessionList', sessions: [] },
  RunList: { type: 'RunList', session_id: 's1', runs: [] },
  RunOutputPage: {
    type: 'RunOutputPage',
    run_id: 'r1',
    offset: 0,
    lines: ['a'],
    has_more: false,
  },
  StatusUpdate: { type: 'StatusUpdate', active_runs: 0, session_count: 0 },
  Pong: { type: 'Pong' },
  Error: { type: 'Error', code: 'E', message: 'm' },
  StashList: { type: 'StashList', stashes: [] },
  StashFiles: { type: 'StashFiles', stash_index: 0, files: [] },
  StashDiff: { type: 'StashDiff', stash_index: 0, diff: '', stat: null },
  DirtyState: { type: 'DirtyState', status: { staged: [], unstaged: [] } },
  DirtyWarning: {
    type: 'DirtyWarning',
    status: { staged: [], unstaged: [] },
    session_id: 's1',
    prompt: 'p',
    mode: 'Free',
  },
  DirectoryListing: { type: 'DirectoryListing', path: '/', entries: [] },
  ChangedFilesList: { type: 'ChangedFilesList', mode: 'working', run_id: undefined, files: [] },
  FileDiffResult: { type: 'FileDiffResult', file_path: 'f', diff: '', stat: null },
  RepoStatusResult: {
    type: 'RepoStatusResult',
    status: { branch: 'main', head: 'abc', clean: true, staged_count: 0, unstaged_count: 0 },
  },
  CommitHistoryResult: { type: 'CommitHistoryResult', commits: [] },
  CommitCreated: { type: 'CommitCreated', hash: 'abc' },
  BranchChanged: { type: 'BranchChanged', name: 'main' },
  BranchList: { type: 'BranchList', branches: [], current: 'main' },
  WorkspaceList: { type: 'WorkspaceList', workspaces: [] },
  WorkspaceCreated: {
    type: 'WorkspaceCreated',
    workspace: {
      id: 'w1',
      name: 'x',
      root_path: '/',
      mode: 'Terminal',
      linked_session_id: null,
      last_active_at: 'now',
    },
  },
  WorkspaceClosed: { type: 'WorkspaceClosed', workspace_id: 'w1' },
  WorkspaceActivated: { type: 'WorkspaceActivated', workspace_id: 'w1' },
  TerminalSessionCreated: {
    type: 'TerminalSessionCreated',
    session_id: 't1',
    workspace_id: 'w1',
    shell: 'bash',
    cwd: '/',
  },
  TerminalSessionClosed: { type: 'TerminalSessionClosed', session_id: 't1' },
  TerminalOutput: { type: 'TerminalOutput', session_id: 't1', data: 'hi' },
  TerminalSessionList: { type: 'TerminalSessionList', workspace_id: 'w1', sessions: [] },
  TerminalSessionRestored: {
    type: 'TerminalSessionRestored',
    previous_session_id: 'p1',
    new_session_id: 't2',
    cwd: '/',
    workspace_id: 'w1',
  },
  TerminalSessionRestoreFailed: {
    type: 'TerminalSessionRestoreFailed',
    previous_session_id: 'p1',
    reason: 'x',
  },
  RestorableTerminalSessions: {
    type: 'RestorableTerminalSessions',
    workspace_id: 'w1',
    sessions: [],
  },
  PushCompleted: { type: 'PushCompleted', branch: 'main', remote: 'origin' },
  PullCompleted: { type: 'PullCompleted', branch: 'main', commits_applied: 0 },
  FetchCompleted: { type: 'FetchCompleted', remote: 'origin' },
  GitOperationFailed: { type: 'GitOperationFailed', operation: 'push', reason: 'x' },
  MergeConflicts: { type: 'MergeConflicts', files: [] },
  ConflictResolved: { type: 'ConflictResolved', file_path: 'f' },
  FileContent: {
    type: 'FileContent',
    path: 'a',
    content: '',
    language: 'ts',
    truncated: false,
    size_bytes: 0,
  },
  FileReadError: { type: 'FileReadError', path: 'a', error: 'x' },
  SearchResults: {
    type: 'SearchResults',
    query: 'q',
    matches: [],
    total_matches: 0,
    files_searched: 0,
    truncated: false,
    duration_ms: 1,
  },
};

describe('EventRouter — C3 completeness', () => {
  it('dispatches every AppEvent variant without throwing', () => {
    for (const [tag, sample] of Object.entries(SAMPLES)) {
      const { router, appDispatch, workspaceDispatch } = makeRouter();
      expect(() => router.route(sample), `variant ${tag}`).not.toThrow();
      // At least ONE of the two dispatchers must have been invoked — the only
      // exception is deliberately-ignored events. Track them explicitly.
      const deliberatelyIgnored = new Set([
        'StatusUpdate',
        'RunReverted',
        'CommitCreated',
        'TerminalOutput',
      ]);
      if (!deliberatelyIgnored.has(tag)) {
        expect(
          appDispatch.mock.calls.length + workspaceDispatch.mock.calls.length,
          `variant ${tag} should dispatch at least once`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('routes app-level events to the app dispatcher', () => {
    const { router, appDispatch, workspaceDispatch } = makeRouter();
    router.route({ type: 'Pong' });
    expect(appDispatch).toHaveBeenCalledWith({ type: 'SET_LAST_PONG' });
    expect(workspaceDispatch).not.toHaveBeenCalled();
  });

  it('routes workspace-scoped events to the workspace dispatcher', () => {
    const { router, appDispatch, workspaceDispatch } = makeRouter();
    router.route({
      type: 'RunStateChanged',
      run_id: 'r1',
      new_state: { type: 'Running' },
    });
    expect(workspaceDispatch).toHaveBeenCalled();
    expect(workspaceDispatch.mock.calls[0]?.[0]).toBe('ws-1');
    expect(appDispatch).not.toHaveBeenCalled();
  });

  it('drops workspace-scoped events when no active workspace', () => {
    const appDispatch = vi.fn();
    const workspaceDispatch = vi.fn();
    const router = new EventRouter(appDispatch, workspaceDispatch, () => null);
    router.route({ type: 'RunOutput', run_id: 'r1', line: 'x', line_number: 1 });
    expect(workspaceDispatch).not.toHaveBeenCalled();
    expect(appDispatch).not.toHaveBeenCalled();
  });

  it('SAMPLES has an entry for every AppEvent variant', () => {
    // Every `AppEvent['type']` literal is a key in SAMPLES — TS enforces this
    // via `Record<AppEvent['type'], AppEvent>`. Guard at runtime too.
    const tags = Object.keys(SAMPLES).sort();
    expect(tags.length).toBeGreaterThan(40);
  });
});
