/**
 * src/platform/overlays.ts — presentation-only drawing helpers (browser glue).
 *
 * These paint the transparency checkerboard (backdrop layer) and the pixel/tile
 * grids (overlay layer). CONSTITUTION (clean-export): none of this ever writes to
 * a pixel buffer or appears in an export — it is drawn on separate presentation
 * canvases above/below the display, never on the source-of-truth artwork.
 */
import type { Rect } from '../core/types';

/** Neutral, theme-independent transparency checker colors (design-direction). */
export const CHECKER_COLORS: readonly [string, string] = ['#C8C8C8', '#8F8F8F'];

interface Point {
  x: number;
  y: number;
}

/**
 * Fill `rect` (screen/CSS px) with a two-tone checkerboard of `cell`-sized
 * squares, clipped to the rect so it reads as the canvas surface only.
 */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  cell: number,
  colors: readonly [string, string] = CHECKER_COLORS,
): void {
  if (rect.w <= 0 || rect.h <= 0 || cell <= 0) {
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const cols = Math.ceil(rect.w / cell) + 1;
  const rows = Math.ceil(rect.h / cell) + 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) & 1 ? colors[1] : colors[0];
      ctx.fillRect(rect.x + col * cell, rect.y + row * cell, cell, cell);
    }
  }
  ctx.restore();
}

/** Draw crisp 1px lines on every art-pixel boundary within the art rectangle. */
export function drawPixelGrid(
  ctx: CanvasRenderingContext2D,
  origin: Point,
  zoom: number,
  artW: number,
  artH: number,
  color: string,
): void {
  drawGridLines(ctx, origin, zoom, artW, artH, 1, color, 1);
}

/** Draw a heavier tile grid every `tile` art pixels (0/absent = skip). */
export function drawTileGrid(
  ctx: CanvasRenderingContext2D,
  origin: Point,
  zoom: number,
  artW: number,
  artH: number,
  tile: number,
  color: string,
): void {
  if (tile > 0) {
    drawGridLines(ctx, origin, zoom, artW, artH, tile, color, 1);
  }
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  origin: Point,
  zoom: number,
  artW: number,
  artH: number,
  step: number,
  color: string,
  lineWidth: number,
): void {
  const spanX = artW * zoom;
  const spanY = artH * zoom;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let i = 0; i <= artW; i += step) {
    const x = Math.round(origin.x + i * zoom) + 0.5;
    ctx.moveTo(x, origin.y);
    ctx.lineTo(x, origin.y + spanY);
  }
  for (let j = 0; j <= artH; j += step) {
    const y = Math.round(origin.y + j * zoom) + 0.5;
    ctx.moveTo(origin.x, y);
    ctx.lineTo(origin.x + spanX, y);
  }
  ctx.stroke();
  ctx.restore();
}
