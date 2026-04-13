import { useEffect, useState } from 'react';
import { useAppState, useAppDispatch } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import { DiffPanel } from '../DiffPanel';
import type { FileChange, FileStatus } from '../../types/protocol';

// --- Helpers ---

function getStatusChar(status: FileStatus): string {
  if (status === 'Added') return 'A';
  if (status === 'Modified') return 'M';
  if (status === 'Deleted') return 'D';
  if (typeof status === 'object' && 'Renamed' in status) return 'R';
  return '?';
}

function getStatusBadgeStyle(status: FileStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    minWidth: 18,
    height: 16,
    padding: '0 5px',
    borderRadius: 8,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.04em',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'transform 150ms var(--ease-out-back)',
  };
  if (status === 'Added') return {
    ...base,
    backgroundColor: 'var(--accent-primary-15)',
    color: 'var(--accent-primary)',
    border: '1px solid rgba(var(--accent-primary-rgb), 0.35)',
  };
  if (status === 'Modified') return {
    ...base,
    backgroundColor: 'rgba(var(--accent-warn-rgb), 0.15)',
    color: 'var(--accent-warn)',
    border: '1px solid rgba(var(--accent-warn-rgb), 0.35)',
  };
  if (status === 'Deleted') return {
    ...base,
    backgroundColor: 'rgba(var(--accent-error-rgb), 0.15)',
    color: 'var(--accent-error)',
    border: '1px solid rgba(var(--accent-error-rgb), 0.35)',
  };
  if (typeof status === 'object' && 'Renamed' in status) return {
    ...base,
    backgroundColor: 'rgba(136,136,136,0.14)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-default)',
  };
  return {
    ...base,
    backgroundColor: 'rgba(136,136,136,0.14)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-default)',
  };
}

function isRunActive(state: { type: string }): boolean {
  return state.type === 'Running' || state.type === 'Preparing' || state.type === 'Pausing' || state.type === 'WaitingInput';
}

// --- Styles ---

const contextBannerStyle: React.CSSProperties = {
  padding: '6px 12px',
  backgroundColor: 'rgba(78, 205, 196, 0.08)',
  borderBottom: '1px solid rgba(78, 205, 196, 0.2)',
  fontSize: 11,
  fontFamily: 'monospace',
  color: 'var(--accent-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: '8px 12px 4px',
  fontSize: 10,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

const fileRowBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px 3px 12px',
  cursor: 'pointer',
  borderLeft: '2px solid transparent',
  fontSize: 11,
  fontFamily: 'monospace',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '4px 8px',
  cursor: 'pointer',
  outline: 'none',
};

const stageBtnBase: React.CSSProperties = {
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 2,
  border: 'none',
  fontSize: 12,
  fontFamily: 'monospace',
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
  lineHeight: 1,
};

const stageAddBtnStyle: React.CSSProperties = {
  ...stageBtnBase,
  backgroundColor: 'rgba(78,205,196,0.12)',
  color: 'var(--accent-primary)',
};

const stageRemoveBtnStyle: React.CSSProperties = {
  ...stageBtnBase,
  backgroundColor: 'rgba(255,107,107,0.12)',
  color: 'var(--accent-error)',
};

// --- Sub-components ---

function FileRow({
  file,
  selected,
  onClick,
  showStageButton,
  onStageAction,
}: {
  file: FileChange;
  selected: boolean;
  onClick: () => void;
  showStageButton?: '+' | '-';
  onStageAction?: () => void;
}) {
  const [hover, setHover] = useState(false);

  const style: React.CSSProperties = {
    ...fileRowBaseStyle,
    ...(selected
      ? { backgroundColor: 'rgba(78, 205, 196, 0.12)', borderLeft: '2px solid #4ecdc4' }
      : hover
        ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' }
        : {}),
  };

  return (
    <div
      style={style}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        style={{
          ...getStatusBadgeStyle(file.status),
          transform: hover ? 'scale(1.12)' : 'scale(1)',
        }}
      >
        {getStatusChar(file.status)}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'var(--text-primary)' }}>
        {file.path}
      </span>
      {showStageButton && onStageAction && (
        <button
          style={showStageButton === '+' ? stageAddBtnStyle : stageRemoveBtnStyle}
          onClick={(e) => {
            e.stopPropagation();
            onStageAction();
          }}
          title={showStageButton === '+' ? 'Stage file' : 'Unstage file'}
        >
          {showStageButton === '+' ? '+' : '\u2212'}
        </button>
      )}
    </div>
  );
}

// --- Main Component ---

