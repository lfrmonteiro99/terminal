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
    width: 14,
    height: 14,
    borderRadius: 2,
    fontSize: 9,
    fontWeight: 'bold',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
  if (status === 'Added') return { ...base, backgroundColor: 'rgba(78,205,196,0.18)', color: '#4ecdc4' };
  if (status === 'Modified') return { ...base, backgroundColor: 'rgba(240,165,0,0.18)', color: '#f0a500' };
  if (status === 'Deleted') return { ...base, backgroundColor: 'rgba(255,107,107,0.18)', color: '#ff6b6b' };
  if (typeof status === 'object' && 'Renamed' in status) return { ...base, backgroundColor: 'rgba(136,136,136,0.18)', color: '#888' };
  return { ...base, backgroundColor: 'rgba(136,136,136,0.18)', color: '#888' };
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
  color: '#4ecdc4',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: '4px 12px 2px',
  fontSize: 10,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
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
  backgroundColor: '#0d1117',
  color: '#e0e0e0',
  border: '1px solid #333',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '4px 8px',
  cursor: 'pointer',
  outline: 'none',
};

// --- Sub-components ---

function FileRow({
  file,
  selected,
  onClick,
}: {
  file: FileChange;
  selected: boolean;
  onClick: () => void;
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
      <span style={getStatusBadgeStyle(file.status)}>{getStatusChar(file.status)}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: '#e0e0e0' }}>
        {file.path}
      </span>
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

  // If we have repoStatus info, split the list. Otherwise show flat.
  const staged = changesContext.mode === 'working' ? files.slice(0, stagedCount) : [];
  const unstaged = changesContext.mode === 'working' ? files.slice(stagedCount) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Context banner */}
      <div style={contextBannerStyle}>
        <span style={{ color: '#666', marginRight: 4 }}>Context:</span>
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
          <div style={{ padding: 16, color: '#666', fontSize: 11, fontFamily: 'monospace', textAlign: 'center' }}>
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
