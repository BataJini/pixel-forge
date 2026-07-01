import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../buffer';
import type { PixelBuffer, RGBA } from '../types';
import { flattenOnColor, scaleBufferNearest, scaleToCanvas } from './png';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const GREEN: RGBA = [0, 128, 0, 255];
const HALF_WHITE: RGBA = [255, 255, 255, 128];

/** The set of distinct packed colors present in a buffer. */
function colorSet(buf: PixelBuffer): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < buf.data.length; i += 4) {
    set.add(
      ((buf.data[i] * 256 + buf.data[i + 1]) * 256 + buf.data[i + 2]) * 256 + buf.data[i + 3],
    );
  }
  return set;
}

function distinctBuffer(): PixelBuffer {
  // 3x2 with six distinct colors so block-mapping is unambiguous.
  let b = createBuffer(3, 2);
  b = setPixel(b, 0, 0, RED);
  b = setPixel(b, 1, 0, BLUE);
  b = setPixel(b, 2, 0, GREEN);
  b = setPixel(b, 0, 1, [10, 20, 30, 255]);
  b = setPixel(b, 1, 1, [200, 100, 50, 255]);
  b = setPixel(b, 2, 1, [0, 0, 0, 0]); // transparent survives scaling
  return b;
}

describe('scaleBufferNearest — dimensions & purity', () => {
  it('scale 1 returns an equal, independent copy', () => {
    const src = distinctBuffer();
    const out = scaleBufferNearest(src, 1);
    expect(out.w).toBe(src.w);
    expect(out.h).toBe(src.h);
    expect([...out.data]).toEqual([...src.data]);
    out.data[0] = 1; // mutating the copy must not touch the source
    expect(src.data[0]).toBe(RED[0]);
  });

  it('produces w*scale × h*scale dimensions', () => {
    for (const scale of [2, 4, 8, 16, 32]) {
      const out = scaleBufferNearest(createBuffer(3, 2), scale);
      expect(out.w).toBe(3 * scale);
      expect(out.h).toBe(2 * scale);
      expect(out.data.length).toBe(3 * scale * 2 * scale * 4);
    }
  });

  it('yields a 2048×2048 buffer for a 512×512 source at 4× (max canvas)', () => {
    const out = scaleBufferNearest(createBuffer(512, 512), 4);
    expect(out.w).toBe(2048);
    expect(out.h).toBe(2048);
  });

  it('rejects non-positive or non-integer scales', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scaleBufferNearest(createBuffer(2, 2), bad)).toThrow(RangeError);
    }
  });
});

describe('scaleBufferNearest — nearest-neighbor correctness', () => {
  it('maps every source pixel to an exact scale×scale block with NO new colors', () => {
    const src = distinctBuffer();
    for (const scale of [1, 2, 4, 8]) {
      const out = scaleBufferNearest(src, scale);
      // Every output pixel equals its source pixel (integer block mapping).
      for (let y = 0; y < out.h; y++) {
        for (let x = 0; x < out.w; x++) {
          const sx = Math.floor(x / scale);
          const sy = Math.floor(y / scale);
          expect(getPixel(out, x, y)).toEqual(getPixel(src, sx, sy));
        }
      }
      // The nearest-neighbor scale introduces no intermediate colors.
      expect(colorSet(out)).toEqual(colorSet(src));
    }
  });

  it('keeps each block solid (no interpolation at block seams)', () => {
    const src = setPixel(setPixel(createBuffer(2, 1), 0, 0, RED), 1, 0, BLUE);
    const out = scaleBufferNearest(src, 4);
    for (let x = 0; x < 4; x++) expect(getPixel(out, x, 2)).toEqual(RED);
    for (let x = 4; x < 8; x++) expect(getPixel(out, x, 2)).toEqual(BLUE);
  });
});

describe('scaleToCanvas — environment guard', () => {
  it('throws a clear error where OffscreenCanvas is unavailable (Node)', () => {
    // The real nearest-neighbor canvas path is asserted in Browser Mode; here we
    // only prove the DOM-boundary fails loudly (not silently) outside a browser.
    const hasCanvas = typeof OffscreenCanvas !== 'undefined' && typeof ImageData !== 'undefined';
    if (hasCanvas) {
      return; // running under a DOM: the browser suite covers the happy path.
    }
    expect(() => scaleToCanvas(createBuffer(2, 2), 2)).toThrow(/OffscreenCanvas/);
  });
});

describe('flattenOnColor', () => {
  const BLACK: RGBA = [0, 0, 0, 255];
  const WHITE: RGBA = [255, 255, 255, 255];

  it('replaces fully-transparent pixels with the opaque matte', () => {
    const out = flattenOnColor(createBuffer(2, 2), WHITE);
    expect(getPixel(out, 0, 0)).toEqual(WHITE);
    expect(getPixel(out, 1, 1)).toEqual(WHITE);
  });

  it('leaves fully-opaque pixels unchanged (still opaque)', () => {
    const out = flattenOnColor(setPixel(createBuffer(1, 1), 0, 0, RED), BLACK);
    expect(getPixel(out, 0, 0)).toEqual(RED);
  });

  it('blends partial alpha toward the matte and forces opacity', () => {
    const out = flattenOnColor(setPixel(createBuffer(1, 1), 0, 0, HALF_WHITE), BLACK);
    // 255*0.502 + 0 ≈ 128 on each channel, fully opaque.
    expect(getPixel(out, 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it('never introduces alpha below 255', () => {
    let buf = createBuffer(3, 1);
    buf = setPixel(buf, 0, 0, RED);
    buf = setPixel(buf, 1, 0, HALF_WHITE);
    const out = flattenOnColor(buf, BLACK);
    for (let x = 0; x < 3; x++) expect(getPixel(out, x, 0)[3]).toBe(255);
  });
});