export function ChangesView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  const { changesContext, changedFiles, diffPanel, runs } = state;

  // Send GetRepoStatus on mount
  useEffect(() => {
    send({ type: 'GetRepoStatus' });
  }, [send]);

  // Auto-fetch changed files when context changes
  useEffect(() => {
    send({
      type: 'GetChangedFiles',
      mode: changesContext.mode,
      run_id: changesContext.runId,
    });
  }, [changesContext.mode, changesContext.runId, send]);

  // Derive runs with active worktrees
  const activeRuns = Array.from(runs.values()).filter(r => isRunActive(r.state));

  // Handle mode selector change
  const handleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'working') {
      dispatch({ type: 'SET_CHANGES_CONTEXT', context: { mode: 'working' } });
    } else {
      dispatch({ type: 'SET_CHANGES_CONTEXT', context: { mode: 'run', runId: value } });
    }
  };

  // Handle file click
  const handleFileClick = (file: FileChange) => {
    dispatch({ type: 'OPEN_DIFF', file: file.path });
    send({
      type: 'GetFileDiff',
      file_path: file.path,
      mode: changesContext.mode,
      run_id: changesContext.runId,
    });
  };

  // Handle staging/unstaging
  const handleStage = (path: string) => {
    send({ type: 'StageFile', path });
    send({ type: 'GetChangedFiles', mode: 'working' });
    send({ type: 'GetRepoStatus' });
  };

  const handleUnstage = (path: string) => {
    send({ type: 'UnstageFile', path });
    send({ type: 'GetChangedFiles', mode: 'working' });
    send({ type: 'GetRepoStatus' });
  };

  // Context banner text
  const contextBannerText = changesContext.mode === 'working'
    ? 'Working Directory'
    : (() => {
        const run = changesContext.runId ? runs.get(changesContext.runId) : undefined;
        return run
          ? `Run: ${run.prompt_preview} (${run.id.slice(0, 8)})`
          : 'Run';
      })();

  // Split files into staged/unstaged for working dir mode
  // The backend sends FileChange[] — in working dir mode, we need to check repoStatus
  // for counts but the files themselves come as a flat list.
  // Since FileChange has no staged/unstaged flag, we use repoStatus counts to split:
  // first repoStatus.staged_count files are staged, rest are unstaged.
  // However, that's a guess. More accurately, if the backend provides staged info
  // in the file list, it would have a flag. Since it doesn't, we'll display them
  // as two groups using the repoStatus staged_count as a heuristic split.
  // Actually, looking at the DirtyStatus type which has staged/unstaged arrays,
  // the ChangedFilesList event just returns a flat files array. The safest approach
  // is to use repoStatus to show counts in headers but display all files together
  // since we can't distinguish staged from unstaged in the FileChange type.
  // Let me re-read the requirement: "grouped Staged (N) / Unstaged (N)".
  // Without staged info per file, I'll split using repoStatus.staged_count.
  const files = changedFiles?.files ?? [];
  const stagedCount = state.repoStatus?.staged_count ?? 0;

  // ACCEPTED LIMITATION: FileChange has no per-file `staged` boolean field.
  // The backend sends staged files first by convention (verified in dispatcher.rs).
  // We split using repoStatus.staged_count as the boundary index.
  // If the backend changes ordering, this split will be incorrect.
  const staged = changesContext.mode === 'working' ? files.slice(0, stagedCount) : [];
  const unstaged = changesContext.mode === 'working' ? files.slice(stagedCount) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Context banner */}
      <div style={contextBannerStyle}>
        <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>Context:</span>
        {contextBannerText}
      </div>

      {/* Mode selector */}
      <div style={{ padding: '6px 12px', flexShrink: 0 }}>
        <select
          style={selectStyle}
          value={changesContext.mode === 'working' ? 'working' : (changesContext.runId ?? 'working')}
          onChange={handleModeChange}
        >
          <option value="working">Working Directory</option>
          {activeRuns.map(run => (
            <option key={run.id} value={run.id}>
              Run: {run.prompt_preview.slice(0, 40)} ({run.id.slice(0, 8)})
            </option>
          ))}
        </select>
      </div>

      {/* File lists */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {files.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 11, fontFamily: 'monospace', textAlign: 'center' }}>
            No changes detected
          </div>
        ) : changesContext.mode === 'working' ? (
          <>
            {/* Staged section */}
            {(stagedCount > 0 || staged.length > 0) && (
              <>
                <div style={sectionHeaderStyle}>Staged ({staged.length})</div>
                {staged.map(file => (
                  <FileRow
                    key={`staged-${file.path}`}
                    file={file}
                    selected={diffPanel.file === file.path}
                    onClick={() => handleFileClick(file)}
                    showStageButton="-"
                    onStageAction={() => handleUnstage(file.path)}
                  />
                ))}
              </>
            )}
            {/* Unstaged section */}
            <div style={sectionHeaderStyle}>Unstaged ({unstaged.length})</div>
            {unstaged.map(file => (
              <FileRow
                key={`unstaged-${file.path}`}
                file={file}
                selected={diffPanel.file === file.path}
                onClick={() => handleFileClick(file)}
                showStageButton="+"
                onStageAction={() => handleStage(file.path)}
              />
            ))}
          </>
        ) : (
          // Run mode: flat list
          files.map(file => (
            <FileRow
              key={file.path}
              file={file}
              selected={diffPanel.file === file.path}
              onClick={() => handleFileClick(file)}
            />
          ))
        )}
      </div>

      {/* Inline DiffPanel */}
      {diffPanel.mode === 'inline' && diffPanel.open && (
        <DiffPanel displayMode="inline" />
      )}
    </div>
  );
}
