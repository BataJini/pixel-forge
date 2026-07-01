import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixelMut } from './buffer';
import { rgbaToHex } from './color';
import {
  addSwatch,
  BUILTIN_PALETTE_IDS,
  BUILTIN_PALETTES,
  duplicatePalette,
  filledFromPalette,
  isBuiltinPaletteId,
  MAX_PALETTE_COLORS,
  makePalette,
  moveSwatch,
  nearestPaletteIndex,
  paletteIndexOf,
  paletteSwap,
  parsePalette,
  removeSwatchAt,
  renamePalette,
  serializePalette,
  setSwatchAt,
  snapBufferToPalette,
  snapColorToPalette,
} from './palette';
import type { Palette, PixelBuffer, RGBA } from './types';

const hexesOf = (p: Palette): string[] => p.colors.map((c) => rgbaToHex(c));

function bufferOf(pixels: RGBA[][]): PixelBuffer {
  const h = pixels.length;
  const w = pixels[0].length;
  const buf = createBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixelMut(buf, x, y, pixels[y][x]);
    }
  }
  return buf;
}

describe('BUILTIN_PALETTES', () => {
  it('exposes every documented id with a name, source, and colors', () => {
    for (const id of BUILTIN_PALETTE_IDS) {
      const p = BUILTIN_PALETTES[id];
      expect(p.id).toBe(id);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.source?.length ?? 0).toBeGreaterThan(0);
      expect(p.colors.length).toBeGreaterThan(0);
      for (const c of p.colors) {
        expect(c[3]).toBe(255); // built-ins are fully opaque
      }
    }
  });

  it('Forge Ramp is the 13 design-direction tokens', () => {
    expect(hexesOf(BUILTIN_PALETTES.forge)).toEqual([
      '#12100E',
      '#2A2622',
      '#4A423A',
      '#0C0A08',
      '#8A7E70',
      '#E8DFD2',
      '#FF6A1A',
      '#C24A12',
      '#FFB03A',
      '#FFE08A',
      '#2FA8C4',
      '#5F9E5A',
      '#E23B2E',
    ]);
  });

  it('DawnBringer 16 is a 16-color bonus palette', () => {
    expect(BUILTIN_PALETTES.db16.colors).toHaveLength(16);
    expect(rgbaToHex(BUILTIN_PALETTES.db16.colors[0])).toBe('#140C1C');
  });

  it('isBuiltinPaletteId narrows only real ids', () => {
    expect(isBuiltinPaletteId('pico8')).toBe(true);
    expect(isBuiltinPaletteId('nope')).toBe(false);
    expect(isBuiltinPaletteId(42)).toBe(false);
  });

  it('deep-freezes every built-in so shared state can never be mutated (L-1)', () => {
    for (const id of BUILTIN_PALETTE_IDS) {
      const p = BUILTIN_PALETTES[id];
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.colors)).toBe(true);
      for (const c of p.colors) {
        expect(Object.isFrozen(c)).toBe(true);
      }
    }
    // An in-place write to a frozen built-in tuple throws in strict mode (ESM),
    // instead of silently corrupting the shared palette.
    const first = BUILTIN_PALETTES.pico8.colors[0];
    expect(() => {
      first[0] = 123;
    }).toThrow();
    expect(rgbaToHex(BUILTIN_PALETTES.pico8.colors[0])).toBe('#000000'); // uncorrupted
  });
});

describe('parsePalette — hex', () => {
  it('parses newline hex, skipping comments and blanks', () => {
    const r = parsePalette('; header\n// note\n#0F380F\n\n#306230\n', 'hex');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hexesOf(r.value)).toEqual(['#0F380F', '#306230']);
    }
  });

  it('accepts bare 6-digit hex and #RGB shorthand', () => {
    const r = parsePalette('0F380F\n#0AF\n', 'hex');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hexesOf(r.value)).toEqual(['#0F380F', '#00AAFF']);
    }
  });

  it('rejects garbage and empty input without throwing', () => {
    expect(parsePalette('not a palette at all', 'hex').ok).toBe(false);
    expect(parsePalette('', 'hex').ok).toBe(false);
    expect(parsePalette(';only a comment\n', 'hex').ok).toBe(false);
  });

  it('caps the color count at MAX_PALETTE_COLORS', () => {
    const many = Array.from({ length: MAX_PALETTE_COLORS + 50 }, () => '#123456').join('\n');
    const r = parsePalette(many, 'hex');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.colors).toHaveLength(MAX_PALETTE_COLORS);
    }
  });
});

