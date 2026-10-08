import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProvider, useAppDispatch, useAppState } from './AppContext';
import type { AppEvent } from '../types/protocol';

/**
 * Drive events through the real provider rather than a reducer copy, so the
 * wiring (including the `HANDLE_EVENT` wrapper) is covered too.
 */
function useRunHarness() {
  return { state: useAppState(), dispatch: useAppDispatch() };
}

function setup() {
  const view = renderHook(() => useRunHarness(), {
    wrapper: ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>,
  });
  const feed = (event: AppEvent) =>
    act(() => view.result.current.dispatch({ type: 'HANDLE_EVENT', event }));
  const dispatch = (action: Parameters<ReturnType<typeof useAppDispatch>>[0]) =>
    act(() => view.result.current.dispatch(action));
  const get = () => view.result.current.state;
  return { feed, dispatch, get };
}

/** An optimistic run that the daemon has accepted and moved to Running. */
function startedRun(runId = 'run-1') {
  const h = setup();
  h.dispatch({ type: 'MARK_RUN_PENDING', prompt: 'tidy the parser' });
  h.feed({ type: 'RunStateChanged', run_id: runId, new_state: { type: 'Preparing' } });
  h.feed({ type: 'RunStateChanged', run_id: runId, new_state: { type: 'Running' } });
  return h;
}

describe('run lifecycle in the app reducer', () => {
  it('lists a failed run instead of leaving the sidebar at zero', () => {
    // Only RunCompleted used to upsert a summary, so a failure looked like the
    // run had never happened: the list stayed at zero and, after a reload, the
    // error was gone entirely.
    const h = startedRun();
    h.feed({
      type: 'RunFailed',
      run_id: 'run-1',
      error: 'usage limit reached (seven_day)',
      phase: 'Execution',
    });

    const state = h.get();
    expect(state.activeRun).toBeNull();
    const summary = state.runs.get('run-1');
    expect(summary).toBeDefined();
    expect(summary!.state).toEqual({
      type: 'Failed',
      error: 'usage limit reached (seven_day)',
      phase: 'Execution',
    });
    // The prompt survives, so the entry says what was attempted.
    expect(summary!.prompt_preview).toBe('tidy the parser');
  });

  it('lists a cancelled run with the same recovery', () => {
    const h = startedRun();
    h.feed({ type: 'RunCancelled', run_id: 'run-1' });

    expect(h.get().runs.get('run-1')!.state).toEqual({
      type: 'Cancelled',
      reason: 'User cancelled',
    });
  });

  it('does not invent an entry for a cancellation it never saw run', () => {
    const h = setup();
    h.feed({ type: 'RunCancelled', run_id: 'someone-elses-run' });

    expect(h.get().runs.size).toBe(0);
  });

  it('buffers token deltas and drops the buffer when the text is committed', () => {
    const h = startedRun();
    h.feed({ type: 'RunOutputDelta', run_id: 'run-1', text: 'O Douro ' });
    h.feed({ type: 'RunOutputDelta', run_id: 'run-1', text: 'nasce' });
    expect(h.get().runLiveText).toBe('O Douro nasce');

    // The committed line represents the same text, so keeping both would print
    // the answer twice.
    h.feed({ type: 'RunOutput', run_id: 'run-1', line: 'O Douro nasce', line_number: 1 });
    expect(h.get().runLiveText).toBe('');
    expect(h.get().outputLines).toContain('O Douro nasce');
  });

  it('ignores deltas belonging to a run that is not active', () => {
    const h = startedRun();
    h.feed({ type: 'RunOutputDelta', run_id: 'an-old-run', text: 'leak' });

    expect(h.get().runLiveText).toBe('');
  });

  it('collects notices as chrome, out of the output log', () => {
    const h = startedRun();
    h.feed({
      type: 'RunNotice',
      run_id: 'run-1',
      level: 'Error',
      message: 'usage limit reached (seven_day)',
    });

    const state = h.get();
    expect(state.runNotices).toHaveLength(1);
    expect(state.runNotices[0].message).toBe('usage limit reached (seven_day)');
    // A notice must never be mistaken for something the model said.
    expect(state.outputLines).toHaveLength(0);
  });

  it('tracks the phase so the panel can say what is happening', () => {
    const h = startedRun();
    h.feed({ type: 'RunProgress', run_id: 'run-1', phase: 'worktree', detail: '/tmp/wt' });

    expect(h.get().runPhase).toBe('worktree');
    expect(h.get().runPhaseDetail).toBe('/tmp/wt');
  });

  it('clears live state when the run ends', () => {
    const h = startedRun();
    h.feed({ type: 'RunOutputDelta', run_id: 'run-1', text: 'half a sentence' });
    h.feed({ type: 'RunFailed', run_id: 'run-1', error: 'boom', phase: 'Execution' });

    expect(h.get().runLiveText).toBe('');
    expect(h.get().runPhase).toBeNull();
  });

  it('starts a fresh buffer for the next run', () => {
    const h = startedRun();
    h.feed({ type: 'RunNotice', run_id: 'run-1', level: 'Info', message: 'context compacted' });
    expect(h.get().runNotices).toHaveLength(1);

    h.dispatch({ type: 'MARK_RUN_PENDING', prompt: 'next thing' });

    expect(h.get().runNotices).toHaveLength(0);
    expect(h.get().runLiveText).toBe('');
  });
});
