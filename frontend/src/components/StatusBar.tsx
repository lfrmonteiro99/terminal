import { useAppState } from '../context/AppContext';

export function StatusBar() {
  const state = useAppState();
  const repo = state.repoStatus;
  const isRunning = state.runState?.type === 'Running';

  return (
    <div style={{
      height: 'var(--statusbar-height)',
      backgroundColor: 'var(--bg-base)',
      borderTop: '1px solid var(--border-default)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 16,
      fontSize: 'var(--font-size-chrome)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-mono)',
      flexShrink: 0,
    }}>
      {repo && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--accent-primary)' }}>&#9679;</span>
          {repo.branch}
          {repo.head && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{repo.head.slice(0, 7)}</span>}
        </span>
      )}

      {repo && !repo.clean && (
        <span>{repo.staged_count + repo.unstaged_count} changed</span>
      )}

      <span style={{ flex: 1 }} />

      {isRunning && (
        <span style={{ color: 'var(--accent-warn)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>&#9679;</span>
          AI running
        </span>
      )}

      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          backgroundColor: state.connection.status === 'connected' ? 'var(--accent-primary)' : 'var(--accent-error)',
        }} />
        {state.connection.status}
      </span>
    </div>
  );
}
