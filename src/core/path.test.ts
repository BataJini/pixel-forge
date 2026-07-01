import { describe, expect, it } from 'vitest';
import { bresenhamLine, type Point2, pixelPerfectFilter, snapLineEndpoint } from './path';

const key = (p: Point2): string => `${p.x},${p.y}`;

describe('bresenhamLine', () => {
  it('includes both endpoints', () => {
    const pts = bresenhamLine(0, 0, 5, 2);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 5, y: 2 });
  });

  it('is a single point for a zero-length line', () => {
    expect(bresenhamLine(3, 4, 3, 4)).toEqual([{ x: 3, y: 4 }]);
  });

  it('produces a contiguous 8-connected path (each step ≤ 1 in both axes)', () => {
    const pts = bresenhamLine(0, 0, 9, 3);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });

  it('a perfect diagonal has no doubled pixels', () => {
    const pts = bresenhamLine(0, 0, 6, 6);
    expect(pts).toHaveLength(7);
    expect(pts).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => ({ x: n, y: n })));
  });

  it('draws right-to-left and bottom-to-top correctly', () => {
    const pts = bresenhamLine(5, 5, 0, 0);
    expect(pts[0]).toEqual({ x: 5, y: 5 });
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
  });

  it('truncates fractional inputs', () => {
    expect(bresenhamLine(0.9, 0.2, 2.7, 0.1)[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('pixelPerfectFilter', () => {
  it('drops the elbow of a single L corner', () => {
    const path: Point2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    const out = pixelPerfectFilter(path);
    expect(out.map(key)).toEqual(['0,0', '1,1']);
  });

  it('cleans a full staircase into a diagonal', () => {
    const path: Point2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ];
    const out = pixelPerfectFilter(path);
    expect(out.map(key)).toEqual(['0,0', '1,1', '2,2', '3,3']);
  });

  it('leaves a pure diagonal untouched', () => {
    const path: Point2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(pixelPerfectFilter(path).map(key)).toEqual(['0,0', '1,1', '2,2']);
  });

  it('leaves a straight run untouched', () => {
    const path: Point2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(pixelPerfectFilter(path).map(key)).toEqual(['0,0', '1,0', '2,0', '3,0']);
  });

  it('returns copies for short paths', () => {
    const path: Point2[] = [{ x: 1, y: 2 }];
    const out = pixelPerfectFilter(path);
    expect(out).toEqual(path);
    expect(out[0]).not.toBe(path[0]);
  });
});

describe('snapLineEndpoint', () => {
  it('snaps a near-horizontal line to horizontal', () => {
    expect(snapLineEndpoint(0, 0, 10, 2)).toEqual({ x: 10, y: 0 });
  });

  it('snaps a near-vertical line to vertical', () => {
    expect(snapLineEndpoint(0, 0, 2, 10)).toEqual({ x: 0, y: 10 });
  });

  it('snaps a diagonal to 45° using the longer axis', () => {
    expect(snapLineEndpoint(0, 0, 10, 8)).toEqual({ x: 10, y: 10 });
  });

  it('preserves direction signs on the diagonal', () => {
    expect(snapLineEndpoint(0, 0, -9, 7)).toEqual({ x: -9, y: 9 }); // down-left
    expect(snapLineEndpoint(0, 0, 8, -10)).toEqual({ x: 10, y: -10 }); // up-right
  });

  it('returns the anchor for a zero-length drag', () => {
    expect(snapLineEndpoint(3, 3, 3, 3)).toEqual({ x: 3, y: 3 });
  });
});
