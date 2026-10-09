// TopBar — page header for the active view.
//
// Navigation lives in the rail; this band answers only three questions:
// where am I (breadcrumb + title), what is the state of this view (meta chips),
// and what can I do here (contextual primary action, layout, command palette).

import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, FolderTree, FileDiff, GitBranch, Users, GitFork,
  ChevronDown, ChevronRight, TerminalSquare, Bot, Globe, RefreshCw,
  SlidersHorizontal, Menu, Check, Bookmark, Plus, X, History,
} from 'lucide-react';
import { useAppState } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import type { SidebarView } from '../types/sidebar';
import { openNavPane } from '../core/openNavPane';
import { LAYOUT_PRESETS, LAYOUT_PRESET_ORDER } from '../core/layoutPresets';
import type { CustomPreset } from '../state/customPresets';

type View = SidebarView;

type ChromeIcon = React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;

const VIEW_META: Record<View, { label: string; Icon: ChromeIcon }> = {
  overview: { label: 'Overview', Icon: LayoutDashboard },
  runs: { label: 'Runs', Icon: History },
  explorer: { label: 'Files', Icon: FolderTree },
  changes: { label: 'Changes', Icon: FileDiff },
  git: { label: 'Git', Icon: GitBranch },
  agents: { label: 'Agents', Icon: Users },
  settings: { label: 'Settings', Icon: SlidersHorizontal },
};

// Icons are presentation, so they live with the chrome rather than in the
// preset table; the labels and the order come from there.
const PRESET_ICONS: Record<string, ChromeIcon> = {
  terminal: TerminalSquare,
  ai: Bot,
  git: GitFork,
  browser: Globe,
  changes: FileDiff,
};

