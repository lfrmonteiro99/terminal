import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunPanel } from './RunPanel';

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
    outputLines: [],
    runToolCalls: new Map(),
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

  it('shows the thinking indicator for an optimistic pending run', () => {
    setRunState({ pendingRunStartedAt: Date.now() });

    render(<RunPanel />);

    expect(screen.getByText(/claude is thinking/i)).toBeDefined();
  });
});
