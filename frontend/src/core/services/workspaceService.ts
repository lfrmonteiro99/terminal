// Workspace service — abstracts workspace protocol commands (M1-03, M3-01)

import type { WorkspaceMode } from '../../domain/workspace/types';
import type { CommandBus } from '../commands/commandBus';

export class WorkspaceService {
  constructor(private readonly bus: CommandBus) {}

  listWorkspaces(): void {
    this.bus.dispatch({ type: 'ListWorkspaces' });
  }

  createWorkspace(params: { name: string; rootPath: string; mode: WorkspaceMode }): void {
    this.bus.dispatch({
      type: 'CreateWorkspace',
      name: params.name,
      root_path: params.rootPath,
      mode: params.mode,
    });
  }

  closeWorkspace(workspaceId: string): void {
    this.bus.dispatch({ type: 'CloseWorkspace', workspace_id: workspaceId });
  }

  activateWorkspace(workspaceId: string): void {
    this.bus.dispatch({ type: 'ActivateWorkspace', workspace_id: workspaceId });
  }
}
