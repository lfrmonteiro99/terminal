import { useCallback, useEffect, useState } from 'react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import { ResizeHandle } from './ResizeHandle';
import type { FileStatus } from '../types/protocol';

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

function getFileStatus(filePath: string, files: Array<{ path: string; status: FileStatus }>): FileStatus {
  const found = files.find(f => f.path === filePath);
  return found?.status ?? 'Modified';
}

interface DiffLineInfo {
  type: 'hunk' | 'added' | 'removed' | 'normal';
  text: string;
  oldNum: string;
  newNum: string;
}

function parseDiffLines(diff: string): DiffLineInfo[] {
  const rawLines = diff.split('\n');
  const result: DiffLineInfo[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'hunk', text: line, oldNum: '', newNum: '' });
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      // File header lines — treat as normal
      result.push({ type: 'normal', text: line, oldNum: '', newNum: '' });
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', text: line, oldNum: '', newNum: String(newLine) });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', text: line, oldNum: String(oldLine), newNum: '' });
      oldLine++;
    } else {
      const oNum = oldLine > 0 ? String(oldLine) : '';
      const nNum = newLine > 0 ? String(newLine) : '';
      result.push({ type: 'normal', text: line, oldNum: oNum, newNum: nNum });
      if (oldLine > 0) oldLine++;
      if (newLine > 0) newLine++;
    }
  }
  return result;
}

// --- Styles ---

const lineStyles: Record<DiffLineInfo['type'], React.CSSProperties> = {
  added: { backgroundColor: 'rgba(76, 175, 80, 0.08)', color: '#4caf50' },
  removed: { backgroundColor: 'rgba(255, 107, 107, 0.08)', color: '#ff6b6b' },
  hunk: { backgroundColor: 'rgba(78, 205, 196, 0.06)', color: '#4ecdc4' },
  normal: { backgroundColor: 'transparent', color: '#aaa' },
};

const lineNumberStyle: React.CSSProperties = {
  width: 40,
  textAlign: 'right',
  paddingRight: 12,
  color: '#444',
  fontSize: 10,
  userSelect: 'none',
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px',
  backgroundColor: '#16213e',
  borderBottom: '1px solid #333',
  minHeight: 32,
  flexShrink: 0,
};

const explainBtnStyle: React.CSSProperties = {
  backgroundColor: 'rgba(78, 205, 196, 0.12)',
  border: '1px solid rgba(78, 205, 196, 0.3)',
  borderRadius: 3,
  color: '#4ecdc4',
  fontSize: 10,
  fontFamily: 'monospace',
  padding: '2px 8px',
  cursor: 'pointer',
};

const explainBtnDisabledStyle: React.CSSProperties = {
  ...explainBtnStyle,
  opacity: 0.6,
  cursor: 'not-allowed',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#666',
  fontSize: 14,
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  fontFamily: 'monospace',
};

const splitContainerStyle: React.CSSProperties = {
  backgroundColor: '#0d1117',
  borderTop: '1px solid #333',
};

const overlayContainerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  width: '70%',
  height: '80%',
  backgroundColor: '#0d1117',
  border: '1px solid #444',
  borderRadius: 4,
  zIndex: 200,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
};

const overlayBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  zIndex: 199,
};

const inlineContainerStyle: React.CSSProperties = {
  backgroundColor: '#0d1117',
  borderTop: '1px solid #333',
  maxHeight: 320,
  display: 'flex',
  flexDirection: 'column',
};

const STORAGE_KEY = 'diff-panel-height';
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;

function getStoredHeight(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (n >= MIN_HEIGHT && n <= MAX_HEIGHT) return n;
  }
  return DEFAULT_HEIGHT;
}

// --- Component ---

interface DiffPanelProps {
  displayMode?: 'split' | 'overlay' | 'inline';
}