describe('parsePalette — gpl', () => {
  it('parses GIMP rows and captures the Name header', () => {
    const gpl = 'GIMP Palette\nName: Test Ramp\nColumns: 4\n#\n15 56 15 dark\n48 98 48 mid\n';
    const r = parsePalette(gpl, 'gpl');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Test Ramp');
      expect(r.value.colors[0]).toEqual([15, 56, 15, 255]);
      expect(r.value.colors[1]).toEqual([48, 98, 48, 255]);
    }
  });

  it('rejects a file with no valid color rows', () => {
    expect(parsePalette('GIMP Palette\nName: Empty\n#\n', 'gpl').ok).toBe(false);
    expect(parsePalette('not a palette at all', 'gpl').ok).toBe(false);
  });

  it('sanitizes control characters out of an imported name', () => {
    const r = parsePalette('GIMP Palette\nName: AB\n1 2 3\n', 'gpl');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('A B');
    }
  });
});

describe('parsePalette — pal', () => {
  it('parses a JASC-PAL file', () => {
    const pal = 'JASC-PAL\n0100\n2\n255 0 0\n0 255 0\n';
    const r = parsePalette(pal, 'pal');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.colors).toEqual([
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ]);
    }
  });

  it('falls back to a hex list inside a .pal', () => {
    const r = parsePalette('#0F380F\n#306230\n', 'pal');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hexesOf(r.value)).toEqual(['#0F380F', '#306230']);
    }
  });

  it('rejects an unsupported format', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the defensive default branch.
    expect(parsePalette('#000000', 'bmp' as any).ok).toBe(false);
  });
});

describe('serializePalette', () => {
  it('round-trips through hex export → hex import', () => {
    const source = BUILTIN_PALETTES.gameboy;
    const text = serializePalette(source, 'hex');
    const r = parsePalette(text, 'hex');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hexesOf(r.value)).toEqual(hexesOf(source));
    }
  });

  it('round-trips through gpl export → gpl import (colors + name)', () => {
    const source = renamePalette(BUILTIN_PALETTES.pico8, 'My PICO');
    const text = serializePalette(source, 'gpl');
    expect(text.startsWith('GIMP Palette')).toBe(true);
    const r = parsePalette(text, 'gpl');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hexesOf(r.value)).toEqual(hexesOf(source));
      expect(r.value.name).toBe('My PICO');
    }
  });
});

describe('swatch editors are immutable', () => {
  const base = makePalette('Base', [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ]);

  it('addSwatch appends or inserts without mutating the source', () => {
    const appended = addSwatch(base, [255, 0, 0, 255]);
    expect(base.colors).toHaveLength(2);
    expect(hexesOf(appended)).toEqual(['#000000', '#FFFFFF', '#FF0000']);
    const inserted = addSwatch(base, [255, 0, 0, 255], 1);
    expect(hexesOf(inserted)).toEqual(['#000000', '#FF0000', '#FFFFFF']);
  });

  it('removeSwatchAt / setSwatchAt / moveSwatch update copies only', () => {
    expect(hexesOf(removeSwatchAt(base, 0))).toEqual(['#FFFFFF']);
    expect(hexesOf(setSwatchAt(base, 1, [255, 0, 0, 255]))).toEqual(['#000000', '#FF0000']);
    expect(hexesOf(moveSwatch(base, 0, 1))).toEqual(['#FFFFFF', '#000000']);
    expect(hexesOf(base)).toEqual(['#000000', '#FFFFFF']); // untouched
  });

  it('out-of-range edits are no-ops returning the input', () => {
    expect(removeSwatchAt(base, 9)).toBe(base);
    expect(setSwatchAt(base, -1, [1, 2, 3, 255])).toBe(base);
    expect(moveSwatch(base, 0, 0)).toBe(base);
  });

  it('renamePalette keeps identity/colors and sanitizes the name', () => {
    const renamed = renamePalette(base, '  Ember\tRamp  ');
    expect(renamed.id).toBe(base.id);
    expect(renamed.name).toBe('Ember Ramp');
    expect(renamed.colors).toEqual(base.colors);
  });

  it('duplicatePalette assigns a fresh id', () => {
    const copy = duplicatePalette(base);
    expect(copy.id).not.toBe(base.id);
    expect(hexesOf(copy)).toEqual(hexesOf(base));
  });

  it('editing a built-in re-derives a fresh id out of the built-in namespace (F-4)', () => {
    const edited = setSwatchAt(BUILTIN_PALETTES.pico8, 0, [1, 2, 3, 255]);
    expect(edited.id).not.toBe('pico8');
    expect(isBuiltinPaletteId(edited.id)).toBe(false);
    expect(BUILTIN_PALETTES.pico8.id).toBe('pico8'); // original untouched (frozen)
    expect(rgbaToHex(edited.colors[0])).toBe('#010203');
    // add/remove/move on a built-in also leave the built-in namespace
    expect(isBuiltinPaletteId(addSwatch(BUILTIN_PALETTES.gameboy, [9, 9, 9, 255]).id)).toBe(false);
    expect(isBuiltinPaletteId(removeSwatchAt(BUILTIN_PALETTES.cga, 0).id)).toBe(false);
    expect(isBuiltinPaletteId(moveSwatch(BUILTIN_PALETTES.c64, 0, 1).id)).toBe(false);
  });

  it('editing a custom palette keeps its stable id (only built-ins re-derive)', () => {
    const edited = setSwatchAt(base, 0, [9, 9, 9, 255]);
    expect(edited.id).toBe(base.id);
  });

  it('addSwatch refuses to exceed the cap', () => {
    const full = makePalette(
      'Full',
      Array.from({ length: MAX_PALETTE_COLORS }, () => [1, 2, 3, 255] as RGBA),
    );
    expect(addSwatch(full, [9, 9, 9, 255])).toBe(full);
  });
});

