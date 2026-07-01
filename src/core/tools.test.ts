import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixelMut } from './buffer';
import type { Point2 } from './path';
import { selectRect } from './selection';
import {
  BAYER_4X4,
  BAYER_LEVELS,
  bayerThreshold,
  ditherColor,
  mirrorPoints,
  type PaintStyle,
  paintStroke,
  sampleColor,
  stampBrush,
  stampMirrored,
  translateBuffer,
} from './tools';
import type { PixelBuffer, RGBA } from './types';

const RED: RGBA = [255, 0, 0, 255];
const BLU: RGBA = [0, 0, 255, 255];
const on = (b: PixelBuffer, x: number, y: number): boolean => getPixel(b, x, y)[3] === 255;
const keyset = (pts: Point2[]): Set<string> => new Set(pts.map((p) => `${p.x},${p.y}`));

describe('mirrorPoints', () => {
  it('returns just the point with no mirroring', () => {
    expect(mirrorPoints(1, 2, 8, 8, { x: false, y: false })).toEqual([{ x: 1, y: 2 }]);
  });

  it('mirror-X reflects across the vertical center', () => {
    const pts = mirrorPoints(1, 2, 8, 8, { x: true, y: false });
    expect(keyset(pts)).toEqual(new Set(['1,2', '6,2']));
  });

  it('mirror-Y reflects across the horizontal center', () => {
    const pts = mirrorPoints(1, 2, 8, 8, { x: false, y: true });
    expect(keyset(pts)).toEqual(new Set(['1,2', '1,5']));
  });

  it('both axes give four points', () => {
    const pts = mirrorPoints(1, 2, 8, 8, { x: true, y: true });
    expect(keyset(pts)).toEqual(new Set(['1,2', '6,2', '1,5', '6,5']));
  });

  it('deduplicates a point on the axis of symmetry', () => {
    // center column of a 9-wide canvas: mirror-X maps 4 -> 4
    const pts = mirrorPoints(4, 2, 9, 9, { x: true, y: false });
    expect(pts).toHaveLength(1);
  });
});

describe('stampBrush', () => {
  it('stamps a single pixel for size 1', () => {
    const b = createBuffer(4, 4);
    const dirty = stampBrush(b, 1, 1, 1, RED);
    expect(getPixel(b, 1, 1)).toEqual(RED);
    expect(dirty).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it('stamps an NxN block for larger brushes', () => {
    const b = createBuffer(6, 6);
    stampBrush(b, 3, 3, 3, RED);
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) {
        expect(getPixel(b, x, y)).toEqual(RED);
      }
    }
  });

  it('respects a selection mask', () => {
    const b = createBuffer(6, 6);
    const sel = selectRect(6, 6, { x: 3, y: 0, w: 3, h: 6 });
    stampBrush(b, 3, 1, 3, RED, sel); // brush box (2..4) but only x>=3 allowed
    expect(on(b, 2, 1)).toBe(false); // outside selection
    expect(getPixel(b, 3, 1)).toEqual(RED);
    expect(getPixel(b, 4, 1)).toEqual(RED);
  });
});

describe('stampMirrored', () => {
  it('paints both mirror images', () => {
    const b = createBuffer(8, 8);
    stampMirrored(b, 1, 1, 1, RED, { x: true, y: false });
    expect(getPixel(b, 1, 1)).toEqual(RED);
    expect(getPixel(b, 6, 1)).toEqual(RED);
  });
});

describe('dither', () => {
  it('BAYER_4X4 is a 4x4 permutation of 0..15', () => {
    const flat = BAYER_4X4.flat().sort((a, b) => a - b);
    expect(flat).toEqual([...Array(16).keys()]);
  });

  it('bayerThreshold wraps and handles negatives', () => {
    expect(bayerThreshold(0, 0)).toBe(0);
    expect(bayerThreshold(4, 4)).toBe(0);
    expect(bayerThreshold(-1, 0)).toBe(bayerThreshold(3, 0));
  });

  it('ditherColor checkerboards fg/bg by parity when enabled', () => {
    const style: PaintStyle = { fg: RED, bg: BLU, dither: true };
    expect(ditherColor(0, 0, style)).toEqual(RED);
    expect(ditherColor(1, 0, style)).toEqual(BLU);
    expect(ditherColor(1, 1, style)).toEqual(RED);
  });

  it('ditherColor is driven by the Bayer matrix (fg below the 50% threshold)', () => {
    // The dither modifier routes through BAYER_4X4 (no dead code): the whole 4×4
    // cell agrees with the matrix threshold, and at the default 50% ratio the
    // field resolves to the fg/bg checkerboard the tool modifier specifies.
    const style: PaintStyle = { fg: RED, bg: BLU, dither: true };
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const expected = bayerThreshold(x, y) < BAYER_LEVELS / 2 ? RED : BLU;
        expect(ditherColor(x, y, style)).toEqual(expected);
        expect(ditherColor(x, y, style)).toEqual(((x + y) & 1) === 0 ? RED : BLU);
      }
    }
  });

  it('ditherColor ratio shifts the fg/bg mix (16-bit ordered shading hook)', () => {
    const style: PaintStyle = { fg: RED, bg: BLU, dither: true };
    // ratio 0 → all bg (threshold 0, nothing is < 0); ratio 1 → all fg.
    expect(ditherColor(0, 0, style, 0)).toEqual(BLU);
    expect(ditherColor(3, 0, style, 1)).toEqual(RED); // bayer(3,0)=10 < 16
  });

  it('ditherColor returns fg when disabled or bg missing', () => {
    expect(ditherColor(1, 0, { fg: RED, bg: BLU, dither: false })).toEqual(RED);
    expect(ditherColor(1, 0, { fg: RED, dither: true })).toEqual(RED);
  });
});

