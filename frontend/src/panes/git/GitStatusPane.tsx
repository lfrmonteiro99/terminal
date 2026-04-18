// GitStatusPane — repository status with stage/unstage/commit actions (M5-01, M5-03)

import React, { useEffect, useState } from 'react';
import { GitBranch, RotateCw } from 'lucide-react';
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

function pillStyle(status: FileChange['status']): React.CSSProperties {
  const base: React.CSSProperties = {
    minWidth: 20,
    height: 18,
    padding: '0 6px',
    borderRadius: 9,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.04em',
    fontFamily: 'var(--font-mono)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
  if (status === 'Added') return {
    ...base,
    color: 'var(--accent-primary)',
    backgroundColor: 'var(--accent-primary-15)',
    border: '1px solid rgba(var(--accent-primary-rgb), 0.35)',
  };
  if (status === 'Modified') return {
    ...base,
    color: 'var(--accent-warn)',
    backgroundColor: 'rgba(var(--accent-warn-rgb), 0.15)',
    border: '1px solid rgba(var(--accent-warn-rgb), 0.35)',
  };
  if (status === 'Deleted') return {
    ...base,
    color: 'var(--accent-error)',
    backgroundColor: 'rgba(var(--accent-error-rgb), 0.15)',
    border: '1px solid rgba(var(--accent-error-rgb), 0.35)',
  };
  return {
    ...base,
    color: 'var(--text-muted)',
    backgroundColor: 'rgba(136,136,136,0.14)',
    border: '1px solid var(--border-default)',
  };
}

export function GitStatusPane({ pane: _pane }: PaneProps) {
  const send = useSend();
  const state = useAppState();
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  useEffect(() => {
    send({ type: 'GetRepoStatus' });
    send({ type: 'GetChangedFiles', mode: 'working' });
  }, [send]);

  // Any fresh RepoStatusResult clears the refresh + stage in-flight flags.
  // This replaces the defensive setTimeout below; the timeout stays only as a
  // safety net for the rare case the reply never arrives.
  useEffect(() => {
    if (state.repoStatus) {
      setRefreshing(false);
      setStagingPath(null);
    }
  }, [state.repoStatus]);

  // Surface GitOperationFailed from global error state
  useEffect(() => {
    if (state.error?.includes('failed:')) {
      setGitError(state.error);
      setStagingPath(null);
    }
  }, [state.error]);

  const files = state.changedFiles?.files ?? [];
  const repoStatus = state.repoStatus;

  const refresh = () => {
    setRefreshing(true);
    setGitError(null);
    send({ type: 'GetRepoStatus' });
    send({ type: 'GetChangedFiles', mode: 'working' });
  };

  const handleStage = (path: string) => {
    setStagingPath(path);
    setGitError(null);
    send({ type: 'StageFile', path });
    // Clear staging indicator when status refreshes
    setTimeout(() => setStagingPath(null), 3000);
  };

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
      {/* Error banner */}
      {gitError && (
        <div
          role="alert"
          style={{
            padding: '6px 12px',
            backgroundColor: 'rgba(var(--accent-error-rgb), 0.12)',
            borderBottom: '1px solid rgba(var(--accent-error-rgb), 0.3)',
            color: 'var(--accent-error)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{gitError}</span>
          <button
            onClick={() => setGitError(null)}
            aria-label="Dismiss error"
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 12,
          fontFamily: 'var(--font-display)',
          color: 'var(--text-secondary)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent-primary)', fontWeight: 600 }}>
          <GitBranch size={12} strokeWidth={2} />
          {repoStatus?.branch ?? 'unknown'}
        </span>
        {repoStatus && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {repoStatus.staged_count > 0 && (
              <span style={{ color: 'var(--accent-primary)' }}>+{repoStatus.staged_count} staged</span>
            )}
            {repoStatus.staged_count > 0 && repoStatus.unstaged_count > 0 && (
              <span style={{ color: 'var(--text-muted)' }}> · </span>
            )}
            {repoStatus.unstaged_count > 0 && (
              <span style={{ color: 'var(--accent-warn)' }}>{repoStatus.unstaged_count} unstaged</span>
            )}
          </span>
        )}
        <button
          onClick={refresh}
          title="Refresh"
          aria-label="Refresh repository status"
          disabled={refreshing}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: refreshing ? 'var(--accent-primary)' : 'var(--text-muted)',
            borderRadius: 5,
            padding: '3px 9px',
            cursor: refreshing ? 'wait' : 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            fontWeight: 500,
            transition: 'color 140ms, border-color 140ms, background 140ms',
            opacity: refreshing ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (refreshing) return;
            e.currentTarget.style.color = 'var(--accent-primary)';
            e.currentTarget.style.borderColor = 'var(--accent-primary)';
            e.currentTarget.style.background = 'var(--accent-primary-08)';
          }}
          onMouseLeave={(e) => {
            if (refreshing) return;
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <RotateCw size={11} strokeWidth={1.75} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {files.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontFamily: 'var(--font-display)',
              textAlign: 'center',
            }}
          >
            no changed files
          </div>
        ) : (
          files.map((file) => {
            const pathStr = typeof file.path === 'string' ? file.path : String(file.path);
            const isHover = hoverPath === pathStr;
            return (
              <div
                key={pathStr}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '5px 12px',
                  gap: 8,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  backgroundColor: isHover ? 'var(--bg-raised)' : 'transparent',
                  borderLeft: isHover ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  transition: 'background-color 120ms, border-color 120ms',
                }}
                onMouseEnter={() => setHoverPath(pathStr)}
                onMouseLeave={() => setHoverPath(null)}
              >
                <span style={pillStyle(file.status)}>{statusLabel(file.status)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pathStr}
                </span>
                <button
                  onClick={() => handleStage(pathStr)}
                  aria-label={`Stage ${pathStr}`}
                  disabled={stagingPath === pathStr}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--accent-primary)',
                    color: 'var(--accent-primary)',
                    borderRadius: 4,
                    padding: '2px 10px',
                    cursor: stagingPath === pathStr ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-display)',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    opacity: stagingPath === pathStr ? 0.5 : (isHover ? 1 : 0.7),
                    transition: 'opacity 120ms, background 120ms',
                  }}
                  onMouseEnter={(e) => {
                    if (stagingPath === pathStr) return;
                    e.currentTarget.style.background = 'var(--accent-primary-08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {stagingPath === pathStr ? '...' : 'Stage'}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Commit bar */}
      <CommitBar onCommit={(msg) => { setGitError(null); send({ type: 'CreateCommit', message: msg }); }} />
    </div>
  );
}

