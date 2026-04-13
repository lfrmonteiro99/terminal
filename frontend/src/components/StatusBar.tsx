import { useState } from 'react';
import { useAppState, useAppDispatch } from '../context/AppContext';

interface StatusBarItemProps {
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}

function StatusBarItem({ onClick, title, children }: StatusBarItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        cursor: onClick ? 'pointer' : 'default',
        padding: '0 6px',
        borderRadius: 3,
        backgroundColor: hovered && onClick ? 'var(--bg-overlay)' : 'transparent',
        transition: 'background-color 100ms',
      }}
    >
      {children}
    </span>
  );
}

export function StatusBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const repo = state.repoStatus;
  const isRunning = state.runState?.type === 'Running';
  const isDisconnected = state.connection.status === 'disconnected';

  return (
    <div style={{
      height: 'var(--statusbar-height)',
      backgroundColor: 'var(--bg-base)',
      borderTop: '1px solid var(--border-default)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 6px',
      gap: 4,
      fontSize: 'var(--font-size-chrome)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-mono)',
      flexShrink: 0,
    }}>
      {repo && (
        <StatusBarItem
          onClick={() => dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'git' })}
          title="Open Git view"
        >
          <span style={{ color: 'var(--accent-primary)' }}>&#9679;</span>
          {repo.branch}
          {repo.head && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{repo.head.slice(0, 7)}</span>}
        </StatusBarItem>
      )}

      {repo && !repo.clean && (
        <StatusBarItem
          onClick={() => {
            dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'changes' });
            if (state.sidebarCollapsed) dispatch({ type: 'TOGGLE_SIDEBAR' });
          }}
          title="Open Changes view"
        >
          {repo.staged_count + repo.unstaged_count} changed
        </StatusBarItem>
      )}

      <span style={{ flex: 1 }} />

      {isRunning && (
        <StatusBarItem
          onClick={() => window.dispatchEvent(new CustomEvent('focus-pane-kind', { detail: 'AiRun' }))}
          title="Focus AI Run pane"
        >
          <span style={{ color: 'var(--accent-warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'var(--accent-warn)',
                animation: 'soft-pulse 1.2s ease-in-out infinite',
                boxShadow: '0 0 8px rgba(var(--accent-warn-rgb), 0.6)',
              }}
            />
            AI running
          </span>
        </StatusBarItem>
      )}

      <StatusBarItem
        onClick={isDisconnected ? () => window.location.reload() : undefined}
        title={isDisconnected ? 'Click to reconnect' : state.connection.status}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          backgroundColor: state.connection.status === 'connected' ? 'var(--accent-primary)' : 'var(--accent-error)',
          boxShadow: state.connection.status === 'connected'
            ? '0 0 6px rgba(var(--accent-primary-rgb), 0.7)'
            : 'none',
        }} />
        {state.connection.status}
      </StatusBarItem>
    </div>
  );
}
