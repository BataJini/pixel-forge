/**
 * src/platform/renderer.ts — the three-layer Canvas 2D render pipeline (ADR-002).
 *
 * Browser glue (uses the DOM/canvas): keeps the pure engine (src/core) free of
 * side effects. Three stacked canvases plus one offscreen source:
 *   - source  (offscreen, art resolution) — the composited pixel buffer
 *   - backdrop (bottom) — transparency checkerboard, shows under transparent art
 *   - display  (middle) — the source scaled with `imageSmoothingEnabled=false`
 *                         (nearest-neighbor) so pixels stay crisp when zoomed
 *   - overlay  (top)    — pixel/tile grid, and later cursor/marquee/onion ghosts
 *
 * Repaints are rAF-coalesced and dirty-rect scoped: a single pointer edit
 * repaints ONLY its scaled sub-rect on the display canvas (constitution/perf) —
 * the backdrop and overlay only repaint when the viewport or size changes.
 * The checkerboard and grid live on separate presentation canvases and never
 * touch the source buffer, so exports stay effect-free (clean-export invariant).
 */
import { clampRect, intersectRect, isEmptyRect, makeRect, unionRect } from '../core/rect';
import type { PixelBuffer, Rect } from '../core/types';
import { artToScreen, type Point, screenToArt, type Viewport } from '../core/viewport';
import { CHECKER_COLORS, drawCheckerboard, drawPixelGrid, drawTileGrid } from './overlays';

export interface RendererCanvases {
  backdrop: HTMLCanvasElement;
  display: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
}

export interface GridConfig {
  pixel: boolean;
  tile: number | null;
}

export interface RendererConfig {
  dpr?: number;
  checkerColors?: readonly [string, string];
  gridColor?: string;
  tileColor?: string;
  gridMinZoom?: number;
  grid?: GridConfig;
}

const DEFAULT_GRID_MIN_ZOOM = 8;
const DEFAULT_GRID_COLOR = 'rgba(120,120,120,0.55)';
const DEFAULT_TILE_COLOR = 'rgba(255,176,58,0.6)';
const MIN_CHECKER_CELL = 4;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  return ctx;
}

/**
 * Imperative controller for the pipeline. Framework-agnostic: React (or a plain
 * demo) creates the three canvases and drives it. All coordinates in the public
 * API are CSS pixels (the space pointer events report); device-pixel scaling is
 * applied internally via `setTransform(dpr)`.
 */
export class PixelRenderer {
  private readonly backCtx: CanvasRenderingContext2D;
  private readonly dispCtx: CanvasRenderingContext2D;
  private readonly overCtx: CanvasRenderingContext2D;
  private readonly source: HTMLCanvasElement;
  private readonly sourceCtx: CanvasRenderingContext2D;
  private sourceImage: ImageData | null = null;

  private readonly dpr: number;
  private readonly checkerColors: readonly [string, string];
  private readonly gridColor: string;
  private readonly tileColor: string;
  private readonly gridMinZoom: number;

  private viewport: Viewport = { zoom: 1, panX: 0, panY: 0 };
  private grid: GridConfig;
  private sourceW = 0;
  private sourceH = 0;
  private cssW = 0;
  private cssH = 0;

  private pendingDirty: Rect | null = null;
  private needsFullDisplay = true;
  private needsStatic = true;
  private frameId: number | null = null;
  private frameKind: 'raf' | 'timeout' = 'raf';
  private disposed = false;

  constructor(
    private readonly canvases: RendererCanvases,
    config: RendererConfig = {},
  ) {
    this.backCtx = context2d(canvases.backdrop);
    this.dispCtx = context2d(canvases.display);
    this.overCtx = context2d(canvases.overlay);
    this.source = document.createElement('canvas');
    this.sourceCtx = context2d(this.source);
    this.dpr = config.dpr ?? (globalThis.devicePixelRatio || 1);
    this.checkerColors = config.checkerColors ?? CHECKER_COLORS;
    this.gridColor = config.gridColor ?? DEFAULT_GRID_COLOR;
    this.tileColor = config.tileColor ?? DEFAULT_TILE_COLOR;
    this.gridMinZoom = config.gridMinZoom ?? DEFAULT_GRID_MIN_ZOOM;
    this.grid = config.grid ?? { pixel: true, tile: null };
    canvases.display.style.imageRendering = 'pixelated';
  }

