import { describe, it, expect, beforeEach } from 'vitest';
import { contrastRatio, readableForeground } from './color';
import { ACCENTS, DEFAULT_ACCENT_ID, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, LIGHT_THEME_IDS, findAccent } from './palettes';
import {
  ACCENT_KEY,
  APPEARANCE_KEY,
  THEME_KEY,
  accentHex,
  applyAccent,
  applyAppearance,
  applyThemeId,
  currentAppearance,
  loadSavedScheme,
  savedAccentId,
  setScheme,
} from './appearance';
import { themes } from './themes';

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root().dataset.theme;
  delete root().dataset.appearance;
  for (const prop of ['--accent-primary', '--accent-primary-rgb', '--accent-fg', '--border-focus']) {
    root().style.removeProperty(prop);
  }
});

describe('accent palettes', () => {
  it('every palette clears AA against the foreground chosen for it, in both appearances', () => {
    for (const palette of ACCENTS) {
      for (const appearance of ['dark', 'light'] as const) {
        const hex = accentHex(palette, appearance);
        const fg = readableForeground(hex);
        const ratio = contrastRatio(hex, fg);
        expect(ratio, `${palette.id}/${appearance} ${hex} vs ${fg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('dark and light tones differ so the accent stays legible on both canvases', () => {
    for (const palette of ACCENTS) {
      expect(palette.dark, palette.id).not.toBe(palette.light);
    }
  });

  it('ids are unique', () => {
    const ids = ACCENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scheme ids', () => {
  it('the default schemes exist in the theme table', () => {
    expect(themes.some((t) => t.id === DEFAULT_DARK_THEME_ID)).toBe(true);
    expect(themes.some((t) => t.id === DEFAULT_LIGHT_THEME_ID)).toBe(true);
  });

  it('every light theme id is a real theme', () => {
    for (const id of LIGHT_THEME_IDS) {
      expect(themes.some((t) => t.id === id), id).toBe(true);
    }
  });
});

describe('applyAccent', () => {
  it('writes the accent variables and the rgb triplet', () => {
    applyAccent('indigo', 'dark');
    expect(root().style.getPropertyValue('--accent-primary')).toBe('#818cf8');
    expect(root().style.getPropertyValue('--accent-primary-rgb')).toBe('129, 140, 248');
    expect(root().style.getPropertyValue('--border-focus')).toBe('#818cf8');
  });

  it('resolves a different hex per appearance', () => {
    applyAccent('indigo', 'dark');
    const dark = root().style.getPropertyValue('--accent-primary');
    applyAccent('indigo', 'light');
    const light = root().style.getPropertyValue('--accent-primary');
    expect(dark).not.toBe(light);
  });

  it('falls back to the default when the id is unknown', () => {
    applyAccent('not-a-palette');
    expect(root().style.getPropertyValue('--accent-primary')).toBe(
      accentHex(findAccent(DEFAULT_ACCENT_ID)!, 'dark'),
    );
    expect(localStorage.getItem(ACCENT_KEY)).toBe(DEFAULT_ACCENT_ID);
  });
});

describe('setScheme', () => {
  it('is the single writer of both data attributes', () => {
    setScheme('dracula', 'dark', 'teal');
    expect(root().dataset.theme).toBe('dracula');
    expect(root().dataset.appearance).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dracula');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
  });

  it('re-derives the accent when the appearance flips', () => {
    setScheme('terminal-engine', 'dark', 'teal');
    const onDark = root().style.getPropertyValue('--accent-primary');
    setScheme('terminal-engine-light', 'light', 'teal');
    const onLight = root().style.getPropertyValue('--accent-primary');
    expect(onDark).not.toBe('');
    expect(onLight).not.toBe('');
    expect(onDark).not.toBe(onLight);
  });
});

describe('applyAppearance', () => {
  it('light picks the light default scheme', () => {
    applyAppearance('light', 'indigo');
    expect(root().dataset.appearance).toBe('light');
    expect(root().dataset.theme).toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it('dark picks the dark default scheme', () => {
    applyAppearance('light', 'indigo');
    applyAppearance('dark', 'indigo');
    expect(root().dataset.appearance).toBe('dark');
    expect(root().dataset.theme).toBe(DEFAULT_DARK_THEME_ID);
  });
});

describe('applyThemeId', () => {
  it('derives light appearance from a light palette', () => {
    applyThemeId('github-light', 'blue');
    expect(currentAppearance()).toBe('light');
  });

  it('derives dark appearance from a dark palette', () => {
    applyThemeId('nord', 'blue');
    expect(currentAppearance()).toBe('dark');
  });

  it('keeps the accent across a theme change', () => {
    applyAccent('rose', 'dark');
    applyThemeId('nord');
    expect(savedAccentId()).toBe('rose');
    expect(root().style.getPropertyValue('--accent-primary')).toBe(
      accentHex(findAccent('rose')!, 'dark'),
    );
  });
});

describe('loadSavedScheme', () => {
  it('restores theme, appearance and accent from storage', () => {
    localStorage.setItem(THEME_KEY, 'github-light');
    localStorage.setItem(ACCENT_KEY, 'amber');
    loadSavedScheme();
    expect(root().dataset.theme).toBe('github-light');
    expect(root().dataset.appearance).toBe('light');
    expect(savedAccentId()).toBe('amber');
  });

  it('defaults to the dark scheme on a clean profile', () => {
    loadSavedScheme();
    expect(root().dataset.theme).toBe(DEFAULT_DARK_THEME_ID);
    expect(root().dataset.appearance).toBe('dark');
    expect(savedAccentId()).toBe(DEFAULT_ACCENT_ID);
  });
});