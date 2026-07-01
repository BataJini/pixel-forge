import { describe, expect, it } from 'vitest';
import {
  blitOverInto,
  brushRect,
  clearRegionWhere,
  cloneBuffer,
  colorsEqual,
  copyRegion,
  copyRegionWhere,
  createBuffer,
  drawEllipse,
  drawEllipseInto,
  drawLine,
  drawLineInto,
  drawRect,
  drawRectInto,
  extractRegion,
  floodFill,
  floodFillInto,
  getPixel,
  setPixel,
  setPixelMut,
} from './buffer';
import { selectionContains, selectRect } from './selection';
import type { PixelBuffer, RGBA } from './types';

const RED: RGBA = [255, 0, 0, 255];
const BLU: RGBA = [0, 0, 255, 255];
const GRN: RGBA = [0, 255, 0, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

const on = (b: PixelBuffer, x: number, y: number): boolean => getPixel(b, x, y)[3] === 255;
const countOpaque = (b: PixelBuffer): number => {
  let n = 0;
  for (let i = 3; i < b.data.length; i += 4) {
    if (b.data[i] === 255) {
      n++;
    }
  }
  return n;
};

describe('colorsEqual', () => {
  it('compares all four channels', () => {
    expect(colorsEqual(RED, [255, 0, 0, 255])).toBe(true);
    expect(colorsEqual(RED, [255, 0, 0, 254])).toBe(false);
    expect(colorsEqual(CLEAR, [0, 0, 0, 0])).toBe(true);
  });
});

describe('brushRect', () => {
  it('size 1 is exactly the single pixel', () => {
    expect(brushRect(5, 6, 1)).toEqual({ x: 5, y: 6, w: 1, h: 1 });
  });
  it('odd sizes center on the pixel', () => {
    expect(brushRect(5, 5, 3)).toEqual({ x: 4, y: 4, w: 3, h: 3 });
  });
  it('even sizes bias to the bottom-right', () => {
    expect(brushRect(5, 5, 2)).toEqual({ x: 5, y: 5, w: 2, h: 2 });
    expect(brushRect(5, 5, 4)).toEqual({ x: 4, y: 4, w: 4, h: 4 });
  });
  it('clamps non-positive sizes to 1', () => {
    expect(brushRect(2, 2, 0)).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(brushRect(2, 2, -3)).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });
});

describe('drawLine (immutable)', () => {
  it('does not mutate the input buffer', () => {
    const b = createBuffer(8, 8);
    const out = drawLine(b, 0, 0, 7, 7, RED);
    expect(out).not.toBe(b);
    expect(on(b, 0, 0)).toBe(false);
    expect(on(out, 0, 0)).toBe(true);
  });

  it('draws a gap-free steep line', () => {
    const b = drawLine(createBuffer(8, 8), 1, 0, 2, 7, RED);
    // every row has exactly one lit pixel (contiguity + no doubling with size 1)
    for (let y = 0; y < 8; y++) {
      let lit = 0;
      for (let x = 0; x < 8; x++) {
        if (on(b, x, y)) {
          lit++;
        }
      }
      expect(lit).toBeGreaterThanOrEqual(1);
    }
    expect(getPixel(b, 1, 0)).toEqual(RED);
    expect(getPixel(b, 2, 7)).toEqual(RED);
  });

  it('supports a square brush size', () => {
    const b = drawLine(createBuffer(9, 9), 4, 4, 4, 4, RED, { size: 3 });
    // a size-3 dot centered on (4,4) lights the 3x3 block (3,3)..(5,5)
    for (let y = 3; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) {
        expect(getPixel(b, x, y)).toEqual(RED);
      }
    }
    expect(on(b, 2, 4)).toBe(false);
    expect(on(b, 6, 4)).toBe(false);
  });

  it('pixel-perfect removes doubled corner pixels on an L staircase', () => {
    // Hand-built path is a right angle: (0,0)->(1,0)->(1,1). The corner (1,0)
    // is the doubled pixel; pixel-perfect should drop it.
    const plain = createBuffer(3, 3);
    drawLineInto(plain, 0, 0, 1, 0, RED);
    drawLineInto(plain, 1, 0, 1, 1, RED);
    expect(on(plain, 1, 0)).toBe(true);

    // Compose the same two segments through a single pixel-perfect stroke path.
    const pp = createBuffer(3, 3);
    // emulate a freehand path by drawing the two-segment polyline pixel-perfect
    drawLineInto(pp, 0, 0, 1, 1, RED, { pixelPerfect: true });
    expect(getPixel(pp, 0, 0)).toEqual(RED);
    expect(getPixel(pp, 1, 1)).toEqual(RED);
  });

  it('drawLineInto reports the dirty rect of the stroke', () => {
    const b = createBuffer(8, 8);
    const dirty = drawLineInto(b, 1, 2, 4, 2, RED);
    expect(dirty).toEqual({ x: 1, y: 2, w: 4, h: 1 });
  });

  it('drawLineInto returns null when nothing is drawn (fully OOB)', () => {
    const b = createBuffer(4, 4);
    expect(drawLineInto(b, -5, -5, -3, -3, RED)).toBeNull();
  });
});

