/**
 * src/core/history.ts — pure undo/redo primitives (master-spec §5, ADR-005).
 *
 * PURE and deterministic (no DOM, no app state). Two reversible command shapes:
 *
 *   1. {@link Patch} — a pixel edit stored as ONLY the dirty sub-rect's before/
 *      after bytes (never a full-buffer snapshot). This keeps a single stroke
 *      cheap even at the 512×512 ceiling (a 1px edit = 4 bytes each way, not 1MB)
 *      and lets undo/redo blit the rect back. `makePatch`/`applyPatch` are the
 *      contract the held-out acceptance tests import by exact path.
 *
 *   2. {@link ListEdit} — a reversible algebra over an ordered list (a frame's
 *      layer stack, or the frame list) covering insert / remove / move / replace.
 *      `applyListEdit` returns the new list AND the exact inverse edit, so U-007
 *      (layers) and U-008 (frames) get add/remove/reorder undo for free.
 *
 * The stateful undo/redo stacks, coalescing, and keyboard wiring live in
 * `src/state/historyStore.ts`; the depth/byte caps are enforced with the pure
 * {@link capByBudget} helper here so eviction is unit-testable in isolation.
 */
import { cloneBuffer, dirtyRect } from './buffer';
import { makeRect } from './rect';
import type { PixelBuffer, Rect } from './types';

const CHANNELS = 4;

/** Direction to apply a {@link Patch}: restore its `before` or its `after`. */
export type PatchDirection = 'undo' | 'redo';

/**
 * A reversible pixel edit. `rect` is the tight dirty bounding box in buffer
 * coordinates; `before`/`after` hold that rect's RGBA bytes (`rect.w*rect.h*4`
 * each) for the pre- and post-edit states. `layerId`/`frameId` name the target
 * so the app can route the patch to the right layer buffer.
 */
export interface Patch {
  readonly layerId: string;
  readonly frameId: string;
  readonly rect: Rect;
  readonly before: Uint8ClampedArray;
  readonly after: Uint8ClampedArray;
}

/** Row-major copy of `rect`'s RGBA bytes out of `buf` (rect must be in bounds). */
function extractRectBytes(buf: PixelBuffer, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * CHANNELS);
  const rowLen = rect.w * CHANNELS;
  for (let row = 0; row < rect.h; row++) {
    const si = ((rect.y + row) * buf.w + rect.x) * CHANNELS;
    out.set(buf.data.subarray(si, si + rowLen), row * rowLen);
  }
  return out;
}

/**
 * Build a patch for the change from `before` to `after`, storing only the dirty
 * sub-rect's bytes. Returns `null` when the two buffers are identical (no-op edit).
 * Intended for same-size pixel edits; dimension changes are structural commands.
 */
export function makePatch(
  layerId: string,
  frameId: string,
  before: PixelBuffer,
  after: PixelBuffer,
): Patch | null {
  const rect = dirtyRect(before, after);
  if (!rect) {
    return null;
  }
  return Object.freeze({
    layerId,
    frameId,
    rect,
    before: extractRectBytes(before, rect),
    after: extractRectBytes(after, rect),
  });
}

/**
 * Return a NEW buffer with `patch`'s dirty rect restored to its `before` bytes
 * (`dir='undo'`) or `after` bytes (`dir='redo'`); the input buffer is untouched.
 * Bounds-safe: any portion of the rect outside `buf` is skipped (never throws),
 * so a patch applied to a resized/mismatched buffer degrades gracefully.
 */
export function applyPatch(buf: PixelBuffer, patch: Patch, dir: PatchDirection): PixelBuffer {
  const src = dir === 'undo' ? patch.before : patch.after;
  const next = cloneBuffer(buf);
  const { x, y, w, h } = patch.rect;
  const startX = Math.max(0, x);
  const endX = Math.min(next.w, x + w);
  if (endX <= startX) {
    return next;
  }
  const copyLen = (endX - startX) * CHANNELS;
  const srcCol = startX - x;
  for (let row = 0; row < h; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= next.h) {
      continue;
    }
    const di = (dy * next.w + startX) * CHANNELS;
    const si = (row * w + srcCol) * CHANNELS;
    next.data.set(src.subarray(si, si + copyLen), di);
  }
  return next;
}

/** The inverse patch: swaps `before`/`after` (shares the byte arrays, no copy). */
export function invertPatch(patch: Patch): Patch {
  return Object.freeze({
    layerId: patch.layerId,
    frameId: patch.frameId,
    rect: patch.rect,
    before: patch.after,
    after: patch.before,
  });
}

/** Approximate retained memory of a patch in bytes (both byte arrays + overhead). */
export function patchByteSize(patch: Patch): number {
  const OVERHEAD = 64; // rect + ids + object headers, amortized
  return patch.before.length + patch.after.length + OVERHEAD;
}

