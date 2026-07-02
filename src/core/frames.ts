/**
 * src/core/frames.ts — pure animation-frame algebra (master-spec §3.5).
 *
 * PURE and deterministic (no DOM, no app state, no id generation): every function
 * takes a `readonly Frame[]` and returns a NEW array with NEW frame/layer objects
 * for anything it changes, never mutating its input (constitution: immutability).
 * Pixel buffers are shared by reference for metadata-only edits and freshly created
 * (via the buffer/layers modules) only where an op genuinely bakes pixels:
 * `duplicateFrame` deep-copies every layer's buffer, `addLayerToAllFrames` mints a
 * fresh transparent buffer PER frame.
 *
 * Cross-frame layer alignment (§3.5): the layer set is consistent across frames —
 * `layers[i]` carries the SAME id/name/visibility/lock/opacity/blend in every frame,
 * differing only in its per-frame pixel `buffer` (the "cel"). The alignment helpers
 * (`addLayerToAllFrames`, `removeLayerFromAllFrames`, `moveLayerInAllFrames`,
 * `duplicateLayerInAllFrames`, `updateLayerInAllFrames`) preserve that invariant.
 *
 * Compositing semantics live in `buffer.ts` (`composite`); the stateful, undoable
 * frame stack, id generation and the rAF playback clock live in
 * `src/state/frameStore.ts` and the timeline UI — this module is unit-testable in
 * isolation.
 */
import { cloneBuffer, composite, createBuffer } from './buffer';
import {
  blankLayer,
  duplicateLayer as coreDuplicateLayer,
  moveLayer as coreMoveLayer,
  insertLayer,
} from './layers';
import type { Frame, Layer, PixelBuffer } from './types';

// ─── FPS / duration bounds ───────────────────────────────────────────────────

/** Slowest allowed global playback rate. */
export const MIN_FPS = 1;
/** Fastest allowed global playback rate. */
export const MAX_FPS = 60;
/** Default global FPS for a fresh animation (a calm 12fps). */
export const DEFAULT_FPS = 12;

/** Shortest a single frame may linger (ms). */
export const MIN_DURATION_MS = 10;
/** Longest a single frame may linger (ms). */
export const MAX_DURATION_MS = 60_000;
/** Default per-frame on-screen time (ms) for a newly added frame. */
export const DEFAULT_DURATION_MS = 100;

/** Clamp/round an arbitrary number into a valid integer FPS [MIN_FPS, MAX_FPS]. */
export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) {
    return DEFAULT_FPS;
  }
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps)));
}

/** Clamp/round an arbitrary number into a valid frame duration in ms. */
export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) {
    return DEFAULT_DURATION_MS;
  }
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(ms)));
}

/** The ms-per-frame implied by a global FPS (e.g. 12fps → ~83ms). */
export function fpsToDurationMs(fps: number): number {
  return Math.round(1000 / clampFps(fps));
}

// ─── index helpers ───────────────────────────────────────────────────────────

function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(min, Math.trunc(value)), max);
}