export function DiffPanel({ displayMode }: DiffPanelProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();
  const [height, setHeight] = useState(getStoredHeight);
  const [closeBtnHover, setCloseBtnHover] = useState(false);

  const mode = displayMode ?? state.diffPanel.mode;
  const { file, diff, stat } = state.diffPanel;

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_DIFF' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  // Resize handler for split mode
  const handleResize = useCallback((delta: number) => {
    setHeight(prev => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, prev - delta)));
  }, []);

  const handleResizeEnd = useCallback(() => {
    setHeight(current => {
      localStorage.setItem(STORAGE_KEY, current.toString());
      return current;
    });
  }, []);

  // Determine file status from changedFiles
  const fileStatus: FileStatus = (() => {
    if (!file || !state.changedFiles) return 'Modified';
    return getFileStatus(file, state.changedFiles.files);
  })();

  // Context origin label
  const contextLabel = state.changesContext.mode === 'working'
    ? 'Working Directory'
    : (() => {
        const run = state.changesContext.runId ? state.runs.get(state.changesContext.runId) : undefined;
        return run ? `Run: ${run.prompt_preview.slice(0, 30)}` : 'Run';
      })();

  // Explain button
  const canExplain = state.activeRun === null && state.activeSession !== null && diff !== null;
  const handleExplain = () => {
    if (!canExplain || !diff || !state.activeSession) return;
    send({
      type: 'StartRun',
      session_id: state.activeSession,
      prompt: `Explain the following code changes concisely. Focus on what changed, why it likely changed, and any risks.\n\n\`\`\`diff\n${diff}\n\`\`\``,
      mode: 'Free',
    });
  };

  // Mode dropdown
  const handleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_DIFF_MODE', mode: e.target.value as 'split' | 'overlay' | 'inline' });
  };

  // Close
  const handleClose = () => {
    dispatch({ type: 'CLOSE_DIFF' });
  };

  // Parse diff lines
  const diffLines = diff ? parseDiffLines(diff) : [];

  // Header
  const headerEl = (
    <div style={headerStyle}>
      <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>
        {contextLabel} &gt;
      </span>
      {file && (
        <>
          <span style={getStatusBadgeStyle(fileStatus)}>{getStatusChar(fileStatus)}</span>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e0e0e0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file}
          </span>
        </>
      )}
      {stat && (
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#666' }}>
          <span style={{ color: '#4caf50' }}>+{stat.insertions}</span>{' '}
          <span style={{ color: '#ff6b6b' }}>-{stat.deletions}</span>
        </span>
      )}
      <select
        value={state.diffPanel.mode}
        onChange={handleModeChange}
        style={{
          backgroundColor: '#0d1117',
          color: '#e0e0e0',
          border: '1px solid #333',
          borderRadius: 3,
          fontSize: 10,
          fontFamily: 'monospace',
          padding: '1px 4px',
          cursor: 'pointer',
        }}
      >
        <option value="split">Split</option>
        <option value="overlay">Overlay</option>
        <option value="inline">Inline</option>
      </select>
      <button
        style={canExplain ? explainBtnStyle : explainBtnDisabledStyle}
        onClick={handleExplain}
        disabled={!canExplain}
      >
        Explain
      </button>
      <button
        style={{ ...closeBtnStyle, color: closeBtnHover ? '#e0e0e0' : '#666' }}
        onClick={handleClose}
        onMouseEnter={() => setCloseBtnHover(true)}
        onMouseLeave={() => setCloseBtnHover(false)}
      >
        {'\u00D7'}
      </button>
    </div>
  );

  // Diff content
  const contentEl = (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {diff === null ? (
        <div style={{ padding: 16, color: '#666', fontSize: 12, fontFamily: 'monospace', textAlign: 'center' }}>
          Loading diff...
        </div>
      ) : diffLines.length === 0 ? (
        <div style={{ padding: 16, color: '#666', fontSize: 12, fontFamily: 'monospace', textAlign: 'center' }}>
          No changes
        </div>
      ) : (
        <pre style={{ margin: 0, padding: 0, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5 }}>
          {diffLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', ...lineStyles[line.type] }}>
              <span style={lineNumberStyle}>{line.oldNum}</span>
              <span style={lineNumberStyle}>{line.newNum}</span>
              <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 8 }}>{line.text}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );

  // Render based on mode
  if (mode === 'overlay') {
    return (
      <>
        <div style={overlayBackdropStyle} onClick={handleClose} />
        <div style={overlayContainerStyle}>
          {headerEl}
          {contentEl}
        </div>
      </>
    );
  }

  if (mode === 'inline') {
    return (
      <div style={inlineContainerStyle}>
        {headerEl}
        {contentEl}
      </div>
    );
  }

  // split mode
  return (
    <>
      <ResizeHandle direction="vertical" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      <div style={{ ...splitContainerStyle, height, display: 'flex', flexDirection: 'column' }}>
        {headerEl}
        {contentEl}
      </div>
    </>
  );
}
