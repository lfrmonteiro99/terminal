import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsView } from './RunsView';
import type { RunSummary } from '../../types/protocol';

// The view is presentation over the app store, so the store and the command bus
// are stubbed: what these tests pin down is which command each control sends,
// and when it refuses to send one. That is the whole of "managing a run".
const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  sent: [] as { type: string }[],
  dispatched: [] as { type: string }[],
}));

vi.mock('../../context/AppContext', () => ({
  useAppState: () => mocks.state,
  useAppDispatch: () => (a: { type: string }) => {
    mocks.dispatched.push(a);
  },
}));

vi.mock('../../context/SendContext', () => ({
  useSend: () => (c: { type: string }) => {
    mocks.sent.push(c);
  },
}));

function run(over: Partial<RunSummary> & { id: string }): RunSummary {
  return {
    state: { type: 'Completed', exit_code: 0 },
    prompt_preview: 'p',
    modified_file_count: 0,
    started_at: '2026-10-08T14:45:02Z',
    ended_at: '2026-10-08T14:45:09Z',
    diff_stat: null,
    autonomy: 'Autonomous',
    session_id: 's1',
    branch: 'llm/r1',
    agent_id: null,
    prompt: 'p',
    mode: 'Free',
    worktree_present: false,
    ...over,
  };
}

function withState(runs: RunSummary[], diffCache = new Map()) {
  mocks.state = {
    activeSession: 's1',
    selectedRun: null,
    runs: new Map(runs.map(r => [r.id, r])),
    agents: new Map(),
    diffCache,
  };
}

beforeEach(() => {
  mocks.sent = [];
  mocks.dispatched = [];
});

afterEach(cleanup);

function sentTypes() {
  return mocks.sent.map(c => c.type);
}

describe('RunsView — grouping', () => {
  it('groups by what still needs a decision, not by date', () => {
    // Merge and revert delete the worktree but leave the run's own state alone,
    // so `Completed` covers both "merged" and "still sitting there". Grouping
    // is the only thing that makes that visible.
    withState([
      run({ id: 'running', state: { type: 'Running' }, worktree_present: false }),
      run({ id: 'pending', worktree_present: true }),
      run({ id: 'done', worktree_present: false }),
    ]);
    render(<RunsView />);

    expect(screen.getByText('Running now')).toBeTruthy();
    expect(screen.getByText('Needs a decision')).toBeTruthy();
    expect(screen.getByText('Resolved (merged or reverted)')).toBeTruthy();
    // The label must not claim to know which of merge/revert happened.
    expect(screen.getByText('Resolved (merged or reverted)').textContent).not.toContain('merged)');
  });

  it('says so when a terminal run can no longer be merged, reverted or diffed', () => {
    withState([run({ id: 'done', worktree_present: false })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));

    expect(document.body.textContent!.replace(/\s+/g, ' ')).toContain(
      'can no longer be merged, reverted or diffed',
    );
  });
});

describe('RunsView — managing a run', () => {
  it('asks for every session of the project, not just the active one', () => {
    withState([]);
    render(<RunsView />);
    const list = mocks.sent.find(c => c.type === 'ListRuns') as
      | { type: string; session_id: string; all_sessions?: boolean }
      | undefined;
    expect(list).toBeDefined();
    expect(list!.all_sessions).toBe(true);
  });

  it('re-runs with the full prompt, never the truncated preview', () => {
    // `prompt_preview` is capped at 100 chars. Re-running from it would silently
    // rewrite the request, which is worse than not offering the action.
    const long = 'a'.repeat(300);
    withState([run({ id: 'r1', prompt: long, prompt_preview: `${'a'.repeat(100)}…` })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('a'.repeat(64) + '…'));
    fireEvent.click(screen.getByText('Re-run'));

    const start = mocks.sent.find(c => c.type === 'StartRun') as
      | { type: string; prompt: string; mode: string; agent_id?: string }
      | undefined;
    expect(start).toBeDefined();
    expect(start!.prompt).toBe(long);
    expect(start!.mode).toBe('Free');
  });

  it('stops a running run instead of offering to re-run it', () => {
    withState([run({ id: 'r1', state: { type: 'Running' }, prompt: 'tidy the parser', prompt_preview: 'tidy the parser' })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('tidy the parser'));

    expect(screen.queryByText('Re-run')).toBeNull();
    fireEvent.click(screen.getByText('Stop'));
    const cancel = mocks.sent.find(c => c.type === 'CancelRun') as
      | { type: string; run_id: string }
      | undefined;
    expect(cancel).toBeDefined();
    expect(cancel!.run_id).toBe('r1');
  });

  it('will not merge a run whose worktree is gone', () => {
    withState([run({ id: 'r1', worktree_present: false })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));

    const merge = screen.getByText('Merge').closest('button')!;
    expect(merge.disabled).toBe(true);
    fireEvent.click(merge);
    expect(sentTypes()).not.toContain('MergeRun');
  });

  it('confirms before merging, then sends the merge', () => {
    withState([run({ id: 'r1', worktree_present: true })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));

    fireEvent.click(screen.getByText('Merge'));
    // Nothing sent until the dialog is answered.
    expect(sentTypes()).not.toContain('MergeRun');
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    // Cancel is a no-op.
    fireEvent.click(screen.getByText('Cancel'));
    expect(sentTypes()).not.toContain('MergeRun');

    fireEvent.click(screen.getByText('Merge'));
    fireEvent.click(screen.getByRole('alertdialog').querySelectorAll('button')[1]);
    expect(sentTypes()).toContain('MergeRun');
  });

  it('names the destructive half of revert in the confirmation', () => {
    withState([run({ id: 'r1', worktree_present: true })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));
    fireEvent.click(screen.getByText('Revert'));

    expect(document.body.textContent).toContain('force-deleted');
    expect(document.body.textContent).toContain('destroyed');
  });

  it('requests the diff and shows it once it arrives', () => {
    const diff = 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n';
    withState([run({ id: 'r1', worktree_present: true })], new Map([['r1', { stat: null, diff }]]));
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));

    const pre = document.querySelector('[data-run-diff]');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('+new');
  });

  it('asks for a diff when the run still has a worktree', () => {
    withState([run({ id: 'r1', worktree_present: true })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));
    expect(sentTypes()).toContain('GetDiff');
  });

  it('does not ask for a diff when there is nothing left to diff', () => {
    // Opening a resolved run used to fire GetDiff anyway; the daemon answered
    // NOT_FOUND and the app painted a red error banner for a run whose only
    // fault was being already handled.
    withState([run({ id: 'r1', worktree_present: false })]);
    render(<RunsView />);
    fireEvent.click(screen.getByText('p'));
    expect(sentTypes()).not.toContain('GetDiff');
  });
});