function inRange(frames: readonly Frame[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < frames.length;
}

// ─── frame construction ──────────────────────────────────────────────────────

/** Build a frame around an existing layer stack (duration clamped to bounds). */
export function makeFrame(
  id: string,
  layers: readonly Layer[],
  durationMs: number = DEFAULT_DURATION_MS,
): Frame {
  return { id, durationMs: clampDuration(durationMs), layers: layers.slice() };
}

/**
 * A fresh single-layer frame: one blank, fully-transparent `w × h` layer. Used to
 * seed a new (single-frame) document; `layerId`/`layerName` give that first layer
 * its aligned identity so later frames can be duplicated/added consistently.
 */
export function blankFrame(
  id: string,
  w: number,
  h: number,
  layerId: string,
  layerName = 'Layer 1',
  durationMs: number = DEFAULT_DURATION_MS,
): Frame {
  return makeFrame(id, [blankLayer(layerId, layerName, w, h)], durationMs);
}

// ─── frame-list ops (immutable) ──────────────────────────────────────────────

/** Whether the list may lose a frame — the last remaining frame is protected. */
export function canDeleteFrame(frames: readonly Frame[]): boolean {
  return frames.length > 1;
}

/** Insert `frame` at position `index` (clamped to `[0, length]`). */
export function insertFrame(frames: readonly Frame[], index: number, frame: Frame): Frame[] {
  const i = clampIndex(index, 0, frames.length);
  return [...frames.slice(0, i), frame, ...frames.slice(i)];
}

/** Append `frame` to the end of the list. */
export function appendFrame(frames: readonly Frame[], frame: Frame): Frame[] {
  return [...frames, frame];
}

/**
 * Duplicate the frame at `index`, DEEP-copying every layer's pixel buffer, and
 * insert the copy directly AFTER the source. The copy carries `newId` as its FRAME
 * id but KEEPS each layer's aligned id/name/metadata (layers stay consistent across
 * frames) — only the buffers are cloned, so editing the copy can never change the
 * source (master-spec §3.5, held-out criterion 2). Out-of-range is a no-op copy.
 */
export function duplicateFrame(frames: readonly Frame[], index: number, newId: string): Frame[] {
  if (!inRange(frames, index)) {
    return frames.slice();
  }
  const src = frames[index];
  const layers = src.layers.map((layer) => ({ ...layer, buffer: cloneBuffer(layer.buffer) }));
  const copy: Frame = { id: newId, durationMs: src.durationMs, layers };
  return insertFrame(frames, index + 1, copy);
}

/**
 * Delete the frame at `index`. Refuses to delete the last remaining frame and any
 * out-of-range index (returns a fresh copy unchanged), so the animation always
 * keeps ≥ 1 frame (master-spec §3.5).
 */
export function deleteFrame(frames: readonly Frame[], index: number): Frame[] {
  if (!canDeleteFrame(frames) || !inRange(frames, index)) {
    return frames.slice();
  }
  return [...frames.slice(0, index), ...frames.slice(index + 1)];
}

/**
 * Reorder: pull the frame at `from` and reinsert it at `to`. Indices are clamped
 * defensively; a 0/1-length list or a no-op move returns a fresh copy unchanged.
 */
export function moveFrame(frames: readonly Frame[], from: number, to: number): Frame[] {
  if (frames.length < 2) {
    return frames.slice();
  }
  const last = frames.length - 1;
  const f = clampIndex(from, 0, last);
  const t = clampIndex(to, 0, last);
  if (f === t) {
    return frames.slice();
  }
  const next = frames.slice();
  const [item] = next.splice(f, 1);
  next.splice(t, 0, item);
  return next;
}

/** Set the on-screen duration (ms, clamped) of the frame at `index`. */
export function setFrameDuration(
  frames: readonly Frame[],
  index: number,
  durationMs: number,
): Frame[] {
  if (!inRange(frames, index)) {
    return frames.slice();
  }
  const ms = clampDuration(durationMs);
  return frames.map((frame, i) => (i === index ? { ...frame, durationMs: ms } : frame));
}

// ─── cross-frame layer alignment (§3.5) ──────────────────────────────────────

/** The `w × h` of a frame's layers (from its first layer), or `null` if empty. */
function frameLayerSize(frame: Frame): { w: number; h: number } | null {
  const first = frame.layers[0];
  return first ? { w: first.buffer.w, h: first.buffer.h } : null;
}

/** Derive the shared canvas size from the first frame that has a layer. */
function canvasSizeOf(frames: readonly Frame[]): { w: number; h: number } | null {
  for (const frame of frames) {
    const size = frameLayerSize(frame);
    if (size) {
      return size;
    }
  }
  return null;
}

/**
 * Insert an aligned blank layer at stack position `layerIndex` in EVERY frame. Each
 * frame receives its OWN fresh transparent buffer (a distinct instance) but the SAME
 * layer id/name/metadata, so the layer set stays aligned across frames and painting
 * one frame's copy never touches another's (master-spec §3.5, held-out criterion 1).
 * Size is taken from the existing layers; `fallback` covers a wholly-empty stack.
 */
export function addLayerToAllFrames(
  frames: readonly Frame[],
  layerIndex: number,
  id: string,
  name: string,
  fallback?: { w: number; h: number },
): Frame[] {
  const size = canvasSizeOf(frames) ?? fallback ?? { w: 1, h: 1 };
  return frames.map((frame) => {
    const s = frameLayerSize(frame) ?? size;
    // A fresh blankLayer per frame → distinct buffer instances, shared id.
    const layer = blankLayer(id, name, s.w, s.h);
    return { ...frame, layers: insertLayer(frame.layers, layerIndex, layer) };
  });
}

/**
 * Remove the aligned layer at `layerIndex` from EVERY frame. Refuses to drop the
 * last remaining layer (each frame keeps ≥ 1 layer) — returns a fresh copy unchanged.
 */
export function removeLayerFromAllFrames(frames: readonly Frame[], layerIndex: number): Frame[] {
  const count = frames[0]?.layers.length ?? 0;
  // Guard the ≥1-layer invariant defensively for EVERY frame (not just the first),
  // so even a mis-aligned stack can never lose a frame's last layer.
  const anyTooSmall = frames.some((frame) => frame.layers.length <= 1);
  if (count <= 1 || anyTooSmall || layerIndex < 0 || layerIndex >= count) {
    return frames.slice();
  }
  return frames.map((frame) => ({
    ...frame,
    layers: frame.layers.filter((_, i) => i !== layerIndex),
  }));
}

/** Reorder the aligned layer from `from`→`to` in EVERY frame (keeps alignment). */
export function moveLayerInAllFrames(frames: readonly Frame[], from: number, to: number): Frame[] {
  return frames.map((frame) => ({ ...frame, layers: coreMoveLayer(frame.layers, from, to) }));
}

/**
 * Duplicate the aligned layer at `layerIndex` in EVERY frame (each frame's copy
 * deep-copies THAT frame's buffer), carrying `newId` for the new aligned layer.
 */
export function duplicateLayerInAllFrames(
  frames: readonly Frame[],
  layerIndex: number,
  newId: string,
): Frame[] {
  return frames.map((frame) => ({
    ...frame,
    layers: coreDuplicateLayer(frame.layers, layerIndex, newId),
  }));
}

/** Metadata patch (name/visible/locked/opacity/blend) applied to the aligned layer
 * in EVERY frame, so the shared layer identity stays consistent (§3.5). */
export function updateLayerInAllFrames(
  frames: readonly Frame[],
  layerIndex: number,
  patch: Partial<Omit<Layer, 'id' | 'buffer'>>,
): Frame[] {
  return frames.map((frame) => ({
    ...frame,
    layers: frame.layers.map((layer, i) => (i === layerIndex ? { ...layer, ...patch } : layer)),
  }));
}

/**
 * Whether the layer set is aligned across all frames: same layer count and the same
 * layer ids in the same order in every frame. (Buffers legitimately differ per
 * frame.) Handy as an invariant check in tests and after structural edits.
 */
export function framesAligned(frames: readonly Frame[]): boolean {
  if (frames.length <= 1) {
    return true;
  }
  const [first, ...rest] = frames;
  const ids = first.layers.map((l) => l.id);
  return rest.every(
    (frame) => frame.layers.length === ids.length && frame.layers.every((l, i) => l.id === ids[i]),
  );
}

// ─── playback timing (§3.5, held-out criterion 3) ────────────────────────────

/** Composite a single frame's layer stack into a fresh buffer (z-order, alpha). */
export function compositeFrame(frame: Frame): PixelBuffer {
  return frame.layers.length > 0 ? composite(frame.layers.slice()) : createBuffer(0, 0);
}

/**
 * A frame's effective on-screen time (ms): its own `durationMs` when positive, else
 * the duration implied by the global `fps`. So playback timing derives from BOTH the
 * per-frame durations and the global FPS fallback (held-out criterion 3).
 */
export function effectiveDurationMs(frame: Frame, fps: number = DEFAULT_FPS): number {
  return frame.durationMs > 0 ? frame.durationMs : fpsToDurationMs(fps);
}

/** One cumulative timeline step: which frame, when it starts, how long it shows. */
export interface TimelineStep {
  readonly frameIndex: number;
  readonly startMs: number;
  readonly durationMs: number;
}

/** The full forward-pass timeline plus its total run length. */
export interface Timeline {
  readonly steps: TimelineStep[];
  readonly totalMs: number;
}

/**
 * Build the cumulative playback timeline for ONE forward pass (frame 0..n-1): each
 * step's `startMs` is the sum of preceding effective durations; `totalMs` is the
 * whole pass. This is the playback ORDER + TIMING derived from per-frame durations
 * and the global FPS (held-out criterion 3).
 */
export function buildTimeline(frames: readonly Frame[], fps: number = DEFAULT_FPS): Timeline {
  let startMs = 0;
  const steps: TimelineStep[] = frames.map((frame, frameIndex) => {
    const durationMs = effectiveDurationMs(frame, fps);
    const step: TimelineStep = { frameIndex, startMs, durationMs };
    startMs += durationMs;
    return step;
  });
  return { steps, totalMs: startMs };
}

/** Total run length of one forward pass (ms). */
export function totalDurationMs(frames: readonly Frame[], fps: number = DEFAULT_FPS): number {
  return frames.reduce((sum, frame) => sum + effectiveDurationMs(frame, fps), 0);
}

/**
 * Total run length of ONE full playback cycle in ms — the forward pass, plus the
 * ping-pong return leg when enabled. Lets a non-looping player know when it has
 * reached the end (held-out criterion 3 timing).
 */
export function cycleDurationMs(
  frames: readonly Frame[],
  opts: { fps?: number; pingPong?: boolean } = {},
): number {
  const order = playbackOrder(frames.length, opts.pingPong ?? false);
  const fps = opts.fps ?? DEFAULT_FPS;
  return order.reduce((sum, idx) => sum + effectiveDurationMs(frames[idx], fps), 0);
}

/**
 * The frame-index visiting order for ONE playback cycle. Forward playback visits
 * `[0..n-1]`; ping-pong bounces back WITHOUT repeating the endpoints, e.g. n=4 →
 * `[0,1,2,3,2,1]` (period `2n-2`). n≤1 yields `[0]`/`[]`.
 */
export function playbackOrder(count: number, pingPong = false): number[] {
  const n = Math.max(0, Math.trunc(count));
  if (n <= 1) {
    return n === 1 ? [0] : [];
  }
  const forward = Array.from({ length: n }, (_, i) => i);
  if (!pingPong) {
    return forward;
  }
  const back: number[] = [];
  for (let i = n - 2; i >= 1; i--) {
    back.push(i);
  }
  return [...forward, ...back];
}

/** Options for {@link frameIndexAtTime}. */
export interface PlaybackOptions {
  readonly fps?: number;
  /** Wrap time past the end back to the start (default true). */
  readonly loop?: boolean;
  /** Bounce back at the ends instead of jumping to the start (default false). */
  readonly pingPong?: boolean;
}

/**
 * Which frame INDEX is visible at elapsed time `tMs`, honoring per-frame durations,
 * optional ping-pong ordering, and looping. Negative time clamps to 0. When not
 * looping, times at/after the cycle end clamp to the last step. Returns 0 for an
 * empty or single-frame list. Deterministic — the rAF clock lives in the UI.
 */
export function frameIndexAtTime(
  frames: readonly Frame[],
  tMs: number,
  opts: PlaybackOptions = {},
): number {
  const n = frames.length;
  if (n <= 1) {
    return 0;
  }
  const fps = opts.fps ?? DEFAULT_FPS;
  const order = playbackOrder(n, opts.pingPong ?? false);
  const durations = order.map((idx) => effectiveDurationMs(frames[idx], fps));
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return order[0];
  }
  let t = Number.isFinite(tMs) ? Math.max(0, tMs) : 0;
  const loop = opts.loop ?? true;
  if (loop) {
    t %= total;
  } else if (t >= total) {
    return order[order.length - 1];
  }
  let acc = 0;
  for (let i = 0; i < order.length; i++) {
    acc += durations[i];
    if (t < acc) {
      return order[i];
    }
  }
  return order[order.length - 1];
}

