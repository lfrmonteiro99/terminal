// SidebarContainer — the navigation rail.
//
// The rail names a destination; the pane surface hosts it. All seven
// destinations (Overview and Settings included) open as panes, so nothing is
// rendered beside the work any more. Before this, a second 220-460px panel
// lived here holding the selected view: navigation and the work shared neither
// a host nor a close button. Both that panel and the phone's separate
// full-surface overlay (MobileViewOverlay) are gone — one mechanism, both form
// factors.
//
// Phone: there is no room for a rail next to the work, so navigation moves into
// an off-canvas drawer that the AppChrome hamburger opens. Choosing a
// destination closes the drawer and reveals the pane it opened.

import type { SidebarView } from '../../types/sidebar';
import { NavRail } from '../nav/NavRail';

interface SidebarContainerProps {
  /** The destination on screen, derived from the layout by App.tsx — the rail
   *  highlight reports it and never sets it. */
  activeView?: SidebarView | null;
  /** Phone form: render as an off-canvas drawer instead of a fixed column. */
  mobile?: boolean;
  /** Drawer visibility (mobile only). */
  mobileOpen?: boolean;
  /** Close the drawer - scrim tap, or choosing a destination. */
  onMobileClose?: () => void;
}

export function SidebarContainer({ activeView = null, mobile = false, mobileOpen = false, onMobileClose }: SidebarContainerProps) {
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
          <NavRail activeView={activeView} onNavigate={onMobileClose} showCollapse={false} forceExpanded />
        </div>
      </>
    );
  }

  // Desktop: the rail is the whole sidebar. Its destinations open as panes.
  return <NavRail activeView={activeView} />;
}
