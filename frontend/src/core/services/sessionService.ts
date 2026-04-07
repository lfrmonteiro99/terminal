// Session service — abstracts session protocol commands (M1-03)

import type { CommandBus } from '../commands/commandBus';

export class SessionService {
  constructor(private readonly bus: CommandBus) {}

  startSession(projectRoot: string): void {
    this.bus.dispatch({ type: 'StartSession', project_root: projectRoot });
  }

  endSession(sessionId: string): void {
    this.bus.dispatch({ type: 'EndSession', session_id: sessionId });
  }

  listSessions(): void {
    this.bus.dispatch({ type: 'ListSessions' });
  }
}
