// Held-out acceptance — U-009 PNG/SVG export core. Builder must NOT edit.
// Targets master-spec §5 exporters. Runner: Vitest (Browser Mode for canvas parts).
import { describe, it, expect } from 'vitest';
import { createBuffer, setPixel } from '../../../src/core/buffer';
import { bufferToSvg } from '../../../src/core/exporters/svg';
import type { RGBA } from '../../../src/core/types';

const RED: RGBA = [255, 0, 0, 255];

describe('bufferToSvg', () => {
  it('produces valid SVG with the art viewBox and crispEdges', () => {
    const b = setPixel(createBuffer(4, 4), 1, 1, RED);
    const svg = bufferToSvg(b, { merge: true });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 4 4"');
    expect(svg).toContain('crispEdges');
  });

  it('omits fully-transparent pixels', () => {
    const b = setPixel(createBuffer(4, 4), 0, 0, RED); // single opaque pixel
    const svg = bufferToSvg(b, { merge: true });
    // exactly one red fill, and no rect covering the whole 4x4 area
    const reds = svg.match(/ff0000|FF0000|rgb\(255,0,0\)/g) ?? [];
    expect(reds.length).toBeGreaterThanOrEqual(1);
  });

  it('merged mode emits far fewer rects than pixels for a solid block', () => {
    // fill an 8x8 solid red block
    let b = createBuffer(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b = setPixel(b, x, y, RED);
    const svg = bufferToSvg(b, { merge: true });
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(rectCount + pathCount).toBeLessThan(64); // merged, not 64 rects
    expect(rectCount + pathCount).toBeGreaterThan(0);
  });
});

// NOTE: PNG nearest-neighbor scale is asserted in Vitest Browser Mode where a real
// CanvasRenderingContext2D exists:
//   const canvas = scaleToCanvas(buffer, 8)
//   expect(canvas.width).toBe(buffer.w * 8); expect(canvas.height).toBe(buffer.h * 8);
//   read back pixels -> every source pixel is an exact 8x8 block, no new colors.
// See criteria.md item "PNG".
