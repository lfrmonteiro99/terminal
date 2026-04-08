// AppChrome — top chrome bar: title, session tabs, connection status

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { useSend } from '../context/SendContext';

export function AppChrome() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();
  const [addingSession, setAddingSession] = useState(false);
  const [newPath, setNewPath] = useState('');

  const connectionStatus = state.connection.status;
  const statusColor =
    connectionStatus === 'connected'
      ? 'var(--accent-primary)'
      : connectionStatus === 'connecting'
        ? 'var(--accent-warn)'
        : 'var(--accent-error)';

  const sessions = Array.from(state.sessions.values());

  const handleNewSession = () => {
    if (!newPath.trim()) return;
    send({ type: 'StartSession', project_root: newPath.trim() });
    setNewPath('');
    setAddingSession(false);
  };

  const handleCloseSession = (sessionId: string) => {
    send({ type: 'EndSession', session_id: sessionId });
    // If closing the active session, switch to another
    if (sessionId === state.activeSession) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) {
        dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: remaining[0].id });
      }
    }
  };

  const projectName = (root: string) => root.split('/').filter(Boolean).pop() ?? root;

  return (
    <div
      style={{
        height: 'var(--chrome-height)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12,
        gap: 0,
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-chrome)',
      }}
    >
      {/* Title */}
      <span style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginRight: 12, whiteSpace: 'nowrap' }}>
        Terminal Engine
      </span>

      {/* Session tabs */}
      <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden', gap: 0 }}>
        {sessions.map(session => {
          const isActive = session.id === state.activeSession;
          return (
            <div
              key={session.id}
              title={session.project_root}
              onClick={() => dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: session.id })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 12px',
                height: '100%',
                cursor: 'pointer',
                borderBottom: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--bg-overlay)' : 'transparent',
                whiteSpace: 'nowrap',
                transition: 'color 100ms, background-color 100ms',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-raised)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span>{projectName(session.project_root)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleCloseSession(session.id); }}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                }}
                title="Close session"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* Add session button or inline input */}
        {addingSession ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px' }}>
            <input
              autoFocus
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewSession();
                if (e.key === 'Escape') { setAddingSession(false); setNewPath(''); }
              }}
              placeholder="Project path..."
              style={{
                backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)',
                color: 'var(--text-primary)', padding: '2px 6px', borderRadius: 3,
                fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-chrome)', width: 180,
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingSession(true)}
            title="New session"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
              padding: '0 8px', height: '100%',
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Right: Ctrl+K hint + connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text-muted)' }}>Ctrl+K</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: statusColor }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: statusColor }} />
          {connectionStatus}
        </span>
      </div>
    </div>
  );
}
