// TopBar — page header for the active view.
//
// Navigation lives in the rail; this band answers only three questions:
// where am I (breadcrumb + title), what is the state of this view (meta chips),
// and what can I do here (contextual primary action, layout, command palette).

import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, FolderTree, FileDiff, GitBranch, Users, GitFork,
  ChevronDown, ChevronRight, TerminalSquare, Bot, Globe, RefreshCw,
  SlidersHorizontal, Menu,
} from 'lucide-react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import type { SidebarView } from '../types/sidebar';

type View = SidebarView;

type ChromeIcon = React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;

const VIEW_META: Record<View, { label: string; Icon: ChromeIcon }> = {
  overview: { label: 'Overview', Icon: LayoutDashboard },
  explorer: { label: 'Files', Icon: FolderTree },
  changes: { label: 'Changes', Icon: FileDiff },
  git: { label: 'Git', Icon: GitBranch },
  agents: { label: 'Agents', Icon: Users },
  settings: { label: 'Settings', Icon: SlidersHorizontal },
};

const LAYOUTS: { preset: string; label: string; Icon: ChromeIcon }[] = [
  { preset: 'terminal', label: 'Terminal only', Icon: TerminalSquare },
  { preset: 'ai', label: 'AI session', Icon: Bot },
  { preset: 'git', label: 'Git review', Icon: GitFork },
  { preset: 'browser', label: 'Browser + terminal', Icon: Globe },
];

interface AppChromeProps {
  onLayoutPreset?: (preset: string) => void;
  /** Phone form: collapse to a hamburger + title and drop the desktop controls. */
  mobile?: boolean;
  /** Opens the off-canvas navigation drawer (mobile only). */
  onOpenDrawer?: () => void;
  /** Replaces the view title — the phone names the focused pane while working. */
  titleOverride?: string;
}

function projectName(root: string): string {
  return root.split(/[/\\]/).filter(Boolean).pop() ?? root;
}