  /** Current viewport (immutable snapshot). */
  getViewport(): Viewport {
    return this.viewport;
  }

  /** Replace the whole composited buffer and repaint everything. */
  setComposite(buf: PixelBuffer): void {
    if (this.source.width !== buf.w || this.source.height !== buf.h) {
      this.source.width = buf.w;
      this.source.height = buf.h;
      this.sourceImage = buf.w > 0 && buf.h > 0 ? new ImageData(buf.w, buf.h) : null;
    }
    this.sourceW = buf.w;
    this.sourceH = buf.h;
    if (this.sourceImage) {
      this.sourceImage.data.set(buf.data);
      this.sourceCtx.putImageData(this.sourceImage, 0, 0);
    }
    this.needsStatic = true;
    this.needsFullDisplay = true;
    this.schedule();
  }

  /**
   * Upload only `rect` of `buf` into the source and mark it dirty — the hot path
   * for a single pointer edit. Copies just the dirty rows into the persistent
   * source image. Falls back to a full replace on a size mismatch.
   */
  updateRegion(buf: PixelBuffer, rect: Rect): void {
    if (buf.w !== this.sourceW || buf.h !== this.sourceH || !this.sourceImage) {
      this.setComposite(buf);
      return;
    }
    const area = clampRect(rect, buf.w, buf.h);
    if (isEmptyRect(area)) {
      return;
    }
    const rowLen = area.w * 4;
    for (let y = area.y; y < area.y + area.h; y++) {
      const start = (y * buf.w + area.x) * 4;
      this.sourceImage.data.set(buf.data.subarray(start, start + rowLen), start);
    }
    this.sourceCtx.putImageData(this.sourceImage, 0, 0, area.x, area.y, area.w, area.h);
    this.markDirty(area);
  }

  /** Accumulate a dirty art-space rect for the next display repaint. */
  markDirty(rect: Rect): void {
    const area = clampRect(rect, this.sourceW, this.sourceH);
    if (isEmptyRect(area)) {
      return;
    }
    this.pendingDirty = this.pendingDirty ? unionRect(this.pendingDirty, area) : area;
    this.schedule();
  }

  /** Set pan/zoom; forces a full repaint of all three canvases. */
  setViewport(vp: Viewport): void {
    this.viewport = vp;
    this.needsStatic = true;
    this.needsFullDisplay = true;
    this.schedule();
  }

  /** Toggle pixel/tile grid; repaints the overlay. */
  setGrid(grid: GridConfig): void {
    this.grid = grid;
    this.needsStatic = true;
    this.schedule();
  }