describe('paintStroke', () => {
  it('joins sparse samples into a gap-free path', () => {
    const b = createBuffer(10, 10);
    const dirty = paintStroke(
      b,
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      1,
      { fg: RED },
    );
    for (let x = 0; x <= 5; x++) {
      expect(getPixel(b, x, 0)).toEqual(RED);
    }
    expect(dirty).toEqual({ x: 0, y: 0, w: 6, h: 1 });
  });

  it('applies mirror across a stroke', () => {
    const b = createBuffer(8, 8);
    paintStroke(
      b,
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      1,
      { fg: RED },
      { x: true, y: false },
    );
    expect(getPixel(b, 0, 0)).toEqual(RED);
    expect(getPixel(b, 7, 0)).toEqual(RED); // mirror of x=0 on an 8-wide canvas
    expect(getPixel(b, 5, 0)).toEqual(RED); // mirror of x=2
  });

  it('constrains a stroke to the selection', () => {
    const b = createBuffer(8, 8);
    const sel = selectRect(8, 8, { x: 4, y: 0, w: 4, h: 8 });
    paintStroke(
      b,
      [
        { x: 0, y: 0 },
        { x: 7, y: 0 },
      ],
      1,
      { fg: RED },
      { x: false, y: false },
      sel,
    );
    expect(on(b, 0, 0)).toBe(false); // left of selection
    expect(on(b, 3, 0)).toBe(false);
    expect(getPixel(b, 4, 0)).toEqual(RED);
    expect(getPixel(b, 7, 0)).toEqual(RED);
  });

  it('pixel-perfect thins an L staircase drawn as a stroke', () => {
    const b = createBuffer(4, 4);
    // path bends: (0,0) -> (1,0) -> (1,1) has a doubled corner at (1,0)
    paintStroke(
      b,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      1,
      { fg: RED },
      { x: false, y: false },
      null,
      true,
    );
    expect(getPixel(b, 0, 0)).toEqual(RED);
    expect(getPixel(b, 1, 1)).toEqual(RED);
    expect(on(b, 1, 0)).toBe(false); // corner removed
  });

  it('returns null for an empty point list', () => {
    expect(paintStroke(createBuffer(4, 4), [], 1, { fg: RED })).toBeNull();
  });
});

describe('sampleColor (eyedropper)', () => {
  it('reads the pixel color, transparent when out of bounds', () => {
    const b = createBuffer(4, 4);
    setPixelMut(b, 2, 2, BLU);
    expect(sampleColor(b, 2, 2)).toEqual(BLU);
    expect(sampleColor(b, 9, 9)).toEqual([0, 0, 0, 0]);
  });
});

describe('translateBuffer (move)', () => {
  it('shifts content by whole pixels, clipping the rest', () => {
    const b = createBuffer(4, 4);
    setPixelMut(b, 0, 0, RED);
    setPixelMut(b, 1, 1, BLU);
    const moved = translateBuffer(b, 1, 1);
    expect(getPixel(moved, 1, 1)).toEqual(RED);
    expect(getPixel(moved, 2, 2)).toEqual(BLU);
    expect(on(moved, 0, 0)).toBe(false); // exposed area is transparent
    // original untouched (immutable)
    expect(getPixel(b, 0, 0)).toEqual(RED);
  });

  it('clips content pushed out of bounds', () => {
    const b = createBuffer(3, 3);
    setPixelMut(b, 2, 2, RED);
    const moved = translateBuffer(b, 2, 2);
    expect(on(moved, 4, 4)).toBe(false); // gone
    let opaque = 0;
    for (let i = 3; i < moved.data.length; i += 4) {
      if (moved.data[i] === 255) opaque++;
    }
    expect(opaque).toBe(0);
  });

  it('negative translation moves up-left', () => {
    const b = createBuffer(4, 4);
    setPixelMut(b, 2, 2, RED);
    const moved = translateBuffer(b, -1, -1);
    expect(getPixel(moved, 1, 1)).toEqual(RED);
  });
});
