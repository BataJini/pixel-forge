/**
 * src/core/layers.ts — pure layer-stack operations (master-spec §3.4, §4.1, §5).
 *
 * PURE and deterministic (no DOM, no app state, no id generation): every function
 * takes a `Layer[]` and returns a NEW array with NEW layer objects for anything it
 * changes, never mutating its input (constitution: immutability). Pixel buffers are
 * shared by reference for metadata-only edits (visibility / lock / opacity / name /
 * blend / reorder) — those never touch pixels — and freshly created (via the buffer
 * module) only where an op genuinely bakes pixels: `duplicateLayer` deep-copies,
 * `mergeDown`/`flatten` composite into a new buffer.
 *
 * The compositing semantics live in `buffer.ts` (`composite`): z-order bottom→top,
 * source-over, respecting each layer's `visible`/`opacity`. `mergeDown` and
 * `flatten` therefore bake in visibility and opacity, and hand back a single fully
 * opaque, visible layer so re-compositing the result reproduces it exactly.
 *
 * The held-out acceptance tests import `setVisible`, `moveLayer`, `setOpacity`,
 * `mergeDown`, and `flatten` from this exact path (master-spec §5). Id generation,
 * the mutable active-layer stack, and undo wiring live in `src/state/layerStore.ts`.
 */
import { cloneBuffer, composite, createBuffer } from './buffer';
import type { BlendMode, Layer } from './types';

/** Opacity is a percentage; the engine clamps every layer into this range. */
export const MIN_OPACITY = 0;
export const MAX_OPACITY = 100;

/** Clamp/round an arbitrary number into a valid 0..100 integer opacity. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return MAX_OPACITY;
  }
  return Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, Math.round(value)));
}

/** Truncate + clamp `value` into the inclusive integer range `[min, max]`. */
function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(min, Math.trunc(value)), max);
}

/** Whether `index` is an in-bounds position in `layers`. */
function inRange(layers: readonly Layer[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < layers.length;
}

/** Construct a layer around an existing buffer; attrs default to a normal, fully
 * visible, unlocked, 100% layer and can be overridden via `over`. */
export function makeLayer(
  id: string,
  name: string,
  buffer: Layer['buffer'],
  over: Partial<Omit<Layer, 'id' | 'buffer'>> = {},
): Layer {
  const { opacity, ...rest } = over;
  return {
    id,
    name,
    visible: true,
    locked: false,
    blend: 'normal',
    ...rest,
    // Clamp any supplied opacity so the constructor can never mint an
    // out-of-range layer (the documented 0..100 invariant).
    opacity: opacity === undefined ? 100 : clampOpacity(opacity),
    buffer,
  };
}

/** A fresh, fully transparent `w × h` layer (new layers start empty; §3.4). */
export function blankLayer(id: string, name: string, w: number, h: number): Layer {
  return makeLayer(id, name, createBuffer(w, h));
}

/** Whether the stack can lose a layer — the last remaining layer is protected
 * from deletion (master-spec §3.4). */
export function canDeleteLayer(layers: readonly Layer[]): boolean {
  return layers.length > 1;
}

/** Return a new array with `patch` shallow-merged into the layer at `index`
 * (metadata edit — the pixel buffer is preserved by reference). Out-of-range is a
 * safe no-op that still returns a fresh array copy. */
function patchLayer(
  layers: readonly Layer[],
  index: number,
  patch: Partial<Omit<Layer, 'id' | 'buffer'>>,
): Layer[] {
  return layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer));
}

/** Show/hide a layer (its pixels leave/enter the composite). */
export function setVisible(layers: readonly Layer[], index: number, visible: boolean): Layer[] {
  return patchLayer(layers, index, { visible });
}

/** Lock/unlock a layer (a locked layer rejects pixel edits at the tool boundary). */
export function setLocked(layers: readonly Layer[], index: number, locked: boolean): Layer[] {
  return patchLayer(layers, index, { locked });
}

/** Set a layer's opacity percentage (clamped/rounded to 0..100). */
export function setOpacity(layers: readonly Layer[], index: number, opacity: number): Layer[] {
  return patchLayer(layers, index, { opacity: clampOpacity(opacity) });
}

