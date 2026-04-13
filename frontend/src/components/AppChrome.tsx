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
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--font-size-label)',
        letterSpacing: '0.01em',
      }}
    >
      {/* Title */}
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '-0.01em',
          marginRight: 16,
          whiteSpace: 'nowrap',
          background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-primary) 120%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
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
                boxShadow: isActive ? 'inset 0 -2px 0 var(--accent-primary), 0 0 12px -6px var(--accent-primary)' : 'none',
                fontFamily: 'var(--font-display)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 12,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                transition: 'color 160ms var(--ease-out-expo), background-color 160ms var(--ease-out-expo), border-color 200ms var(--ease-out-expo), box-shadow 200ms var(--ease-out-expo)',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
        <span
          style={{
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            border: '1px solid var(--border-default)',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.04em',
          }}
        >
          ⌘K
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: statusColor,
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: statusColor,
              boxShadow: connectionStatus === 'connected' ? '0 0 8px currentColor' : 'none',
              animation: connectionStatus === 'connecting' ? 'soft-pulse 1.2s ease-in-out infinite' : 'none',
            }}
          />
          {connectionStatus}
        </span>
      </div>
    </div>
  );
}
