// Terminal service — abstracts PTY protocol commands (M1-03, M4-01)

import type { CommandBus } from '../commands/commandBus';

export class TerminalService {
  private readonly bus: CommandBus;

  constructor(bus: CommandBus) {
    this.bus = bus;
  }

  createSession(params: {
    workspaceId: string;
    shell?: string;
    cwd?: string;
    env?: [string, string][];
  }): void {
    this.bus.dispatch({
      type: 'CreateTerminalSession',
      workspace_id: params.workspaceId,
      shell: params.shell,
      cwd: params.cwd,
      env: params.env,
    });
  }

  closeSession(sessionId: string): void {
    this.bus.dispatch({ type: 'CloseTerminalSession', session_id: sessionId });
  }

  write(sessionId: string, data: string): void {
    this.bus.dispatch({ type: 'WriteTerminalInput', session_id: sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.bus.dispatch({ type: 'ResizeTerminal', session_id: sessionId, cols, rows });
  }

  listSessions(workspaceId: string): void {
    this.bus.dispatch({ type: 'ListTerminalSessions', workspace_id: workspaceId });
  }

  restoreSession(previousSessionId: string, workspaceId: string): void {
    this.bus.dispatch({
      type: 'RestoreTerminalSession',
      previous_session_id: previousSessionId,
      workspace_id: workspaceId,
    });
  }

  listRestorableSessions(workspaceId: string): void {
    this.bus.dispatch({ type: 'ListRestoredTerminalSessions', workspace_id: workspaceId });
  }
}
