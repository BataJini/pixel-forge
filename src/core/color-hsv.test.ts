import { describe, expect, it } from 'vitest';
import { hsvToRgb, rgbToHsv } from './color';
import type { RGBA } from './types';

describe('rgbToHsv', () => {
  it('maps primaries to the right hue with full saturation/value', () => {
    expect(rgbToHsv([255, 0, 0, 255])).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv([0, 255, 0, 255])).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 255, 255])).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('reports zero saturation for grays and value from lightness', () => {
    expect(rgbToHsv([0, 0, 0, 255])).toEqual({ h: 0, s: 0, v: 0 });
    const gray = rgbToHsv([128, 128, 128, 255]);
    expect(gray.h).toBe(0);
    expect(gray.s).toBe(0);
    expect(gray.v).toBeCloseTo(128 / 255, 5);
  });

  it('ignores alpha', () => {
    expect(rgbToHsv([255, 0, 0, 12])).toEqual(rgbToHsv([255, 0, 0, 255]));
  });
});

describe('hsvToRgb', () => {
  it('inverts the primaries', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255, 255]);
  });

  it('wraps the hue mod 360 and clamps s/v and alpha', () => {
    expect(hsvToRgb(360, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(hsvToRgb(-360, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(hsvToRgb(0, 2, 2, 999)).toEqual([255, 0, 0, 255]);
    expect(hsvToRgb(0, -1, 0.5)).toEqual([128, 128, 128, 255]);
  });

  it('carries an explicit alpha through', () => {
    expect(hsvToRgb(0, 1, 1, 128)).toEqual([255, 0, 0, 128]);
  });

  it('handles a non-finite hue as 0', () => {
    expect(hsvToRgb(Number.NaN, 1, 1)).toEqual([255, 0, 0, 255]);
  });
});

describe('rgb <-> hsv round-trip', () => {
  it('is stable (±1 per channel) across a spread of colors', () => {
    const samples: RGBA[] = [
      [255, 106, 26, 255],
      [47, 168, 196, 255],
      [95, 158, 90, 255],
      [18, 16, 14, 255],
      [131, 118, 156, 255],
      [255, 241, 232, 255],
      [0, 228, 54, 255],
      [200, 74, 18, 255],
    ];
    for (const c of samples) {
      const { h, s, v } = rgbToHsv(c);
      const back = hsvToRgb(h, s, v, c[3]);
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(back[i] - c[i])).toBeLessThanOrEqual(1);
      }
    }
  });
});
