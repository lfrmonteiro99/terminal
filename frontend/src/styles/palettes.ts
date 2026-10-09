// Accent palettes — the user-facing colour choice in Settings.
//
// One palette is two hexes, not one: a mid-tone that reads well on a light
// canvas and a lighter tone for dark surfaces. Same cognitive colour in both
// appearances, tuned per appearance. This is what the old fixed phosphor green
// could not do (it was legible on dark and muddy on light).

export interface AccentPalette {
  id: string;
  name: string;
  /** Primary on dark backgrounds. */
  dark: string;
  /** Primary on light backgrounds. */
  light: string;
}

export const ACCENTS: AccentPalette[] = [
  { id: 'indigo', name: 'Indigo', dark: '#818cf8', light: '#4f46e5' },
  { id: 'blue', name: 'Blue', dark: '#60a5fa', light: '#2563eb' },
  { id: 'violet', name: 'Violet', dark: '#a78bfa', light: '#7c3aed' },
  { id: 'teal', name: 'Teal', dark: '#2dd4bf', light: '#0d9488' },
  { id: 'amber', name: 'Amber', dark: '#f0a83c', light: '#b45309' },
  { id: 'rose', name: 'Rose', dark: '#f472b6', light: '#db2777' },
  { id: 'slate', name: 'Slate', dark: '#a1a1aa', light: '#3f3f46' },
  { id: 'green', name: 'Green', dark: '#35d399', light: '#0d7a45' },
];

export const DEFAULT_ACCENT_ID = 'indigo';

/**
 * Themes whose neutral palette is light. Applying one implies the light
 * appearance; `data-theme` and `data-appearance` are therefore always written
 * together by the same function (appearance.ts `setScheme`), never separately —
 * two writers was the bug that made a light/dark toggle impossible.
 */
export const LIGHT_THEME_IDS: ReadonlySet<string> = new Set([
  'terminal-engine-light',
  'github-light',
  'catppuccin-latte',
  'solarized-light',
]);

export const DEFAULT_DARK_THEME_ID = 'terminal-engine';
export const DEFAULT_LIGHT_THEME_ID = 'terminal-engine-light';

export function findAccent(id: string): AccentPalette | undefined {
  return ACCENTS.find((a) => a.id === id);
}
