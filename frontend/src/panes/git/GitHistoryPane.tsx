// GitHistoryPane — commit history with branch actions (M5-01, M5-03)

import { useEffect } from 'react';
import { useSend } from '../../context/SendContext';
import { useAppState } from '../../context/AppContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

export function GitHistoryPane({ pane: _pane }: PaneProps) {
  const send = useSend();
  const state = useAppState();

  useEffect(() => {
    send({ type: 'GetCommitHistory', limit: 50 });
  }, [send]);

  const commits = state.commitHistory;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#16213e',
        color: '#e0e0e0',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          fontSize: 12,
          color: '#888',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span>Commit History</span>
        <button
          onClick={() => send({ type: 'GetCommitHistory', limit: 50 })}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #444', color: '#888', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
        >
          ↻
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {commits.length === 0 ? (
          <div style={{ padding: '16px 12px', color: '#555', fontSize: 12, fontFamily: 'monospace' }}>
            No commits yet
          </div>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #222',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ color: '#f0a500', fontSize: 10 }}>{commit.hash.slice(0, 7)}</span>
                <span style={{ color: '#888', fontSize: 10 }}>{commit.author}</span>
                <span style={{ color: '#555', fontSize: 10, marginLeft: 'auto' }}>{commit.date}</span>
              </div>
              <div style={{ color: '#e0e0e0', wordBreak: 'break-word' }}>{commit.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

registerPane('GitHistory', GitHistoryPane);
