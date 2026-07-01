import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  meetsAA,
  meetsNonTextContrast,
  parseHex,
  relativeLuminance,
} from './contrast';

describe('parseHex', () => {
  it('parses #RRGGBB', () => {
    expect(parseHex('#FF6A1A')).toEqual([255, 106, 26]);
  });
  it('parses shorthand #RGB', () => {
    expect(parseHex('#0F0')).toEqual([0, 255, 0]);
  });
  it('parses #RRGGBBAA ignoring alpha', () => {
    expect(parseHex('#12100E80')).toEqual([18, 16, 14]);
  });
  it('is case- and hash-insensitive', () => {
    expect(parseHex('e8f0ff')).toEqual(parseHex('#E8F0FF'));
  });
  it('throws on malformed input', () => {
    expect(() => parseHex('#zzz')).toThrow();
    expect(() => parseHex('#12')).toThrow();
    expect(() => parseHex('nope')).toThrow();
  });
});

describe('relativeLuminance & contrastRatio', () => {
  it('yields the canonical black/white bounds', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
  });
  it('is 1 for identical colors and order-independent', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 6);
    expect(contrastRatio('#06070C', '#E8F0FF')).toBeCloseTo(
      contrastRatio('#E8F0FF', '#06070C'),
      10,
    );
  });
});

// Criterion 3 (held-out): exact AA assertions for the two contractual ramps.
describe('U-002 criterion 3 — contractual contrast assertions', () => {
  it('Arcade CRT (default) ramp passes', () => {
    expect(contrastRatio('#E8F0FF', '#06070C')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio('#7C86A8', '#06070C')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#06070C', '#00F0FF')).toBeGreaterThanOrEqual(4.5);
  });
  it('Forge ramp passes', () => {
    expect(contrastRatio('#E8DFD2', '#12100E')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio('#8A7E70', '#12100E')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#12100E', '#FF6A1A')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('meets* helpers', () => {
  it('classifies AA correctly', () => {
    expect(meetsAA('#7C86A8', '#06070C')).toBe(true);
    expect(meetsAA('#333333', '#2A2622')).toBe(false);
    expect(meetsNonTextContrast('#FFB03A', '#12100E')).toBe(true);
  });
});
