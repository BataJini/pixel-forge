import { describe, expect, it } from 'vitest';
import {
  clampRect,
  expandRect,
  intersectRect,
  isEmptyRect,
  makeRect,
  rectBottom,
  rectContains,
  rectEquals,
  rectFromPoints,
  rectRight,
  unionRect,
} from './rect';

describe('makeRect / edges', () => {
  it('builds a rect and reports exclusive edges', () => {
    const r = makeRect(2, 3, 4, 5);
    expect(r).toEqual({ x: 2, y: 3, w: 4, h: 5 });
    expect(rectRight(r)).toBe(6);
    expect(rectBottom(r)).toBe(8);
  });
});

describe('isEmptyRect', () => {
  it('treats non-positive dimensions as empty', () => {
    expect(isEmptyRect(makeRect(0, 0, 0, 5))).toBe(true);
    expect(isEmptyRect(makeRect(0, 0, 5, 0))).toBe(true);
    expect(isEmptyRect(makeRect(0, 0, -1, 5))).toBe(true);
    expect(isEmptyRect(makeRect(0, 0, 1, 1))).toBe(false);
  });
});

describe('rectContains', () => {
  it('is inclusive of the top-left and exclusive of the bottom-right', () => {
    const r = makeRect(1, 1, 2, 2);
    expect(rectContains(r, 1, 1)).toBe(true);
    expect(rectContains(r, 2, 2)).toBe(true);
    expect(rectContains(r, 3, 3)).toBe(false);
    expect(rectContains(r, 0, 1)).toBe(false);
  });
});

describe('rectEquals', () => {
  it('compares all four fields', () => {
    expect(rectEquals(makeRect(1, 2, 3, 4), makeRect(1, 2, 3, 4))).toBe(true);
    expect(rectEquals(makeRect(1, 2, 3, 4), makeRect(1, 2, 3, 5))).toBe(false);
  });
});

describe('unionRect', () => {
  it('covers both rects', () => {
    expect(unionRect(makeRect(1, 1, 1, 1), makeRect(2, 3, 1, 1))).toEqual({
      x: 1,
      y: 1,
      w: 2,
      h: 3,
    });
  });

  it('ignores an empty operand', () => {
    expect(unionRect(makeRect(4, 4, 2, 2), makeRect(0, 0, 0, 0))).toEqual({
      x: 4,
      y: 4,
      w: 2,
      h: 2,
    });
    expect(unionRect(makeRect(0, 0, 0, 0), makeRect(4, 4, 2, 2))).toEqual({
      x: 4,
      y: 4,
      w: 2,
      h: 2,
    });
  });

  it('returns an empty rect when both are empty', () => {
    expect(unionRect(makeRect(3, 3, 0, 0), makeRect(9, 9, 0, 0))).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });
});

describe('intersectRect', () => {
  it('returns the overlap', () => {
    expect(intersectRect(makeRect(0, 0, 4, 4), makeRect(2, 2, 4, 4))).toEqual({
      x: 2,
      y: 2,
      w: 2,
      h: 2,
    });
  });

  it('returns null when disjoint or edge-touching', () => {
    expect(intersectRect(makeRect(0, 0, 2, 2), makeRect(5, 5, 2, 2))).toBeNull();
    expect(intersectRect(makeRect(0, 0, 2, 2), makeRect(2, 0, 2, 2))).toBeNull();
  });
});

describe('clampRect', () => {
  it('clips to the [0,0,w,h] bounds', () => {
    expect(clampRect(makeRect(-2, -2, 6, 6), 4, 4)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(clampRect(makeRect(1, 1, 10, 1), 4, 4)).toEqual({ x: 1, y: 1, w: 3, h: 1 });
  });

  it('yields an empty rect when fully outside', () => {
    expect(isEmptyRect(clampRect(makeRect(10, 10, 2, 2), 4, 4))).toBe(true);
  });
});

describe('rectFromPoints', () => {
  it('builds an inclusive normalized rect regardless of order', () => {
    expect(rectFromPoints(5, 2, 1, 6)).toEqual({ x: 1, y: 2, w: 5, h: 5 });
    expect(rectFromPoints(3, 3, 3, 3)).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });
});

describe('expandRect', () => {
  it('grows on all sides by pad', () => {
    expect(expandRect(makeRect(2, 2, 2, 2), 1)).toEqual({ x: 1, y: 1, w: 4, h: 4 });
  });

  it('shrinks with a negative pad', () => {
    expect(expandRect(makeRect(2, 2, 4, 4), -1)).toEqual({ x: 3, y: 3, w: 2, h: 2 });
  });
});
