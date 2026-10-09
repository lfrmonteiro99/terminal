// SidebarView — the single source of truth for which sidebar destination is
// active. This union used to be copy-pasted into four files, so adding a
// destination silently broke the ones that were missed (the persisted session
// store was typed to the old, narrower set).
//
// 'overview' and 'settings' are full-width pages; the rest are list surfaces
// rendered inside the resizable sidebar panel.

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

/** Views that take the whole content area instead of the narrow panel. */
export const FULL_WIDTH_VIEWS: readonly SidebarView[] = ['overview', 'settings'];

export function isFullWidthView(view: SidebarView): boolean {
  return FULL_WIDTH_VIEWS.includes(view);
}