function CommitBar({ onCommit }: { onCommit: (msg: string) => void }) {
  const [msg, setMsg] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);

  return (
    <div
      style={{
        padding: '10px 12px',
        borderTop: '1px solid var(--border-default)',
        display: 'flex',
        gap: 8,
        background: 'var(--bg-base)',
      }}
    >
      <input
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim() && !committing) { setCommitting(true); onCommit(msg.trim()); setMsg(''); setTimeout(() => setCommitting(false), 3000); } }}
        placeholder="commit message..."
        aria-label="Commit message"
        disabled={committing}
        style={{
          flex: 1,
          backgroundColor: 'var(--bg-raised)',
          border: `1px solid ${focused ? 'var(--accent-primary)' : 'var(--border-default)'}`,
          color: 'var(--text-primary)',
          padding: '6px 10px',
          borderRadius: 5,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          outline: 'none',
          boxShadow: focused ? 'var(--glow-accent)' : 'none',
          transition: 'border-color 160ms, box-shadow 200ms var(--ease-out-expo)',
        }}
      />
      <button
        onClick={() => { if (msg.trim() && !committing) { setCommitting(true); onCommit(msg.trim()); setMsg(''); setTimeout(() => setCommitting(false), 3000); } }}
        disabled={!msg.trim() || committing}
        aria-label="Create commit"
        style={{
          backgroundColor: msg.trim() ? 'var(--accent-primary)' : 'var(--bg-overlay)',
          color: msg.trim() ? 'var(--bg-base)' : 'var(--text-muted)',
          border: 'none',
          borderRadius: 5,
          padding: '6px 16px',
          cursor: msg.trim() ? 'pointer' : 'not-allowed',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.02em',
          boxShadow: msg.trim() ? 'var(--glow-accent)' : 'none',
          opacity: msg.trim() ? 1 : 'var(--disabled-opacity)' as unknown as number,
          transition: 'background 160ms, box-shadow 200ms, opacity 160ms',
        }}
      >
        Commit
      </button>
    </div>
  );
}

registerPane('GitStatus', GitStatusPane);
