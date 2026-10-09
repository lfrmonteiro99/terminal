// navViews tests — the derivation that replaced the stored `activeSidebarView`.
//
// The bug this guards against: a saved session restored its destination next to
// a layout that no longer contained that pane, so the chrome named a view that
// was not open (title "Runs" over a lone Terminal). Deriving the destination
// from the layout makes that state unrepresentable, and these are the cases
// that prove it.

import { describe, it, expect } from 'vitest';
import { NAV_PANE_KIND, NAV_KINDS, navViewOf } from './navViews';
import { SIDEBAR_VIEWS } from '../types/sidebar';
import { splitPane, type PaneKind, type PaneLayout } from '../domain/pane/types';

const single = (kind: PaneKind, id = 'pane'): PaneLayout => ({
  Single: { id, kind, resource_id: null },
});

const terminal = (id = 'terminal-0'): PaneLayout => single('Terminal', id);

describe('navViewOf', () => {
  it('reports no destination for a bare Terminal', () => {
    expect(navViewOf(terminal(), 'terminal-0')).toBeNull();
  });

  it('reports the focused destination', () => {
    expect(navViewOf(single('Runs', 'runs-1'), 'runs-1')).toBe('runs');
  });

  it('reports a destination open behind the work', () => {
    const split = splitPane(terminal(), 'terminal-0', 'Horizontal', 'FileExplorer');
    expect(split).not.toBeNull();
    // Focus stays on the Terminal; the destination is still on screen, and the
    // chrome's Refresh still applies to it.
    expect(navViewOf(split!.layout, 'terminal-0')).toBe('explorer');
  });

  it('prefers the focused destination over another one on screen', () => {
    const withRuns = splitPane(terminal(), 'terminal-0', 'Horizontal', 'Runs')!;
    const withGit = splitPane(withRuns.layout, withRuns.newPaneId, 'Horizontal', 'Git')!;

    expect(navViewOf(withGit.layout, withRuns.newPaneId)).toBe('runs');
    expect(navViewOf(withGit.layout, withGit.newPaneId)).toBe('git');
    // No destination focused: the first one in layout order, so the answer does
    // not flicker as focus moves through the work panes.
    expect(navViewOf(withGit.layout, 'terminal-0')).toBe('runs');
  });

  it('maps every destination to a kind and back', () => {
    for (const view of SIDEBAR_VIEWS) {
      const kind = NAV_PANE_KIND[view];
      expect(NAV_KINDS.has(kind)).toBe(true);
      expect(navViewOf(single(kind, 'x'), 'x')).toBe(view);
    }
  });
});
