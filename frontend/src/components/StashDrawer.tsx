import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '../context/AppContext.tsx';
import type { FileChange, FileStatus, StashEntry } from '../types/protocol.ts';

interface StashDrawerProps {
  onClose: () => void;
  onFetchStashes: () => void;
  onFetchFiles: (index: number) => void;
  onFetchDiff: (index: number, filePath: string | null) => void;
}

// --- Helpers ---

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function getStatusChar(status: FileStatus): string {
  if (status === 'Modified') return 'M';
  if (status === 'Added') return 'A';
  if (status === 'Deleted') return 'D';
  if (typeof status === 'object' && 'Renamed' in status) return 'R';
  return '?';
}

function getStatusColor(status: FileStatus): string {
  if (status === 'Modified') return '#f0a500';
  if (status === 'Added') return '#4caf50';
  if (status === 'Deleted') return '#ff6b6b';
  if (typeof status === 'object' && 'Renamed' in status) return '#f0a500';
  return '#666666';
}

// --- Styles ---

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  zIndex: 500,
};

const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'calc(60vw)',
  minWidth: 700,
  maxWidth: 1100,
  backgroundColor: '#1a1a1a',
  borderLeft: '1px solid #333',
  zIndex: 501,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'monospace',
};

const drawerHeaderStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  backgroundColor: 'transparent',
  border: 'none',
  color: '#888',
  fontSize: 18,
  cursor: 'pointer',
  padding: '4px 8px',
  fontFamily: 'monospace',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
};

const leftColumnStyle: React.CSSProperties = {
  width: 240,
  flexShrink: 0,
  borderRight: '1px solid #333',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const leftHeaderStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  color: '#888',
  letterSpacing: 1,
  flexShrink: 0,
  fontFamily: 'monospace',
};

const leftScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '4px 8px',
};

const rightColumnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const stashCardStyle = (selected: boolean): React.CSSProperties => ({
  minHeight: 72,
  padding: 12,
  backgroundColor: selected ? '#16213e' : '#0a0a0a',
  borderLeft: selected ? '3px solid #4ecdc4' : '3px solid transparent',
  borderRadius: 4,
  marginBottom: 4,
  cursor: 'pointer',
});

const fileRowStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  fontSize: 12,
  fontFamily: 'monospace',
  color: '#e0e0e0',
  cursor: 'pointer',
  backgroundColor: selected ? '#16213e' : 'transparent',
  height: 28,
});

