import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '../commands/commandBus';
import { RunService } from './runService';

describe('RunService', () => {
  it('startRun forwards autonomy explicitly in StartRun payload', () => {
    const send = vi.fn();
    const service = new RunService(new CommandBus(send));

    service.startRun({
      sessionId: 'session-1',
      prompt: 'plan this work',
      mode: 'Free',
      autonomy: 'ReviewPlan',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'StartRun',
      session_id: 'session-1',
      prompt: 'plan this work',
      mode: 'Free',
      autonomy: 'ReviewPlan',
      skip_dirty_check: undefined,
    });
  });

  it('dispatches command payloads for cancel/diff/revert/merge helpers', () => {
    const send = vi.fn();
    const service = new RunService(new CommandBus(send));

    service.cancelRun('run-1');
    service.getDiff('run-1');
    service.revertRun('run-1');
    service.mergeRun('run-1');

    expect(send).toHaveBeenNthCalledWith(1, {
      type: 'CancelRun',
      run_id: 'run-1',
      reason: 'User cancelled',
    });
    expect(send).toHaveBeenNthCalledWith(2, { type: 'GetDiff', run_id: 'run-1' });
    expect(send).toHaveBeenNthCalledWith(3, { type: 'RevertRun', run_id: 'run-1' });
    expect(send).toHaveBeenNthCalledWith(4, { type: 'MergeRun', run_id: 'run-1' });
  });
});
