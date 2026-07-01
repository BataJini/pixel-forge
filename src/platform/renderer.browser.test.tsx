import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuffer, setPixel, setPixelMut } from '../core/buffer';
import type { PixelBuffer } from '../core/types';
import { createRenderer, type RendererCanvases } from './renderer';

// Real Chromium via Vitest Browser Mode (`npm run test:browser`). Automates the
// U-003 "Manual / review" criteria: nearest-neighbor display, dirty-rect-only
// repaint, checkerboard/grid on separate presentation layers (never the buffer),
// and pointer->art coordinate mapping.

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

afterEach(() => {
  for (const h of hosts.splice(0)) {
    h.remove();
  }
  vi.restoreAllMocks();
});

describe('PixelRenderer — display pipeline', () => {
  it('renders the buffer nearest-neighbor and lets transparent pixels reveal the checker', () => {
    const canvases = mountCanvases();
    const r = createRenderer(canvases, { dpr: 1, grid: { pixel: true, tile: null } });
    r.resize(160, 160);

    // 2x2: only (0,0) is opaque red; the rest transparent.
    let buf: PixelBuffer = createBuffer(2, 2);
    buf = setPixel(buf, 0, 0, [255, 0, 0, 255]);
    r.setComposite(buf);
    r.setViewport({ zoom: 40, panX: 0, panY: 0 });
    r.flush();

    // Center of the scaled red pixel (art 0,0 -> screen 0..40) is solid red...
    expect(pixelAt(canvases.display, 20, 20)).toEqual([255, 0, 0, 255]);
    // ...and a neighbouring device pixel is still exactly red (no anti-aliased ramp).
    expect(pixelAt(canvases.display, 39, 39)).toEqual([255, 0, 0, 255]);

    // Art pixel (1,0) is transparent on the DISPLAY (alpha 0), so the backdrop
    // checkerboard shows through — the checker is never in the buffer.
    expect(pixelAt(canvases.display, 60, 20)[3]).toBe(0);
    const checker = pixelAt(canvases.backdrop, 60, 20);
    expect(checker[3]).toBe(255);
    expect(checker[0]).toBeGreaterThan(120); // neutral grey, not red
    r.dispose();
  });

  it('a single-pixel edit repaints ONLY its scaled sub-rect (dirty-rect)', () => {
    const canvases = mountCanvases();
    const r = createRenderer(canvases, { dpr: 1 });
    r.resize(200, 200);
    const buf = createBuffer(16, 16);
    r.setComposite(buf);
    r.setViewport({ zoom: 8, panX: 0, panY: 0 });
    r.flush();

    const ctx = canvases.display.getContext('2d');
    if (!ctx) {
      throw new Error('no ctx');
    }
    const clearSpy = vi.spyOn(ctx, 'clearRect');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    setPixelMut(buf, 5, 6, [0, 255, 0, 255]);
    r.updateRegion(buf, { x: 5, y: 6, w: 1, h: 1 });
    r.flush();

    // Exactly one blit, scoped to the 8x8 device rect at (40,48) — not the full canvas.
    expect(drawSpy).toHaveBeenCalledTimes(1);
    const drawArgs = drawSpy.mock.calls[0];
    expect(drawArgs.slice(5)).toEqual([40, 48, 8, 8]);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy.mock.calls[0]).toEqual([40, 48, 8, 8]);
    r.dispose();
  });

  it('repaints only the dirty rect at the 512x512 ceiling (no full-canvas repaint)', () => {
    const canvases = mountCanvases();
    const r = createRenderer(canvases, { dpr: 1 });
    r.resize(560, 560);
    const buf = createBuffer(512, 512);
    r.setComposite(buf);
    r.setViewport({ zoom: 1, panX: 8, panY: 8 });
    r.flush();

    const ctx = canvases.display.getContext('2d');
    if (!ctx) {
      throw new Error('no ctx');
    }
    const clearSpy = vi.spyOn(ctx, 'clearRect');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    setPixelMut(buf, 300, 400, [255, 106, 26, 255]);
    r.updateRegion(buf, { x: 300, y: 400, w: 1, h: 1 });
    r.flush();

    // One 1x1 blit at (308,408) — a full-canvas repaint of ~262k px is never done.
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(drawSpy.mock.calls[0].slice(5)).toEqual([308, 408, 1, 1]);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy.mock.calls[0]).toEqual([308, 408, 1, 1]);
    r.dispose();
  });

  it('coalesces multiple dirty marks within one frame into a single blit', () => {
    const canvases = mountCanvases();
    const r = createRenderer(canvases, { dpr: 1 });
    r.resize(200, 200);
    const buf = createBuffer(16, 16);
    r.setComposite(buf);
    r.setViewport({ zoom: 8, panX: 0, panY: 0 });
    r.flush();

    const ctx = canvases.display.getContext('2d');
    if (!ctx) {
      throw new Error('no ctx');
    }
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    r.markDirty({ x: 1, y: 1, w: 1, h: 1 });
    r.markDirty({ x: 3, y: 4, w: 1, h: 1 });
    r.flush();

    expect(drawSpy).toHaveBeenCalledTimes(1);
    // Union of the two marks: x[1..4), y[1..5) -> device (8,8,24,32).
    expect(drawSpy.mock.calls[0].slice(5)).toEqual([8, 8, 24, 32]);
    r.dispose();
  });

  it('maps pointer positions to the correct integer art coordinate', () => {
    const canvases = mountCanvases();
    const r = createRenderer(canvases, { dpr: 1 });
    r.resize(200, 200);
    r.setComposite(createBuffer(16, 16));
    r.setViewport({ zoom: 10, panX: 5, panY: 7 });
    r.flush();

    expect(r.screenToArt(5, 7)).toEqual({ x: 0, y: 0 });
    expect(r.screenToArt(16, 18)).toEqual({ x: 1, y: 1 });
    expect(r.artToScreen(2, 3)).toEqual({ x: 25, y: 37 });
    r.dispose();
  });

  it('shows the pixel grid only when zoomed in enough, and only on the overlay', () => {
    const canvases = mountCanvases();
    const r = createRenderer(canvases, {
      dpr: 1,
      gridMinZoom: 8,
      grid: { pixel: true, tile: null },
    });
    r.resize(200, 200);
    r.setComposite(createBuffer(16, 16));

    // Below threshold: overlay is fully transparent along a boundary.
    r.setViewport({ zoom: 4, panX: 0, panY: 0 });
    r.flush();
    expect(pixelAt(canvases.overlay, 4 * 4, 20)[3]).toBe(0);

    // At/above threshold: a grid line boundary paints on the overlay.
    r.setViewport({ zoom: 8, panX: 0, panY: 0 });
    r.flush();
    let found = false;
    for (let y = 0; y < 16 * 8; y++) {
      if (pixelAt(canvases.overlay, 8, y)[3] > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    r.dispose();
  });
});
