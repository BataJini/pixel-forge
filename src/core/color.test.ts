import { describe, expect, it } from 'vitest';
import { hexToRgba, rgbaToHex, tryHexToRgba } from './color';
import type { RGBA } from './types';

describe('rgbaToHex', () => {
  it('formats opaque colors as uppercase #RRGGBB by default', () => {
    expect(rgbaToHex([0, 0, 0, 255])).toBe('#000000');
    expect(rgbaToHex([255, 255, 255, 255])).toBe('#FFFFFF');
    expect(rgbaToHex([255, 106, 26, 255])).toBe('#FF6A1A');
  });

  it('appends alpha only when requested', () => {
    expect(rgbaToHex([18, 16, 14, 128])).toBe('#12100E');
    expect(rgbaToHex([18, 16, 14, 128], true)).toBe('#12100E80');
    expect(rgbaToHex([0, 0, 0, 0], true)).toBe('#00000000');
  });

  it('clamps and rounds out-of-range channels defensively', () => {
    expect(rgbaToHex([-5, 300, 127.6, 255])).toBe('#00FF80');
    expect(rgbaToHex([Number.NaN, 0, 0, 255])).toBe('#000000');
  });
});

describe('hexToRgba', () => {
  it('parses #RRGGBB with implicit full alpha', () => {
    expect(hexToRgba('#FF6A1A')).toEqual([255, 106, 26, 255]);
  });

  it('parses #RGB shorthand by doubling nibbles', () => {
    expect(hexToRgba('#0AF')).toEqual([0, 170, 255, 255]);
    expect(hexToRgba('#fff')).toEqual([255, 255, 255, 255]);
  });

  it('parses #RRGGBBAA with explicit alpha', () => {
    expect(hexToRgba('#12100E80')).toEqual([18, 16, 14, 128]);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(hexToRgba('  #ff6a1a  ')).toEqual([255, 106, 26, 255]);
  });

  it('throws on malformed input (programmer error)', () => {
    expect(() => hexToRgba('ff6a1a')).toThrow();
    expect(() => hexToRgba('#GG0000')).toThrow();
    expect(() => hexToRgba('#12345')).toThrow();
    expect(() => hexToRgba('#')).toThrow();
  });
});

describe('tryHexToRgba (result envelope)', () => {
  it('returns ok for valid hex', () => {
    const r = tryHexToRgba('#39FF14');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([57, 255, 20, 255]);
    }
  });

  it('returns a coded error for invalid hex without throwing', () => {
    for (const bad of ['', 'red', '#12', '#1234567', '#zzzzzz']) {
      const r = tryHexToRgba(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('COLOR_INVALID');
        expect(r.error.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects a non-string input safely', () => {
    const r = tryHexToRgba(undefined as unknown as string);
    expect(r.ok).toBe(false);
  });
});

describe('round-trip property', () => {
  it('rgbaToHex -> hexToRgba is identity for opaque colors', () => {
    const samples: RGBA[] = [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [18, 16, 14, 255],
      [255, 106, 26, 255],
      [47, 168, 196, 255],
    ];
    for (const c of samples) {
      expect(hexToRgba(rgbaToHex(c))).toEqual(c);
    }
  });

  it('preserves alpha across a withAlpha round-trip', () => {
    const samples: RGBA[] = [
      [18, 16, 14, 128],
      [0, 0, 0, 0],
      [255, 176, 58, 200],
    ];
    for (const c of samples) {
      expect(hexToRgba(rgbaToHex(c, true))).toEqual(c);
    }
  });
});
