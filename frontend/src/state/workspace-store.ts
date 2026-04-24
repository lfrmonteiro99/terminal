// Per-workspace state — scoped to a single workspace (M1-02, C3)

import type {
  BranchInfo,
  CommitEntry,
  DiffStat,
  DirtyStatus,
  FileChange,
  FileTreeEntry,
  MergeConflictFile,
  PreflightError,
  RestorableTerminalSession,
  RunMetrics,
  RunMode,
  RunState,
  RunSummary,
  SearchMatch,
  StashEntry,
  TerminalSessionSummary,
  ToolCall,
} from '../types/protocol';

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  total_matches: number;
  files_searched: number;
  truncated: boolean;
  duration_ms: number;
}

export interface FileViewerState {
  path: string;
  content?: string;
  language?: string;
  truncated?: boolean;
  size_bytes?: number;
  error?: string;
}

export interface GitToast {
  kind: 'push' | 'pull' | 'fetch' | 'error';
  message: string;
}

export interface WorkspaceStore {
  workspaceId: string;

  // AI session / run state
  activeSession: string | null;
  activeRun: string | null;
  pendingRunStartedAt: number | null;
  runState: RunState | null;
  outputLines: string[];
  runs: Map<string, RunSummary>;
  selectedRun: string | null;
  diffCache: Map<string, { stat: DiffStat; diff: string }>;
  mergeConflict: { runId: string; paths: string[] } | null;

  // Run telemetry (TERMINAL-055)
  runToolCalls: Map<string, ToolCall>;
  runMetrics: RunMetrics | null;
  preflightError: PreflightError | null;

  // Stash / dirty
  stashes: StashEntry[];
  stashFiles: Map<number, FileChange[]>;
  stashDiffs: Map<string, { diff: string; stat: DiffStat | null }>;
  dirtyWarning: { status: DirtyStatus; session_id: string; prompt: string; mode: RunMode } | null;
  dirtyState: DirtyStatus | null;
  stashDrawerOpen: boolean;

  // Sidebar layout
  activeSidebarView: 'explorer' | 'changes' | 'git';
  sidebarCollapsed: boolean;

  // Content state
  changesContext: { mode: 'working' | 'run'; runId?: string };
  changedFiles: { context: { mode: 'working' | 'run'; runId?: string }; files: FileChange[] } | null;
  repoStatus: RepoStatus | null;
  commitHistory: CommitEntry[];
  explorerTree: Map<string, FileTreeEntry[]>;
  diffPanel: { open: boolean; mode: 'split' | 'overlay' | 'inline'; file: string | null; diff: string | null; stat: DiffStat | null };

  // Git branches
  branches: BranchInfo[];
  currentBranch: string | null;
  gitToast: GitToast | null;

  // Terminal pane sessions
  terminalSessions: Map<string, TerminalSessionSummary>;
  restorableTerminals: RestorableTerminalSession[];

  // Merge conflicts (M5-05)
  mergeConflicts: MergeConflictFile[];

  // File viewer / search (TERMINAL-005/006)
  fileViewer: FileViewerState | null;
  searchResult: SearchResult | null;
}

export interface RepoStatus {
  branch: string;
  head: string;
  clean: boolean;
  staged_count: number;
  unstaged_count: number;
}

const MAX_OUTPUT_LINES = 2000;

export function createWorkspaceStore(workspaceId: string): WorkspaceStore {
  return {
    workspaceId,
    activeSession: null,
    activeRun: null,
    pendingRunStartedAt: null,
    runState: null,
    outputLines: [],
    runs: new Map(),
    selectedRun: null,
    diffCache: new Map(),
    mergeConflict: null,
    runToolCalls: new Map(),
    runMetrics: null,
    preflightError: null,
    stashes: [],
    stashFiles: new Map(),
    stashDiffs: new Map(),
    dirtyWarning: null,
    dirtyState: null,
    stashDrawerOpen: false,
    activeSidebarView: 'changes',
    sidebarCollapsed: false,
    changesContext: { mode: 'working' },
    changedFiles: null,
    repoStatus: null,
    commitHistory: [],
    explorerTree: new Map(),
    diffPanel: {
      open: false,
      mode:
        (typeof localStorage !== 'undefined'
          ? (localStorage.getItem('diff-mode') as 'split' | 'overlay' | 'inline')
          : null) || 'split',
      file: null,
      diff: null,
      stat: null,
    },
    branches: [],
    currentBranch: null,
    gitToast: null,
    terminalSessions: new Map(),
    restorableTerminals: [],
    mergeConflicts: [],
    fileViewer: null,
    searchResult: null,
  };
}

