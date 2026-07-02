/**
 * Unit tests for the pure frame algebra (src/core/frames.ts).
 *
 * Encodes the four machine-checkable U-008 acceptance criteria against the pure
 * engine (docs/acceptance/U-008/criteria.md) plus the correctness edge cases:
 *   1. adding a layer adds an aligned layer to EVERY frame (distinct buffers);
 *   2. frame add/duplicate(deep-copy)/delete(last-frame guard)/reorder;
 *   3. playback order + timing from per-frame durationMs / global fps;
 *   4. onion-skin selection returns only N prev/next, never current, clamped.
 */
import { describe, expect, it } from 'vitest';
import { getPixel, setPixelMut } from './buffer';
import {
  addLayerToAllFrames,
  appendFrame,
  blankFrame,
  buildTimeline,
  canDeleteFrame,
  clampDuration,
  clampFps,
  compositeFrame,
  cycleDurationMs,
  DEFAULT_FPS,
  deleteFrame,
  duplicateFrame,
  duplicateLayerInAllFrames,
  effectiveDurationMs,
  fpsToDurationMs,
  frameIndexAtTime,
  framesAligned,
  insertFrame,
  MAX_ONION_RANGE,
  makeFrame,
  moveFrame,
  moveLayerInAllFrames,
  onionGhosts,
  onionSkinIndices,
  playbackOrder,
  removeLayerFromAllFrames,
  selectOnionFrames,
  setFrameDuration,
  totalDurationMs,
  updateLayerInAllFrames,
} from './frames';
import { blankLayer } from './layers';
import type { Frame, RGBA } from './types';

const RED: RGBA = [255, 0, 0, 255];
const W = 4;
const H = 4;

/** A frame with `n` blank aligned layers (ids layer-1..layer-n), duration `ms`. */
function frame(id: string, layerIds: string[], ms = 100): Frame {
  return makeFrame(
    id,
    layerIds.map((lid) => blankLayer(lid, lid, W, H)),
    ms,
  );
}

function singleLayerFrames(ids: string[]): Frame[] {
  return ids.map((id) => frame(id, ['layer-1']));
}

describe('frames — fps / duration bounds', () => {
  it('clampFps rounds and clamps into [1, 60]', () => {
    expect(clampFps(12)).toBe(12);
    expect(clampFps(0)).toBe(1);
    expect(clampFps(999)).toBe(60);
    expect(clampFps(11.6)).toBe(12);
    expect(clampFps(Number.NaN)).toBe(DEFAULT_FPS);
  });

  it('clampDuration clamps into [10, 60000] ms', () => {
    expect(clampDuration(100)).toBe(100);
    expect(clampDuration(1)).toBe(10);
    expect(clampDuration(1e9)).toBe(60_000);
    expect(clampDuration(Number.NaN)).toBe(100);
  });

  it('fpsToDurationMs inverts fps to ms-per-frame', () => {
    expect(fpsToDurationMs(10)).toBe(100);
    expect(fpsToDurationMs(20)).toBe(50);
    expect(fpsToDurationMs(12)).toBe(83);
  });

  it('makeFrame clamps its duration and copies the layer array', () => {
    const layers = [blankLayer('layer-1', 'L1', W, H)];
    const f = makeFrame('f1', layers, 5);
    expect(f.durationMs).toBe(10); // clamped up to MIN
    expect(f.layers).not.toBe(layers); // fresh array
  });
});

