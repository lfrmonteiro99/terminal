import { useEffect, useState, useCallback } from 'react';
import { useAppState } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import { FileTreeNode } from './FileTreeNode';

// --- Styles ---

const headerLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const projectNameStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--accent-primary)',
  fontWeight: 'bold',
};

// --- Component ---

export function ExplorerView() {
  const state = useAppState();
  const send = useSend();

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Fetch root directory on mount
  useEffect(() => {
    send({ type: 'ListDirectory', path: '.' });
  }, [send]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  // Derive project folder name from active session
  const activeSession = state.activeSession ? state.sessions.get(state.activeSession) : undefined;
  const projectName = activeSession
    ? activeSession.project_root.split('/').pop() || activeSession.project_root
    : 'No project';

  const rootEntries = state.explorerTree.get('.');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px 4px', flexShrink: 0 }}>
        <div style={headerLabelStyle}>EXPLORER</div>
        <div style={projectNameStyle}>{projectName}</div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {rootEntries === undefined ? (
          <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'monospace' }}>
            Loading...
          </div>
        ) : rootEntries.length === 0 ? (
          <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'monospace', fontStyle: 'italic' }}>
            (empty)
          </div>
        ) : (
          rootEntries.map(entry => (
            <FileTreeNode
              key={entry.name}
              entry={entry}
              depth={0}
              fullPath={entry.name}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              selectedFile={selectedFile}
              onSelectFile={handleSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
