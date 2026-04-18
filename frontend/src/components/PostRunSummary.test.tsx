// Tests for PostRunSummary — specifically the Failed-run rendering path.
// AI-BUG-01 / issue #113: mid-stream crash must show the failure reason,
// not a silent "Completed" with 0 files modified.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { PostRunSummary } from './PostRunSummary';
import type { AppState } from '../context/AppContext';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Minimal stub for AppContext — only the slices PostRunSummary reads.
// ---------------------------------------------------------------------------

// Re-export the context name so we can inject a custom value without
// importing the real AppProvider (which starts WebSocket connections etc.)
const AppStateContext = createContext<Partial<AppState>>({});

// Patch the module so `useAppState` returns whatever the test provides.
vi.mock('../context/AppContext.tsx', async (importOriginal) => {
  const real = await importOriginal<typeof import('../context/AppContext')>();
  return {
    ...real,
    useAppState: () => useContext(AppStateContext),
  };
});

function Wrapper({ state, children }: { state: Partial<AppState>; children: ReactNode }) {
  return <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFailedRun(error: string) {
  return {
    id: 'run-001',
    state: { type: 'Failed' as const, error, phase: 'Execution' as const },
    prompt_preview: 'fix the bug',
    modified_file_count: 0,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    diff_stat: null,
    autonomy: 'Autonomous' as const,
  };
}

function makeCompletedRun() {
  return {
    id: 'run-002',
    state: { type: 'Completed' as const, exit_code: 0 },
    prompt_preview: 'fix the bug',
    modified_file_count: 2,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    diff_stat: { files_changed: 2, insertions: 10, deletions: 3, file_stats: [] },
    autonomy: 'Autonomous' as const,
  };
}

function makeMinimalState(runs: Map<string, ReturnType<typeof makeFailedRun> | ReturnType<typeof makeCompletedRun>>): Partial<AppState> {
  return {
    runs: runs as AppState['runs'],
    diffCache: new Map(),
    mergeConflict: null,
    runMetrics: null,
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostRunSummary — Failed run', () => {
  it('shows the failure reason box when the run has state Failed', () => {
    const reason = 'stream ended without result event (exit -1): connection reset by peer';
    const run = makeFailedRun(reason);
    const state = makeMinimalState(new Map([[run.id, run]]));

    render(
      <Wrapper state={state}>
        <PostRunSummary
          runId={run.id}
          onGetDiff={noop}
          onMerge={noop}
          onRevert={noop}
        />
      </Wrapper>,
    );

    // The failure reason must be visible
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('shows the phase in the failure heading', () => {
    const run = makeFailedRun('stream ended without result event');
    const state = makeMinimalState(new Map([[run.id, run]]));

    render(
      <Wrapper state={state}>
        <PostRunSummary
          runId={run.id}
          onGetDiff={noop}
          onMerge={noop}
          onRevert={noop}
        />
      </Wrapper>,
    );

    expect(screen.getByText(/Run failed \(Execution\)/i)).toBeTruthy();
  });

  it('shows "Run did not complete" in the Changes section for Failed runs', () => {
    const run = makeFailedRun('stream ended without result event');
    const state = makeMinimalState(new Map([[run.id, run]]));

    render(
      <Wrapper state={state}>
        <PostRunSummary
          runId={run.id}
          onGetDiff={noop}
          onMerge={noop}
          onRevert={noop}
        />
      </Wrapper>,
    );

    expect(screen.getByText('Run did not complete')).toBeTruthy();
  });

  it('does NOT show the failure reason box for Completed runs', () => {
    const run = makeCompletedRun();
    const state = makeMinimalState(new Map([[run.id, run]]));

    render(
      <Wrapper state={state}>
        <PostRunSummary
          runId={run.id}
          onGetDiff={noop}
          onMerge={noop}
          onRevert={noop}
        />
      </Wrapper>,
    );

    // The failure heading must NOT be present
    expect(screen.queryByText(/Run failed/i)).toBeNull();
  });

  it('shows "Failed" in the Status section for Failed runs', () => {
    const run = makeFailedRun('some error');
    const state = makeMinimalState(new Map([[run.id, run]]));

    render(
      <Wrapper state={state}>
        <PostRunSummary
          runId={run.id}
          onGetDiff={noop}
          onMerge={noop}
          onRevert={noop}
        />
      </Wrapper>,
    );

    // The status badge must read "Failed"
    expect(screen.getByText('Failed')).toBeTruthy();
  });
});
