import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostRunSummary } from './PostRunSummary';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../context/AppContext.tsx', () => ({
  useAppState: () => mocks.state,
}));

function withRun(run: Record<string, unknown>) {
  mocks.state = {
    runs: new Map([['r1', run]]),
    diffCache: new Map(),
    mergeConflict: null,
    runMetrics: null,
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