describe('drawRect (immutable)', () => {
  it('outline leaves the interior transparent', () => {
    const b = drawRect(createBuffer(6, 6), { x: 1, y: 1, w: 4, h: 4 }, RED, { fill: false });
    expect(getPixel(b, 1, 1)).toEqual(RED);
    expect(getPixel(b, 4, 1)).toEqual(RED);
    expect(getPixel(b, 1, 4)).toEqual(RED);
    expect(getPixel(b, 4, 4)).toEqual(RED);
    expect(on(b, 2, 2)).toBe(false);
    expect(on(b, 3, 3)).toBe(false);
    // outline of a 4x4 box = 12 border pixels
    expect(countOpaque(b)).toBe(12);
  });

  it('fill uses fillColor for the interior and c for the border', () => {
    const b = drawRect(createBuffer(6, 6), { x: 1, y: 1, w: 4, h: 4 }, RED, {
      fill: true,
      fillColor: BLU,
    });
    expect(getPixel(b, 1, 1)).toEqual(RED); // border
    expect(getPixel(b, 4, 4)).toEqual(RED); // border
    expect(getPixel(b, 2, 2)).toEqual(BLU); // interior
    expect(getPixel(b, 3, 3)).toEqual(BLU); // interior
  });

  it('fill without fillColor is a solid rect of c', () => {
    const b = drawRect(createBuffer(5, 5), { x: 0, y: 0, w: 5, h: 5 }, GRN, { fill: true });
    expect(countOpaque(b)).toBe(25);
    expect(getPixel(b, 2, 2)).toEqual(GRN);
  });

  it('a 1x1 rect lights a single pixel', () => {
    const b = drawRect(createBuffer(4, 4), { x: 2, y: 2, w: 1, h: 1 }, RED);
    expect(getPixel(b, 2, 2)).toEqual(RED);
    expect(countOpaque(b)).toBe(1);
  });

  it('drawRectInto returns the clamped dirty rect and null when empty', () => {
    const b = createBuffer(6, 6);
    expect(drawRectInto(b, { x: 1, y: 1, w: 4, h: 4 }, RED)).toEqual({ x: 1, y: 1, w: 4, h: 4 });
    expect(drawRectInto(b, { x: 0, y: 0, w: 0, h: 3 }, RED)).toBeNull();
    expect(drawRectInto(createBuffer(6, 6), { x: 10, y: 10, w: 3, h: 3 }, RED)).toBeNull();
  });
});