const statusBadgeStyle = (color: string): React.CSSProperties => ({
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

// --- Sub-components ---

function StashCard({
  stash,
  selected,
  fileCount,
  onClick,
}: {
  stash: StashEntry;
  selected: boolean;
  fileCount: number | null;
  onClick: () => void;
}) {
  return (
    <div style={stashCardStyle(selected)} onClick={onClick}>
      <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', marginBottom: 4 }}>
        stash@{'{' + stash.index + '}'}
      </div>
      <div style={{
        fontSize: 13,
        fontFamily: 'monospace',
        color: '#e0e0e0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginBottom: 4,
      }}>
        {stash.message || '(no message)'}
      </div>
      <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', marginBottom: 2 }}>
        {stash.branch ?? 'detached'}{fileCount !== null ? ` \u00B7 ${fileCount} files` : ''}
      </div>
      <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
        {relativeTime(stash.date)}
      </div>
    </div>
  );
}

function FileListRow({
  file,
  selected,
  onClick,
}: {
  file: FileChange;
  selected: boolean;
  onClick: () => void;
}) {
  const ch = getStatusChar(file.status);
  const color = getStatusColor(file.status);

  return (
    <div style={fileRowStyle(selected)} onClick={onClick}>
      <span style={statusBadgeStyle(color)}>{ch}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {file.path}
      </span>
    </div>
  );
}

function DiffView({ diff }: { diff: string | null }) {
  if (!diff) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
        fontSize: 12,
        fontFamily: 'monospace',
      }}>
        Select a stash to view its diff.
      </div>
    );
  }

  const lines = diff.split('\n');

  return (
    <pre style={{
      flex: 1,
      margin: 0,
      padding: 12,
      fontSize: 12,
      fontFamily: 'monospace',
      lineHeight: 1.5,
      overflow: 'auto',
      whiteSpace: 'pre',
    }}>
      {lines.map((line, i) => {
        let color = '#aaaaaa';
        let bg = 'transparent';
        if (line.startsWith('@@')) {
          color = '#4ecdc4';
        } else if (line.startsWith('+')) {
          color = '#4caf50';
          bg = 'rgba(76,175,80,0.08)';
        } else if (line.startsWith('-')) {
          color = '#ff6b6b';
          bg = 'rgba(255,107,107,0.08)';
        }
        return (
          <div key={i} style={{ color, backgroundColor: bg }}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

function EmptyState() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    }}>
      <div style={{ color: '#888', fontSize: 13, fontFamily: 'monospace' }}>
        No stashes found
      </div>
      <div style={{ color: '#666', fontSize: 11, fontFamily: 'monospace' }}>
        Use{' '}
        <span style={{
          backgroundColor: '#0a0a0a',
          color: '#4ecdc4',
          padding: '2px 6px',
          borderRadius: 2,
          fontFamily: 'monospace',
        }}>
          git stash
        </span>{' '}
        to save work in progress.
      </div>
    </div>
  );
}

// --- Main Component ---

export function StashDrawer({ onClose, onFetchStashes, onFetchFiles, onFetchDiff }: StashDrawerProps) {
  const state = useAppState();
  const [selectedStash, setSelectedStash] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Fetch stashes on mount
  useEffect(() => {
    onFetchStashes();
  }, [onFetchStashes]);

  // Escape key closes drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelectStash = useCallback(
    (index: number) => {
      setSelectedStash(index);
      setSelectedFile(null);
      if (!state.stashFiles.has(index)) {
        onFetchFiles(index);
      }
      onFetchDiff(index, null);
    },
    [state.stashFiles, onFetchFiles, onFetchDiff],
  );

  const handleSelectFile = useCallback(
    (filePath: string) => {
      if (selectedStash === null) return;
      setSelectedFile(filePath);
      onFetchDiff(selectedStash, filePath);
    },
    [selectedStash, onFetchDiff],
  );

  const files = selectedStash !== null ? state.stashFiles.get(selectedStash) : undefined;
  const selectedStashObj = state.stashes.find((s) => s.index === selectedStash);
  const diffKey = selectedStash !== null ? `${selectedStash}:full` : null;
  const cachedDiff = diffKey !== null ? state.stashDiffs.get(diffKey) : undefined;

  return (
    <>
      {/* Backdrop */}
      <div style={backdropStyle} onClick={onClose} />

      {/* Drawer */}
      <div style={drawerStyle}>
        {/* Header */}
        <div style={drawerHeaderStyle}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', color: '#888', letterSpacing: 1, fontFamily: 'monospace' }}>
            STASH VIEWER
          </span>
          <button style={closeBtnStyle} onClick={onClose}>{'\u00D7'}</button>
        </div>

        {state.stashes.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={bodyStyle}>
            {/* Left column: stash list */}
            <div style={leftColumnStyle}>
              <div style={leftHeaderStyle}>
                STASHES ({state.stashes.length})
              </div>
              <div style={leftScrollStyle}>
                {state.stashes.map((stash) => (
                  <StashCard
                    key={stash.index}
                    stash={stash}
                    selected={stash.index === selectedStash}
                    fileCount={state.stashFiles.get(stash.index)?.length ?? null}
                    onClick={() => handleSelectStash(stash.index)}
                  />
                ))}
              </div>
            </div>

            {/* Right column: file list + diff */}
            <div style={rightColumnStyle}>
              {selectedStashObj ? (
                <>
                  {/* Stash info header */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', flexShrink: 0, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                    {selectedStashObj.message}{' \u00B7 '}
                    {selectedStashObj.branch ?? 'detached'}{' \u00B7 '}
                    {files ? `${files.length} file${files.length !== 1 ? 's' : ''}` : '...'}
                  </div>

                  {/* File list */}
                  <div style={{ maxHeight: 180, overflowY: 'auto', borderBottom: '1px solid #333', flexShrink: 0 }}>
                    {files ? files.map((file) => (
                      <FileListRow
                        key={file.path}
                        file={file}
                        selected={file.path === selectedFile}
                        onClick={() => handleSelectFile(file.path)}
                      />
                    )) : (
                      <div style={{ padding: '8px 12px', color: '#666', fontSize: 12, fontFamily: 'monospace' }}>
                        Loading files...
                      </div>
                    )}
                  </div>

                  {/* Diff view */}
                  <DiffView diff={cachedDiff?.diff ?? null} />

                  {/* Future action buttons placeholder */}
                  {/* <div style={{ padding: '8px 12px', borderTop: '1px solid #333', display: 'flex', gap: 8 }}>
                    <button>Apply</button>
                    <button>Pop</button>
                    <button>Drop</button>
                  </div> */}
                </>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ color: '#666', fontSize: 12, fontFamily: 'monospace' }}>
                    Select a stash to view details.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
