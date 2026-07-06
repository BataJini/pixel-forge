// Held-out acceptance — U-011 project serialize/deserialize. Builder must NOT edit.
// Targets master-spec §4.3 + §5 project.ts. Runner: Vitest.
import { describe, expect, it } from 'vitest';
import { createBuffer, setPixel } from '../../../src/core/buffer';
import { deserialize, serialize } from '../../../src/core/project';
import type { Frame, Layer, Project, RGBA } from '../../../src/core/types';

const C: RGBA = [255, 106, 26, 255];

const mkLayer = (id: string, w: number, h: number, paint = false): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  opacity: 100,
  blend: 'normal',
  buffer: paint ? setPixel(createBuffer(w, h), 1, 1, C) : createBuffer(w, h),
});

const mkProject = (): Project => {
  const w = 8,
    h = 8;
  const frames: Frame[] = [
    { id: 'f1', durationMs: 100, layers: [mkLayer('l1', w, h, true), mkLayer('l2', w, h)] },
    { id: 'f2', durationMs: 200, layers: [mkLayer('l1', w, h), mkLayer('l2', w, h, true)] },
  ];
  return {
    schema: 1,
    id: 'p1',
    name: 'Test',
    w,
    h,
    frames,
    palette: null,
    indexed: false,
    fps: 12,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  };
};

describe('project round-trip', () => {
  it('serialize -> deserialize is lossless for a multi-layer, multi-frame project', () => {
    const p = mkProject();
    const r = deserialize(serialize(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = r.value;
    expect(q.w).toBe(p.w);
    expect(q.h).toBe(p.h);
    expect(q.frames.length).toBe(2);
    expect(q.frames[0].durationMs).toBe(100);
    expect(q.frames[1].durationMs).toBe(200);
    // pixel data preserved exactly
    expect(Array.from(q.frames[0].layers[0].buffer.data)).toEqual(
      Array.from(p.frames[0].layers[0].buffer.data),
    );
    expect(Array.from(q.frames[1].layers[1].buffer.data)).toEqual(
      Array.from(p.frames[1].layers[1].buffer.data),
    );
  });

  it('does not encode pixels as a raw JSON number array (uses base64/dataURL)', () => {
    const s = serialize(mkProject());
    // a raw number-array of RGBA would contain long ",0,0,0,0,0" runs; assert compactness
    expect(s).not.toMatch(/(,0){40,}/);
  });

  it('rejects malformed / wrong-schema input with an error result (no throw)', () => {
    expect(deserialize('{"nope":true}').ok).toBe(false);
    expect(deserialize('not json').ok).toBe(false);
    expect(deserialize(JSON.stringify({ schema: 999 })).ok).toBe(false);
  });

  it('rejects a project exceeding the 512x512 canvas cap', () => {
    const p = mkProject();
    const oversize = { ...p, w: 513, h: 512 };
    // serialize is best-effort; deserialize must enforce the cap and fail cleanly
    const r = deserialize(serialize(oversize as typeof p));
    expect(r.ok).toBe(false);
  });
});
