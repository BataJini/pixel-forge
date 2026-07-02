import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from './buffer';
import {
  clampDim,
  contentBounds,
  cropBuffer,
  cropProject,
  projectContentBounds,
  resizeBuffer,
  resizeProject,
  trimProject,
} from './canvas';
import { createProject } from './project';
import type { Layer, Project, RGBA } from './types';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];

function layer(id: string, w: number, h: number, paint?: (l: Layer) => Layer): Layer {
  const base: Layer = {
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 100,
    blend: 'normal',
    buffer: createBuffer(w, h),
  };
  return paint ? paint(base) : base;
}

function projectWith(w: number, h: number, layers: Layer[]): Project {
  return createProject({ w, h, id: 'p', createdAt: 't', layers });
}

describe('clampDim', () => {
  it('clamps to the 1..512 integer cap', () => {
    expect(clampDim(0)).toBe(1);
    expect(clampDim(-5)).toBe(1);
    expect(clampDim(513)).toBe(512);
    expect(clampDim(64.9)).toBe(64);
    expect(clampDim(Number.NaN)).toBe(1);
  });
});

describe('resizeBuffer', () => {
  it('grows the canvas keeping content at the top-left by default', () => {
    const src = setPixel(createBuffer(2, 2), 0, 0, RED);
    const out = resizeBuffer(src, 4, 4);
    expect(out.w).toBe(4);
    expect(out.h).toBe(4);
    expect(getPixel(out, 0, 0)).toEqual(RED);
    expect(getPixel(out, 3, 3)).toEqual([0, 0, 0, 0]);
    // Source is untouched (immutability).
    expect(src.w).toBe(2);
  });

  it('centers content when anchored center', () => {
    const src = setPixel(createBuffer(2, 2), 0, 0, RED);
    const out = resizeBuffer(src, 4, 4, 'center');
    // delta = 2 → floor(2/2) = 1 offset.
    expect(getPixel(out, 1, 1)).toEqual(RED);
    expect(getPixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('places content bottom-right when anchored bottom-right', () => {
    const src = setPixel(createBuffer(2, 2), 1, 1, BLUE);
    const out = resizeBuffer(src, 4, 4, 'bottom-right');
    expect(getPixel(out, 3, 3)).toEqual(BLUE);
  });

  it('crops overflow when shrinking', () => {
    let src = createBuffer(4, 4);
    src = setPixel(src, 0, 0, RED);
    src = setPixel(src, 3, 3, BLUE);
    const out = resizeBuffer(src, 2, 2); // top-left keeps (0,0), drops (3,3)
    expect(out.w).toBe(2);
    expect(getPixel(out, 0, 0)).toEqual(RED);
    expect(getPixel(out, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('enforces the 512 cap', () => {
    const out = resizeBuffer(createBuffer(2, 2), 999, 1000);
    expect(out.w).toBe(512);
    expect(out.h).toBe(512);
  });
});

describe('cropBuffer & contentBounds', () => {
  it('crops to a sub-rect', () => {
    let src = createBuffer(4, 4);
    src = setPixel(src, 2, 2, RED);
    const out = cropBuffer(src, { x: 2, y: 2, w: 2, h: 2 });
    expect(out.w).toBe(2);
    expect(getPixel(out, 0, 0)).toEqual(RED);
  });

  it('finds the tight content bounds', () => {
    let src = createBuffer(8, 8);
    src = setPixel(src, 2, 3, RED);
    src = setPixel(src, 5, 6, BLUE);
    expect(contentBounds(src)).toEqual({ x: 2, y: 3, w: 4, h: 4 });
  });

  it('returns null bounds for a fully transparent buffer', () => {
    expect(contentBounds(createBuffer(4, 4))).toBeNull();
  });
});

describe('project-level ops', () => {
  it('resizeProject resizes every layer of every frame', () => {
    const p = projectWith(2, 2, [
      layer('a', 2, 2, (l) => ({ ...l, buffer: setPixel(l.buffer, 0, 0, RED) })),
      layer('b', 2, 2, (l) => ({ ...l, buffer: setPixel(l.buffer, 1, 1, BLUE) })),
    ]);
    const out = resizeProject(p, 4, 4);
    expect(out.w).toBe(4);
    expect(out.frames[0].layers).toHaveLength(2);
    expect(out.frames[0].layers[0].buffer.w).toBe(4);
    expect(getPixel(out.frames[0].layers[0].buffer, 0, 0)).toEqual(RED);
    expect(getPixel(out.frames[0].layers[1].buffer, 1, 1)).toEqual(BLUE);
    // Original untouched.
    expect(p.w).toBe(2);
  });

  it('cropProject crops every layer and updates size', () => {
    const p = projectWith(4, 4, [
      layer('a', 4, 4, (l) => ({ ...l, buffer: setPixel(l.buffer, 3, 3, RED) })),
    ]);
    const out = cropProject(p, { x: 2, y: 2, w: 2, h: 2 });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.w).toBe(2);
    expect(out.h).toBe(2);
    expect(getPixel(out.frames[0].layers[0].buffer, 1, 1)).toEqual(RED);
  });

  it('cropProject clamps an over-hanging rect to the canvas', () => {
    const p = projectWith(4, 4, [layer('a', 4, 4)]);
    const out = cropProject(p, { x: 2, y: 2, w: 10, h: 10 });
    expect(out?.w).toBe(2);
    expect(out?.h).toBe(2);
  });

  it('cropProject returns null when the rect misses the canvas', () => {
    const p = projectWith(4, 4, [layer('a', 4, 4)]);
    expect(cropProject(p, { x: 10, y: 10, w: 2, h: 2 })).toBeNull();
  });

  it('projectContentBounds unions across layers/frames', () => {
    const p = projectWith(8, 8, [
      layer('a', 8, 8, (l) => ({ ...l, buffer: setPixel(l.buffer, 1, 1, RED) })),
      layer('b', 8, 8, (l) => ({ ...l, buffer: setPixel(l.buffer, 6, 5, BLUE) })),
    ]);
    expect(projectContentBounds(p)).toEqual({ x: 1, y: 1, w: 6, h: 5 });
  });

  it('trimProject trims transparent margins and reports the bounds', () => {
    const p = projectWith(8, 8, [
      layer('a', 8, 8, (l) => ({ ...l, buffer: setPixel(l.buffer, 2, 2, RED) })),
    ]);
    const trimmed = trimProject(p);
    expect(trimmed).not.toBeNull();
    if (!trimmed) return;
    expect(trimmed.bounds).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(trimmed.project.w).toBe(1);
    expect(getPixel(trimmed.project.frames[0].layers[0].buffer, 0, 0)).toEqual(RED);
  });

  it('trimProject is a no-op (null) for an already-tight or empty canvas', () => {
    const tight = projectWith(2, 2, [
      layer('a', 2, 2, (l) => {
        let b = setPixel(l.buffer, 0, 0, RED);
        b = setPixel(b, 1, 1, BLUE);
        return { ...l, buffer: b };
      }),
    ]);
    expect(trimProject(tight)).toBeNull();
    const empty = projectWith(4, 4, [layer('a', 4, 4)]);
    expect(trimProject(empty)).toBeNull();
  });
});