interface AppChromeProps {
  /** The navigation destination currently on screen, or null when the surface
   *  is showing no destination (a bare Terminal). Derived from the layout by
   *  App.tsx — the chrome never decides where it is, it reports it. */
  view?: SidebarView | null;
  onLayoutPreset?: (preset: string) => void;
  /** Which preset the current layout matches, or null when it is hand-built.
   *  Drives the check mark and tells the user whether switching loses work. */
  activePreset?: string | null;
  /** The user's own saved arrangements, listed under the built-ins. */
  customPresets?: CustomPreset[];
  /** Save the current pane tree under a name the user types. */
  onSaveLayout?: (label: string) => void;
  /** Forget a saved arrangement. */
  onDeletePreset?: (id: string) => void;
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

export function AppChrome({
  view = null,
  onLayoutPreset,
  activePreset = null,
  customPresets = [],
  onSaveLayout,
  onDeletePreset,
  mobile = false,
  onOpenDrawer,
  titleOverride,
}: AppChromeProps) {
  const state = useAppState();
  const send = useSend();

  const [menu, setMenu] = useState<null | 'layout'>(null);
  // Naming the layout happens inline in the popover: a modal for one text field
  // would be heavier than the thing it names.
  const [savingLayout, setSavingLayout] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setMenu(null);
        setSavingLayout(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const closeMenu = () => {
    setMenu(null);
    setSavingLayout(false);
    setNewLabel('');
  };

  const commitSave = () => {
    onSaveLayout?.(newLabel);
    closeMenu();
  };

  const meta = view ? VIEW_META[view] : null;
  // No destination open means no view title. A phone still names the pane it is
  // showing (titleOverride); on the desktop the breadcrumb ends at the
  // workspace rather than naming a view that is not on screen.
  const title = titleOverride ?? meta?.label ?? '';
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
      case 'runs':
        if (state.activeSession) {
          // Every run the project has, not just this session's: a project
          // accumulates a session per StartSession, so the session-scoped list
          // hides most of the history.
          send({ type: 'ListRuns', session_id: state.activeSession, all_sessions: true });
        }
        send({ type: 'ListAgents' });
        break;
      default:
        send({ type: 'GetRepoStatus' });
        send({ type: 'GetChangedFiles', mode: 'working' });
        send({ type: 'GetCommitHistory', limit: 20 });
        if (state.activeSession) send({ type: 'ListRuns', session_id: state.activeSession, all_sessions: true });
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
              onClick={() => openNavPane('overview')}
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

        {title && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-primary)', fontSize: 'var(--font-size-title)', fontWeight: 600, letterSpacing: '-0.01em', minWidth: 0 }}>
            {meta && <meta.Icon size={15} strokeWidth={1.9} style={{ flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          </span>
        )}
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
              onClick={() => openNavPane('changes')}
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

      {/* Contextual primary action — reloads the open destination's data. With
          no destination on screen there is nothing to reload, so it is absent
          rather than present-and-inert. */}
      {view && meta && (
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
      )}

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
              {LAYOUT_PRESET_ORDER.map((id) => {
                const preset = LAYOUT_PRESETS[id];
                const Icon = PRESET_ICONS[id];
                if (!preset || !Icon) return null;
                const isActive = activePreset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    title={preset.description}
                    onClick={() => { onLayoutPreset?.(id); closeMenu(); }}
                    style={{
                      ...popoverRowStyle,
                      ...rowResetStyle,
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                      fontWeight: isActive ? 600 : 500,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Icon size={14} strokeWidth={1.9} />
                    <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{preset.label}</span>
                    {isActive && <Check size={13} strokeWidth={2.4} />}
                  </button>
                );
              })}

              {/* The user's own arrangements. Five fixed trees are not enough —
                  this is where "Terminal + changes + Git" lives. */}
              {customPresets.length > 0 && (
                <>
                  <div style={popoverSectionStyle}>Your layouts</div>
                  {customPresets.map((preset) => {
                    const isActive = activePreset === preset.id;
                    return (
                      <div key={preset.id} style={{ display: 'flex', alignItems: 'center' }}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isActive}
                          onClick={() => { onLayoutPreset?.(preset.id); closeMenu(); }}
                          style={{
                            ...popoverRowStyle,
                            ...rowResetStyle,
                            flex: 1,
                            minWidth: 0,
                            color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                            fontWeight: isActive ? 600 : 500,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Bookmark size={14} strokeWidth={1.9} />
                          <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {preset.label}
                          </span>
                          {isActive && <Check size={13} strokeWidth={2.4} />}
                        </button>
                        <button
                          type="button"
                          title={`Delete “${preset.label}”`}
                          aria-label={`Delete ${preset.label}`}
                          onClick={() => onDeletePreset?.(preset.id)}
                          style={presetDeleteBtnStyle}
                        >
                          <X size={12} strokeWidth={2.2} />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              <div style={popoverDividerStyle} />

              {/* Saving is the whole point of the custom library, so it is a row
                  of the menu rather than something buried in Settings. */}
              {savingLayout ? (
                <input
                  autoFocus
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitSave();
                    if (e.key === 'Escape') { setSavingLayout(false); setNewLabel(''); }
                  }}
                  placeholder="Name this layout"
                  aria-label="Layout name"
                  style={popoverInputStyle}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setSavingLayout(true)}
                  style={{ ...popoverRowStyle, ...rowResetStyle }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Plus size={14} strokeWidth={2} />
                  <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>Save current layout…</span>
                </button>
              )}

              {/* Only worth saying when it is true: a preset is a whole-layout
                  replacement, so a hand-built arrangement is about to go. */}
              {activePreset === null && (
                <div style={popoverNoteStyle}>
                  Your layout is custom — picking a preset replaces it.
                </div>
              )}
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

/** Reset the browser's button chrome so a row can be a real <button> (focusable,
 *  keyboard-operable) without looking like one. */
const rowResetStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 'inherit',
};

const popoverNoteStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '6px 9px 2px',
  borderTop: '1px solid var(--tint-border)',
  color: 'var(--text-muted)',
  fontSize: 'var(--font-size-micro)',
  lineHeight: 1.45,
};

const popoverSectionStyle: React.CSSProperties = {
  padding: '8px 9px 4px',
  marginTop: 4,
  borderTop: '1px solid var(--tint-border)',
  color: 'var(--text-muted)',
  fontSize: 'var(--font-size-micro)',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
};

const popoverDividerStyle: React.CSSProperties = {
  height: 1,
  margin: '6px 4px',
  background: 'var(--tint-border)',
};

const popoverInputStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 9px',
  background: 'var(--bg-base)',
  // Longhands: the focus ring below mutates borderColor imperatively.
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--accent-primary)',
  borderRadius: 'var(--radius-xs)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-small)',
  outline: 'none',
  boxSizing: 'border-box',
};

const presetDeleteBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  flexShrink: 0,
  border: 'none',
  background: 'transparent',
  borderRadius: 'var(--radius-xs)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};
