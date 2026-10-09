// Appearance engine — owns the two user-facing layers of the design system.
//
//   appearance (light | dark)  → neutral surfaces, via `data-appearance`
//   accent     (palette id)    → --accent-* variables, inline on <html>
//
// Both are persisted. Keeping them separate is the point: the accent is the
// user's colour, the appearance is the user's light/dark preference, and
// neither one is allowed to decide the other (which is exactly what the old
// "theme" objects did — picking Dracula silently changed your accent).

import { hexToRgbTriplet, readableForeground } from './color';
import {
  DEFAULT_ACCENT_ID,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  LIGHT_THEME_IDS,
  findAccent,
  type AccentPalette,
} from './palettes';

export type Appearance = 'light' | 'dark';

export const APPEARANCE_KEY = 'terminal:appearance';
export const ACCENT_KEY = 'terminal:accent';

/** Appearance currently applied to the document. */
export function currentAppearance(): Appearance {
  return document.documentElement.dataset.appearance === 'light' ? 'light' : 'dark';
}

export function savedAppearance(): Appearance {
  return localStorage.getItem(APPEARANCE_KEY) === 'light' ? 'light' : 'dark';
}

export function savedAccentId(): string {
  const saved = localStorage.getItem(ACCENT_KEY);
  return saved && findAccent(saved) ? saved : DEFAULT_ACCENT_ID;
}

export function accentPalette(id: string = savedAccentId()): AccentPalette {
  return findAccent(id) ?? findAccent(DEFAULT_ACCENT_ID)!;
}

/** The hex a palette resolves to in a given appearance. */
export function accentHex(palette: AccentPalette, appearance: Appearance): string {
  return appearance === 'light' ? palette.light : palette.dark;
}

/**
 * Write the accent variables for `id`. Every derived fill (-08/-15/-25, soft,
 * border) is computed in CSS from --accent-primary-rgb, so only the triplet
 * and the two scalars need to be set here.
 */
export function applyAccent(id: string, appearance: Appearance = currentAppearance()): void {
  const palette = accentPalette(id);
  const hex = accentHex(palette, appearance);
  const root = document.documentElement;
  root.style.setProperty('--accent-primary', hex);
  root.style.setProperty('--accent-primary-rgb', hexToRgbTriplet(hex));
  root.style.setProperty('--accent-fg', readableForeground(hex));
  root.style.setProperty('--border-focus', hex);
  localStorage.setItem(ACCENT_KEY, palette.id);
}

export const THEME_KEY = 'terminal:theme';

/**
 * The single writer of both `data-theme` and `data-appearance`.
 *
 * Keeping them together is deliberate: split writers is what made light mode
 * unreachable (a theme wrote inline neutrals; the appearance block never won).
 */
export function setScheme(themeId: string, mode: Appearance, accentId: string = savedAccentId()): void {
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.dataset.appearance = mode;
  localStorage.setItem(THEME_KEY, themeId);
  localStorage.setItem(APPEARANCE_KEY, mode);
  applyAccent(accentId, mode);
}

/**
 * Light/dark switch. Backed by the default scheme for that appearance, so it is
 * the same mechanism as picking a theme — no second code path to drift.
 */
export function applyAppearance(mode: Appearance, accentId: string = savedAccentId()): void {
  setScheme(mode === 'light' ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID, mode, accentId);
}

/** Apply a neutral palette; the appearance follows the palette's brightness. */
export function applyThemeId(themeId: string, accentId: string = savedAccentId()): void {
  setScheme(themeId, LIGHT_THEME_IDS.has(themeId) ? 'light' : 'dark', accentId);
}

export function savedThemeId(): string {
  return localStorage.getItem(THEME_KEY) ?? DEFAULT_DARK_THEME_ID;
}

/** Applied once before first render. */
export function loadSavedScheme(): void {
  applyThemeId(savedThemeId(), savedAccentId());
}
