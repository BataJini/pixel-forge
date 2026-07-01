// Held-out acceptance — U-005 palette system. Builder must NOT edit.
// Targets master-spec §4.4 + §5. Runner: Vitest.
import { describe, it, expect } from 'vitest';
import { BUILTIN_PALETTES, parsePalette } from '../../../src/core/palette';
import { rgbaToHex } from '../../../src/core/color';

const hexes = (id: string): string[] =>
  BUILTIN_PALETTES[id].colors.map((c) => rgbaToHex(c).toUpperCase());

describe('built-in palettes have the exact authoritative hexes', () => {
  it('Game Boy DMG = 4 colors', () => {
    expect(hexes('gameboy')).toEqual(['#0F380F', '#306230', '#8BAC0F', '#9BBC0F']);
  });
  it('PICO-8 = 16 colors in order', () => {
    expect(hexes('pico8')).toEqual([
      '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7',
      '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C',
      '#FF77A8', '#FFCCAA',
    ]);
  });
  it('CGA = 16 colors', () => {
    expect(hexes('cga')).toEqual([
      '#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500',
      '#AAAAAA', '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF',
      '#FFFF55', '#FFFFFF',
    ]);
  });
  it('Commodore 64 (Pepto) = 16 colors', () => {
    expect(hexes('c64')).toEqual([
      '#000000', '#FFFFFF', '#68372B', '#70A4B2', '#6F3D86', '#588D43', '#352879',
      '#B8C76F', '#6F4F25', '#433900', '#9A6759', '#444444', '#6C6C6C', '#9AD284',
      '#6C5EB5', '#959595',
    ]);
  });
  it('NES palette has 52..56 unique colors', () => {
    const nes = hexes('nes');
    expect(nes.length).toBeGreaterThanOrEqual(52);
    expect(nes.length).toBeLessThanOrEqual(56);
    expect(new Set(nes).size).toBe(nes.length); // unique
  });
});

describe('parsePalette', () => {
  it('parses a newline-delimited hex list, ignoring comments/blanks', () => {
    const r = parsePalette('; my palette\n#0F380F\n#306230\n\n#8BAC0F\n', 'hex');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.colors.map((c) => rgbaToHex(c))).toEqual(
      ['#0F380F', '#306230', '#8BAC0F']);
  });
  it('parses a GIMP .gpl file', () => {
    const gpl = 'GIMP Palette\nName: Test\n#\n15 56 15 dark\n48 98 48 mid\n';
    const r = parsePalette(gpl, 'gpl');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.colors[0]).toEqual([15, 56, 15, 255]);
  });
  it('rejects garbage input with an error result (no throw)', () => {
    const r = parsePalette('not a palette at all', 'hex');
    expect(r.ok).toBe(false);
  });
});