describe('drawEllipse (immutable)', () => {
  it('outline touches the four side midpoints and is symmetric (odd box)', () => {
    const b = drawEllipse(createBuffer(9, 9), { x: 0, y: 0, w: 9, h: 9 }, RED, { fill: false });
    expect(getPixel(b, 0, 4)).toEqual(RED);
    expect(getPixel(b, 8, 4)).toEqual(RED);
    expect(getPixel(b, 4, 0)).toEqual(RED);
    expect(getPixel(b, 4, 8)).toEqual(RED);
    // 4-fold symmetry: mirror across both axes matches
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const v = on(b, x, y);
        expect(on(b, 8 - x, y)).toBe(v);
        expect(on(b, x, 8 - y)).toBe(v);
      }
    }
    expect(on(b, 4, 4)).toBe(false); // hollow center
  });

  it('touches the side midpoints for an even box too', () => {
    // 8x8 box: inclusive corners (0,0)-(7,7); vertical extents at rows 3 and 4.
    const b = drawEllipse(createBuffer(8, 8), { x: 0, y: 0, w: 8, h: 8 }, RED, { fill: false });
    expect(on(b, 0, 3) || on(b, 0, 4)).toBe(true); // left edge
    expect(on(b, 7, 3) || on(b, 7, 4)).toBe(true); // right edge
    expect(on(b, 3, 0) || on(b, 4, 0)).toBe(true); // top edge
    expect(on(b, 3, 7) || on(b, 4, 7)).toBe(true); // bottom edge
  });

  it('fill fills the interior and leaves corners of the box empty', () => {
    const b = drawEllipse(createBuffer(9, 9), { x: 0, y: 0, w: 9, h: 9 }, RED, { fill: true });
    expect(getPixel(b, 4, 4)).toEqual(RED); // center filled
    expect(on(b, 0, 0)).toBe(false); // box corner outside the ellipse
    expect(on(b, 8, 8)).toBe(false);
    // a filled disk covers more pixels than its outline
    const outline = drawEllipse(createBuffer(9, 9), { x: 0, y: 0, w: 9, h: 9 }, RED, {
      fill: false,
    });
    expect(countOpaque(b)).toBeGreaterThan(countOpaque(outline));
  });

  it('fill uses fillColor inside and c on the outline', () => {
    const b = drawEllipse(createBuffer(9, 9), { x: 0, y: 0, w: 9, h: 9 }, RED, {
      fill: true,
      fillColor: BLU,
    });
    expect(getPixel(b, 4, 4)).toEqual(BLU); // interior
    expect(getPixel(b, 0, 4)).toEqual(RED); // outline midpoint
  });

  it('drawEllipseInto returns null for an empty rect', () => {
    expect(drawEllipseInto(createBuffer(9, 9), { x: 0, y: 0, w: 0, h: 9 }, RED)).toBeNull();
  });

  it('handles degenerate 1×1 / 1×N / N×1 ellipses without hanging', () => {
    expect(
      getPixel(drawEllipse(createBuffer(4, 4), { x: 1, y: 1, w: 1, h: 1 }, RED), 1, 1),
    ).toEqual(RED);
    const thinH = drawEllipse(createBuffer(9, 3), { x: 0, y: 1, w: 9, h: 1 }, RED);
    expect(getPixel(thinH, 0, 1)).toEqual(RED);
    expect(getPixel(thinH, 8, 1)).toEqual(RED);
    const thinV = drawEllipse(createBuffer(3, 9), { x: 1, y: 0, w: 1, h: 9 }, RED);
    expect(getPixel(thinV, 1, 0)).toEqual(RED);
    expect(getPixel(thinV, 1, 8)).toEqual(RED);
  });

  it('rasterizes a large 128×96 ellipse touching all four extremes', () => {
    const b = drawEllipse(createBuffer(128, 96), { x: 0, y: 0, w: 128, h: 96 }, RED);
    // even box: extreme spans across the two central rows/cols
    expect(on(b, 0, 47) || on(b, 0, 48)).toBe(true);
    expect(on(b, 127, 47) || on(b, 127, 48)).toBe(true);
    expect(on(b, 63, 0) || on(b, 64, 0)).toBe(true);
    expect(on(b, 63, 95) || on(b, 64, 95)).toBe(true);
  });
});

