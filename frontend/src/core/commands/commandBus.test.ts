// M14 — CommandBus is a thin passthrough to the WS send function, so the
// contract to verify is: (1) payloads are forwarded verbatim; (2) the
// singleton getters fail fast if not initialised.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandBus, initCommandBus, getCommandBus } from './commandBus';
import type { AppCommand } from '../../types/protocol';

describe('CommandBus', () => {
  it('dispatch forwards AppCommand payloads to the send fn', () => {
    const send = vi.fn();
    const bus = new CommandBus(send);
    const cmd: AppCommand = { type: 'Ping' };
    bus.dispatch(cmd);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(cmd);
  });

  it('dispatch preserves payload shape for each command variant', () => {
    const send = vi.fn();
    const bus = new CommandBus(send);
    const samples: AppCommand[] = [
      { type: 'Auth', token: 'tok' },
      { type: 'StartSession', project_root: '/root' },
      { type: 'StartRun', session_id: 's1', prompt: 'p', mode: 'Free' },
      { type: 'CancelRun', run_id: 'r1', reason: 'user' },
      { type: 'RespondToBlocking', run_id: 'r1', response: 'yes' },
      { type: 'GetDiff', run_id: 'r1' },
      { type: 'ListWorkspaces' },
      { type: 'CreateWorkspace', name: 'w', root_path: '/', mode: 'Terminal' },
      { type: 'CreateTerminalSession', workspace_id: 'w1' },
      { type: 'WriteTerminalInput', session_id: 't1', data: 'ls\n' },
      { type: 'ResizeTerminal', session_id: 't1', cols: 80, rows: 24 },
      { type: 'PushBranch' },
      { type: 'PullBranch', remote: 'origin', branch: 'main' },
      { type: 'ReadFile', path: 'a' },
      { type: 'SearchFiles', query: 'q' },
    ];
    for (const cmd of samples) bus.dispatch(cmd);
    expect(send).toHaveBeenCalledTimes(samples.length);
    samples.forEach((cmd, i) => {
      expect(send.mock.calls[i]?.[0]).toBe(cmd);
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      // Deliberately re-init: earlier tests may have left the module state
      // populated. initCommandBus overwrites the singleton.
      initCommandBus(vi.fn());
    });

    it('initCommandBus returns a bus bound to the given send fn', () => {
      const send = vi.fn();
      const bus = initCommandBus(send);
      bus.dispatch({ type: 'Ping' });
      expect(send).toHaveBeenCalledWith({ type: 'Ping' });
    });

    it('getCommandBus returns the same instance as initCommandBus', () => {
      const bus = initCommandBus(vi.fn());
      expect(getCommandBus()).toBe(bus);
    });

    it('getCommandBus dispatches through the initialised send fn', () => {
      const send = vi.fn();
      initCommandBus(send);
      getCommandBus().dispatch({ type: 'Ping' });
      expect(send).toHaveBeenCalledWith({ type: 'Ping' });
    });
  });
});
