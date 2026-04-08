// GitStatusPane — repository status with stage/unstage/commit actions (M5-01, M5-03)

import React, { useEffect } from 'react';
import { useSend } from '../../context/SendContext';
import { useAppState } from '../../context/AppContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';
import type { FileChange } from '../../types/protocol';

function statusLabel(status: FileChange['status']): string {
  if (status === 'Added') return 'A';
  if (status === 'Modified') return 'M';
  if (status === 'Deleted') return 'D';
  if (typeof status === 'object' && 'Renamed' in status) return 'R';
  return '?';
}

function statusColor(status: FileChange['status']): string {
  if (status === 'Added') return 'var(--accent-primary)';
  if (status === 'Modified') return 'var(--accent-warn)';
  if (status === 'Deleted') return 'var(--accent-error)';
  return 'var(--text-muted)';
}

export function GitStatusPane({ pane: _pane }: PaneProps) {
  const send = useSend();
  const state = useAppState();

  useEffect(() => {
    send({ type: 'GetRepoStatus' });
    send({ type: 'GetChangedFiles', mode: 'working' });
  }, [send]);

  const files = state.changedFiles?.files ?? [];
  const repoStatus = state.repoStatus;

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
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 12,
          color: 'var(--text-muted)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)' }}>
          {repoStatus?.branch ?? 'unknown'}
        </span>
        {repoStatus && (
          <span>
            {repoStatus.staged_count > 0 && (
              <span style={{ color: 'var(--accent-primary)' }}>+{repoStatus.staged_count} staged</span>
            )}
            {repoStatus.staged_count > 0 && repoStatus.unstaged_count > 0 && ' · '}
            {repoStatus.unstaged_count > 0 && (
              <span style={{ color: 'var(--accent-warn)' }}>{repoStatus.unstaged_count} unstaged</span>
            )}
          </span>
        )}
        <button
          onClick={() => { send({ type: 'GetRepoStatus' }); send({ type: 'GetChangedFiles', mode: 'working' }); }}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-muted)', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {files.length === 0 ? (
          <div style={{ padding: '16px 12px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
            No changed files
          </div>
        ) : (
          files.map((file) => (
            <div
              key={typeof file.path === 'string' ? file.path : String(file.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px 12px',
                gap: 8,
                fontSize: 12,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--bg-raised)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent')}
            >
              <span style={{ color: statusColor(file.status), width: 14, textAlign: 'center' }}>
                {statusLabel(file.status)}
              </span>
              <span style={{ flex: 1 }}>
                {typeof file.path === 'string' ? file.path : String(file.path)}
              </span>
              <button
                onClick={() => send({ type: 'StageFile', path: typeof file.path === 'string' ? file.path : String(file.path) })}
                style={{ background: 'none', border: '1px solid var(--border-default)', color: 'var(--accent-primary)', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontSize: 10 }}
              >
                Stage
              </button>
            </div>
          ))
        )}
      </div>

      {/* Commit bar */}
      <CommitBar onCommit={(msg) => send({ type: 'CreateCommit', message: msg })} />
    </div>
  );
}

function CommitBar({ onCommit }: { onCommit: (msg: string) => void }) {
  const [msg, setMsg] = React.useState('');

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-default)', display: 'flex', gap: 8 }}>
      <input
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim()) { onCommit(msg.trim()); setMsg(''); } }}
        placeholder="Commit message..."
        style={{
          flex: 1,
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
          padding: '4px 8px',
          borderRadius: 3,
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      />
      <button
        onClick={() => { if (msg.trim()) { onCommit(msg.trim()); setMsg(''); } }}
        style={{
          backgroundColor: 'var(--accent-primary)',
          color: 'var(--bg-surface)',
          border: 'none',
          borderRadius: 3,
          padding: '4px 12px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 'bold',
        }}
      >
        Commit
      </button>
    </div>
  );
}

registerPane('GitStatus', GitStatusPane);