// ─── onion skin (§3.5, held-out criterion 4) ─────────────────────────────────

/** How many previous / next frames to ghost. */
export interface OnionRange {
  readonly before: number;
  readonly after: number;
}

/** Default onion range: one frame each side. */
export const DEFAULT_ONION_RANGE: OnionRange = { before: 1, after: 1 };
/** Upper bound on ghost count per side (keeps compositing within frame budget). */
export const MAX_ONION_RANGE = 8;

function clampRangeCount(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(MAX_ONION_RANGE, Math.max(0, Math.trunc(n)));
}

/** The previous / next frames selected for onion-skinning (excludes current). */
export interface OnionSelection {
  readonly prev: Frame[];
  readonly next: Frame[];
}

/**
 * Select ONLY the `before` previous and `after` next frames around `currentIndex`,
 * NEVER the current frame, clamped at the ends (no wraparound, no out-of-range).
 * `prev`/`next` are returned in ascending index order (held-out criterion 4).
 */
export function selectOnionFrames(
  frames: readonly Frame[],
  currentIndex: number,
  range: OnionRange = DEFAULT_ONION_RANGE,
): OnionSelection {
  const prev: Frame[] = [];
  const next: Frame[] = [];
  const n = frames.length;
  const cur = Math.trunc(currentIndex);
  if (n === 0 || cur < 0 || cur >= n) {
    return { prev, next };
  }
  const before = clampRangeCount(range.before);
  const after = clampRangeCount(range.after);
  for (let i = Math.max(0, cur - before); i < cur; i++) {
    prev.push(frames[i]);
  }
  const endNext = Math.min(n - 1, cur + after);
  for (let i = cur + 1; i <= endNext; i++) {
    next.push(frames[i]);
  }
  return { prev, next };
}

