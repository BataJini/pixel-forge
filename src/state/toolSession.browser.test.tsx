import { afterEach, describe, expect, it } from 'vitest';
import { createBuffer } from '../core/buffer';
import { createRenderer, type RendererCanvases } from '../platform';
import { ToolSession } from './toolSession';

// Real Chromium via Vitest Browser Mode (`npm run test:browser`). Proves the
// U-004 ToolSession drives the U-003 render pipeline end to end: a drawn stroke
// reaches the display canvas as real pixels, and the selection marquee paints on
// the overlay only (never the pixel buffer / never an export).

const hosts: HTMLElement[] = [];

function mountCanvases(): RendererCanvases {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const make = (): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    host.appendChild(c);
    return c;
  };
  return { backdrop: make(), display: make(), overlay: make() };
}

function pixelAt(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): [number, number, number, number] {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no ctx');
  }
  const saved = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  ctx.setTransform(saved);
  return [d[0], d[1], d[2], d[3]];
}

function anyOpaque(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no ctx');
  }
  const saved = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  ctx.setTransform(saved);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      return true;
    }
  }
  return false;
}

afterEach(() => {
  for (const h of hosts.splice(0)) {
    h.remove();
  }
});

describe('ToolSession × PixelRenderer', () => {
  it('draws a pencil stroke that appears on the display canvas', () => {
    const canvases = mountCanvases();
    const renderer = createRenderer(canvases, { dpr: 1, grid: { pixel: false, tile: null } });
    renderer.resize(160, 160);
    const buffer = createBuffer(16, 16);
    const session = new ToolSession(renderer, buffer, { fg: [255, 0, 0, 255] });
    renderer.setComposite(buffer);
    renderer.setViewport({ zoom: 10, panX: 0, panY: 0 });
    renderer.flush();

    session.setTool('pencil');
    session.pointerDown(2, 2);
    session.pointerMove(6, 2);
    session.pointerUp();
    renderer.flush();

    // Center of art pixel (4,2) -> display (45,25) must be solid red.
    expect(pixelAt(canvases.display, 45, 25)).toEqual([255, 0, 0, 255]);
    // A row above the stroke stays transparent (no smearing).
    expect(pixelAt(canvases.display, 45, 5)[3]).toBe(0);
    renderer.dispose();
  });

  it('copy → paste → move → commit relocates real pixels on the display canvas', () => {
    const canvases = mountCanvases();
    const renderer = createRenderer(canvases, { dpr: 1, grid: { pixel: false, tile: null } });
    renderer.resize(160, 160);
    const buffer = createBuffer(16, 16);
    const session = new ToolSession(renderer, buffer, { fg: [255, 0, 0, 255] });
    renderer.setComposite(buffer);
    renderer.setViewport({ zoom: 10, panX: 0, panY: 0 });
    renderer.flush();

    // Draw a red dot, marquee it, and copy.
    session.setTool('pencil');
    session.pointerDown(2, 2);
    session.pointerUp();
    session.setTool('select');
    session.pointerDown(2, 2);
    session.pointerMove(3, 3); // selection covers (2,2)
    session.pointerUp();
    session.copySelection();

    // Paste (floating at origin), nudge it four pixels right, and commit.
    session.paste();
    session.nudge(4, 0); // float now at (6,2)
    session.setTool('pencil'); // commit on tool change
    renderer.flush();

    // Original (art 2,2 → display 25,25) stays; the pasted copy lands at art (6,2).
    expect(pixelAt(canvases.display, 25, 25)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(canvases.display, 65, 25)).toEqual([255, 0, 0, 255]);
    renderer.dispose();
  });

  it('paints the selection marquee on the overlay only', () => {
    const canvases = mountCanvases();
    const renderer = createRenderer(canvases, { dpr: 1, grid: { pixel: false, tile: null } });
    renderer.resize(160, 160);
    const buffer = createBuffer(16, 16);
    const session = new ToolSession(renderer, buffer);
    renderer.setComposite(buffer);
    renderer.setViewport({ zoom: 10, panX: 0, panY: 0 });
    renderer.flush();

    session.setTool('select');
    session.pointerDown(2, 2);
    session.pointerMove(8, 8);
    session.pointerUp();
    renderer.flush();

    // Marquee outline present on the overlay near the selection border...
    expect(anyOpaque(canvases.overlay, 15, 15, 95, 95)).toBe(true);
    // ...and the display buffer is untouched by the selection (clean-export).
    expect(anyOpaque(canvases.display, 0, 0, 160, 160)).toBe(false);
    renderer.dispose();
  });
});
