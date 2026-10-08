import { useEffect, useState, useCallback } from 'react';
import { useAppState } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import { FileTreeNode } from './FileTreeNode';

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

  const rootEntries = state.explorerTree.get('.');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* The page title lives in the top bar — no duplicate panel header here. */}

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 6 }}>
        {rootEntries === undefined ? (
          <div style={{ padding: '8px 14px', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
            Loading…
          </div>
        ) : rootEntries.length === 0 ? (
          <div style={{ padding: '8px 14px', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontStyle: 'italic' }}>
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