export function AppChrome({ onLayoutPreset, mobile = false, onOpenDrawer, titleOverride }: AppChromeProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  const [menu, setMenu] = useState<null | 'layout'>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const view = state.activeSidebarView as View;
  const meta = VIEW_META[view] ?? VIEW_META.overview;
  const title = titleOverride ?? meta.label;
  const active = state.activeSession ? state.sessions.get(state.activeSession) : null;
  const repo = state.repoStatus;
  const dirtyTotal = (repo?.staged_count ?? 0) + (repo?.unstaged_count ?? 0);

  const refresh = () => {
    switch (view) {
      case 'explorer':
        send({ type: 'ListDirectory', path: '.' });
        break;
      case 'changes':
        send({ type: 'GetRepoStatus' });
        send({ type: 'GetChangedFiles', mode: 'working' });
        break;
      case 'git':
        send({ type: 'GetRepoStatus' });
        send({ type: 'GetCommitHistory', limit: 20 });
        send({ type: 'ListBranches' });
        break;
      case 'agents':
        send({ type: 'ListAgents' });
        send({ type: 'ListCatalog' });
        break;
      default:
        send({ type: 'GetRepoStatus' });
        send({ type: 'GetChangedFiles', mode: 'working' });
        send({ type: 'GetCommitHistory', limit: 20 });
        if (state.activeSession) send({ type: 'ListRuns', session_id: state.activeSession });
    }
  };

  const connectionStatus = state.connection.status;
  const statusColor =
    connectionStatus === 'connected'
      ? 'var(--accent-primary)'
      : connectionStatus === 'connecting'
        ? 'var(--accent-warn)'
        : 'var(--accent-error)';

  return (
    <div
      ref={barRef}
      style={{
        height: 'var(--chrome-height)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--tint-border)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 12,
        gap: 10,
        flexShrink: 0,
        position: 'relative',
        zIndex: 40,
        fontFamily: 'var(--font-display)',
      }}
    >
      {/* Drawer trigger (mobile only) */}
      {mobile && (
        <button
          onClick={onOpenDrawer}
          aria-label="Open navigation"
          title="Navigation"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, flexShrink: 0,
            background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: 'pointer', padding: 0,
          }}
        >
          <Menu size={18} strokeWidth={1.9} />
        </button>
      )}

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {/* The workspace switcher doubles as the Overview link on desktop; on a
            phone the drawer owns both jobs, so the bar keeps only the title. */}
        {!mobile && (
          <>
            <button
              onClick={() => dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'overview' })}
              title={active?.project_root ?? 'No workspace'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 'var(--font-size-body)',
                fontFamily: 'var(--font-display)',
                maxWidth: 220,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                backgroundColor: statusColor,
                flexShrink: 0,
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {active ? projectName(active.project_root) : 'No workspace'}
              </span>
            </button>

            <ChevronRight size={13} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </>
        )}

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-primary)', fontSize: 'var(--font-size-title)', fontWeight: 600, letterSpacing: '-0.01em', minWidth: 0 }}>
          <meta.Icon size={15} strokeWidth={1.9} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </span>
      </div>

      {/* Meta chips — desktop only; the drawer and StatusBar carry this on a phone. */}
      {!mobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {repo && (
            <span style={chipStyle} title="Current branch">
              <GitBranch size={11} strokeWidth={2} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>{repo.branch}</span>
            </span>
          )}
          {dirtyTotal > 0 ? (
            <button
              onClick={() => dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'changes' })}
              style={{ ...chipStyle, color: 'var(--accent-warn)', cursor: 'pointer' }}
              title="Uncommitted changes"
            >
              {dirtyTotal} changed
            </button>
          ) : repo ? (
            <span style={{ ...chipStyle, color: 'var(--text-muted)' }}>clean</span>
          ) : null}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Contextual primary action */}
      <button
        onClick={refresh}
        title={`Reload ${meta.label.toLowerCase()}`}
        aria-label={`Reload ${meta.label.toLowerCase()}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, padding: mobile ? 0 : '0 10px',
          width: mobile ? 30 : undefined,
          justifyContent: 'center',
          // Longhands, not `border`: the hover handlers below mutate
          // borderColor imperatively, and shorthand+longhand mixing makes React
          // lose the colour on the next rerender.
          borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--tint-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
          fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-small)', fontWeight: 550,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--tint-border)'; }}
      >
        <RefreshCw size={13} strokeWidth={2} />
        {!mobile && 'Refresh'}
      </button>

      {/* Layout presets — desktop only. A phone shows one pane at a time, so
          there is no grid to arrange; the pane switcher covers what is left. */}
      {!mobile && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenu(m => (m === 'layout' ? null : 'layout'))}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 28, padding: '0 10px',
              border: `1px solid ${menu === 'layout' ? 'var(--accent-primary)' : 'var(--tint-border)'}`,
              borderRadius: 'var(--radius-sm)', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-small)', fontWeight: 550,
            }}
            title="Pane layout presets"
          >
            Layout
            <ChevronDown size={13} strokeWidth={2} style={{ opacity: 0.6 }} />
          </button>
          {menu === 'layout' && (
            <div style={popoverStyle}>
              {LAYOUTS.map(({ preset, label, Icon }) => (
                <div
                  key={preset}
                  onClick={() => { onLayoutPreset?.(preset); setMenu(null); }}
                  style={popoverRowStyle}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Icon size={14} strokeWidth={1.9} />
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Command palette hint — desktop only; there is no ⌘K on a phone. */}
      {!mobile && (
        <span
          title="Command palette (⌘K)"
          style={{
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 7px',
            border: '1px solid var(--tint-border)',
            borderRadius: 'var(--radius-xs)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-micro)',
            letterSpacing: '0.04em',
          }}
        >
          ⌘K
        </span>
      )}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 22,
  padding: '0 8px',
  border: '1px solid var(--tint-border)',
  borderRadius: 'var(--radius-pill)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-micro)',
  whiteSpace: 'nowrap',
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  minWidth: 190,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-overlay)',
  padding: 6,
  zIndex: 50,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-small)',
};

const popoverRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 9px',
  borderRadius: 'var(--radius-xs)',
  cursor: 'pointer',
  color: 'var(--text-primary)',
};
