// NavRail — labelled, grouped navigation (Notion / Jira style).
//
// Replaces the top-bar segmented switcher: navigation now lives next to the
// content it controls, carries human labels (not just icons), section headers,
// and live counts. Collapsed state keeps the rail usable as an icon strip.

import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, FolderTree, FileDiff, GitBranch, Users,
  ChevronDown, ChevronLeft, ChevronsRight, Plus, X, Check, Settings,
} from 'lucide-react';
import { useAppState, useAppDispatch } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import type { AppState } from '../../context/AppContext';

type View = AppState['activeSidebarView'];
type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number }>;

interface NavItem {
  view: View;
  label: string;
  hint: string;
  Icon: IconCmp;
}

interface NavRailProps {
  /** Called after a destination is chosen — the mobile drawer closes on it. */
  onNavigate?: () => void;
  /** Hide the collapse toggle (meaningless inside a phone drawer). */
  showCollapse?: boolean;
  /** Render expanded regardless of the persisted sidebar state (drawer). */
  forceExpanded?: boolean;
}

const GROUPS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [
      { view: 'overview', label: 'Overview', hint: 'Workspace dashboard', Icon: LayoutDashboard },
      { view: 'explorer', label: 'Files', hint: 'Browse the project tree', Icon: FolderTree },
      { view: 'changes', label: 'Changes', hint: 'Uncommitted work', Icon: FileDiff },
      { view: 'git', label: 'Git', hint: 'Branches and history', Icon: GitBranch },
    ],
  },
  {
    title: 'Agents',
    items: [
      { view: 'agents', label: 'Agents', hint: 'Named workers and roles', Icon: Users },
    ],
  },
  {
    title: null,
    items: [
      { view: 'settings', label: 'Settings', hint: 'Appearance and accent colour', Icon: Settings },
    ],
  },
];

function projectName(root: string): string {
  return root.split(/[/\\]/).filter(Boolean).pop() ?? root;
}

