import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  hexToRgbTriplet,
  parseHex,
  readableForeground,
  relativeLuminance,
} from './color';

describe('parseHex', () => {
  it('parses 6-digit hex', () => {
    expect(parseHex('#4f46e5')).toEqual({ r: 79, g: 70, b: 229 });
  });

  it('expands 3-digit shorthand', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('accepts a missing leading hash', () => {
    expect(parseHex('000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns null for junk', () => {
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('#gggggg')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('hexToRgbTriplet', () => {
  it('formats for rgba(var(--x-rgb), a)', () => {
    expect(hexToRgbTriplet('#0d9488')).toBe('13, 148, 136');
  });

  it('falls back to the default accent when unparsable', () => {
    expect(hexToRgbTriplet('nope')).toBe('79, 70, 229');
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('measures white and black at the extremes', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('gives 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#4f46e5', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#4f46e5'),
      6,
    );
  });
});

describe('readableForeground', () => {
  it('picks white on a dark accent', () => {
    expect(readableForeground('#4f46e5')).toBe('#ffffff');
    expect(readableForeground('#2563eb')).toBe('#ffffff');
  });

  it('picks near-black on a light accent', () => {
    expect(readableForeground('#818cf8')).toBe('#0b0d0c');
    expect(readableForeground('#2dd4bf')).toBe('#0b0d0c');
  });

  it('always clears 4.5:1 against the accent it is chosen for', () => {
    const samples = ['#4f46e5', '#818cf8', '#f0a83c', '#b45309', '#0d9488', '#f472b6'];
    for (const hex of samples) {
      const fg = readableForeground(hex);
      expect(contrastRatio(hex, fg), `${hex} vs ${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});