describe('indexed lookups', () => {
  const p = BUILTIN_PALETTES.gameboy;

  it('paletteIndexOf finds exact matches (incl. alpha) or -1', () => {
    expect(paletteIndexOf(p, p.colors[2])).toBe(2);
    expect(paletteIndexOf(p, [1, 2, 3, 255])).toBe(-1);
    expect(paletteIndexOf(p, [p.colors[0][0], p.colors[0][1], p.colors[0][2], 0])).toBe(-1);
  });

  it('nearestPaletteIndex minimizes RGB distance, ties to lower index', () => {
    expect(nearestPaletteIndex(p, [16, 57, 16, 255])).toBe(0); // ~#0F380F
    const dup = makePalette('Dup', [
      [10, 10, 10, 255],
      [10, 10, 10, 255],
    ]);
    expect(nearestPaletteIndex(dup, [10, 10, 10, 255])).toBe(0);
  });

  it('snapColorToPalette keeps transparency and handles empty palettes', () => {
    expect(snapColorToPalette(p, [0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    const empty = makePalette('Empty', []);
    expect(snapColorToPalette(empty, [5, 6, 7, 255])).toEqual([5, 6, 7, 255]);
  });
});

describe('paletteSwap recolors by index', () => {
  const from = BUILTIN_PALETTES.gameboy;
  const to = BUILTIN_PALETTES.pico8;

  it('remaps each palette pixel to the same index in the target', () => {
    const buf = bufferOf([
      [from.colors[0], from.colors[3]],
      [
        [0, 0, 0, 0],
        [123, 45, 67, 255],
      ], // transparent + non-palette
    ]);
    const out = paletteSwap(buf, from, to);
    expect(getPixel(out, 0, 0)).toEqual(to.colors[0]);
    expect(getPixel(out, 1, 0)).toEqual(to.colors[3]);
    expect(getPixel(out, 0, 1)).toEqual([0, 0, 0, 0]); // transparent preserved
    expect(getPixel(out, 1, 1)).toEqual([123, 45, 67, 255]); // non-palette preserved
    // input buffer is untouched (immutable)
    expect(getPixel(buf, 0, 0)).toEqual(from.colors[0]);
  });

  it('leaves pixels unchanged when the target lacks that index', () => {
    const short = makePalette('Short', [to.colors[0]]);
    const buf = bufferOf([[from.colors[2]]]);
    expect(getPixel(paletteSwap(buf, from, short), 0, 0)).toEqual(from.colors[2]);
  });
});

describe('snapBufferToPalette', () => {
  it('quantizes opaque pixels to the nearest palette color, keeping alpha holes', () => {
    const p = BUILTIN_PALETTES.gameboy;
    const buf = bufferOf([
      [
        [17, 58, 17, 255],
        [0, 0, 0, 0],
      ],
    ]);
    const out = snapBufferToPalette(buf, p);
    expect(getPixel(out, 0, 0)).toEqual(p.colors[0]); // snapped to #0F380F
    expect(getPixel(out, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('is a copy when the palette is empty', () => {
    const buf = bufferOf([[[9, 9, 9, 255]]]);
    const out = snapBufferToPalette(buf, makePalette('Empty', []));
    expect(getPixel(out, 0, 0)).toEqual([9, 9, 9, 255]);
    expect(out).not.toBe(buf);
  });
});

describe('filledFromPalette', () => {
  it('fills a buffer with the chosen palette index', () => {
    const p = BUILTIN_PALETTES.gameboy;
    const buf = filledFromPalette(2, 2, p, 1);
    expect(getPixel(buf, 0, 0)).toEqual(p.colors[1]);
    expect(getPixel(buf, 1, 1)).toEqual(p.colors[1]);
  });

  it('leaves the buffer transparent when the index is out of range', () => {
    const buf = filledFromPalette(1, 1, BUILTIN_PALETTES.gameboy, 99);
    expect(getPixel(buf, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('makePalette determinism', () => {
  it('produces a stable id for identical content and caps colors', () => {
    const a = makePalette('X', [[1, 2, 3, 255]]);
    const b = makePalette('X', [[1, 2, 3, 255]]);
    expect(a.id).toBe(b.id);
    const capped = makePalette(
      'Big',
      Array.from({ length: MAX_PALETTE_COLORS + 5 }, () => [0, 0, 0, 255] as RGBA),
    );
    expect(capped.colors).toHaveLength(MAX_PALETTE_COLORS);
  });
});
