// Command bus — decouples UI from raw protocol payload construction (M1-03)

import type { AppCommand } from '../../types/protocol';

export type SendFn = (cmd: AppCommand) => void;

/**
 * CommandBus wraps the raw WebSocket send function.
 * Services use this instead of calling send() directly.
 */
export class CommandBus {
  private readonly send: SendFn;

  constructor(send: SendFn) {
    this.send = send;
  }

  dispatch(cmd: AppCommand): void {
    this.send(cmd);
  }
}

let _bus: CommandBus | null = null;

export function initCommandBus(send: SendFn): CommandBus {
  _bus = new CommandBus(send);
  return _bus;
}

export function getCommandBus(): CommandBus {
  if (!_bus) throw new Error('CommandBus not initialized');
  return _bus;
}
