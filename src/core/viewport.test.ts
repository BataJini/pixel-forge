import { describe, expect, it } from 'vitest';
import {
  artToScreen,
  clampZoom,
  fitToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoom,
  panBy,
  screenToArt,
  type Viewport,
  ZOOM_STEPS,
  zoomAt,
} from './viewport';

const vp = (zoom: number, panX = 0, panY = 0): Viewport => ({ zoom, panX, panY });

describe('ZOOM_STEPS', () => {
  it('is strictly ascending', () => {
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1]);
    }
    expect(MIN_ZOOM).toBe(ZOOM_STEPS[0]);
    expect(MAX_ZOOM).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  });
});

describe('clampZoom', () => {
  it('clamps to the supported range and handles non-finite input', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(4)).toBe(4);
  });
});

describe('screenToArt / artToScreen', () => {
  it('maps screen points to the integer art pixel under them', () => {
    const v = vp(8, 10, 20);
    expect(screenToArt(v, 10, 20)).toEqual({ x: 0, y: 0 });
    expect(screenToArt(v, 17, 27)).toEqual({ x: 0, y: 0 }); // still inside pixel (0,0)
    expect(screenToArt(v, 18, 28)).toEqual({ x: 1, y: 1 });
  });

  it('floors negative regions (cursor left/above the canvas)', () => {
    const v = vp(4, 0, 0);
    expect(screenToArt(v, -1, -1)).toEqual({ x: -1, y: -1 });
  });

  it('artToScreen returns the pixel top-left corner and inverts screenToArt', () => {
    const v = vp(8, 10, 20);
    expect(artToScreen(v, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(artToScreen(v, 3, 2)).toEqual({ x: 34, y: 36 });
    const p = artToScreen(v, 5, 7);
    expect(screenToArt(v, p.x, p.y)).toEqual({ x: 5, y: 7 });
  });
});

describe('nextZoom', () => {
  it('steps to the next / previous ladder rung', () => {
    expect(nextZoom(1, 1)).toBe(2);
    expect(nextZoom(2, -1)).toBe(1);
    expect(nextZoom(4, 1)).toBe(6);
  });

  it('snaps an off-ladder value to the neighbour in the given direction', () => {
    expect(nextZoom(5, 1)).toBe(6);
    expect(nextZoom(5, -1)).toBe(4);
  });

  it('saturates at the ends', () => {
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe('zoomAt', () => {
  it('keeps the art point under the anchor fixed on screen', () => {
    const before = vp(4, 0, 0);
    const anchorX = 40;
    const anchorY = 24;
    const artBefore = screenToArt(before, anchorX, anchorY);
    const after = zoomAt(before, 8, anchorX, anchorY);
    expect(after.zoom).toBe(8);
    // the same art coordinate should still sit under the anchor
    expect(screenToArt(after, anchorX, anchorY)).toEqual(artBefore);
  });

  it('clamps the requested zoom', () => {
    expect(zoomAt(vp(1, 0, 0), 10_000, 0, 0).zoom).toBe(MAX_ZOOM);
  });
});

describe('panBy', () => {
  it('translates without changing zoom', () => {
    expect(panBy(vp(4, 10, 10), 5, -3)).toEqual({ zoom: 4, panX: 15, panY: 7 });
  });
});

describe('fitToScreen', () => {
  it('chooses the largest ladder zoom that fits and centers the art', () => {
    const v = fitToScreen(16, 16, 200, 200);
    expect(v.zoom).toBe(12); // 200/16 = 12.5 -> ladder rung 12
    expect(v.panX).toBeCloseTo((200 - 16 * 12) / 2);
    expect(v.panY).toBeCloseTo((200 - 16 * 12) / 2);
  });

  it('respects padding', () => {
    const v = fitToScreen(10, 10, 120, 120, 10);
    // usable 100 -> 100/10 = 10 -> ladder rung 8
    expect(v.zoom).toBe(8);
  });

  it('picks the min ladder rung when the art only just fits', () => {
    // 512 * 0.125 = 64 <= 100, so the smallest ladder rung still fits.
    expect(fitToScreen(512, 512, 100, 100).zoom).toBe(MIN_ZOOM);
  });

  it('falls back to a continuous zoom when even the min step cannot fit', () => {
    const v = fitToScreen(512, 512, 50, 50);
    expect(v.zoom).toBeLessThan(MIN_ZOOM);
    expect(v.zoom).toBeCloseTo(50 / 512);
  });
});
