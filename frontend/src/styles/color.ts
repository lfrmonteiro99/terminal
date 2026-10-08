// Colour helpers shared by the theming layer.
//
// Kept dependency-free and pure so they can be unit-tested without a DOM.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse "#rgb" or "#rrggbb" into components. Returns null when unusable. */
export function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, '');
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (normalized.length !== 6 || /[^0-9a-fA-F]/.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

/** "r, g, b" string, usable inside `rgba(var(--x-rgb), a)`. */
export function hexToRgbTriplet(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '79, 70, 229'; // fallback: default accent (indigo)
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

function toLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/**
 * Contrast ratio between two colours (1 … 21). Used by tests to prove the
 * accent stays legible against its own foreground.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Foreground that stays readable on top of `hex`.
 *
 * Threshold is the WCAG crossover point (L ≈ 0.179): below it white text wins,
 * above it near-black wins. Using a higher threshold would put white text on
 * mid-tone accents like indigo-400, which drops to ~3:1 and fails AA.
 */
export function readableForeground(hex: string): string {
  return relativeLuminance(hex) > 0.18 ? '#0b0d0c' : '#ffffff';
}