/** Rename a layer. */
export function setName(layers: readonly Layer[], index: number, name: string): Layer[] {
  return patchLayer(layers, index, { name });
}

/** Set a layer's blend mode (default `'normal'`; others reserved for later units). */
export function setBlend(layers: readonly Layer[], index: number, blend: BlendMode): Layer[] {
  return patchLayer(layers, index, { blend });
}

/**
 * Reorder: pull the layer at `from` and reinsert it at `to`. Indices are clamped
 * defensively; a 0/1-length stack or a no-op move returns a fresh copy unchanged.
 * (`from`/`to` are stack indices, 0 = bottom.)
 */
export function moveLayer(layers: readonly Layer[], from: number, to: number): Layer[] {
  if (layers.length < 2) {
    return layers.slice();
  }
  const last = layers.length - 1;
  const f = clampIndex(from, 0, last);
  const t = clampIndex(to, 0, last);
  if (f === t) {
    return layers.slice();
  }
  const next = layers.slice();
  const [item] = next.splice(f, 1);
  next.splice(t, 0, item);
  return next;
}

/** Insert `layer` at stack position `index` (clamped to `[0, length]`). */
export function insertLayer(layers: readonly Layer[], index: number, layer: Layer): Layer[] {
  const i = clampIndex(index, 0, layers.length);
  return [...layers.slice(0, i), layer, ...layers.slice(i)];
}

/**
 * Duplicate the layer at `index` (deep-copying its pixels) and insert the copy
 * directly ABOVE the source, carrying the given `newId`. Visibility, opacity and
 * blend are preserved; the copy starts unlocked. Out-of-range is a no-op copy.
 */
export function duplicateLayer(layers: readonly Layer[], index: number, newId: string): Layer[] {
  if (!inRange(layers, index)) {
    return layers.slice();
  }
  const src = layers[index];
  const copy = makeLayer(newId, `${src.name} copy`, cloneBuffer(src.buffer), {
    visible: src.visible,
    opacity: src.opacity,
    blend: src.blend,
    locked: false,
  });
  return insertLayer(layers, index + 1, copy);
}

/**
 * Delete the layer at `index`. Refuses to delete the last remaining layer and any
 * out-of-range index (returns a fresh copy unchanged), so the stack always keeps
 * ≥ 1 layer (master-spec §3.4).
 */
export function deleteLayer(layers: readonly Layer[], index: number): Layer[] {
  if (!canDeleteLayer(layers) || !inRange(layers, index)) {
    return layers.slice();
  }
  return [...layers.slice(0, index), ...layers.slice(index + 1)];
}

/**
 * Merge the layer at `index` DOWN onto the layer beneath it (`index - 1`),
 * replacing the pair with a single layer whose buffer is `composite([lower, upper])`
 * — so it reproduces exactly what the two layers showed. The merged layer keeps the
 * lower layer's id/name and lock state and is fully opaque + visible. Merging the
 * bottom layer (or an out-of-range index) is a no-op copy.
 */
export function mergeDown(layers: readonly Layer[], index: number): Layer[] {
  if (!inRange(layers, index) || index < 1) {
    return layers.slice();
  }
  const lower = layers[index - 1];
  const upper = layers[index];
  const merged = makeLayer(lower.id, lower.name, composite([lower, upper]), {
    locked: lower.locked,
  });
  return [...layers.slice(0, index - 1), merged, ...layers.slice(index + 1)];
}

/**
 * Collapse the whole stack into a single layer whose buffer equals the full
 * composite (all visibility/opacity baked in). Keeps the bottom layer's id/name and
 * returns it fully opaque, visible and unlocked. An empty stack stays empty.
 */
export function flatten(layers: readonly Layer[]): Layer[] {
  if (layers.length === 0) {
    return [];
  }
  const base = layers[0];
  // `composite` takes a mutable Layer[]; hand it a shallow copy (it never mutates).
  return [makeLayer(base.id, base.name, composite(layers.slice()), { locked: false })];
}