// ─── Reversible ordered-list algebra (structural commands, ADR-005) ──────────

/** A reversible edit to an ordered list (layer stack / frame list). */
export type ListEdit<T> =
  | { readonly type: 'insert'; readonly index: number; readonly items: readonly T[] }
  | { readonly type: 'remove'; readonly index: number; readonly count: number }
  | { readonly type: 'move'; readonly from: number; readonly to: number }
  | { readonly type: 'replace'; readonly index: number; readonly item: T };

/** The result of {@link applyListEdit}: the new list plus the exact inverse edit. */
export interface ListEditResult<T> {
  readonly next: T[];
  readonly inverse: ListEdit<T>;
}

function clampIndex(index: number, max: number): number {
  return Math.min(Math.max(0, Math.trunc(index)), max);
}

/**
 * Apply a reversible list edit purely, returning the new list and the inverse
 * edit that restores the original. The input list is never mutated. Indices are
 * clamped defensively so an out-of-range edit degrades to a safe no-op-ish result.
 */
export function applyListEdit<T>(list: readonly T[], edit: ListEdit<T>): ListEditResult<T> {
  switch (edit.type) {
    case 'insert': {
      const index = clampIndex(edit.index, list.length);
      const items = [...edit.items];
      const next = [...list.slice(0, index), ...items, ...list.slice(index)];
      return { next, inverse: { type: 'remove', index, count: items.length } };
    }
    case 'remove': {
      const index = clampIndex(edit.index, list.length);
      const count = Math.max(0, Math.min(Math.trunc(edit.count), list.length - index));
      const removed = list.slice(index, index + count);
      const next = [...list.slice(0, index), ...list.slice(index + count)];
      return { next, inverse: { type: 'insert', index, items: removed } };
    }
    case 'move': {
      // A 0- or 1-element list cannot be reordered; return a no-op move.
      if (list.length < 2) {
        return { next: [...list], inverse: { type: 'move', from: 0, to: 0 } };
      }
      const from = clampIndex(edit.from, list.length - 1);
      const to = clampIndex(edit.to, list.length - 1);
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { next, inverse: { type: 'move', from: to, to: from } };
    }
    case 'replace': {
      // Replacing into an empty list degenerates to an insert (invert = remove).
      if (list.length === 0) {
        return { next: [edit.item], inverse: { type: 'remove', index: 0, count: 1 } };
      }
      const index = clampIndex(edit.index, list.length - 1);
      const prev = list[index];
      const next = [...list];
      next[index] = edit.item;
      return { next, inverse: { type: 'replace', index, item: prev } };
    }
  }
}

// ─── History caps (depth + total bytes, oldest-eviction) ─────────────────────

/** Default undo depth (master-spec §3.6/§6). */
export const DEFAULT_HISTORY_DEPTH = 100 as const;

/** Default total-bytes budget for the undo stack (~64MB, master-spec §6). */
export const DEFAULT_HISTORY_MAX_BYTES = 64 * 1024 * 1024;

/** Anything carrying an approximate byte weight (a history entry or patch). */
export interface Weighted {
  readonly bytes: number;
}

/** The kept (newest) and dropped (oldest) partition from {@link capByBudget}. */
export interface CapResult<T> {
  readonly kept: T[];
  readonly dropped: T[];
}

/**
 * Enforce the depth and byte caps on an undo stack whose NEWEST entry is last.
 * Oldest entries (front) are evicted first until the stack fits both the depth
 * and byte budgets; the single newest entry is always retained even if it alone
 * exceeds the byte budget. Pure — returns the kept/dropped partition, no mutation.
 */
export function capByBudget<T extends Weighted>(
  stack: readonly T[],
  maxDepth: number = DEFAULT_HISTORY_DEPTH,
  maxBytes: number = DEFAULT_HISTORY_MAX_BYTES,
): CapResult<T> {
  if (stack.length === 0) {
    return { kept: [], dropped: [] };
  }
  const depth = Math.max(1, Math.trunc(maxDepth));
  // Walk newest→oldest, keeping entries while both budgets allow.
  let keepCount = 0;
  let total = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    const nextTotal = total + stack[i].bytes;
    const withinDepth = keepCount < depth;
    const withinBytes = nextTotal <= maxBytes;
    if (keepCount === 0 || (withinDepth && withinBytes)) {
      // Always keep the newest; then keep while within both caps.
      total = nextTotal;
      keepCount += 1;
    } else {
      break;
    }
  }
  const cut = stack.length - keepCount;
  return { kept: stack.slice(cut), dropped: stack.slice(0, cut) };
}

/** A tight 1×1 rect at (x,y) — small helper for single-pixel patch bounds. */
export function pixelRect(x: number, y: number): Rect {
  return makeRect(x, y, 1, 1);
}
