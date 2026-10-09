// openNavPane — the single funnel from a navigation click to the pane surface.
//
// The rail, the chrome breadcrumb, the status bar, the command palette and
// Overview's own cards all mean the same thing by "go to Files": open that
// destination as a pane. None of them can reach App's layout state, so they
// announce it and App.tsx applies the policy (focus the pane if it is already
// open, otherwise take over the focused slot, splitting only when that slot
// holds real work).
//
// Same shape as the existing `open-file-viewer` / `set-pane-type` bridges: five
// call sites, one owner. Threading a callback through four components to say
// one sentence would cost more than it explains.

import type { SidebarView } from '../types/sidebar';

/** Window event App.tsx listens for. */
export const OPEN_NAV_PANE = 'open-nav-pane';

export function openNavPane(view: SidebarView): void {
  window.dispatchEvent(new CustomEvent(OPEN_NAV_PANE, { detail: { view } }));
}
