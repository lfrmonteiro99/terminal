import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunPanel } from './RunPanel';
import type { RunNotice } from '../types/protocol';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock('../context/AppContext', () => ({
  useAppState: () => mocks.state,
}));

vi.mock('../context/SendContext', () => ({
  useSend: () => mocks.send,
}));

function setRunState(overrides: Record<string, unknown>) {
  mocks.state = {
    activeRun: null,
    pendingRunStartedAt: null,
    runState: null,
    outputLines: [],
    runToolCalls: new Map(),
    runLiveText: '',
    runPhase: null,
    runPhaseDetail: null,
    runStartedAt: null,
    runMetrics: null,
    runNotices: [],
    ...overrides,
  };
}

function notice(overrides: Partial<RunNotice> = {}): RunNotice {
  return {
    runId: 'run-1',
    level: 'Error',
    message: 'usage limit reached (seven_day)',
    at: 1,
    ...overrides,
  };
}

describe('RunPanel run controls', () => {
  beforeEach(() => {
    mocks.send.mockReset();
    setRunState({});
  });

  it('shows a stop button while a run is active and dispatches CancelRun on click', () => {
    setRunState({ activeRun: 'run-1', outputLines: ['working'] });

    render(<RunPanel />);
    fireEvent.click(screen.getByRole('button', { name: /stop run/i }));

    expect(mocks.send).toHaveBeenCalledWith({
      type: 'CancelRun',
      run_id: 'run-1',
      reason: 'User cancelled',
    });
  });

  it('dispatches CancelRun on Escape and Ctrl+period while active', () => {
    setRunState({ activeRun: 'run-1', outputLines: ['working'] });

    const { unmount } = render(<RunPanel />);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: '.', ctrlKey: true });

    expect(mocks.send).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('names the phase while a run is working but silent', () => {
    // The old panel showed a bare "Claude is thinking…" spinner, which is what
    // made a long run indistinguishable from a hung one.
    setRunState({
      activeRun: 'run-1',
      runPhase: 'worktree',
      runPhaseDetail: '/tmp/wt',
      runStartedAt: Date.now() - 5000,
    });

    render(<RunPanel />);

    // Appears once, in the status header — the body must not repeat it.
    expect(screen.getAllByText(/creating an isolated worktree/i)).toHaveLength(1);
    expect(screen.getByText(/no output yet/i)).toBeDefined();
    // The detail line names the worktree, which is how a user learns where the
    // run is happening.
    expect(screen.getByText('/tmp/wt')).toBeDefined();
  });

  it('falls back to a plain waiting label before any phase arrives', () => {
    setRunState({ pendingRunStartedAt: Date.now() });

    render(<RunPanel />);

    expect(screen.getByText(/waiting for the first token/i)).toBeDefined();
  });

  it('renders token deltas as a live buffer', () => {
    setRunState({ activeRun: 'run-1', runLiveText: 'O Douro nasce' });

    render(<RunPanel />);

    expect(screen.getByText(/O Douro nasce/)).toBeDefined();
  });

  it('shows an error notice as an alert, out of the output log', () => {
    setRunState({ activeRun: 'run-1', runNotices: [notice()] });

    render(<RunPanel />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('usage limit reached');
  });

  it('collapses consecutive duplicate notices', () => {
    // A rate limit repeats per turn; the panel should say it once.
    setRunState({
      activeRun: 'run-1',
      runNotices: [
        notice({ at: 1 }),
        notice({ at: 2 }),
        notice({ at: 3, message: 'context compacted', level: 'Info' }),
      ],
    });

    render(<RunPanel />);

    expect(screen.getAllByText(/usage limit reached/)).toHaveLength(1);
    expect(screen.getByText(/context compacted/)).toBeDefined();
  });

  it('does not colour stderr as an error', () => {
    // CLI diagnostics land on stderr; painting them all red made every run look
    // like it was failing.
    setRunState({
      activeRun: 'run-1',
      outputLines: ['[stderr] session_id: 20261008_145451', 'real output'],
    });

    render(<RunPanel />);

    const stderrLine = screen.getByText('[stderr] session_id: 20261008_145451');
    expect(stderrLine.style.color).toBe('var(--text-muted)');
    expect(screen.getByText('real output').style.color).toBe('var(--text-primary)');
  });

  it('reports metrics when the runner provided them', () => {
    setRunState({
      activeRun: 'run-1',
      outputLines: ['done'],
      runMetrics: { num_turns: 2, cost_usd: 0.1234, input_tokens: 1500, output_tokens: 420 },
    });

    render(<RunPanel />);

    // Formatted with the runtime locale, so match the shape rather than digits.
    const footer = screen.getByText(/turns/);
    expect(footer.textContent).toMatch(/2 turns/);
    expect(footer.textContent).toMatch(/\d+ in \/ \d+ out/);
    expect(footer.textContent).toMatch(/\$0\.123/);
  });
});