export type WorkspaceAction =
  | { type: 'SET_ACTIVE_SESSION'; sessionId: string | null }
  | { type: 'SET_ACTIVE_RUN'; runId: string | null }
  | { type: 'SET_RUN_STATE'; runState: RunState | null }
  | { type: 'START_PENDING_RUN'; startedAt: number }
  | { type: 'CLEAR_PENDING_RUN' }
  | { type: 'APPEND_OUTPUT'; line: string }
  | { type: 'CLEAR_OUTPUT' }
  | { type: 'UPSERT_RUN'; run: RunSummary }
  | { type: 'SET_RUNS'; runs: RunSummary[] }
  | { type: 'SELECT_RUN'; runId: string | null }
  | { type: 'SET_DIFF'; runId: string; stat: DiffStat; diff: string }
  | { type: 'SET_MERGE_CONFLICT'; runId: string; paths: string[] }
  | { type: 'CLEAR_MERGE_CONFLICT' }
  | { type: 'ADD_TOOL_CALL'; runId: string; toolCall: ToolCall }
  | { type: 'UPDATE_TOOL_RESULT'; runId: string; toolId: string; isError: boolean; resultPreview: string }
  | { type: 'SET_RUN_METRICS'; runId: string; metrics: RunMetrics }
  | { type: 'SET_PREFLIGHT_ERROR'; error: PreflightError | null }
  | { type: 'SET_STASHES'; stashes: StashEntry[] }
  | { type: 'SET_STASH_FILES'; stashIndex: number; files: FileChange[] }
  | { type: 'SET_STASH_DIFF'; stashIndex: number; diff: string; stat: DiffStat | null }
  | { type: 'SET_DIRTY_WARNING'; status: DirtyStatus; session_id: string; prompt: string; mode: RunMode }
  | { type: 'DISMISS_DIRTY_WARNING' }
  | { type: 'SET_DIRTY_STATE'; status: DirtyStatus }
  | { type: 'TOGGLE_STASH_DRAWER' }
  | { type: 'SET_SIDEBAR_VIEW'; view: WorkspaceStore['activeSidebarView'] }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_CHANGES_CONTEXT'; context: WorkspaceStore['changesContext'] }
  | { type: 'SET_CHANGED_FILES'; context: WorkspaceStore['changesContext']; files: FileChange[] }
  | { type: 'SET_REPO_STATUS'; status: RepoStatus }
  | { type: 'SET_COMMIT_HISTORY'; commits: CommitEntry[] }
  | { type: 'SET_DIRECTORY'; path: string; entries: FileTreeEntry[] }
  | { type: 'OPEN_DIFF'; file: string }
  | { type: 'CLOSE_DIFF' }
  | { type: 'SET_DIFF_CONTENT'; file: string; diff: string; stat: DiffStat | null }
  | { type: 'SET_DIFF_MODE'; mode: WorkspaceStore['diffPanel']['mode'] }
  | { type: 'SET_BRANCH_NAME'; name: string }
  | { type: 'SET_BRANCH_LIST'; branches: BranchInfo[]; current: string | null }
  | { type: 'SET_GIT_TOAST'; toast: GitToast | null }
  | { type: 'ADD_TERMINAL_SESSION'; session: TerminalSessionSummary }
  | { type: 'REMOVE_TERMINAL_SESSION'; sessionId: string }
  | { type: 'SET_TERMINAL_SESSIONS'; sessions: TerminalSessionSummary[] }
  | { type: 'SET_RESTORABLE_TERMINALS'; sessions: RestorableTerminalSession[] }
  | { type: 'SET_MERGE_CONFLICTS'; files: MergeConflictFile[] }
  | { type: 'REMOVE_CONFLICT'; filePath: string }
  | { type: 'CLEAR_RUN_METRICS' }
  | {
      type: 'SET_FILE_CONTENT';
      path: string;
      content: string;
      language: string;
      truncated: boolean;
      sizeBytes: number;
    }
  | { type: 'SET_FILE_ERROR'; path: string; error: string }
  | { type: 'SET_SEARCH_RESULTS'; result: SearchResult };

