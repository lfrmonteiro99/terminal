// Run service — abstracts AI run protocol commands (M1-03)

import type { AutonomyLevel, RunMode } from '../../types/protocol';
import type { CommandBus } from '../commands/commandBus';

export interface RunServiceStartRunParams {
  sessionId: string;
  prompt: string;
  mode: RunMode;
  autonomy: AutonomyLevel;
  skipDirtyCheck?: boolean;
}

export class RunService {
  private readonly bus: CommandBus;

  constructor(bus: CommandBus) {
    this.bus = bus;
  }

  startRun(params: RunServiceStartRunParams): void {
    this.bus.dispatch({
      type: 'StartRun',
      session_id: params.sessionId,
      prompt: params.prompt,
      mode: params.mode,
      autonomy: params.autonomy,
      skip_dirty_check: params.skipDirtyCheck,
    });
  }

  cancelRun(runId: string, reason = 'User cancelled'): void {
    this.bus.dispatch({ type: 'CancelRun', run_id: runId, reason });
  }

  getDiff(runId: string): void {
    this.bus.dispatch({ type: 'GetDiff', run_id: runId });
  }

  revertRun(runId: string): void {
    this.bus.dispatch({ type: 'RevertRun', run_id: runId });
  }

  mergeRun(runId: string): void {
    this.bus.dispatch({ type: 'MergeRun', run_id: runId });
  }

  listRuns(sessionId: string): void {
    this.bus.dispatch({ type: 'ListRuns', session_id: sessionId });
  }

  stashAndRun(params: { sessionId: string; prompt: string; mode: RunMode; stashMessage: string }): void {
    this.bus.dispatch({
      type: 'StashAndRun',
      session_id: params.sessionId,
      prompt: params.prompt,
      mode: params.mode,
      stash_message: params.stashMessage,
    });
  }
}
