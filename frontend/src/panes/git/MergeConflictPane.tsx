// MergeConflictPane — 3-way merge conflict resolution (M5-05)

import { useState } from 'react';
import { useSend } from '../../context/SendContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';
import type { MergeConflictFile } from '../../types/protocol';

export function MergeConflictPane({ pane: _pane }: PaneProps) {
  const send = useSend();
  const [files, setFiles] = useState<MergeConflictFile[]>([]);
  const [selected, setSelected] = useState<MergeConflictFile | null>(null);

  const resolve = (filePath: string, side: 'ours' | 'theirs') => {
    send({
      type: 'ResolveConflict',
      file_path: filePath,
      resolution: side === 'ours' ? { type: 'TakeOurs' } : { type: 'TakeTheirs' },
    });
    setFiles((prev) => prev.filter((f) => f.path !== filePath));
    if (selected?.path === filePath) setSelected(null);
  };

  const loadConflicts = () => send({ type: 'GetMergeConflicts' });

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', backgroundColor: '#16213e', color: '#e0e0e0' }}>
      {/* File list */}
      <div style={{ width: 200, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 12, color: '#888', display: 'flex', alignItems: 'center' }}>
          <span>Conflicts</span>
          <button onClick={loadConflicts} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #444', color: '#888', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>
            Load
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {files.map((f) => (
            <div
              key={typeof f.path === 'string' ? f.path : String(f.path)}
              onClick={() => setSelected(f)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'monospace',
                backgroundColor: selected?.path === f.path ? '#1e2a3e' : 'transparent',
                borderLeft: selected?.path === f.path ? '2px solid #4ecdc4' : '2px solid transparent',
              }}
            >
              {typeof f.path === 'string' ? f.path.split('/').pop() : String(f.path)}
            </div>
          ))}
          {files.length === 0 && (
            <div style={{ padding: '12px', color: '#555', fontSize: 11 }}>No conflicts loaded</div>
          )}
        </div>
      </div>

      {/* Conflict viewer */}
      {selected ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#888' }}>{typeof selected.path === 'string' ? selected.path : String(selected.path)}</span>
            <button onClick={() => resolve(typeof selected.path === 'string' ? selected.path : String(selected.path), 'ours')} style={{ marginLeft: 'auto', backgroundColor: '#4ecdc4', color: '#1a1a2e', border: 'none', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>
              Take Ours
            </button>
            <button onClick={() => resolve(typeof selected.path === 'string' ? selected.path : String(selected.path), 'theirs')} style={{ backgroundColor: '#f0a500', color: '#1a1a2e', border: 'none', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>
              Take Theirs
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <ConflictSide label="Ours (Current)" content={selected.ours} color="#4ecdc4" />
            <div style={{ width: 1, backgroundColor: '#333' }} />
            <ConflictSide label="Theirs (Incoming)" content={selected.theirs} color="#f0a500" />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
          Select a conflict file
        </div>
      )}
    </div>
  );
}

function ConflictSide({ label, content, color }: { label: string; content: string; color: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '4px 8px', backgroundColor: '#1a1a2e', borderBottom: '1px solid #333', fontSize: 11, color, fontWeight: 'bold' }}>
        {label}
      </div>
      <pre style={{ flex: 1, overflow: 'auto', margin: 0, padding: '8px', fontSize: 12, fontFamily: 'monospace', color: '#e0e0e0', backgroundColor: '#16213e' }}>
        {content}
      </pre>
    </div>
  );
}

registerPane('Diff', MergeConflictPane);