export function NavRail({ onNavigate, showCollapse = true, forceExpanded = false }: NavRailProps = {}) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Selecting a destination is a navigation event. On desktop the rail stays
  // put; inside a phone drawer the caller uses this to close the drawer, which
  // is why it is a prop and not a `window` event.
  const go = (view: View) => {
    dispatch({ type: 'SET_SIDEBAR_VIEW', view });
    onNavigate?.();
  };

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const collapsed = forceExpanded ? false : state.sidebarCollapsed;
  const sessions = Array.from(state.sessions.values());
  const active = state.activeSession ? state.sessions.get(state.activeSession) : null;

  const changeCount = (state.repoStatus?.staged_count ?? 0) + (state.repoStatus?.unstaged_count ?? 0);
  const agentCount = state.agents.size;
  const runCount = state.runs.size;

  const badgeFor = (view: View): number | null => {
    if (view === 'changes') return changeCount > 0 ? changeCount : null;
    if (view === 'agents') return agentCount > 0 ? agentCount : null;
    if (view === 'git') return runCount > 0 ? null : null;
    return null;
  };

  const statusColor =
    state.connection.status === 'connected'
      ? 'var(--accent-primary)'
      : state.connection.status === 'connecting'
        ? 'var(--accent-warn)'
        : 'var(--accent-error)';

  const handleNewSession = () => {
    const path = newPath.trim();
    if (!path) return;
    send({ type: 'StartSession', project_root: path });
    setNewPath('');
    setAdding(false);
    setMenu(false);
  };

  const handleCloseSession = (sessionId: string) => {
    send({ type: 'EndSession', session_id: sessionId });
    if (sessionId === state.activeSession) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: remaining[0].id });
    }
  };

  return (
    <div ref={rootRef} style={styles.rail(collapsed, forceExpanded)}>
      {/* Brand */}
      <div style={styles.brand(collapsed)}>
        <span style={styles.mark}>▸</span>
        {!collapsed && <span style={styles.brandName}>Engine</span>}
      </div>

      {/* Workspace switcher */}
      <div style={{ position: 'relative', padding: collapsed ? '0 6px 6px' : '0 8px 8px' }}>
        <button
          onClick={() => setMenu(m => !m)}
          title={active?.project_root ?? 'No workspace open'}
          className="touch-row"
          style={{
            ...styles.workspaceBtn,
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderColor: menu ? 'var(--accent-primary)' : 'var(--tint-border)',
          }}
        >
          <span style={{ ...styles.dot, backgroundColor: statusColor }} />
          {!collapsed && (
            <>
              <span style={styles.workspaceName}>
                {active ? projectName(active.project_root) : 'No workspace'}
              </span>
              <ChevronDown size={13} strokeWidth={2} style={{ opacity: 0.55, flexShrink: 0 }} />
            </>
          )}
        </button>

        {menu && (
          <div style={{ ...styles.popover, left: collapsed ? 8 : 8 }}>
            <div style={styles.popoverLabel}>Workspaces</div>
            {sessions.length === 0 && <div style={styles.popoverEmpty}>none open</div>}
            {sessions.map(s => {
              const isActive = s.id === state.activeSession;
              return (
                <div
                  key={s.id}
                  onClick={() => { dispatch({ type: 'SET_ACTIVE_SESSION', sessionId: s.id }); setMenu(false); onNavigate?.(); }}
                  style={styles.popoverRow}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 15, display: 'inline-flex', flexShrink: 0 }}>
                    {isActive && <Check size={13} strokeWidth={2.5} style={{ color: 'var(--accent-primary)' }} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.popoverTitle}>{projectName(s.project_root)}</div>
                    <div style={styles.popoverMeta}>{s.run_count} runs</div>
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleCloseSession(s.id); }}
                    title="Close workspace"
                    style={styles.iconBtn}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            <div style={styles.divider} />

            {adding ? (
              <input
                autoFocus
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleNewSession();
                  if (e.key === 'Escape') { setAdding(false); setNewPath(''); }
                }}
                placeholder="/path/to/project"
                style={styles.pathInput}
              />
            ) : (
              <div
                onClick={() => setAdding(true)}
                style={{ ...styles.popoverRow, color: 'var(--accent-primary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 15, display: 'inline-flex', flexShrink: 0 }}><Plus size={13} strokeWidth={2.5} /></span>
                Open workspace…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {GROUPS.map((group, gi) => (
          <div key={group.title ?? `g${gi}`} style={{ marginBottom: 4 }}>
            {group.title && !collapsed && <div style={styles.groupLabel}>{group.title}</div>}
            {group.title && collapsed && <div style={styles.groupRule} />}
            {group.items.map(item => {
              const isActive = state.activeSidebarView === item.view;
              const badge = badgeFor(item.view);
              return (
                <button
                  key={item.view}
                  title={`${item.label} — ${item.hint}`}
                  onClick={() => go(item.view)}
                  className="touch-row"
                  style={{
                    ...styles.navItem,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background: isActive ? 'rgba(var(--accent-primary-rgb), 0.13)' : 'transparent',
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                  }}
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--tint-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
                >
                  <item.Icon size={16} strokeWidth={1.8} />
                  {!collapsed && <span style={styles.navLabel}>{item.label}</span>}
                  {!collapsed && badge !== null && (
                    <span style={{
                      ...styles.badge,
                      background: isActive ? 'var(--accent-primary-15)' : 'var(--tint-active)',
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: collapse (desktop only — a phone drawer has no collapsed form) */}
      {showCollapse && (
        <button
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
          title={collapsed ? 'Expand navigation (Ctrl+B)' : 'Collapse navigation (Ctrl+B)'}
          style={{ ...styles.footerBtn, justifyContent: collapsed ? 'center' : 'flex-start' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronLeft size={15} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
    </div>
  );
}

const styles = {
  rail: (collapsed: boolean, fullWidth = false): React.CSSProperties => ({
    // In the phone drawer the rail must fill the drawer: a fixed rail width
    // would leave a strip of drawer background and draw the rail's right
    // border in the middle of the panel.
    width: fullWidth ? '100%' : collapsed ? 'var(--rail-width-collapsed)' : 'var(--rail-width)',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg-base)',
    borderRight: fullWidth ? 'none' : '1px solid var(--tint-border)',
    overflow: 'hidden',
    transition: 'width 160ms var(--ease-out-expo)',
    fontFamily: 'var(--font-display)',
  }),
  brand: (collapsed: boolean): React.CSSProperties => ({
    height: 'var(--chrome-height)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: 9,
    padding: collapsed ? 0 : '0 14px',
    flexShrink: 0,
  }),
  mark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-primary)',
    color: 'var(--accent-primary)',
    backgroundColor: 'var(--accent-primary-08)',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    flexShrink: 0,
    userSelect: 'none' as const,
  },
  brandName: {
    fontSize: 'var(--font-size-body)',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)',
  },
  workspaceBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 32,
    padding: '0 9px',
    // Border split into longhands on purpose: this object gets a borderColor
    // override at the call site, and mixing the `border` shorthand with the
    // `borderColor` longhand makes React drop the colour on rerender.
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--tint-border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--tint-card)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-size-small)',
  } as React.CSSProperties,
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  workspaceName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'left',
    fontWeight: 550,
  } as React.CSSProperties,
  groupLabel: {
    padding: '12px 14px 5px',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  groupRule: {
    height: 1,
    background: 'var(--tint-border)',
    margin: '8px 12px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: 'calc(100% - 16px)',
    margin: '1px 8px',
    height: 32,
    padding: '0 9px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-size-body)',
    textAlign: 'left',
    transition: 'background-color 120ms var(--ease-out-expo), color 120ms var(--ease-out-expo)',
  } as React.CSSProperties,
  navLabel: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: {
    flexShrink: 0,
    minWidth: 20,
    height: 17,
    padding: '0 6px',
    borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  footerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    height: 34,
    padding: '0 14px',
    margin: 0,
    border: 'none',
    borderTop: '1px solid var(--tint-border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-size-small)',
    flexShrink: 0,
    transition: 'color 120ms',
  } as React.CSSProperties,
  popover: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    minWidth: 250,
    background: 'var(--bg-overlay)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-overlay)',
    padding: 6,
    zIndex: 60,
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-size-small)',
  } as React.CSSProperties,
  popoverLabel: {
    padding: '5px 9px',
    color: 'var(--text-muted)',
    fontSize: 'var(--font-size-micro)',
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    fontWeight: 600,
  } as React.CSSProperties,
  popoverEmpty: {
    padding: '6px 9px',
    color: 'var(--text-muted)',
    fontSize: 'var(--font-size-small)',
  } as React.CSSProperties,
  popoverRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 9px',
    borderRadius: 'var(--radius-xs)',
    cursor: 'pointer',
    color: 'var(--text-primary)',
  } as React.CSSProperties,
  popoverTitle: {
    fontSize: 'var(--font-size-small)',
    fontWeight: 550,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  popoverMeta: {
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
    marginTop: 1,
  } as React.CSSProperties,
  divider: {
    height: 1,
    background: 'var(--tint-border)',
    margin: '5px 4px',
  } as React.CSSProperties,
  iconBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--text-muted)',
    display: 'flex',
    flexShrink: 0,
  } as React.CSSProperties,
  pathInput: {
    width: '100%',
    backgroundColor: 'var(--bg-raised)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
    padding: '6px 8px',
    borderRadius: 'var(--radius-xs)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--font-size-small)',
  } as React.CSSProperties,
};
