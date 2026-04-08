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
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      {/* File list */}
      <div style={{ width: 200, borderRight: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-default)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <span>Conflicts</span>
          <button onClick={loadConflicts} style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-muted)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>
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
                backgroundColor: selected?.path === f.path ? 'var(--bg-raised)' : 'transparent',
                borderLeft: selected?.path === f.path ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
            >
              {typeof f.path === 'string' ? f.path.split('/').pop() : String(f.path)}
            </div>
          ))}
          {files.length === 0 && (
            <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 11 }}>No conflicts loaded</div>
          )}
        </div>
      </div>

      {/* Conflict viewer */}
      {selected ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-default)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>{typeof selected.path === 'string' ? selected.path : String(selected.path)}</span>
            <button onClick={() => resolve(typeof selected.path === 'string' ? selected.path : String(selected.path), 'ours')} style={{ marginLeft: 'auto', backgroundColor: 'var(--accent-primary)', color: 'var(--bg-surface)', border: 'none', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>
              Take Ours
            </button>
            <button onClick={() => resolve(typeof selected.path === 'string' ? selected.path : String(selected.path), 'theirs')} style={{ backgroundColor: 'var(--accent-warn)', color: 'var(--bg-surface)', border: 'none', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>
              Take Theirs
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <ConflictSide label="Ours (Current)" content={selected.ours} color="var(--accent-primary)" />
            <div style={{ width: 1, backgroundColor: 'var(--border-default)' }} />
            <ConflictSide label="Theirs (Incoming)" content={selected.theirs} color="var(--accent-warn)" />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Select a conflict file
        </div>
      )}
    </div>
  );
}

function ConflictSide({ label, content, color }: { label: string; content: string; color: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '4px 8px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', fontSize: 11, color, fontWeight: 'bold' }}>
        {label}
      </div>
      <pre style={{ flex: 1, overflow: 'auto', margin: 0, padding: '8px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' }}>
        {content}
      </pre>
    </div>
  );
}

registerPane('Diff', MergeConflictPane);
