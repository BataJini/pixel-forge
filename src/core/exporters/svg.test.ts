import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../buffer';
import type { PixelBuffer, RGBA } from '../types';
import { bufferToSvg } from './svg';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const HALF_GREEN: RGBA = [0, 255, 0, 128];

function fill(buf: PixelBuffer, x: number, y: number, w: number, h: number, c: RGBA): PixelBuffer {
  let next = buf;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      next = setPixel(next, xx, yy, c);
    }
  }
  return next;
}

/**
 * Re-rasterize a bufferToSvg() string back into a PixelBuffer by parsing its
 * <g fill fill-opacity><rect/></g> structure. Proves the SVG faithfully encodes
 * the source (the "re-rasterizes to the source image" acceptance criterion).
 */
function rasterizeSvg(svg: string): PixelBuffer {
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!vb) throw new Error('no viewBox');
  const w = Number(vb[1]);
  const h = Number(vb[2]);
  let buf = createBuffer(w, h);
  const groupRe = /<g fill="(#[0-9A-F]{6})"(?: fill-opacity="([\d.]+)")?>(.*?)<\/g>/g;
  for (let g = groupRe.exec(svg); g !== null; g = groupRe.exec(svg)) {
    const hex = g[1];
    const alpha = g[2] !== undefined ? Math.round(Number(g[2]) * 255) : 255;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const gr = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const color: RGBA = [r, gr, b, alpha];
    const rectRe = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g;
    for (let rc = rectRe.exec(g[3]); rc !== null; rc = rectRe.exec(g[3])) {
      buf = fill(buf, Number(rc[1]), Number(rc[2]), Number(rc[3]), Number(rc[4]), color);
    }
  }
  return buf;
}

function countTag(svg: string, tag: string): number {
  return (svg.match(new RegExp(`<${tag}[ />]`, 'g')) ?? []).length;
}

describe('bufferToSvg — structure', () => {
  it('emits a namespaced svg with the art viewBox and crispEdges', () => {
    const svg = bufferToSvg(createBuffer(7, 5));
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 7 5"');
    expect(svg).toContain('width="7"');
    expect(svg).toContain('height="5"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('produces an empty (rect-free) svg for a fully transparent buffer', () => {
    const svg = bufferToSvg(createBuffer(8, 8));
    expect(countTag(svg, 'rect')).toBe(0);
    expect(countTag(svg, 'g')).toBe(0);
  });

  it('handles a zero-size buffer without throwing', () => {
    const svg = bufferToSvg(createBuffer(0, 0));
    expect(svg).toContain('viewBox="0 0 0 0"');
    expect(countTag(svg, 'rect')).toBe(0);
  });
});

describe('bufferToSvg — transparency', () => {
  it('omits fully-transparent pixels and keeps the one opaque pixel', () => {
    const svg = bufferToSvg(setPixel(createBuffer(4, 4), 0, 0, RED));
    expect(countTag(svg, 'rect')).toBe(1);
    expect(svg).toContain('<rect x="0" y="0" width="1" height="1"/>');
    // No rect spans the whole 4x4 area (only the <svg> root carries those dims).
    expect(svg).not.toContain('<rect x="0" y="0" width="4" height="4"/>');
  });

  it('encodes partial alpha as fill-opacity and round-trips it', () => {
    const svg = bufferToSvg(setPixel(createBuffer(2, 2), 1, 1, HALF_GREEN));
    expect(svg).toContain('fill-opacity="0.502"');
    const back = rasterizeSvg(svg);
    expect(getPixel(back, 1, 1)).toEqual(HALF_GREEN);
    expect(getPixel(back, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('bufferToSvg — greedy merge', () => {
  it('collapses a solid 8x8 block into a single rect', () => {
    const svg = bufferToSvg(fill(createBuffer(8, 8), 0, 0, 8, 8, RED));
    expect(countTag(svg, 'rect') + countTag(svg, 'path')).toBe(1);
    expect(svg).toContain('<rect x="0" y="0" width="8" height="8"/>');
  });

  it('emits far fewer rects than pixels for a solid block (acceptance)', () => {
    const svg = bufferToSvg(fill(createBuffer(8, 8), 0, 0, 8, 8, RED));
    const total = countTag(svg, 'rect') + countTag(svg, 'path');
    expect(total).toBeLessThan(64);
    expect(total).toBeGreaterThan(0);
  });

  it('merges a full-width band into one rect via vertical coalescing', () => {
    // 6x4 red band inside a 6x6 canvas -> a single 6x4 rect.
    const svg = bufferToSvg(fill(createBuffer(6, 6), 0, 1, 6, 4, RED));
    expect(countTag(svg, 'rect')).toBe(1);
    expect(svg).toContain('<rect x="0" y="1" width="6" height="4"/>');
  });

  it('splits an L-shape into the minimal rects and round-trips exactly', () => {
    // L: column x=0 (all rows) + row y=3 (all cols) on a 4x4 grid.
    let buf = fill(createBuffer(4, 4), 0, 0, 1, 4, BLUE);
    buf = fill(buf, 0, 3, 4, 1, BLUE);
    const svg = bufferToSvg(buf);
    // Greedy row-run + vertical merge yields 2 rects: the 1x4 column and the 3x1 tail.
    expect(countTag(svg, 'rect')).toBe(2);
    const back = rasterizeSvg(svg);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(getPixel(back, x, y)).toEqual(getPixel(buf, x, y));
      }
    }
  });

  it('unmerged mode emits one rect per opaque pixel', () => {
    const svg = bufferToSvg(fill(createBuffer(3, 3), 0, 0, 3, 3, RED), { merge: false });
    expect(countTag(svg, 'rect')).toBe(9);
  });
});

describe('bufferToSvg — colors, grouping, determinism', () => {
  it('groups rects under one <g> per distinct color', () => {
    let buf = fill(createBuffer(4, 2), 0, 0, 4, 1, RED);
    buf = fill(buf, 0, 1, 4, 1, BLUE);
    const svg = bufferToSvg(buf);
    expect(countTag(svg, 'g')).toBe(2);
    expect(svg).toContain('fill="#FF0000"');
    expect(svg).toContain('fill="#0000FF"');
  });

  it('is deterministic and orders colors by packed value', () => {
    let buf = fill(createBuffer(2, 2), 0, 0, 2, 1, BLUE); // packed lower than red? no
    buf = fill(buf, 0, 1, 2, 1, RED);
    const a = bufferToSvg(buf);
    const b = bufferToSvg(buf);
    expect(a).toBe(b);
    // RED packs to a larger integer than BLUE, so the blue group appears first.
    expect(a.indexOf('#0000FF')).toBeLessThan(a.indexOf('#FF0000'));
  });

  it('round-trips a multi-color checker pattern exactly', () => {
    let buf = createBuffer(5, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if ((x + y) % 2 === 0) buf = setPixel(buf, x, y, x % 3 === 0 ? RED : BLUE);
      }
    }
    const back = rasterizeSvg(bufferToSvg(buf));
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(getPixel(back, x, y)).toEqual(getPixel(buf, x, y));
      }
    }
  });
});
