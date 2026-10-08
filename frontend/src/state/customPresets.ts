// Custom layout presets — the user's own pane arrangements.
//
// Why this exists: the built-in presets are five fixed trees, so "Terminal +
// changes + Git" could only be built by hand — and the next preset click threw
// it away with nowhere to get it back. Saving the current layout as a named
// preset is what makes the system composable without shipping a grid editor.
//
// Stored apart from the live workspace layout (state/layout-persistence.ts):
// that one is the arrangement on screen right now, this one is a library of
// arrangements you can return to.

import type { PaneLayout } from '../domain/pane/types';

export interface CustomPreset {
  id: string;
  label: string;
  layout: PaneLayout;
}

const STORAGE_KEY = 'terminal:custom-layouts';
/** Enough for a personal library, small enough that the menu stays a menu. */
export const MAX_CUSTOM_PRESETS = 12;

export function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Anything can be in localStorage — a half-written value or a payload from
    // an older shape must not take the whole app down at boot.
    return arr.filter(
      (p): p is CustomPreset =>
        !!p &&
        typeof (p as CustomPreset).id === 'string' &&
        typeof (p as CustomPreset).label === 'string' &&
        !!(p as CustomPreset).layout,
    );
  } catch {
    return [];
  }
}

function write(presets: CustomPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage may be full — silently ignore, as layout-persistence does.
  }
}

/**
 * Append a preset and return the new list. `id` is passed in rather than
 * generated here so the caller owns identity and this stays unit-testable
 * without stubbing crypto.
 */
export function addCustomPreset(label: string, layout: PaneLayout, id: string): CustomPreset[] {
  const trimmed = label.trim();
  const next = [
    ...loadCustomPresets(),
    { id, label: trimmed === '' ? 'Untitled layout' : trimmed, layout },
  ];
  // Drop the oldest rather than refusing to save — the layout on screen is
  // what the user just asked to keep.
  const capped = next.length > MAX_CUSTOM_PRESETS ? next.slice(next.length - MAX_CUSTOM_PRESETS) : next;
  write(capped);
  return capped;
}

export function removeCustomPreset(id: string): CustomPreset[] {
  const next = loadCustomPresets().filter((p) => p.id !== id);
  write(next);
  return next;
}
