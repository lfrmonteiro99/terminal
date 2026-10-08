// SidebarContainer — the navigation rail plus the resizable content panel.
//
// Desktop: the rail (NavRail) is always visible and the panel holds the list
// surface for the selected view. Overview and Settings are full-width pages,
// so the panel is hidden while they are active.
//
// Phone: there is no room for a 280px rail next to the work, so navigation
// moves into an off-canvas drawer that the AppChrome hamburger opens. The
// drawer holds the rail only; the selected view's content is rendered by App
// as a full-width overlay, the same treatment Overview/Settings already get.

import { useCallback, useState } from 'react';
import { useAppState } from '../../context/AppContext';
import { NavRail } from '../nav/NavRail';
import { SessionStrip } from './SessionStrip';
import { ExplorerView } from './ExplorerView';
import { ChangesView } from './ChangesView';
import { GitView } from './GitView';
import { AgentsView } from './AgentsView';
import { ResizeHandle } from '../ResizeHandle';

const MIN_WIDTH = 220;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 280;
const STORAGE_KEY = 'sidebar-width';

function getStoredWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  }
  return DEFAULT_WIDTH;
}

interface SidebarContainerProps {
  /** Phone form: render as an off-canvas drawer instead of a fixed column. */
  mobile?: boolean;
  /** Drawer visibility (mobile only). */
  mobileOpen?: boolean;
  /** Close the drawer — scrim tap, or choosing a destination. */
  onMobileClose?: () => void;
}

export function SidebarContainer({ mobile = false, mobileOpen = false, onMobileClose }: SidebarContainerProps) {
  const state = useAppState();
  const [width, setWidth] = useState(getStoredWidth);

  const handleResize = useCallback((delta: number) => {
    setWidth((prev) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, prev + delta)));
  }, []);

  const handleResizeEnd = useCallback(() => {
    setWidth((current) => {
      localStorage.setItem(STORAGE_KEY, current.toString());
      return current;
    });
  }, []);

  if (mobile) {
    if (!mobileOpen) return null;
    return (
      <>
        <div className="drawer-scrim" onClick={onMobileClose} aria-hidden="true" />
        <div
          role="dialog"
          aria-label="Navigation"
          className="mobile-scroll"
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            left: 0,
            width: 'min(300px, 84vw)',
            zIndex: 61,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-base)',
            boxShadow: 'var(--shadow-overlay)',
            paddingLeft: 'env(safe-area-inset-left, 0px)',
            animation: 'drawer-in 180ms var(--ease-out-expo, ease-out)',
          }}
        >
          <NavRail onNavigate={onMobileClose} showCollapse={false} forceExpanded />
        </div>
      </>
    );
  }

  // Overview and Settings are full-width pages, not list surfaces.
  const showPanel =
    !state.sidebarCollapsed &&
    state.activeSidebarView !== 'overview' &&
    state.activeSidebarView !== 'settings';

  const ActiveView = (() => {
    switch (state.activeSidebarView) {
      case 'explorer': return ExplorerView;
      case 'changes': return ChangesView;
      case 'git': return GitView;
      case 'agents': return AgentsView;
      default: return ExplorerView;
    }
  })();

  return (
    <>
      <NavRail />
      {showPanel && (
        <div style={{
          width,
          flexShrink: 0,
          backgroundColor: 'var(--bg-surface)',
          borderRight: '1px solid var(--tint-border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--font-size-small)',
        }}>
          <SessionStrip />
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <ActiveView />
          </div>
        </div>
      )}
      {showPanel && (
        <ResizeHandle direction="horizontal" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      )}
    </>
  );
}