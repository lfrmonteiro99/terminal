import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirtyStatus, DirtyFile, FileStatus } from '../types/protocol.ts';

interface DirtyWarningModalProps {
  status: DirtyStatus;
  onStashAndRun: () => void;
  onRunAnyway: () => void;
  onCancel: () => void;
}

function getStatusChar(status: FileStatus): string {
  if (status === 'Modified') return 'M';
  if (status === 'Added') return 'A';
  if (status === 'Deleted') return 'D';
  if (typeof status === 'object' && 'Renamed' in status) return 'R';
  return '?';
}

function getStatusColor(status: FileStatus): string {
  if (status === 'Modified') return 'var(--accent-warn)';
  if (status === 'Added') return '#4caf50';
  if (status === 'Deleted') return 'var(--accent-error)';
  if (typeof status === 'object' && 'Renamed' in status) return 'var(--accent-warn)';
  return 'var(--text-muted)';
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  width: 480,
  maxHeight: '70vh',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  fontFamily: 'monospace',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 'bold',
  color: 'var(--text-primary)',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'monospace',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  color: 'var(--text-muted)',
  marginBottom: 16,
  lineHeight: 1.5,
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  color: 'var(--text-muted)',
  letterSpacing: '0.5px',
  cursor: 'pointer',
  userSelect: 'none',
  padding: '6px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'monospace',
};

const fileListStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-base)',
  maxHeight: 120,
  overflowY: 'auto',
  borderRadius: 4,
  marginBottom: 8,
};

const fileRowStyle: React.CSSProperties = {
  height: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  color: 'var(--text-primary)',
};

const badgeStyle = (color: string): React.CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: 2,
  backgroundColor: `${color}33`,
  color,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'monospace',
  flexShrink: 0,
});

const separatorStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border-default)',
  marginBottom: 16,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  justifyContent: 'flex-end',
};

const primaryButtonStyle: React.CSSProperties = {
  backgroundColor: 'var(--accent-primary)',
  color: 'var(--bg-base)',
  fontWeight: 'bold',
  padding: '10px 20px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 13,
};

const secondaryButtonStyle: React.CSSProperties = {
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--text-muted)',
  padding: '10px 20px',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 13,
};

const ghostButtonStyle: React.CSSProperties = {
  backgroundColor: 'transparent',
  color: 'var(--text-muted)',
  border: 'none',
  padding: '10px 20px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 13,
};

function FileSection({ label, files }: { label: string; files: DirtyFile[] }) {
  const [expanded, setExpanded] = useState(true);

  if (files.length === 0) return null;

  return (
    <div>
      <div style={sectionHeaderStyle} onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '\u25BC' : '\u25B6'}</span>
        <span>{label} ({files.length})</span>
      </div>
      {expanded && (
        <div style={fileListStyle}>
          {files.map((file, i) => {
            const ch = getStatusChar(file.status);
            const color = getStatusColor(file.status);
            return (
              <div key={i} style={fileRowStyle}>
                <span style={badgeStyle(color)}>{ch}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.path}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DirtyWarningModal({ status, onStashAndRun, onRunAnyway, onCancel }: DirtyWarningModalProps) {
  const stashBtnRef = useRef<HTMLButtonElement>(null);
  const runAnywayBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Escape key triggers cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // Focus trap
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    const focusable = [stashBtnRef.current, runAnywayBtnRef.current, cancelBtnRef.current].filter(
      (el): el is HTMLButtonElement => el !== null,
    );
    if (focusable.length === 0) return;

    const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);

    if (e.shiftKey) {
      const nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
      focusable[nextIndex].focus();
    } else {
      const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
      focusable[nextIndex].focus();
    }
    e.preventDefault();
  }, []);

  // Auto-focus primary button on mount
  useEffect(() => {
    stashBtnRef.current?.focus();
  }, []);

  return (
    <div style={overlayStyle} onKeyDown={handleKeyDown}>
      <div style={modalStyle}>
        {/* Title */}
        <div style={titleStyle}>
          <span style={{ color: 'var(--accent-warn)', fontSize: 18 }}>{'\u26A0'}</span>
          <span>Uncommitted Changes Detected</span>
        </div>

        {/* Description */}
        <div style={descriptionStyle}>
          The AI will work in an isolated worktree created from HEAD. These uncommitted changes will{' '}
          <span style={{ color: 'var(--accent-error)', fontWeight: 'bold' }}>NOT</span>{' '}
          be visible to the LLM.
        </div>

        {/* File sections */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
          <FileSection label="STAGED" files={status.staged} />
          <FileSection label="UNSTAGED" files={status.unstaged} />
        </div>

        {/* Separator */}
        <div style={separatorStyle} />

        {/* Buttons */}
        <div style={buttonRowStyle}>
          <button
            ref={cancelBtnRef}
            onClick={onCancel}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            style={ghostButtonStyle}
          >
            Cancel
          </button>
          <button
            ref={runAnywayBtnRef}
            onClick={onRunAnyway}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--text-muted)')}
            style={secondaryButtonStyle}
          >
            Run Anyway
          </button>
          <button
            ref={stashBtnRef}
            onClick={onStashAndRun}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            style={primaryButtonStyle}
          >
            Stash & Run
          </button>
        </div>
      </div>
    </div>
  );
}