/** The previous / next frame INDICES for onion-skinning (excludes current). */
export interface OnionIndices {
  readonly prev: number[];
  readonly next: number[];
}

/**
 * The index form of {@link selectOnionFrames}: the previous/next frame indices only
 * (never `currentIndex`), clamped at the ends. `count` is the frame count.
 */
export function onionSkinIndices(
  count: number,
  currentIndex: number,
  range: OnionRange = DEFAULT_ONION_RANGE,
): OnionIndices {
  const prev: number[] = [];
  const next: number[] = [];
  const n = Math.max(0, Math.trunc(count));
  const cur = Math.trunc(currentIndex);
  if (n === 0 || cur < 0 || cur >= n) {
    return { prev, next };
  }
  const before = clampRangeCount(range.before);
  const after = clampRangeCount(range.after);
  for (let i = Math.max(0, cur - before); i < cur; i++) {
    prev.push(i);
  }
  const endNext = Math.min(n - 1, cur + after);
  for (let i = cur + 1; i <= endNext; i++) {
    next.push(i);
  }
  return { prev, next };
}

/** Warm = previous ghost (§3.5 "red-tinted"); cool = next ghost ("blue-tinted"). */
export type OnionTint = 'warm' | 'cool';

/** A renderable onion ghost: which frame, its signed offset, tint and falloff alpha. */
export interface OnionGhost {
  readonly frame: Frame;
  readonly index: number;
  /** Signed distance from the current frame (negative = previous, positive = next). */
  readonly offset: number;
  readonly tint: OnionTint;
  /** Suggested render opacity (0..1), strongest nearest the current frame. */
  readonly opacity: number;
}

