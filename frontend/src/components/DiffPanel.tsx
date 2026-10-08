import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import { ResizeHandle } from './ResizeHandle';
import type { FileStatus } from '../types/protocol';
import { parseDiffLines, type DiffLineType } from '../core/diff/parse';
import { toSideBySide, type SbCell, type SbRow } from '../core/diff/sideBySide';
import { useIsMobile } from '../hooks/useMediaQuery';

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
  if (status === 'Added') return { ...base, backgroundColor: 'var(--accent-primary-15)', color: 'var(--accent-primary)' };
    if (status === 'Modified') return { ...base, backgroundColor: 'rgba(var(--accent-warn-rgb), 0.18)', color: 'var(--accent-warn)' };
    if (status === 'Deleted') return { ...base, backgroundColor: 'rgba(var(--accent-error-rgb), 0.18)', color: 'var(--accent-error)' };
    if (typeof status === 'object' && 'Renamed' in status) return { ...base, backgroundColor: 'var(--tint-active)', color: 'var(--text-muted)' };
    return { ...base, backgroundColor: 'var(--tint-active)', color: 'var(--text-muted)' };
  }

function getFileStatus(filePath: string, files: Array<{ path: string; status: FileStatus }>): FileStatus {
  const found = files.find(f => f.path === filePath);
  return found?.status ?? 'Modified';
}

// --- Styles ---

// Convention colours come from the token layer, not literals: a diff has to
// follow the appearance (the dark greens/reds are unreadable on white) and stay
// visually distinct from the user-chosen accent.
const lineStyles: Record<DiffLineType, React.CSSProperties> = {
  added: { backgroundColor: 'var(--diff-add-bg)', color: 'var(--diff-add)' },
  removed: { backgroundColor: 'var(--diff-del-bg)', color: 'var(--diff-del)' },
  hunk: { backgroundColor: 'var(--accent-primary-08)', color: 'var(--accent-primary)' },
  normal: { backgroundColor: 'transparent', color: 'var(--text-secondary)' },
  meta: { backgroundColor: 'transparent', color: 'var(--text-muted)' },
};

const lineNumberStyle: React.CSSProperties = {
  width: 40,
  textAlign: 'right',
  paddingRight: 12,
  color: 'var(--border-default)',
  fontSize: 10,
  userSelect: 'none',
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px',
  backgroundColor: 'var(--bg-surface)',
  borderBottom: '1px solid var(--border-default)',
  minHeight: 32,
  flexShrink: 0,
};

const explainBtnStyle: React.CSSProperties = {
  backgroundColor: 'var(--accent-primary-15)',
  border: '1px solid var(--accent-border)',
  borderRadius: 3,
  color: 'var(--accent-primary)',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
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
  color: 'var(--text-muted)',
  fontSize: 14,
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  fontFamily: 'monospace',
};

const splitContainerStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-base)',
  borderTop: '1px solid var(--border-default)',
};

const overlayContainerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  width: '70%',
  height: '80%',
  backgroundColor: 'var(--bg-base)',
  border: '1px solid var(--border-default)',
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
  backgroundColor: 'var(--bg-base)',
  borderTop: '1px solid var(--border-default)',
  maxHeight: 320,
  display: 'flex',
  flexDirection: 'column',
};

const STORAGE_KEY = 'diff-panel-height';
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;

/** Unified vs side-by-side is a reading preference, so it persists. */
const VIEW_KEY = 'diff-view';
type DiffView = 'unified' | 'side';

function getStoredView(): DiffView {
  return localStorage.getItem(VIEW_KEY) === 'side' ? 'side' : 'unified';
}

// --- Side-by-side rendering ---

const sbTextStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: 'pre',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Divider between the two columns. Narrow and shrink-proof: the columns take
 *  the remaining space with `flex: 1`, so a percentage here would overflow. */
const sbGutterStyle: React.CSSProperties = {
  width: 1,
  flexShrink: 0,
  backgroundColor: 'var(--border-default)',
};

/**
 * Two aligned columns. Blank cells are drawn (not skipped) so the reader can
 * see that a change has no counterpart on one side — that alignment is the
 * whole point of the view.
 */