  /** Resize all canvases to `cssW × cssH` CSS px (backing store scaled by dpr). */
  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(0, Math.floor(cssW));
    this.cssH = Math.max(0, Math.floor(cssH));
    for (const canvas of [this.canvases.backdrop, this.canvases.display, this.canvases.overlay]) {
      canvas.width = Math.round(this.cssW * this.dpr);
      canvas.height = Math.round(this.cssH * this.dpr);
      canvas.style.width = `${this.cssW}px`;
      canvas.style.height = `${this.cssH}px`;
    }
    this.backCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.dispCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.overCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.needsStatic = true;
    this.needsFullDisplay = true;
    this.schedule();
  }

  /** Map a CSS-px view point to the integer art pixel under it. */
  screenToArt(sx: number, sy: number): Point {
    return screenToArt(this.viewport, sx, sy);
  }

  /** Map an art pixel corner to its CSS-px view position. */
  artToScreen(ax: number, ay: number): Point {
    return artToScreen(this.viewport, ax, ay);
  }

  /** Paint synchronously right now, cancelling any pending frame. */
  flush(): void {
    this.cancelFrame();
    this.render();
  }

  /** Stop all scheduled work; the instance must not be used afterward. */
  dispose(): void {
    this.cancelFrame();
    this.disposed = true;
  }

  private schedule(): void {
    if (this.disposed || this.frameId !== null) {
      return;
    }
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') {
      this.frameKind = 'raf';
      this.frameId = raf(() => {
        this.frameId = null;
        this.render();
      });
    } else {
      this.frameKind = 'timeout';
      this.frameId = setTimeout(() => {
        this.frameId = null;
        this.render();
      }, 0) as unknown as number;
    }
  }

  private cancelFrame(): void {
    if (this.frameId === null) {
      return;
    }
    if (this.frameKind === 'raf' && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.frameId);
    } else {
      clearTimeout(this.frameId);
    }
    this.frameId = null;
  }

  private render(): void {
    if (this.disposed) {
      return;
    }
    if (this.needsStatic) {
      this.paintBackdrop();
      this.paintOverlay();
      this.needsStatic = false;
    }
    if (this.needsFullDisplay) {
      this.dispCtx.clearRect(0, 0, this.cssW, this.cssH);
      this.paintDisplayRegion(makeRect(0, 0, this.sourceW, this.sourceH), true);
      this.needsFullDisplay = false;
      this.pendingDirty = null;
    } else if (this.pendingDirty) {
      this.paintDisplayRegion(this.pendingDirty, false);
      this.pendingDirty = null;
    }
  }

  private paintDisplayRegion(artRect: Rect, fullClear: boolean): void {
    if (this.sourceW <= 0 || this.sourceH <= 0) {
      return;
    }
    const r = clampRect(artRect, this.sourceW, this.sourceH);
    if (isEmptyRect(r)) {
      return;
    }
    const { zoom, panX, panY } = this.viewport;
    const dx = panX + r.x * zoom;
    const dy = panY + r.y * zoom;
    const dw = r.w * zoom;
    const dh = r.h * zoom;
    this.dispCtx.imageSmoothingEnabled = false;
    if (!fullClear) {
      this.dispCtx.clearRect(dx, dy, dw, dh);
    }
    this.dispCtx.drawImage(this.source, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
  }

  private artRectScreen(): Rect | null {
    if (this.sourceW <= 0 || this.sourceH <= 0) {
      return null;
    }
    const { zoom, panX, panY } = this.viewport;
    const art = makeRect(panX, panY, this.sourceW * zoom, this.sourceH * zoom);
    return intersectRect(art, makeRect(0, 0, this.cssW, this.cssH));
  }

  private paintBackdrop(): void {
    this.backCtx.clearRect(0, 0, this.cssW, this.cssH);
    const art = this.artRectScreen();
    if (!art) {
      return;
    }
    const cell = Math.max(MIN_CHECKER_CELL, Math.round(this.viewport.zoom));
    drawCheckerboard(this.backCtx, art, cell, this.checkerColors);
  }

  private paintOverlay(): void {
    this.overCtx.clearRect(0, 0, this.cssW, this.cssH);
    if (this.sourceW <= 0 || this.sourceH <= 0) {
      return;
    }
    const { zoom, panX, panY } = this.viewport;
    const origin: Point = { x: panX, y: panY };
    if (this.grid.pixel && zoom >= this.gridMinZoom) {
      drawPixelGrid(this.overCtx, origin, zoom, this.sourceW, this.sourceH, this.gridColor);
    }
    if (this.grid.tile && this.grid.tile > 0) {
      drawTileGrid(
        this.overCtx,
        origin,
        zoom,
        this.sourceW,
        this.sourceH,
        this.grid.tile,
        this.tileColor,
      );
    }
  }
}

/** Convenience factory mirroring the `createRenderer` naming in the plan. */
export function createRenderer(canvases: RendererCanvases, config?: RendererConfig): PixelRenderer {
  return new PixelRenderer(canvases, config);
}