/**
 * Ghost descriptors for the overlay renderer: each previous frame tinted `warm`,
 * each next `cool`, with opacity falling off linearly with distance (nearest =
 * `maxOpacity`, farthest = `maxOpacity/steps`). Never includes the current frame.
 * Ordered farthest→nearest within each side so nearer ghosts paint on top.
 */
export function onionGhosts(
  frames: readonly Frame[],
  currentIndex: number,
  range: OnionRange = DEFAULT_ONION_RANGE,
  maxOpacity = 0.5,
): OnionGhost[] {
  const { prev, next } = onionSkinIndices(frames.length, currentIndex, range);
  const alpha = Math.min(1, Math.max(0, maxOpacity));
  const ghosts: OnionGhost[] = [];
  const before = Math.max(1, prev.length);
  const after = Math.max(1, next.length);
  // Previous: farthest first (ascending index is already farthest→nearest).
  for (const index of prev) {
    const offset = index - currentIndex; // negative
    const step = -offset; // 1 = nearest
    ghosts.push({
      frame: frames[index],
      index,
      offset,
      tint: 'warm',
      opacity: alpha * ((before - step + 1) / before),
    });
  }
  // Next: nearest first, then farther; sort so farther paints first (lower alpha).
  const nextGhosts: OnionGhost[] = next.map((index) => {
    const offset = index - currentIndex; // positive
    const step = offset; // 1 = nearest
    return {
      frame: frames[index],
      index,
      offset,
      tint: 'cool' as const,
      opacity: alpha * ((after - step + 1) / after),
    };
  });
  // Emit next ghosts farthest→nearest as well (descending index).
  nextGhosts.sort((a, b) => b.index - a.index);
  return [...ghosts, ...nextGhosts];
}
