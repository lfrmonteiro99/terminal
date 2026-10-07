// AppChrome — single horizontal command bar.
// Replaces the VS Code layout of (title bar + vertical activity rail + editor tabs)
// with one band: identity · workspace selector · view switcher · layout · status.

import { useState, useRef, useEffect } from 'react';
import {
  FolderTree, FileDiff, GitBranch, Users, TerminalSquare, Bot, Globe,
  ChevronDown, Plus, X, Check,
} from 'lucide-react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { useSend } from '../context/SendContext';

type SidebarView = 'explorer' | 'changes' | 'git' | 'agents';

const VIEWS: { view: SidebarView; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { view: 'explorer', label: 'Files', Icon: FolderTree },
  { view: 'changes', label: 'Changes', Icon: FileDiff },
  { view: 'git', label: 'Git', Icon: GitBranch },
  { view: 'agents', label: 'Agents', Icon: Users },
];

const LAYOUTS: { preset: string; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { preset: 'terminal', label: 'Terminal', Icon: TerminalSquare },
  { preset: 'ai', label: 'AI session', Icon: Bot },
  { preset: 'browser', label: 'Browser', Icon: Globe },
];

interface AppChromeProps {
  onLayoutPreset?: (preset: string) => void;
}

/** The app mark — a bracketed prompt cursor, mono-native, no gradient clip. */
function Mark() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: 6,
        border: '1px solid var(--accent-primary)',
        color: 'var(--accent-primary)',
        backgroundColor: 'var(--accent-primary-08)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      ▸
    </span>
  );
}

export function AppChrome({ onLayoutPreset }: AppChromeProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  const [menu, setMenu] = useState<null | 'workspace' | 'layout'>(null);
  const [addingSession, setAddingSession] = useState(false);
  const [newPath, setNewPath] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const connectionStatus = state.connection.status;
  const statusColor =
    connectionStatus === 'connected'
      ? 'var(--accent-primary)'
      : connectionStatus === 'connecting'
        ? 'var(--accent-warn)'
        : 'var(--accent-error)';

  const sessions = Array.from(state.sessions.values());
  const active = state.activeSession ? state.sessions.get(state.activeSession) : null;
  const projectName = (root: string) => root.split(/[/\\]/).filter(Boolean).pop() ?? root;

  const activeView = state.sidebarCollapsed ? null : state.activeSidebarView;

  const handleNewSession = () => {
    const path = newPath.trim();
    if (!path) return;
    send({ type: 'StartSession', project_root: path });
    setNewPath('');
    setAddingSession(false);
    setMenu(null);
  };

  const handleCloseSession = (sessionId: string) => {
    send({ type: 'EndSession', session_id: sessionId });
    if (sessionId === state.activeSession) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) {
        dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: remaining[0].id });
      }
    }
  };

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    padding: '0 8px',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
    fontSize: 12,
    whiteSpace: 'nowrap',
    transition: 'color 140ms var(--ease-out-expo), border-color 140ms var(--ease-out-expo)',
  };

  const popoverStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    minWidth: 260,
    background: 'var(--bg-overlay)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-overlay)',
    padding: 6,
    zIndex: 50,
    fontFamily: 'var(--font-display)',
    fontSize: 12,
  };

  return (
    <div
      ref={barRef}
      style={{
        height: 'var(--chrome-height)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12,
        gap: 10,
        flexShrink: 0,
        position: 'relative',
        zIndex: 40,
      }}
    >
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
        <Mark />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: '-0.005em',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
          }}
        >
          Engine
        </span>
      </div>

      {/* Workspace selector */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setMenu(m => (m === 'workspace' ? null : 'workspace'))}
          title={active?.project_root ?? 'No workspace'}
          style={{
            ...chipStyle,
            color: 'var(--text-primary)',
            borderColor: menu === 'workspace' ? 'var(--accent-primary)' : 'var(--border-default)',
          }}
        >
          <span
            style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: statusColor,
              boxShadow: connectionStatus === 'connected' ? '0 0 6px currentColor' : 'none',
              flexShrink: 0,
            }}
          />
          {active ? projectName(active.project_root) : 'No workspace'}
          <ChevronDown size={13} strokeWidth={2} style={{ opacity: 0.6 }} />
        </button>

        {menu === 'workspace' && (
          <div style={popoverStyle}>
            <div style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Workspaces
            </div>
            {sessions.length === 0 && (
              <div style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>none open</div>
            )}
            {sessions.map(s => {
              const isActive = s.id === state.activeSession;
              return (
                <div
                  key={s.id}
                  onClick={() => { dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: s.id }); setMenu(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-raised)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 12, display: 'inline-flex' }}>
                    {isActive && <Check size={12} strokeWidth={2.5} style={{ color: 'var(--accent-primary)' }} />}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {projectName(s.project_root)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.run_count} runs</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCloseSession(s.id); }}
                    title="Close workspace"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            <div style={{ height: 1, background: 'var(--border-default)', margin: '5px 4px' }} />

            {addingSession ? (
              <input
                autoFocus
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleNewSession();
                  if (e.key === 'Escape') { setAddingSession(false); setNewPath(''); }
                }}
                placeholder="/path/to/project"
                style={{
                  width: '100%', backgroundColor: 'var(--bg-raised)',
                  border: '1px solid var(--border-default)', color: 'var(--text-primary)',
                  padding: '5px 7px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 12,
                }}
              />
            ) : (
              <div
                onClick={() => setAddingSession(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 5, cursor: 'pointer', color: 'var(--accent-primary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-raised)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 12, display: 'inline-flex' }}><Plus size={12} strokeWidth={2.5} /></span>
                Open workspace…
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 18, background: 'var(--border-default)', flexShrink: 0 }} />

      {/* View switcher — segmented, replaces the vertical activity rail */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 7,
          padding: 2,
        }}
      >
        {VIEWS.map(({ view, label, Icon }) => {
          const isActive = activeView === view;
          return (
            <button
              key={view}
              title={label}
              onClick={() => {
                if (isActive) dispatch({ type: 'TOGGLE_SIDEBAR' });
                else dispatch({ type: 'SET_SIDEBAR_VIEW', view });
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 24, padding: '0 9px', border: 'none', borderRadius: 5, cursor: 'pointer',
                background: isActive ? 'var(--accent-primary-15)' : 'transparent',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: isActive ? 600 : 500,
                transition: 'color 140ms var(--ease-out-expo), background-color 140ms var(--ease-out-expo)',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <Icon size={14} strokeWidth={1.9} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Layout presets */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setMenu(m => (m === 'layout' ? null : 'layout'))}
          style={{ ...chipStyle, borderColor: menu === 'layout' ? 'var(--accent-primary)' : 'var(--border-default)' }}
          title="Layout"
        >
          Layout
          <ChevronDown size={13} strokeWidth={2} style={{ opacity: 0.6 }} />
        </button>
        {menu === 'layout' && (
          <div style={{ ...popoverStyle, left: 'auto', right: 0, minWidth: 180 }}>
            {LAYOUTS.map(({ preset, label, Icon }) => (
              <div
                key={preset}
                onClick={() => { onLayoutPreset?.(preset); setMenu(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 5, cursor: 'pointer', color: 'var(--text-primary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-raised)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Icon size={14} strokeWidth={1.9} />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Command hint */}
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
    </div>
  );
}
