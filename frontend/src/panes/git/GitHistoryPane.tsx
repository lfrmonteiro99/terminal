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
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 12,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span>Commit History</span>
        <button
          onClick={() => send({ type: 'GetCommitHistory', limit: 50 })}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-muted)', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
        >
          ↻
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {commits.length === 0 ? (
          <div style={{ padding: '16px 12px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
            No commits yet
          </div>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-default)',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ color: 'var(--accent-warn)', fontSize: 10 }}>{commit.hash.slice(0, 7)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{commit.author}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto' }}>{commit.date}</span>
              </div>
              <div style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{commit.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

registerPane('GitHistory', GitHistoryPane);
