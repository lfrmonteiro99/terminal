// navViews — the one place that says what a navigation destination *is*.
//
// A destination is a pane kind. The rail, the chrome breadcrumb, the status
// bar, the command palette and Overview's own cards all name a `SidebarView`;
// this module turns that name into the pane that hosts it, and turns a layout
// back into the name for whoever is drawing the rail highlight or the chrome
// title.
//
// That second direction is why this is not just a lookup table. The layout is
// the surface: it is the only thing that knows what is actually on screen. When
// `activeSidebarView` lived in the reducer, the app had two owners for one fact,
// and they disagreed the moment they were set by different paths — a restored
// session showed the saved destination in the title while the layout restored a
// plain Terminal, so the chrome named a view that was not open. Deriving it
// instead makes that state unrepresentable.

import { collectPanes, type PaneKind, type PaneLayout } from '../domain/pane/types';
import type { SidebarView } from '../types/sidebar';

/** Rail destination → the pane kind that hosts it. One entry per SidebarView,
 *  so adding a destination is a compile error until it has somewhere to go. */
export const NAV_PANE_KIND: Record<SidebarView, PaneKind> = {
  overview: 'Overview',
  runs: 'Runs',
  explorer: 'FileExplorer',
  changes: 'Changes',
  git: 'Git',
  agents: 'Agents',
  settings: 'Settings',
};

/** The pane kinds that are navigation destinations — at most one of these is
 *  on screen at a time. */
export const NAV_KINDS: ReadonlySet<PaneKind> = new Set<PaneKind>(Object.values(NAV_PANE_KIND));

const VIEW_OF_KIND = new Map<PaneKind, SidebarView>(
  (Object.keys(NAV_PANE_KIND) as SidebarView[]).map(view => [NAV_PANE_KIND[view], view]),
);

/**
 * Which destination the layout is showing, or null when it is showing none.
 *
 * The focused pane wins when it is a destination — the chrome describes what
 * you are looking at, not what you last clicked. Otherwise any destination on
 * screen counts, because a pane the user deliberately opened is still live
 * behind the terminal and its Refresh action still applies to it.
 *
 * null is a real answer, not a failure: a fresh session is one Terminal and no
 * destination, and the chrome says so instead of naming the default view.
 */
export function navViewOf(layout: PaneLayout, focusedPaneId: string | null): SidebarView | null {
  const panes = collectPanes(layout);

  const focused = panes.find(p => p.id === focusedPaneId);
  const fromFocused = focused ? VIEW_OF_KIND.get(focused.kind) : undefined;
  if (fromFocused) return fromFocused;

  const open = panes.find(p => NAV_KINDS.has(p.kind));
  return open ? VIEW_OF_KIND.get(open.kind) ?? null : null;
}