describe('floodFill (immutable)', () => {
  const withDivider = (): PixelBuffer => {
    let b = createBuffer(4, 4);
    for (let y = 0; y < 4; y++) {
      b = setPixel(b, 2, y, BLU);
    }
    return b;
  };

  it('does not mutate the input', () => {
    const b = withDivider();
    const out = floodFill(b, 0, 0, RED, { tolerance: 0, contiguous: true });
    expect(out).not.toBe(b);
    expect(on(b, 0, 0)).toBe(false);
  });

  it('contiguous fill stops at a divider', () => {
    const filled = floodFill(withDivider(), 0, 0, RED, { contiguous: true });
    expect(getPixel(filled, 0, 0)).toEqual(RED);
    expect(getPixel(filled, 1, 3)).toEqual(RED);
    expect(getPixel(filled, 2, 0)).toEqual(BLU);
    expect(getPixel(filled, 3, 0)).toEqual(CLEAR);
  });

  it('global fill replaces all matching pixels', () => {
    const filled = floodFill(withDivider(), 0, 0, RED, { contiguous: false });
    expect(getPixel(filled, 3, 0)).toEqual(RED);
    expect(getPixel(filled, 2, 0)).toEqual(BLU);
  });

  it('tolerance matches near colors', () => {
    let b = createBuffer(3, 1);
    b = setPixel(b, 0, 0, [100, 100, 100, 255]);
    b = setPixel(b, 1, 0, [104, 100, 100, 255]); // within 5
    b = setPixel(b, 2, 0, [200, 100, 100, 255]); // far
    const filled = floodFill(b, 0, 0, RED, { tolerance: 5, contiguous: true });
    expect(getPixel(filled, 0, 0)).toEqual(RED);
    expect(getPixel(filled, 1, 0)).toEqual(RED);
    expect(getPixel(filled, 2, 0)).toEqual([200, 100, 100, 255]);
  });

  it('tolerance 0 is exact-match only', () => {
    let b = createBuffer(2, 1);
    b = setPixel(b, 0, 0, [100, 100, 100, 255]);
    b = setPixel(b, 1, 0, [101, 100, 100, 255]);
    const filled = floodFill(b, 0, 0, RED, { tolerance: 0, contiguous: true });
    expect(getPixel(filled, 0, 0)).toEqual(RED);
    expect(getPixel(filled, 1, 0)).toEqual([101, 100, 100, 255]);
  });

  it('is a no-op when the seed already equals the fill color', () => {
    const b = setPixel(createBuffer(3, 3), 1, 1, RED);
    expect(floodFillInto(b, 1, 1, RED)).toBeNull();
  });

  it('is a no-op for an out-of-bounds seed', () => {
    expect(floodFillInto(createBuffer(3, 3), 9, 9, RED)).toBeNull();
  });

  it('fills an entire empty canvas from any seed', () => {
    const filled = floodFill(createBuffer(5, 5), 2, 2, RED);
    expect(countOpaque(filled)).toBe(25);
  });

  it('scales to the 512x512 ceiling without recursion overflow', () => {
    const filled = floodFill(createBuffer(512, 512), 0, 0, RED);
    expect(getPixel(filled, 0, 0)).toEqual(RED);
    expect(getPixel(filled, 511, 511)).toEqual(RED);
    expect(getPixel(filled, 256, 256)).toEqual(RED);
  });
});

describe('copyRegion', () => {
  it('restores a sub-rect from a base buffer', () => {
    const base = createBuffer(4, 4);
    setPixelMut(base, 1, 1, RED);
    const work = cloneBuffer(base);
    setPixelMut(work, 1, 1, BLU); // diverge
    setPixelMut(work, 3, 3, GRN); // outside the restore rect
    copyRegion(work, base, { x: 0, y: 0, w: 2, h: 2 });
    expect(getPixel(work, 1, 1)).toEqual(RED); // restored from base
    expect(getPixel(work, 3, 3)).toEqual(GRN); // untouched
  });

  it('is a no-op on a size mismatch', () => {
    const dst = createBuffer(2, 2);
    setPixelMut(dst, 0, 0, RED);
    copyRegion(dst, createBuffer(3, 3), { x: 0, y: 0, w: 2, h: 2 });
    expect(getPixel(dst, 0, 0)).toEqual(RED);
  });
});

describe('copyRegionWhere', () => {
  it('restores only the pixels where keep() is true', () => {
    const base = createBuffer(4, 4); // all transparent
    const work = createBuffer(4, 4);
    setPixelMut(work, 0, 0, RED);
    setPixelMut(work, 3, 0, BLU);
    // keep (restore-from-base) only x < 2
    copyRegionWhere(work, base, { x: 0, y: 0, w: 4, h: 4 }, (x) => x < 2);
    expect(on(work, 0, 0)).toBe(false); // restored to transparent base
    expect(getPixel(work, 3, 0)).toEqual(BLU); // kept
  });
});

