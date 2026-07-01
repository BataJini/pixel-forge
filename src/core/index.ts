/**
 * src/core — pure, deterministic engine primitives.
 *
 * MODULE BOUNDARY (constitution): this folder MUST NOT import React, the DOM, or
 * any browser global, so it stays unit-testable in isolation. Held-out
 * acceptance tests import engine modules from here by their exact paths
 * (master-spec §5): color.ts, buffer.ts, history.ts, palette.ts, project.ts,
 * exporters/*. Those concrete modules land in later units (U-003+); this barrel
 * establishes the boundary and the shared cross-cutting constants for U-001.
 */

// Engine surface (master-spec §5). Held-out tests import concrete modules by
// their exact paths (e.g. `src/core/buffer`); this barrel is for app-internal use.
export * from './buffer';
export * from './color';
export * from './palette';
export * from './path';
export * from './rect';
export * from './selection';
export * from './tools';
export * from './types';
export * from './viewport';

/** Stable module marker (lets the boundary be asserted from a test). */
export const CORE_MODULE = 'pixel-forge/core' as const;

/** Hard canvas cap — constitution: 1 <= w,h <= 512 on every sizing path. */
export const MAX_CANVAS = 512 as const;

/** Minimum canvas dimension. */
export const MIN_CANVAS = 1 as const;

/**
 * Clamp an arbitrary number to a valid integer canvas dimension in
 * [MIN_CANVAS, MAX_CANVAS]. Non-finite input collapses to MIN_CANVAS.
 * Pure and deterministic; no DOM dependency.
 */
export function clampCanvasDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_CANVAS;
  }
  const truncated = Math.trunc(value);
  if (truncated < MIN_CANVAS) {
    return MIN_CANVAS;
  }
  if (truncated > MAX_CANVAS) {
    return MAX_CANVAS;
  }
  return truncated;
}

/** Whether the given width/height pair is within the allowed canvas bounds. */
export function isValidCanvasSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_CANVAS &&
    width <= MAX_CANVAS &&
    height >= MIN_CANVAS &&
    height <= MAX_CANVAS
  );
}
