// Context switch service — "Open current context in another mode" (M3-03)
// Allows switching a workspace's mode while preserving context (e.g., keeping the same project).

import type { WorkspaceMode } from '../../domain/workspace/types';
import { getMode } from '../../modes/registry';
import type { CommandBus } from '../commands/commandBus';

export class ContextSwitchService {
  private readonly bus: CommandBus;

  constructor(bus: CommandBus) {
    this.bus = bus;
  }

  /**
   * Switch the active workspace to a different mode.
   * Creates a new layout using the mode's default layout,
   * keeping the workspace's root path and session link.
   */
  switchMode(workspaceId: string, newMode: WorkspaceMode): void {
    const def = getMode(newMode);
    if (!def) return;
    this.bus.dispatch({ type: 'ActivateWorkspace', workspace_id: workspaceId });
    // In a full implementation, this would also update the workspace's mode
    // by sending an UpdateWorkspaceMode command (future protocol extension).
    // For now, activating the workspace is the entry point.
  }

  /**
   * Open the current context (same root_path) in a new workspace with a different mode.
   */
  openInNewMode(rootPath: string, mode: WorkspaceMode): void {
    const def = getMode(mode);
    const name = `${rootPath.split('/').pop() ?? 'workspace'} (${def?.label ?? mode})`;
    this.bus.dispatch({
      type: 'CreateWorkspace',
      name,
      root_path: rootPath,
      mode,
    });
  }
}
