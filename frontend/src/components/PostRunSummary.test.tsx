import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostRunSummary } from './PostRunSummary';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../context/AppContext.tsx', () => ({
  useAppState: () => mocks.state,
  useAppDispatch: () => () => {},
}));

function withRun(run: Record<string, unknown>) {
  mocks.state = {
    runs: new Map([['r1', run]]),
    diffCache: new Map(),
    mergeConflict: null,
    runMetrics: null,
    runErrors: new Map(),
  };
}

const baseRun = {
  id: 'r1',
  prompt_preview: 'mete o background a verde',
  started_at: '2026-10-08T14:45:02Z',
  ended_at: '2026-10-08T14:45:04Z',
  modified_file_count: 0,
  diff_stat: null,
};

function noop() {}

describe('PostRunSummary — a failed run', () => {
  it('states why it failed, not only that it did', () => {
    withRun({
      ...baseRun,
      state: {
        type: 'Failed',
        error: 'failed to start `hermes` in /gone/project: No such file or directory',
        phase: 'Preparation',
      },
    });
    render(
      <PostRunSummary runId="r1" onGetDiff={noop} onMerge={noop} onRevert={noop} />,
    );

    const reason = document.querySelector('[data-run-error]');
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toContain('No such file or directory');
    expect(reason!.textContent).toContain('/gone/project');
    expect(reason!.textContent).toContain('Preparation');
  });

  it('does not invent a reason for a run that succeeded', () => {
    withRun({
      ...baseRun,
      state: { type: 'Completed', exit_code: 0 },
    });
    render(
      <PostRunSummary runId="r1" onGetDiff={noop} onMerge={noop} onRevert={noop} />,
    );
    expect(document.querySelector('[data-run-error]')).toBeNull();
  });
});

describe('PostRunSummary — the diff button', () => {
  // The request this pins down was the source of the complaint: opening a run
  // whose worktree was gone fired GetDiff, the daemon answered NOT_FOUND, and
  // the app painted a full-width red banner — for a run that simply had nothing
  // left to diff, which the summary already said in words.
  it('does not ask for a diff when the worktree is already gone', () => {
    const onGetDiff = vi.fn();
    withRun({
      ...baseRun,
      worktree_present: false,
      state: { type: 'Completed', exit_code: 0 },
    });
    render(<PostRunSummary runId="r1" onGetDiff={onGetDiff} onMerge={noop} onRevert={noop} />);

    fireEvent.click(screen.getByText('Show diff'));

    expect(onGetDiff).not.toHaveBeenCalled();
  });

  it('still asks while the worktree is on disk', () => {
    const onGetDiff = vi.fn();
    withRun({
      ...baseRun,
      worktree_present: true,
      state: { type: 'Completed', exit_code: 0 },
    });
    render(<PostRunSummary runId="r1" onGetDiff={onGetDiff} onMerge={noop} onRevert={noop} />);

    fireEvent.click(screen.getByText('Show diff'));

    expect(onGetDiff).toHaveBeenCalledWith('r1');
  });
});
