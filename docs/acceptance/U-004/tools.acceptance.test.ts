// Held-out acceptance — U-004 drawing tools. Builder must NOT edit.
// Targets master-spec §5 buffer ops. Runner: Vitest.
import { describe, it, expect } from 'vitest';
import {
  createBuffer, getPixel, setPixel, floodFill, drawLine, drawRect, drawEllipse,
} from '../../../src/core/buffer';
import type { RGBA } from '../../../src/core/types';

const RED: RGBA = [255, 0, 0, 255];
const BLU: RGBA = [0, 0, 255, 255];
const opaque = (b: ReturnType<typeof createBuffer>, x: number, y: number) =>
  getPixel(b, x, y)[3] === 255;

describe('drawLine', () => {
  it('sets both endpoints and is contiguous (Bresenham)', () => {
    const b = drawLine(createBuffer(8, 8), 0, 0, 7, 7, RED, { size: 1 });
    expect(getPixel(b, 0, 0)).toEqual(RED);
    expect(getPixel(b, 7, 7)).toEqual(RED);
    for (let i = 0; i < 8; i++) expect(getPixel(b, i, i)).toEqual(RED); // diagonal
  });
  it('draws a horizontal line without touching other rows', () => {
    const b = drawLine(createBuffer(8, 8), 1, 3, 6, 3, RED, { size: 1 });
    for (let x = 1; x <= 6; x++) expect(getPixel(b, x, 3)).toEqual(RED);
    expect(opaque(b, 3, 2)).toBe(false);
    expect(opaque(b, 3, 4)).toBe(false);
  });
});

describe('drawRect', () => {
  it('outline mode leaves the interior empty', () => {
    const b = drawRect(createBuffer(6, 6), { x: 1, y: 1, w: 4, h: 4 }, RED, { fill: false });
    expect(getPixel(b, 1, 1)).toEqual(RED); // corner
    expect(getPixel(b, 4, 4)).toEqual(RED); // opposite corner
    expect(getPixel(b, 1, 4)).toEqual(RED);
    expect(opaque(b, 2, 2)).toBe(false);    // interior empty
  });
  it('fill mode fills the interior', () => {
    const b = drawRect(createBuffer(6, 6), { x: 1, y: 1, w: 4, h: 4 }, RED,
      { fill: true, fillColor: RED });
    expect(getPixel(b, 2, 2)).toEqual(RED);
    expect(getPixel(b, 3, 3)).toEqual(RED);
  });
});

describe('drawEllipse', () => {
  it('is symmetric about its center', () => {
    const b = drawEllipse(createBuffer(9, 9), { x: 0, y: 0, w: 9, h: 9 }, RED, { fill: false });
    // horizontal extremes on the middle row
    expect(getPixel(b, 0, 4)).toEqual(RED);
    expect(getPixel(b, 8, 4)).toEqual(RED);
    // vertical extremes on the middle column
    expect(getPixel(b, 4, 0)).toEqual(RED);
    expect(getPixel(b, 4, 8)).toEqual(RED);
  });
});

describe('floodFill', () => {
  it('fills a contiguous region of the target color', () => {
    let b = createBuffer(4, 4); // all transparent (the target)
    // draw a vertical divider of BLU at x=2
    for (let y = 0; y < 4; y++) b = setPixel(b, 2, y, BLU);
    const filled = floodFill(b, 0, 0, RED, { tolerance: 0, contiguous: true });
    // left region becomes RED
    expect(getPixel(filled, 0, 0)).toEqual(RED);
    expect(getPixel(filled, 1, 3)).toEqual(RED);
    // divider untouched
    expect(getPixel(filled, 2, 0)).toEqual(BLU);
    // right region NOT filled (non-contiguous across divider)
    expect(getPixel(filled, 3, 0)).toEqual([0, 0, 0, 0]);
  });
  it('non-contiguous mode replaces all matching pixels', () => {
    let b = createBuffer(4, 4);
    for (let y = 0; y < 4; y++) b = setPixel(b, 2, y, BLU);
    const filled = floodFill(b, 0, 0, RED, { tolerance: 0, contiguous: false });
    expect(getPixel(filled, 3, 0)).toEqual(RED); // right region filled too
    expect(getPixel(filled, 2, 0)).toEqual(BLU); // divider still BLU
  });
});
