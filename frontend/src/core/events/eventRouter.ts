// Event router — routes raw daemon events to the correct state layer (M1-03, C3).
//
// Every `AppEvent` variant is handled explicitly. When a variant genuinely
// has no routing target (e.g. purely informational), the switch arm is
// annotated with `// intentionally ignored: <reason>`. New protocol variants
// must be handled here — the `default: never` arm at the bottom of
// `routeToWorkspace` breaks compilation on any unhandled tag.

import type { AppEvent } from '../../types/protocol';
import type { AppStoreAction } from '../../state/app-store';
import type { WorkspaceAction } from '../../state/workspace-store';

export type AppStoreDispatch = (action: AppStoreAction) => void;
export type WorkspaceDispatch = (workspaceId: string, action: WorkspaceAction) => void;

/**
 * Events that pertain to the whole app (auth, sessions, workspaces, status).
 * Anything NOT listed here is routed to the active workspace.
 */
const APP_LEVEL_EVENTS = new Set<AppEvent['type']>([
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
  private readonly appDispatch: AppStoreDispatch;
  private readonly workspaceDispatch: WorkspaceDispatch;
  private readonly getActiveWorkspaceId: () => string | null;

  constructor(
    appDispatch: AppStoreDispatch,
    workspaceDispatch: WorkspaceDispatch,
    getActiveWorkspaceId: () => string | null,
  ) {
    this.appDispatch = appDispatch;
    this.workspaceDispatch = workspaceDispatch;
    this.getActiveWorkspaceId = getActiveWorkspaceId;
  }

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
      case 'StatusUpdate':
        // intentionally ignored: dashboard heartbeat, no store slice yet
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
      default:
        // Should be unreachable — events in APP_LEVEL_EVENTS must be handled above.
        console.warn('[eventRouter] unhandled app-level event', event);
    }
  }

  private routeToWorkspace(workspaceId: string, event: AppEvent): void {
    const dispatch = (action: WorkspaceAction) =>
      this.workspaceDispatch(workspaceId, action);

    switch (event.type) {
      // Events already classified as app-level — routed here only if the caller
      // bypassed `route()`. Forward to the app dispatcher.
      case 'AuthSuccess':
      case 'AuthFailed':
      case 'Pong':
      case 'SessionStarted':
      case 'SessionEnded':
      case 'SessionList':
      case 'StatusUpdate':
      case 'Error':
      case 'WorkspaceList':
      case 'WorkspaceCreated':
      case 'WorkspaceClosed':
      case 'WorkspaceActivated':
        this.routeToApp(event);
        break;

      // --- Run lifecycle ---
      case 'RunStateChanged':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: event.run_id });
        dispatch({ type: 'SET_RUN_STATE', runState: event.new_state });
        break;
      case 'RunOutput':
        dispatch({ type: 'APPEND_OUTPUT', line: event.line });
        break;
      case 'RunOutputPage':
        // Paginated history load: append each line in order.
        for (const line of event.lines) {
          dispatch({ type: 'APPEND_OUTPUT', line });
        }
        break;
      case 'RunCompleted':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: null });
        dispatch({ type: 'UPSERT_RUN', run: event.summary });
        dispatch({ type: 'CLEAR_RUN_METRICS' });
        break;
      case 'RunFailed':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: null });
        dispatch({ type: 'CLEAR_RUN_METRICS' });
        break;
      case 'RunCancelled':
        dispatch({ type: 'SET_ACTIVE_RUN', runId: null });
        dispatch({ type: 'CLEAR_RUN_METRICS' });
        break;
      case 'RunList':
        dispatch({ type: 'SET_RUNS', runs: event.runs });
        break;
      case 'RunDiff':
        dispatch({ type: 'SET_DIFF', runId: event.run_id, stat: event.stat, diff: event.diff });
        break;
      case 'RunReverted':
        // intentionally ignored: legacy event; UI reacts to the follow-up RunList refresh
        break;
      case 'RunMerged':
        dispatch({ type: 'CLEAR_MERGE_CONFLICT' });
        break;
      case 'RunMergeConflict':
        dispatch({ type: 'SET_MERGE_CONFLICT', runId: event.run_id, paths: event.conflict_paths });
        break;

      // --- Run structured telemetry (TERMINAL-055) ---
      case 'RunToolUse':
        dispatch({
          type: 'ADD_TOOL_CALL',
          runId: event.run_id,
          toolCall: {
            tool_id: event.tool_id,
            tool_name: event.tool_name,
            input_preview: event.tool_input_preview,
            status: 'pending',
          },
        });
        break;
      case 'RunToolResult':
        dispatch({
          type: 'UPDATE_TOOL_RESULT',
          runId: event.run_id,
          toolId: event.tool_id,
          isError: event.is_error,
          resultPreview: event.preview,
        });
        break;
      case 'RunMetrics':
        dispatch({
          type: 'SET_RUN_METRICS',
          runId: event.run_id,
          metrics: {
            num_turns: event.num_turns,
            cost_usd: event.cost_usd,
            input_tokens: event.input_tokens,
            output_tokens: event.output_tokens,
          },
        });
        break;
      case 'RunPreflightFailed':
        dispatch({
          type: 'SET_PREFLIGHT_ERROR',
          error: { reason: event.reason, suggestion: event.suggestion },
        });
        break;

      // --- Stash / dirty ---
      case 'StashList':
        dispatch({ type: 'SET_STASHES', stashes: event.stashes });
        break;
      case 'StashFiles':
        dispatch({ type: 'SET_STASH_FILES', stashIndex: event.stash_index, files: event.files });
        break;
      case 'StashDiff':
        dispatch({
          type: 'SET_STASH_DIFF',
          stashIndex: event.stash_index,
          diff: event.diff,
          stat: event.stat,
        });
        break;
      case 'StashApplied':
        // intentionally ignored: UI refreshes via follow-up ListStashes/GetRepoStatus
        break;
      case 'StashDropped':
        // intentionally ignored: UI refreshes via follow-up ListStashes
        break;
      case 'DirtyState':
        dispatch({ type: 'SET_DIRTY_STATE', status: event.status });
        break;
      case 'DirtyWarning':
        dispatch({
          type: 'SET_DIRTY_WARNING',
          status: event.status,
          session_id: event.session_id,
          prompt: event.prompt,
          mode: event.mode,
        });
        break;

      // --- Sidebar / file tree ---
      case 'DirectoryListing':
        dispatch({ type: 'SET_DIRECTORY', path: event.path, entries: event.entries });
        break;
      case 'ChangedFilesList':
        dispatch({
          type: 'SET_CHANGED_FILES',
          context: { mode: event.mode as 'working' | 'run', runId: event.run_id },
          files: event.files,
        });
        break;
      case 'FileDiffResult':
        dispatch({
          type: 'SET_DIFF_CONTENT',
          file: event.file_path,
          diff: event.diff,
          stat: event.stat,
        });
        break;
      case 'CommitHistoryResult':
        dispatch({ type: 'SET_COMMIT_HISTORY', commits: event.commits });
        break;
      case 'CommitCreated':
        // intentionally ignored: follow-up RepoStatusResult/CommitHistoryResult refreshes the UI
        break;
      case 'BranchChanged':
        dispatch({ type: 'SET_BRANCH_NAME', name: event.name });
        break;
      case 'BranchList':
        dispatch({ type: 'SET_BRANCH_LIST', branches: event.branches, current: event.current });
        break;

      // --- PTY / terminal ---
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
      case 'TerminalOutput':
        // intentionally ignored: high-frequency; consumed via terminalBus by the pane.
        break;
      case 'TerminalSessionRestored':
        dispatch({
          type: 'ADD_TERMINAL_SESSION',
          session: {
            session_id: event.new_session_id,
            workspace_id: event.workspace_id,
            shell: '',
            cwd: event.cwd,
            created_at: new Date().toISOString(),
            last_active_at: new Date().toISOString(),
          },
        });
        break;
      case 'TerminalSessionRestoreFailed':
        // Surface as an app-level error so the user sees it.
        this.appDispatch({
          type: 'SET_ERROR',
          error: `Could not restore terminal ${event.previous_session_id}: ${event.reason}`,
        });
        break;
      case 'RestorableTerminalSessions':
        dispatch({ type: 'SET_RESTORABLE_TERMINALS', sessions: event.sessions });
        break;

      // --- Git extended (M5-04) ---
      case 'PushCompleted':
        dispatch({
          type: 'SET_GIT_TOAST',
          toast: { kind: 'push', message: `Pushed ${event.branch} → ${event.remote}` },
        });
        break;
      case 'PullCompleted':
        dispatch({
          type: 'SET_GIT_TOAST',
          toast: {
            kind: 'pull',
            message:
              event.commits_applied === 0
                ? `${event.branch} is up to date`
                : `Pulled ${event.commits_applied} commit(s) into ${event.branch}`,
          },
        });
        break;
      case 'FetchCompleted':
        dispatch({
          type: 'SET_GIT_TOAST',
          toast: { kind: 'fetch', message: `Fetched from ${event.remote}` },
        });
        break;
      case 'GitOperationFailed':
        dispatch({
          type: 'SET_GIT_TOAST',
          toast: { kind: 'error', message: `${event.operation} failed: ${event.reason}` },
        });
        break;
      case 'MergeConflicts':
        dispatch({ type: 'SET_MERGE_CONFLICTS', files: event.files });
        break;
      case 'ConflictResolved':
        dispatch({ type: 'REMOVE_CONFLICT', filePath: event.file_path });
        break;

      // --- Repo status ---
      case 'RepoStatusResult':
        dispatch({ type: 'SET_REPO_STATUS', status: event.status });
        break;

      // --- File viewer / search ---
      case 'FileContent':
        dispatch({
          type: 'SET_FILE_CONTENT',
          path: event.path,
          content: event.content,
          language: event.language,
          truncated: event.truncated,
          sizeBytes: event.size_bytes,
        });
        break;
      case 'FileReadError':
        dispatch({ type: 'SET_FILE_ERROR', path: event.path, error: event.error });
        break;
      case 'SearchResults':
        dispatch({
          type: 'SET_SEARCH_RESULTS',
          result: {
            query: event.query,
            matches: event.matches,
            total_matches: event.total_matches,
            files_searched: event.files_searched,
            truncated: event.truncated,
            duration_ms: event.duration_ms,
          },
        });
        break;

      default:
        return assertNever(event);
    }
  }
}

/**
 * Compile-time exhaustiveness gate. Adding a new `AppEvent` variant without
 * a matching case above will fail TypeScript compilation here.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled AppEvent variant: ${JSON.stringify(value)}`);
}
