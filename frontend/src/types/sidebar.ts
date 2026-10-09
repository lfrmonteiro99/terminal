// SidebarView — the name of a navigation destination.
//
// This union used to be copy-pasted into four files, so adding a destination
// silently broke the ones that were missed (the persisted session store was
// typed to the old, narrower set).
//
// Every destination opens as a pane of its own kind (`NAV_PANE_KIND` in
// `core/navViews.ts`), and which one is on screen is *derived* from the pane
// layout — `navViewOf` in the same module. Nothing stores the current
// destination: the layout is the surface, so it is the only thing that knows.
// `SidebarView` therefore names a place, and the layout decides whether that
// place is open.

export type SidebarView =
  | 'overview'
  | 'runs'
  | 'explorer'
  | 'changes'
  | 'git'
  | 'agents'
  | 'settings';

export const SIDEBAR_VIEWS: readonly SidebarView[] = [
  'overview',
  'runs',
  'explorer',
  'changes',
  'git',
  'agents',
  'settings',
];
