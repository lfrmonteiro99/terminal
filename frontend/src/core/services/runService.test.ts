// RunService tests — verifies autonomy forwarding (SEC-03)

import { describe, it, expect, vi } from 'vitest';
import { RunService } from './runService';
import { CommandBus } from '../commands/commandBus';

function makeService() {
  const send = vi.fn();
  const bus = new CommandBus(send);
  const service = new RunService(bus);
  return { service, send };
}

describe('RunService.startRun', () => {
  it('forwards autonomy: ReviewPlan in the outgoing StartRun frame', () => {
    const { service, send } = makeService();
    service.startRun({
      sessionId: 'sess-1',
      prompt: 'x',
      mode: 'Free',
      autonomy: 'ReviewPlan',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const frame = send.mock.calls[0]?.[0];
    expect(frame).toMatchObject({
      type: 'StartRun',
      session_id: 'sess-1',
      prompt: 'x',
      mode: 'Free',
      autonomy: 'ReviewPlan',
    });
  });

  it('forwards autonomy: Autonomous in the outgoing StartRun frame', () => {
    const { service, send } = makeService();
    service.startRun({
      sessionId: 'sess-2',
      prompt: 'do something',
      mode: 'Free',
      autonomy: 'Autonomous',
    });
    const frame = send.mock.calls[0]?.[0];
    expect(frame).toMatchObject({
      type: 'StartRun',
      autonomy: 'Autonomous',
    });
  });

  it('includes skipDirtyCheck when provided', () => {
    const { service, send } = makeService();
    service.startRun({
      sessionId: 'sess-3',
      prompt: 'test',
      mode: 'Free',
      autonomy: 'Autonomous',
      skipDirtyCheck: true,
    });
    const frame = send.mock.calls[0]?.[0];
    expect(frame).toMatchObject({
      type: 'StartRun',
      skip_dirty_check: true,
      autonomy: 'Autonomous',
    });
  });

  it('TypeScript requires autonomy — omitting it would be a compile error', () => {
    // This test documents the compile-time contract: the call below is valid
    // only because autonomy is supplied. The actual enforcement is by tsc.
    const { service, send } = makeService();
    service.startRun({ sessionId: 's', prompt: 'p', mode: 'Free', autonomy: 'Autonomous' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
