/// <reference types="node" />
// Terminal ANSI palette invariants.
//
// The 16 ANSI colours are the only place in the design system where we cannot
// use semantic tokens: shell output picks from fixed slots. That makes them
// easy to get wrong silently — a dark-tuned colour on the light canvas is
// unreadable, and a contrast-constrained light set collapses the normal/bright
// pairs into one colour.
//
// These assertions read the real tokens.css, so the claim in its comments is
// checked rather than asserted.
//
// The triple-slash reference above is deliberate: tsconfig.app.json pins
// `types` to ["vite/client"], so node built-ins are not in scope app-wide.
// This is the only test that reads a file from disk, so it opts in locally
// rather than widening the global type surface.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { contrastRatio } from './color';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'tokens.css'), 'utf8');

/** Declarations of the first rule block matching `selector`. */
function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  expect(at, `selector not found in tokens.css: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const SLOTS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'bright-black', 'bright-red', 'bright-green', 'bright-yellow',
  'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white',
] as const;

const NEUTRALS = ['black', 'bright-black', 'white', 'bright-white'] as const;

const dark = block(':root {');
const light = block(':root[data-appearance="light"] {');

describe('terminal ANSI palette', () => {
  it('defines all 16 slots in both appearances', () => {
    for (const [label, tokens] of [['dark', dark], ['light', light]] as const) {
      for (const slot of SLOTS) {
        expect(tokens[`term-${slot}`], `${label} --term-${slot}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('dark: every slot is readable on the dark canvas', () => {
    const bg = dark['bg-base'];
    for (const slot of SLOTS) {
      const hex = dark[`term-${slot}`];
      // `black` exists to be dim (comments, de-emphasis); it only has to be
      // visible, not AA.
      const floor = slot === 'black' ? 3 : 4.5;
      const ratio = contrastRatio(hex, bg);
      expect(ratio, `dark ${slot} ${hex} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('light: every slot is readable on the light canvas', () => {
    const bg = light['bg-base'];
    for (const slot of SLOTS) {
      const hex = light[`term-${slot}`];
      const floor = slot === 'black' ? 3 : 4.5;
      const ratio = contrastRatio(hex, bg);
      expect(ratio, `light ${slot} ${hex} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('light: bright slots stay distinguishable from their normal pair', () => {
    const bg = light['bg-base'];
    for (const slot of SLOTS) {
      if (!slot.startsWith('bright-')) continue;
      const normal = slot.slice('bright-'.length);
      if (normal === 'black' || normal === 'white') continue; // neutrals, pinned
      const bright = light[`term-${slot}`];
      const ratio = contrastRatio(bright, bg);
      // A single AA threshold collapses both members of the pair onto the same
      // colour; the bright slot is held to a higher bar so the ladder survives.
      expect(ratio, `light ${slot} ${bright} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(6.5);
      expect(bright, `light ${slot} must differ from ${normal}`).not.toBe(light[`term-${normal}`]);
    }
  });

  it('light: the four neutrals are distinct', () => {
    // Regression guard: deriving them from the dark set flattens all four into
    // the same grey and erases the role difference.
    const seen = NEUTRALS.map((n) => light[`term-${n}`]);
    expect(new Set(seen).size).toBe(NEUTRALS.length);
  });

  it('the two appearances genuinely differ, slot by slot', () => {
    for (const slot of SLOTS) {
      expect(dark[`term-${slot}`], slot).not.toBe(light[`term-${slot}`]);
    }
  });
});