describe('extractRegion', () => {
  it('lifts a sub-rect into a new right-sized buffer', () => {
    const src = createBuffer(6, 6);
    setPixelMut(src, 2, 2, RED);
    setPixelMut(src, 3, 3, BLU);
    const clip = extractRegion(src, { x: 2, y: 2, w: 2, h: 2 });
    expect(clip.w).toBe(2);
    expect(clip.h).toBe(2);
    expect(getPixel(clip, 0, 0)).toEqual(RED);
    expect(getPixel(clip, 1, 1)).toEqual(BLU);
    expect(on(src, 2, 2)).toBe(true); // source is not mutated
  });

  it('leaves pixels transparent where keep() is false (mask shape preserved)', () => {
    const src = createBuffer(6, 6);
    setPixelMut(src, 0, 0, RED);
    setPixelMut(src, 3, 0, BLU);
    const sel = selectRect(6, 6, { x: 3, y: 0, w: 3, h: 6 }); // only x>=3 kept
    const clip = extractRegion(src, { x: 0, y: 0, w: 4, h: 1 }, (x, y) =>
      selectionContains(sel, x, y),
    );
    expect(on(clip, 0, 0)).toBe(false); // outside mask -> transparent
    expect(getPixel(clip, 3, 0)).toEqual(BLU); // inside mask -> kept
  });

  it('fills OOB source reads with transparent', () => {
    const src = createBuffer(2, 2);
    setPixelMut(src, 1, 1, RED);
    const clip = extractRegion(src, { x: 1, y: 1, w: 3, h: 3 });
    expect(getPixel(clip, 0, 0)).toEqual(RED);
    expect(on(clip, 2, 2)).toBe(false); // was out of source bounds
  });

  it('returns an empty buffer for a zero-area rect', () => {
    const clip = extractRegion(createBuffer(4, 4), { x: 1, y: 1, w: 0, h: 3 });
    expect(clip.w).toBe(0);
    expect(clip.data.length).toBe(0);
  });
});

describe('clearRegionWhere', () => {
  it('clears masked pixels to transparent and reports the dirty rect', () => {
    const buf = createBuffer(5, 5);
    setPixelMut(buf, 1, 1, RED);
    setPixelMut(buf, 3, 1, BLU);
    const sel = selectRect(5, 5, { x: 0, y: 0, w: 2, h: 5 }); // only x<2 hit
    const dirty = clearRegionWhere(buf, { x: 0, y: 0, w: 5, h: 5 }, (x, y) =>
      selectionContains(sel, x, y),
    );
    expect(on(buf, 1, 1)).toBe(false); // cleared (inside mask)
    expect(getPixel(buf, 3, 1)).toEqual(BLU); // untouched (outside mask)
    expect(dirty).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it('returns null when nothing is cleared', () => {
    const buf = createBuffer(4, 4);
    expect(clearRegionWhere(buf, { x: 0, y: 0, w: 4, h: 4 }, () => false)).toBeNull();
  });

  it('returns null for a fully out-of-bounds rect', () => {
    const buf = createBuffer(4, 4);
    expect(clearRegionWhere(buf, { x: 10, y: 10, w: 3, h: 3 }, () => true)).toBeNull();
  });
});

describe('blitOverInto', () => {
  it('composites an opaque source, replacing destination pixels', () => {
    const dst = createBuffer(6, 6);
    setPixelMut(dst, 4, 4, BLU);
    const src = createBuffer(2, 2);
    setPixelMut(src, 0, 0, RED);
    setPixelMut(src, 1, 1, GRN);
    const dirty = blitOverInto(dst, src, 4, 4);
    expect(getPixel(dst, 4, 4)).toEqual(RED); // opaque replaces BLU
    expect(getPixel(dst, 5, 5)).toEqual(GRN);
    expect(dirty).toEqual({ x: 4, y: 4, w: 2, h: 2 });
  });

  it('skips fully-transparent source pixels (mask shape kept)', () => {
    const dst = createBuffer(4, 4);
    setPixelMut(dst, 0, 0, BLU);
    const src = createBuffer(2, 2); // (0,0) transparent, (1,1) red
    setPixelMut(src, 1, 1, RED);
    blitOverInto(dst, src, 0, 0);
    expect(getPixel(dst, 0, 0)).toEqual(BLU); // transparent source left dst intact
    expect(getPixel(dst, 1, 1)).toEqual(RED);
  });

  it('clips a source blitted partly off-canvas', () => {
    const dst = createBuffer(3, 3);
    const src = createBuffer(2, 2);
    setPixelMut(src, 0, 0, RED);
    setPixelMut(src, 1, 1, GRN);
    const dirty = blitOverInto(dst, src, 2, 2); // only src(0,0) lands at (2,2)
    expect(getPixel(dst, 2, 2)).toEqual(RED);
    expect(dirty).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });
});
