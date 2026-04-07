// AppChrome — top chrome bar: title, session name, connection status

import { useAppState } from '../context/AppContext';

export function AppChrome() {
  const state = useAppState();

  const connectionStatus = state.connection.status;

  const statusColor =
    connectionStatus === 'connected'
      ? 'var(--accent-primary)'
      : connectionStatus === 'connecting'
        ? 'var(--accent-warn)'
        : 'var(--accent-error)';

  // Derive a human-readable session label from the active session
  const sessionLabel = state.activeSession
    ? state.activeSession.slice(0, 8) + '...'
    : null;

  return (
    <div
      style={{
        height: 'var(--chrome-height)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        gap: 12,
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-chrome)',
        boxSizing: 'border-box',
      }}
    >
      {/* Left: title */}
      <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
        Terminal Engine
      </span>

      {/* Center: session name */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        {sessionLabel && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {sessionLabel}
          </span>
        )}
      </div>

      {/* Right: connection status dot + Ctrl+K hint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-muted)' }}>Ctrl+K</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: statusColor }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: statusColor,
              display: 'inline-block',
            }}
          />
          {connectionStatus}
        </span>
      </div>
    </div>
  );
}