function SideBySideBody({ rows }: { rows: SbRow[] }) {
  const half: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex' };
  const changedStyle = (removed: boolean): React.CSSProperties => ({
    backgroundColor: removed ? 'var(--diff-del-bg)' : 'var(--diff-add-bg)',
    color: removed ? 'var(--diff-del)' : 'var(--diff-add)',
  });

  const side = (cell: SbCell | null, changed: boolean, removed: boolean) => (
    <div style={{ ...half, ...(changed ? changedStyle(removed) : { color: 'var(--text-secondary)' }) }}>
      <span style={lineNumberStyle}>{cell?.num ?? ''}</span>
      <span style={sbTextStyle}>{cell?.text ?? ''}</span>
    </div>
  );

  return (
    <pre style={{ margin: 0, padding: 0, fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
      {rows.map((row, i) => {
        if (row.kind === 'full') {
          return (
            <div key={i} style={{ ...lineStyles[row.type], display: 'flex', paddingLeft: 8 }}>
              {row.text}
            </div>
          );
        }

        // A blank cell means "no counterpart", which is different from an empty
        // line — hence null rather than '' all the way from the parser.
        const leftChanged = row.kind === 'change' && row.left !== null;
        const rightChanged = row.kind === 'change' && row.right !== null;

        return (
          <div key={i} style={{ display: 'flex' }}>
            {side(row.left, leftChanged, true)}
            <div style={sbGutterStyle} />
            {side(row.right, rightChanged, false)}
          </div>
        );
      })}
    </pre>
  );
}

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
    const [view, setViewState] = useState<DiffView>(getStoredView);
  // Two columns of ~640px do not fit a phone, and a horizontally scrolling
  // code viewer is worse than a unified one. The stored preference is kept
  // untouched, so the choice comes back on a wider screen.
  const isMobile = useIsMobile();
  const effectiveView: DiffView = isMobile ? 'unified' : view;

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

    // Parse diff lines once; the side-by-side pairing is derived from them.
    const diffLines = useMemo(() => (diff ? parseDiffLines(diff) : []), [diff]);
    const sbRows = useMemo(
    () => (effectiveView === 'side' ? toSideBySide(diffLines) : []),
    [effectiveView, diffLines],
  );

    const setView = (next: DiffView) => {
      setViewState(next);
      localStorage.setItem(VIEW_KEY, next);
    };

  // Header
  const headerEl = (
    <div style={headerStyle}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {contextLabel} &gt;
      </span>
      {file && (
        <>
          <span style={getStatusBadgeStyle(fileStatus)}>{getStatusChar(fileStatus)}</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file}
          </span>
        </>
      )}
      {stat && (
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--diff-add)' }}>+{stat.insertions}</span>{' '}
          <span style={{ color: 'var(--diff-del)' }}>-{stat.deletions}</span>
        </span>
      )}

      {/* Reading view. Hidden on a phone — the effective view is unified there.
          Distinct from the Split/Overlay/Inline select, which is about *where*
          the diff renders, not how it reads. */}
      {!isMobile && (
        <div role="group" aria-label="Diff view" style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 3, overflow: 'hidden' }}>
          {(['unified', 'side'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              title={v === 'unified' ? 'Unified diff' : 'Side by side'}
              style={{
                border: 'none',
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 10,
                fontFamily: 'var(--font-display)',
                fontWeight: view === v ? 600 : 500,
                backgroundColor: view === v ? 'var(--accent-primary-15)' : 'transparent',
                color: view === v ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              {v === 'unified' ? 'Unified' : 'Side by side'}
            </button>
          ))}
        </div>
      )}

      <select
        value={state.diffPanel.mode}
        onChange={handleModeChange}
        title="Where the diff renders"
        style={{
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: 3,
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
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
        style={{ ...closeBtnStyle, color: closeBtnHover ? 'var(--text-primary)' : 'var(--text-muted)' }}
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
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
          Loading diff...
        </div>
      ) : diffLines.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
          No changes
        </div>
      ) : effectiveView === 'side' ? (
        <SideBySideBody rows={sbRows} />
      ) : (
        <pre style={{ margin: 0, padding: 0, fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
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
