// Event router — routes raw daemon events to the correct state layer (M1-03)

import type { AppEvent } from '../../types/protocol';
import type { AppStoreAction } from '../../state/app-store';
import type { WorkspaceAction } from '../../state/workspace-store';

export type AppStoreDispatch = (action: AppStoreAction) => void;
export type WorkspaceDispatch = (workspaceId: string, action: WorkspaceAction) => void;

/** Global (app-level) event types. */
const APP_LEVEL_EVENTS = new Set([
  'AuthSuccess',
  'AuthFailed',
  'Pong',
  'SessionStarted',
  'SessionEnded',
  'SessionList',
  'StatusUpdate',
  'Error',
  'WorkspaceList',
  'WorkspaceCreated',
  'WorkspaceClosed',
  'WorkspaceActivated',
]);

export class EventRouter {
  constructor(
    private readonly appDispatch: AppStoreDispatch,
    private readonly workspaceDispatch: WorkspaceDispatch,
    private readonly getActiveWorkspaceId: () => string | null,
  ) {}

  route(event: AppEvent): void {
    if (APP_LEVEL_EVENTS.has(event.type)) {
      this.routeToApp(event);
    } else {
      const wid = this.getActiveWorkspaceId();
      if (wid) this.routeToWorkspace(wid, event);
    }
  }

  private routeToApp(event: AppEvent): void {
    switch (event.type) {
      case 'AuthSuccess':
        this.appDispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
        break;
      case 'AuthFailed':
        this.appDispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
        this.appDispatch({ type: 'SET_ERROR', error: `Auth failed: ${event.reason}` });
        break;
      case 'Pong':
        this.appDispatch({ type: 'SET_LAST_PONG' });
        break;
      case 'SessionStarted':
        this.appDispatch({ type: 'ADD_SESSION', session: event.session });
        break;
      case 'SessionEnded':
        this.appDispatch({ type: 'REMOVE_SESSION', sessionId: event.session_id });
        break;
      case 'SessionList':
        this.appDispatch({ type: 'SET_SESSIONS', sessions: event.sessions });
        break;
      case 'Error':
        this.appDispatch({ type: 'SET_ERROR', error: `${event.code}: ${event.message}` });
        break;
      case 'WorkspaceList':
        this.appDispatch({ type: 'SET_WORKSPACES', workspaces: event.workspaces });
        break;
      case 'WorkspaceCreated':
        this.appDispatch({ type: 'ADD_WORKSPACE', workspace: event.workspace });
        break;
      case 'WorkspaceClosed':
        this.appDispatch({ type: 'REMOVE_WORKSPACE', workspaceId: event.workspace_id });
        break;
      case 'WorkspaceActivated':
        this.appDispatch({ type: 'SET_ACTIVE_WORKSPACE', workspaceId: event.workspace_id });
        break;
    }
  }

  private routeToWorkspace(workspaceId: string, event: AppEvent): void {
    const dispatch = (action: WorkspaceAction) =>
      this.workspaceDispatch(workspaceId, action);

    switch (event.type) {
      case 'RunStateChanged':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: event.run_id });
        dispatch({ type: 'SET_RUN_STATE', runState: event.new_state });
        if (event.new_state.type === 'Running') dispatch({ type: 'CLEAR_BLOCKING' });
        break;
      case 'RunOutput':
        dispatch({ type: 'APPEND_OUTPUT', line: event.line });
        break;
      case 'RunBlocking':
        dispatch({ type: 'SET_BLOCKING', question: event.question, context: event.context });
        break;
      case 'RunCompleted':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: null });
        dispatch({ type: 'UPSERT_RUN', run: event.summary });
        dispatch({ type: 'CLEAR_BLOCKING' });
        break;
      case 'RunFailed':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: null });
        dispatch({ type: 'CLEAR_BLOCKING' });
        break;
      case 'RunCancelled':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: null });
        dispatch({ type: 'CLEAR_BLOCKING' });
        break;
      case 'RunList':
        dispatch({ type: 'SET_RUNS', runs: event.runs });
        break;
      case 'RunDiff':
        dispatch({ type: 'SET_DIFF', runId: event.run_id, stat: event.stat, diff: event.diff });
        break;
      case 'RunReverted':
        break;
      case 'RunMerged':
        dispatch({ type: 'CLEAR_MERGE_CONFLICT' });
        break;
      case 'RunMergeConflict':
        dispatch({ type: 'SET_MERGE_CONFLICT', runId: event.run_id, paths: event.conflict_paths });
        break;
      case 'StashList':
        dispatch({ type: 'SET_STASHES', stashes: event.stashes });
        break;
      case 'StashFiles':
        dispatch({ type: 'SET_STASH_FILES', stashIndex: event.stash_index, files: event.files });
        break;
      case 'StashDiff':
        dispatch({ type: 'SET_STASH_DIFF', stashIndex: event.stash_index, diff: event.diff, stat: event.stat });
        break;
      case 'DirtyWarning':
        dispatch({ type: 'SET_DIRTY_WARNING', status: event.status, session_id: event.session_id, prompt: event.prompt, mode: event.mode });
        break;
      case 'DirectoryListing':
        dispatch({ type: 'SET_DIRECTORY', path: event.path, entries: event.entries });
        break;
      case 'ChangedFilesList':
        dispatch({ type: 'SET_CHANGED_FILES', context: { mode: event.mode as 'working' | 'run', runId: event.run_id }, files: event.files });
        break;
      case 'FileDiffResult':
        dispatch({ type: 'SET_DIFF_CONTENT', file: event.file_path, diff: event.diff, stat: event.stat });
        break;
      case 'RepoStatusResult':
        dispatch({ type: 'SET_REPO_STATUS', status: event.status });
        break;
      case 'CommitHistoryResult':
        dispatch({ type: 'SET_COMMIT_HISTORY', commits: event.commits });
        break;
      case 'BranchChanged':
        break;
      case 'TerminalSessionCreated':
        dispatch({
          type: 'ADD_TERMINAL_SESSION',
          session: {
            session_id: event.session_id,
            workspace_id: event.workspace_id,
            shell: event.shell,
            cwd: event.cwd,
            created_at: new Date().toISOString(),
            last_active_at: new Date().toISOString(),
          },
        });
        break;
      case 'TerminalSessionClosed':
        dispatch({ type: 'REMOVE_TERMINAL_SESSION', sessionId: event.session_id });
        break;
      case 'TerminalSessionList':
        dispatch({ type: 'SET_TERMINAL_SESSIONS', sessions: event.sessions });
        break;
      case 'MergeConflicts':
        dispatch({ type: 'SET_MERGE_CONFLICTS', files: event.files });
        break;
      case 'ConflictResolved':
        dispatch({ type: 'REMOVE_CONFLICT', filePath: event.file_path });
        break;
    }
  }
}
