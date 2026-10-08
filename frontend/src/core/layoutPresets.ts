// Layout presets — the single source of truth for the four-plus-one pane
// arrangements offered by the Layout menu, the command palette and the
// Ctrl+Alt+N shortcuts.
//
// Labels live here and nowhere else. They used to be duplicated: the chrome
// popover had its own hardcoded array ('Terminal only') while the palette and
// the cheatsheet rendered 'Terminal Focus' from this table, so the same command
// answered to two names. Anything that needs to show a preset reads it here.
//
// Order is explicit and append-only: Ctrl+Alt+N binds by index, so inserting a
// preset in the middle silently rebinds everyone's muscle memory. New presets go
// on the end.

import type { PaneLayout } from '../domain/pane/types';

export interface LayoutPreset {
  id: string;
  label: string;
  description: string;
  layout: PaneLayout;
}

export const LAYOUT_PRESETS: Record<string, LayoutPreset> = {
  terminal: {
    id: 'terminal',
    label: 'Terminal only',
    description: 'A single terminal pane',
    layout: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
  },
  ai: {
    id: 'ai',
    label: 'AI session',
    description: 'AI run beside the terminal',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.5,
        first: { Single: { id: 'ai-run', kind: 'AiRun', resource_id: null } },
        second: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
      },
    },
  },
  git: {
    id: 'git',
    label: 'Git review',
    description: 'Git status beside the commit history',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.4,
        first: { Single: { id: 'git-status', kind: 'GitStatus', resource_id: null } },
        second: { Single: { id: 'git-history', kind: 'GitHistory', resource_id: null } },
      },
    },
  },
  browser: {
    id: 'browser',
    label: 'Browser + terminal',
    description: 'Terminal beside the embedded browser',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.5,
        first: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
        second: { Single: { id: 'browser-0', kind: 'Browser', resource_id: null } },
      },
    },
  },
  changes: {
    id: 'changes',
    label: 'Terminal + changes',
    description: 'Terminal beside the working-tree changes and their diff',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.5,
        first: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
        second: { Single: { id: 'changes-0', kind: 'Changes', resource_id: null } },
      },
    },
  },
};

/** Binding order for Ctrl+Alt+N. Append only — see the header note. */
export const LAYOUT_PRESET_ORDER: string[] = ['terminal', 'ai', 'git', 'browser', 'changes'];

/**
 * Structural signature of a layout: the arrangement of pane kinds, ignoring
 * ids, ratios and resource links.
 *
 * Those three are exactly the parts that change while you use a preset — you
 * drag the divider, you open a file, a pane gets re-keyed — and none of them
 * mean the arrangement is no longer that preset. Two panes side by side stay
 * two panes side by side after you move the divider.
 */
export function layoutSignature(layout: PaneLayout): string {
  if ('Single' in layout) return layout.Single.kind;
  const s = layout.Split;
  return `${s.direction}(${layoutSignature(s.first)},${layoutSignature(s.second)})`;
}

/**
 * The minimum a preset needs to be matched — enough for the built-in table and
 * for the user's saved layouts (state/customPresets.ts), which carry no
 * description or icon.
 */
export interface PresetLike {
  id: string;
  label: string;
  layout: PaneLayout;
}

/**
 * Which preset, if any, describes this layout. `null` means the layout is the
 * user's own arrangement — which is what the "replace it?" confirmation keys
 * off: switching between presets is free, but overwriting hand-built work is not.
 *
 * `extra` holds the user's saved layouts. They are checked *after* the built-ins
 * so that a saved copy of "Terminal only" still reads as the built-in one.
 */
export function matchPreset(layout: PaneLayout, extra: PresetLike[] = []): string | null {
  const signature = layoutSignature(layout);
  for (const id of LAYOUT_PRESET_ORDER) {
    const preset = LAYOUT_PRESETS[id];
    if (preset && layoutSignature(preset.layout) === signature) return id;
  }
  for (const preset of extra) {
    if (layoutSignature(preset.layout) === signature) return preset.id;
  }
  return null;
}