// ── Criterion 1 ───────────────────────────────────────────────────────────────
describe('frames — criterion 1: adding a layer adds to EVERY frame, aligned', () => {
  it('inserts an aligned layer (same id, distinct buffer) into every frame', () => {
    const frames = singleLayerFrames(['f1', 'f2', 'f3']);
    const next = addLayerToAllFrames(frames, 1, 'layer-2', 'Ink');

    // Every frame gained the layer at index 1 with the SAME id/name.
    expect(next.every((f) => f.layers.length === 2)).toBe(true);
    expect(next.every((f) => f.layers[1].id === 'layer-2')).toBe(true);
    expect(next.every((f) => f.layers[1].name === 'Ink')).toBe(true);
    expect(framesAligned(next)).toBe(true);

    // The per-frame buffers are DISTINCT instances (painting one never leaks).
    const bufs = next.map((f) => f.layers[1].buffer);
    expect(new Set(bufs).size).toBe(3);
    setPixelMut(bufs[0], 2, 2, RED);
    expect(getPixel(bufs[0], 2, 2)).toEqual(RED);
    expect(getPixel(bufs[1], 2, 2)).toEqual([0, 0, 0, 0]); // sibling untouched
    expect(getPixel(bufs[2], 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('does not mutate the input frames', () => {
    const frames = singleLayerFrames(['f1', 'f2']);
    const snapshotLen = frames.map((f) => f.layers.length);
    addLayerToAllFrames(frames, 1, 'layer-2', 'Ink');
    expect(frames.map((f) => f.layers.length)).toEqual(snapshotLen);
  });

  it('remove/move/duplicate/update keep the layer set aligned across frames', () => {
    let frames = singleLayerFrames(['f1', 'f2']);
    frames = addLayerToAllFrames(frames, 1, 'layer-2', 'Ink');
    frames = addLayerToAllFrames(frames, 2, 'layer-3', 'Top');
    expect(framesAligned(frames)).toBe(true);

    const moved = moveLayerInAllFrames(frames, 0, 2);
    expect(moved.every((f) => f.layers.map((l) => l.id).join() === 'layer-2,layer-3,layer-1')).toBe(
      true,
    );
    expect(framesAligned(moved)).toBe(true);

    const dup = duplicateLayerInAllFrames(frames, 1, 'layer-4');
    expect(dup.every((f) => f.layers.length === 4)).toBe(true);
    expect(framesAligned(dup)).toBe(true);

    const updated = updateLayerInAllFrames(frames, 0, { visible: false, opacity: 40 });
    expect(updated.every((f) => f.layers[0].visible === false && f.layers[0].opacity === 40)).toBe(
      true,
    );

    const removed = removeLayerFromAllFrames(frames, 2);
    expect(removed.every((f) => f.layers.length === 2)).toBe(true);
    expect(framesAligned(removed)).toBe(true);
  });

  it('removeLayerFromAllFrames refuses to drop the last layer', () => {
    const frames = singleLayerFrames(['f1', 'f2']);
    const next = removeLayerFromAllFrames(frames, 0);
    expect(next.every((f) => f.layers.length === 1)).toBe(true);
  });

  it('removeLayerFromAllFrames never drops a frame below one layer, even mis-aligned', () => {
    // A deliberately mis-aligned stack (f2 has only one layer) must be left intact.
    const frames: Frame[] = [frame('f1', ['layer-1', 'layer-2']), frame('f2', ['layer-1'])];
    const next = removeLayerFromAllFrames(frames, 0);
    expect(next.every((f) => f.layers.length >= 1)).toBe(true);
    expect(next[1].layers.length).toBe(1);
  });
});

// ── Criterion 2 ───────────────────────────────────────────────────────────────
describe('frames — criterion 2: frame add / duplicate / delete / reorder', () => {
  it('insertFrame / appendFrame place frames without mutating input', () => {
    const frames = singleLayerFrames(['f1', 'f2']);
    const inserted = insertFrame(frames, 1, frame('fx', ['layer-1']));
    expect(inserted.map((f) => f.id)).toEqual(['f1', 'fx', 'f2']);
    const appended = appendFrame(frames, frame('fz', ['layer-1']));
    expect(appended.map((f) => f.id)).toEqual(['f1', 'f2', 'fz']);
    expect(frames.map((f) => f.id)).toEqual(['f1', 'f2']); // untouched
  });

  it('duplicateFrame deep-copies buffers so editing the copy never changes the source', () => {
    const frames = [frame('f1', ['layer-1'])];
    // Paint the source frame's only layer.
    setPixelMut(frames[0].layers[0].buffer, 1, 1, RED);

    const dup = duplicateFrame(frames, 0, 'f1-copy');
    expect(dup.map((f) => f.id)).toEqual(['f1', 'f1-copy']);
    const source = dup[0];
    const copy = dup[1];

    // Copy starts identical...
    expect(getPixel(copy.layers[0].buffer, 1, 1)).toEqual(RED);
    // ...but its buffer is an independent instance keeping the aligned layer id.
    expect(copy.layers[0].buffer).not.toBe(source.layers[0].buffer);
    expect(copy.layers[0].id).toBe(source.layers[0].id);

    // Editing the copy leaves the source pixel unchanged (deep copy).
    setPixelMut(copy.layers[0].buffer, 3, 3, RED);
    expect(getPixel(copy.layers[0].buffer, 3, 3)).toEqual(RED);
    expect(getPixel(source.layers[0].buffer, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it('duplicateFrame inserts directly after the source and stays aligned', () => {
    let frames = singleLayerFrames(['f1', 'f2']);
    frames = addLayerToAllFrames(frames, 1, 'layer-2', 'Ink');
    const dup = duplicateFrame(frames, 0, 'f1-copy');
    expect(dup.map((f) => f.id)).toEqual(['f1', 'f1-copy', 'f2']);
    expect(framesAligned(dup)).toBe(true);
  });

  it('deleteFrame removes a frame but guards the last remaining one', () => {
    const frames = singleLayerFrames(['f1', 'f2', 'f3']);
    expect(canDeleteFrame(frames)).toBe(true);
    const two = deleteFrame(frames, 1);
    expect(two.map((f) => f.id)).toEqual(['f1', 'f3']);

    const one = deleteFrame(singleLayerFrames(['only']), 0);
    expect(one.map((f) => f.id)).toEqual(['only']); // last-frame guard
    expect(canDeleteFrame(one)).toBe(false);
  });

  it('moveFrame reorders and clamps; out-of-range/no-op returns a fresh copy', () => {
    const frames = singleLayerFrames(['f1', 'f2', 'f3']);
    expect(moveFrame(frames, 0, 2).map((f) => f.id)).toEqual(['f2', 'f3', 'f1']);
    expect(moveFrame(frames, 2, 0).map((f) => f.id)).toEqual(['f3', 'f1', 'f2']);
    const noop = moveFrame(frames, 1, 1);
    expect(noop.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(noop).not.toBe(frames);
  });

  it('setFrameDuration updates one frame (clamped) immutably', () => {
    const frames = singleLayerFrames(['f1', 'f2']);
    const next = setFrameDuration(frames, 1, 250);
    expect(next[1].durationMs).toBe(250);
    expect(next[0].durationMs).toBe(100);
    expect(frames[1].durationMs).toBe(100); // input untouched
    expect(setFrameDuration(frames, 1, 2).map((f) => f.durationMs)).toEqual([100, 10]); // clamped
  });
});

// ── Criterion 3 ───────────────────────────────────────────────────────────────
describe('frames — criterion 3: playback order + timing from durationMs / fps', () => {
  it('effectiveDurationMs prefers the frame duration, else derives from fps', () => {
    expect(effectiveDurationMs(frame('a', ['layer-1'], 200), 10)).toBe(200);
    // A zero-duration frame falls back to the global fps (1000/10 = 100).
    const zero: Frame = { id: 'z', durationMs: 0, layers: [blankLayer('layer-1', 'L', W, H)] };
    expect(effectiveDurationMs(zero, 10)).toBe(100);
  });

  it('buildTimeline gives cumulative start offsets and a correct total', () => {
    const frames = [
      frame('f1', ['layer-1'], 100),
      frame('f2', ['layer-1'], 200),
      frame('f3', ['layer-1'], 300),
    ];
    const { steps, totalMs } = buildTimeline(frames, DEFAULT_FPS);
    expect(steps.map((s) => s.startMs)).toEqual([0, 100, 300]);
    expect(steps.map((s) => s.durationMs)).toEqual([100, 200, 300]);
    expect(steps.map((s) => s.frameIndex)).toEqual([0, 1, 2]);
    expect(totalMs).toBe(600);
    expect(totalDurationMs(frames, DEFAULT_FPS)).toBe(600);
  });

  it('playbackOrder is forward, and ping-pong bounces without repeating endpoints', () => {
    expect(playbackOrder(4)).toEqual([0, 1, 2, 3]);
    expect(playbackOrder(4, true)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackOrder(1, true)).toEqual([0]);
    expect(playbackOrder(0)).toEqual([]);
    expect(playbackOrder(2, true)).toEqual([0, 1]); // 2 frames: bounce == loop
  });

  it('frameIndexAtTime maps elapsed time to the active frame (looping)', () => {
    const frames = [
      frame('f1', ['layer-1'], 100),
      frame('f2', ['layer-1'], 200),
      frame('f3', ['layer-1'], 300),
    ];
    expect(frameIndexAtTime(frames, 0)).toBe(0);
    expect(frameIndexAtTime(frames, 99)).toBe(0);
    expect(frameIndexAtTime(frames, 100)).toBe(1); // boundary → next frame
    expect(frameIndexAtTime(frames, 299)).toBe(1);
    expect(frameIndexAtTime(frames, 300)).toBe(2);
    expect(frameIndexAtTime(frames, 599)).toBe(2);
    expect(frameIndexAtTime(frames, 600)).toBe(0); // wrap (total = 600)
    expect(frameIndexAtTime(frames, 650)).toBe(0);
    expect(frameIndexAtTime(frames, -50)).toBe(0); // negative clamps to start
  });

  it('frameIndexAtTime clamps to the last frame when not looping', () => {
    const frames = [frame('f1', ['layer-1'], 100), frame('f2', ['layer-1'], 100)];
    expect(frameIndexAtTime(frames, 1000, { loop: false })).toBe(1);
    expect(frameIndexAtTime(frames, 50, { loop: false })).toBe(0);
  });

  it('frameIndexAtTime follows the ping-pong order', () => {
    const frames = [
      frame('f1', ['layer-1'], 100),
      frame('f2', ['layer-1'], 100),
      frame('f3', ['layer-1'], 100),
    ];
    // order = [0,1,2,1], each 100ms, period 400ms.
    expect(frameIndexAtTime(frames, 0, { pingPong: true })).toBe(0);
    expect(frameIndexAtTime(frames, 150, { pingPong: true })).toBe(1);
    expect(frameIndexAtTime(frames, 250, { pingPong: true })).toBe(2);
    expect(frameIndexAtTime(frames, 350, { pingPong: true })).toBe(1); // bounce back
    expect(frameIndexAtTime(frames, 400, { pingPong: true })).toBe(0); // wrap
  });

  it('cycleDurationMs sums the forward pass, plus the return leg for ping-pong', () => {
    const frames = [
      frame('f1', ['layer-1'], 100),
      frame('f2', ['layer-1'], 100),
      frame('f3', ['layer-1'], 100),
    ];
    expect(cycleDurationMs(frames)).toBe(300); // forward
    expect(cycleDurationMs(frames, { pingPong: true })).toBe(400); // + return frame f2
  });

  it('single/empty frame lists are stable', () => {
    expect(frameIndexAtTime([frame('only', ['layer-1'])], 999)).toBe(0);
    expect(frameIndexAtTime([], 10)).toBe(0);
  });

  it('uses the fps fallback when frames have no explicit duration', () => {
    const frames: Frame[] = [
      { id: 'a', durationMs: 0, layers: [blankLayer('layer-1', 'L', W, H)] },
      { id: 'b', durationMs: 0, layers: [blankLayer('layer-1', 'L', W, H)] },
    ];
    // fps 10 → 100ms each.
    expect(buildTimeline(frames, 10).totalMs).toBe(200);
    expect(frameIndexAtTime(frames, 100, { fps: 10 })).toBe(1);
  });
});

// ── Criterion 4 ───────────────────────────────────────────────────────────────
describe('frames — criterion 4: onion-skin selection', () => {
  const five = singleLayerFrames(['f0', 'f1', 'f2', 'f3', 'f4']);

  it('returns only the N previous and N next frames, never the current', () => {
    const { prev, next } = selectOnionFrames(five, 2, { before: 1, after: 1 });
    expect(prev.map((f) => f.id)).toEqual(['f1']);
    expect(next.map((f) => f.id)).toEqual(['f3']);
    expect([...prev, ...next].some((f) => f.id === 'f2')).toBe(false); // never current
  });

  it('respects an asymmetric range', () => {
    const { prev, next } = selectOnionFrames(five, 2, { before: 2, after: 1 });
    expect(prev.map((f) => f.id)).toEqual(['f0', 'f1']);
    expect(next.map((f) => f.id)).toEqual(['f3']);
  });

  it('clamps at the start (no wraparound, no negative indices)', () => {
    const { prev, next } = selectOnionFrames(five, 0, { before: 2, after: 2 });
    expect(prev).toEqual([]); // nothing before frame 0
    expect(next.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('clamps at the end (no wraparound past the last frame)', () => {
    const { prev, next } = selectOnionFrames(five, 4, { before: 2, after: 2 });
    expect(prev.map((f) => f.id)).toEqual(['f2', 'f3']);
    expect(next).toEqual([]); // nothing after the last frame
  });

  it('a zero range selects nothing; out-of-range current is empty', () => {
    expect(selectOnionFrames(five, 2, { before: 0, after: 0 })).toEqual({ prev: [], next: [] });
    expect(selectOnionFrames(five, -1)).toEqual({ prev: [], next: [] });
    expect(selectOnionFrames(five, 99)).toEqual({ prev: [], next: [] });
    expect(selectOnionFrames([], 0)).toEqual({ prev: [], next: [] });
  });

  it('caps an absurd range at MAX_ONION_RANGE', () => {
    const { prev, next } = selectOnionFrames(five, 2, { before: 999, after: 999 });
    expect(prev.map((f) => f.id)).toEqual(['f0', 'f1']); // clamped by frame bounds
    expect(next.map((f) => f.id)).toEqual(['f3', 'f4']);
    expect(MAX_ONION_RANGE).toBeGreaterThan(0);
  });

  it('onionSkinIndices mirrors selectOnionFrames as indices', () => {
    expect(onionSkinIndices(5, 2, { before: 2, after: 1 })).toEqual({ prev: [0, 1], next: [3] });
    expect(onionSkinIndices(5, 0, { before: 1, after: 1 })).toEqual({ prev: [], next: [1] });
  });

  it('onionGhosts tints previous warm and next cool with falloff, never the current', () => {
    const ghosts = onionGhosts(five, 2, { before: 2, after: 2 }, 0.6);
    expect(ghosts.every((g) => g.index !== 2)).toBe(true);
    const warm = ghosts.filter((g) => g.tint === 'warm');
    const cool = ghosts.filter((g) => g.tint === 'cool');
    expect(warm.map((g) => g.index).sort()).toEqual([0, 1]);
    expect(cool.map((g) => g.index).sort()).toEqual([3, 4]);
    // Nearest ghost (offset ±1) is the strongest; farther is weaker.
    const nearestWarm = warm.find((g) => g.offset === -1);
    const farWarm = warm.find((g) => g.offset === -2);
    expect(nearestWarm?.opacity).toBeGreaterThan(farWarm?.opacity ?? 1);
    expect(nearestWarm?.opacity).toBeCloseTo(0.6, 5);
    // Ghosts are ordered farthest→nearest per side (so nearer paints on top).
    expect(warm.map((g) => g.index)).toEqual([0, 1]);
    expect(cool.map((g) => g.index)).toEqual([4, 3]);
  });
});

describe('frames — compositeFrame', () => {
  it('composites a frame stack into a fresh buffer of the canvas size', () => {
    const f = blankFrame('f1', W, H, 'layer-1');
    setPixelMut(f.layers[0].buffer, 0, 0, RED);
    const out = compositeFrame(f);
    expect(out.w).toBe(W);
    expect(out.h).toBe(H);
    expect(getPixel(out, 0, 0)).toEqual(RED);
  });

  it('an empty-stack frame composites to an empty buffer', () => {
    const empty: Frame = { id: 'e', durationMs: 100, layers: [] };
    expect(compositeFrame(empty).data.length).toBe(0);
  });
});