export function workspaceReducer(state: WorkspaceStore, action: WorkspaceAction): WorkspaceStore {
  switch (action.type) {
    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSession: action.sessionId };

    case 'SET_ACTIVE_RUN':
      return { ...state, activeRun: action.runId };

    case 'SET_RUN_STATE':
      return { ...state, runState: action.runState, pendingRunStartedAt: null };

    case 'START_PENDING_RUN':
      return { ...state, pendingRunStartedAt: action.startedAt, outputLines: [], runToolCalls: new Map(), runMetrics: null, preflightError: null };

    case 'CLEAR_PENDING_RUN':
      return { ...state, pendingRunStartedAt: null };

    case 'APPEND_OUTPUT': {
      const lines = [...state.outputLines, action.line];
      return {
        ...state,
        pendingRunStartedAt: null,
        outputLines: lines.length > MAX_OUTPUT_LINES ? lines.slice(-MAX_OUTPUT_LINES) : lines,
      };
    }

    case 'CLEAR_OUTPUT':
      return { ...state, outputLines: [] };

    case 'UPSERT_RUN': {
      const runs = new Map(state.runs);
      runs.set(action.run.id, action.run);
      return { ...state, runs };
    }

    case 'SET_RUNS': {
      const runs = new Map<string, RunSummary>();
      for (const r of action.runs) runs.set(r.id, r);
      return { ...state, runs };
    }

    case 'SELECT_RUN':
      return { ...state, selectedRun: action.runId };

    case 'SET_DIFF': {
      const diffCache = new Map(state.diffCache);
      diffCache.set(action.runId, { stat: action.stat, diff: action.diff });
      return { ...state, diffCache };
    }

    case 'SET_MERGE_CONFLICT':
      return { ...state, mergeConflict: { runId: action.runId, paths: action.paths } };

    case 'CLEAR_MERGE_CONFLICT':
      return { ...state, mergeConflict: null };

    case 'ADD_TOOL_CALL': {
      if (action.runId !== state.activeRun) return state;
      const runToolCalls = new Map(state.runToolCalls);
      runToolCalls.set(action.toolCall.tool_id, action.toolCall);
      return { ...state, pendingRunStartedAt: null, runToolCalls };
    }

    case 'UPDATE_TOOL_RESULT': {
      if (action.runId !== state.activeRun) return state;
      const existing = state.runToolCalls.get(action.toolId);
      if (!existing) return state;
      const runToolCalls = new Map(state.runToolCalls);
      runToolCalls.set(action.toolId, {
        ...existing,
        status: action.isError ? 'error' : 'ok',
        result_preview: action.resultPreview,
      });
      return { ...state, runToolCalls };
    }

    case 'SET_RUN_METRICS':
      if (action.runId !== state.activeRun) return state;
      return { ...state, runMetrics: action.metrics };

    case 'SET_PREFLIGHT_ERROR':
      return { ...state, preflightError: action.error };

    case 'SET_STASHES':
      return { ...state, stashes: action.stashes };

    case 'SET_STASH_FILES': {
      const stashFiles = new Map(state.stashFiles);
      stashFiles.set(action.stashIndex, action.files);
      return { ...state, stashFiles };
    }

    case 'SET_STASH_DIFF': {
      const stashDiffs = new Map(state.stashDiffs);
      stashDiffs.set(action.stashIndex.toString(), { diff: action.diff, stat: action.stat });
      return { ...state, stashDiffs };
    }

    case 'SET_DIRTY_WARNING':
      return {
        ...state,
        dirtyWarning: {
          status: action.status,
          session_id: action.session_id,
          prompt: action.prompt,
          mode: action.mode,
        },
      };

    case 'DISMISS_DIRTY_WARNING':
      return { ...state, dirtyWarning: null };

    case 'SET_DIRTY_STATE':
      return { ...state, dirtyState: action.status };

    case 'TOGGLE_STASH_DRAWER':
      return { ...state, stashDrawerOpen: !state.stashDrawerOpen };

    case 'SET_SIDEBAR_VIEW':
      return { ...state, activeSidebarView: action.view, sidebarCollapsed: false };

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case 'SET_CHANGES_CONTEXT':
      return { ...state, changesContext: action.context, changedFiles: null };

    case 'SET_CHANGED_FILES': {
      const ctx = state.changesContext;
      if (action.context.mode !== ctx.mode) return state;
      if (action.context.mode === 'run' && action.context.runId !== ctx.runId) return state;
      return { ...state, changedFiles: { context: action.context, files: action.files } };
    }

    case 'SET_REPO_STATUS':
      return { ...state, repoStatus: action.status };

    case 'SET_COMMIT_HISTORY':
      return { ...state, commitHistory: action.commits };

    case 'SET_DIRECTORY': {
      const explorerTree = new Map(state.explorerTree);
      explorerTree.set(action.path, action.entries);
      return { ...state, explorerTree };
    }

    case 'OPEN_DIFF':
      return { ...state, diffPanel: { ...state.diffPanel, open: true, file: action.file, diff: null, stat: null } };

    case 'CLOSE_DIFF':
      return { ...state, diffPanel: { ...state.diffPanel, open: false, file: null, diff: null, stat: null } };

    case 'SET_DIFF_CONTENT':
      if (action.file !== state.diffPanel.file) return state;
      return { ...state, diffPanel: { ...state.diffPanel, diff: action.diff, stat: action.stat } };

    case 'SET_DIFF_MODE':
      return { ...state, diffPanel: { ...state.diffPanel, mode: action.mode } };

    case 'SET_BRANCH_NAME':
      return {
        ...state,
        repoStatus: state.repoStatus ? { ...state.repoStatus, branch: action.name } : null,
        currentBranch: action.name,
      };

    case 'SET_BRANCH_LIST':
      return { ...state, branches: action.branches, currentBranch: action.current };

    case 'SET_GIT_TOAST':
      return { ...state, gitToast: action.toast };

    case 'ADD_TERMINAL_SESSION': {
      const terminalSessions = new Map(state.terminalSessions);
      terminalSessions.set(action.session.session_id, action.session);
      return { ...state, terminalSessions };
    }

    case 'REMOVE_TERMINAL_SESSION': {
      const terminalSessions = new Map(state.terminalSessions);
      terminalSessions.delete(action.sessionId);
      return { ...state, terminalSessions };
    }

    case 'SET_TERMINAL_SESSIONS': {
      const terminalSessions = new Map<string, TerminalSessionSummary>();
      for (const s of action.sessions) terminalSessions.set(s.session_id, s);
      return { ...state, terminalSessions };
    }

    case 'SET_RESTORABLE_TERMINALS':
      return { ...state, restorableTerminals: action.sessions };

    case 'SET_MERGE_CONFLICTS':
      return { ...state, mergeConflicts: action.files };

    case 'REMOVE_CONFLICT':
      return {
        ...state,
        mergeConflicts: state.mergeConflicts.filter((f) => f.path !== action.filePath),
      };

    case 'CLEAR_RUN_METRICS':
      return { ...state, runMetrics: null, runToolCalls: new Map() };

    case 'SET_FILE_CONTENT':
      return {
        ...state,
        fileViewer: {
          path: action.path,
          content: action.content,
          language: action.language,
          truncated: action.truncated,
          size_bytes: action.sizeBytes,
        },
      };

    case 'SET_FILE_ERROR':
      return { ...state, fileViewer: { path: action.path, error: action.error } };

    case 'SET_SEARCH_RESULTS':
      return { ...state, searchResult: action.result };

    default:
      return state;
  }
}
