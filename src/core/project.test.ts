import { describe, expect, it } from 'vitest';
import { createBuffer, setPixel } from './buffer';
import {
  createProject,
  deserialize,
  FORGE_EXTENSION,
  PROJECT_SCHEMA,
  projectPixelBytes,
  serialize,
} from './project';
import type { Frame, Layer, Palette, Project, RGBA } from './types';

const EMBER: RGBA = [255, 106, 26, 255];

function layer(id: string, w: number, h: number, paint = false): Layer {
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 100,
    blend: 'normal',
    buffer: paint ? setPixel(createBuffer(w, h), 2, 3, EMBER) : createBuffer(w, h),
  };
}

function sampleProject(): Project {
  const w = 6;
  const h = 5;
  const frames: Frame[] = [
    { id: 'f1', durationMs: 120, layers: [layer('l1', w, h, true), layer('l2', w, h)] },
    { id: 'f2', durationMs: 240, layers: [layer('l1', w, h), layer('l2', w, h, true)] },
  ];
  const palette: Palette = {
    id: 'pal-1',
    name: 'Test Ramp',
    colors: [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 106, 26, 255],
    ],
    source: 'test',
  };
  return {
    schema: 1,
    id: 'proj-1',
    name: 'Sample',
    w,
    h,
    frames,
    palette,
    indexed: true,
    fps: 8,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    thumbnailDataUrl: 'data:image/png;base64,AAAA',
  };
}

describe('project serialize / deserialize', () => {
  it('round-trips a multi-frame, multi-layer project losslessly', () => {
    const p = sampleProject();
    const r = deserialize(serialize(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = r.value;
    expect(q.schema).toBe(PROJECT_SCHEMA);
    expect(q.id).toBe(p.id);
    expect(q.name).toBe(p.name);
    expect(q.w).toBe(p.w);
    expect(q.h).toBe(p.h);
    expect(q.indexed).toBe(true);
    expect(q.fps).toBe(8);
    expect(q.createdAt).toBe(p.createdAt);
    expect(q.updatedAt).toBe(p.updatedAt);
    expect(q.thumbnailDataUrl).toBe(p.thumbnailDataUrl);
    expect(q.frames.map((f) => f.durationMs)).toEqual([120, 240]);
    // Every layer's pixels preserved exactly.
    for (let fi = 0; fi < p.frames.length; fi++) {
      for (let li = 0; li < p.frames[fi].layers.length; li++) {
        expect(Array.from(q.frames[fi].layers[li].buffer.data)).toEqual(
          Array.from(p.frames[fi].layers[li].buffer.data),
        );
      }
    }
    // Palette preserved.
    expect(q.palette?.name).toBe('Test Ramp');
    expect(q.palette?.source).toBe('test');
    expect(q.palette?.colors).toEqual(p.palette?.colors);
  });

  it('preserves layer metadata (visibility, lock, opacity, blend, names)', () => {
    const p = sampleProject();
    p.frames[0].layers[1] = {
      ...p.frames[0].layers[1],
      visible: false,
      locked: true,
      opacity: 42,
      blend: 'multiply',
      name: 'Shadow',
    };
    const r = deserialize(serialize(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.value.frames[0].layers[1];
    expect(l.visible).toBe(false);
    expect(l.locked).toBe(true);
    expect(l.opacity).toBe(42);
    expect(l.blend).toBe('multiply');
    expect(l.name).toBe('Shadow');
  });

  it('handles a null palette', () => {
    const p = { ...sampleProject(), palette: null };
    const r = deserialize(serialize(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.palette).toBeNull();
  });

  it('encodes pixels compactly as base64 (never a raw JSON number array)', () => {
    const big = createProject({
      w: 64,
      h: 64,
      id: 'big',
      createdAt: 'now',
      layers: [layer('l1', 64, 64)],
    });
    const s = serialize(big);
    expect(s).not.toMatch(/(,0){40,}/);
    // A number array writes ≥2 chars per byte ("0,"); base64 writes 4 chars per
    // 3 bytes (~1.33×). Assert we are well under the number-array size.
    const rawBytes = 64 * 64 * 4;
    expect(s.length).toBeLessThan(rawBytes * 2);
    expect(s.length).toBeLessThan(rawBytes * 1.5); // base64 ≈ 1.34× raw + JSON chrome
  });

  it('rejects non-JSON without throwing', () => {
    expect(deserialize('not json at all').ok).toBe(false);
    expect(deserialize('').ok).toBe(false);
    expect(deserialize('[1,2,3]').ok).toBe(false);
    expect(deserialize('42').ok).toBe(false);
  });

  it('rejects a wrong or missing schema', () => {
    expect(deserialize('{"nope":true}').ok).toBe(false);
    expect(deserialize(JSON.stringify({ schema: 999 })).ok).toBe(false);
    expect(deserialize(JSON.stringify({ schema: '1' })).ok).toBe(false);
  });

  it('rejects a project exceeding the 512×512 cap', () => {
    const p = sampleProject();
    for (const dims of [
      { w: 513, h: 512 },
      { w: 512, h: 513 },
      { w: 0, h: 8 },
      { w: 8, h: 0 },
      { w: 8.5, h: 8 },
    ]) {
      const r = deserialize(serialize({ ...p, ...dims } as Project));
      expect(r.ok).toBe(false);
    }
  });

  it('rejects layer pixel data that does not match the canvas size', () => {
    const p = sampleProject();
    const wire = JSON.parse(serialize(p));
    // Corrupt one layer's base64 so it decodes to the wrong length.
    wire.frames[0].layers[0].pixels = 'AAAA';
    const r = deserialize(JSON.stringify(wire));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PROJECT_PIXELS');
  });

  it('rejects a project with no frames or an empty frame', () => {
    const p = sampleProject();
    expect(deserialize(serialize({ ...p, frames: [] })).ok).toBe(false);
    const wire = JSON.parse(serialize(p));
    wire.frames[0].layers = [];
    expect(deserialize(JSON.stringify(wire)).ok).toBe(false);
  });

  it('rejects invalid field types defensively', () => {
    const wire = JSON.parse(serialize(sampleProject()));
    const mutate = (patch: object): string => JSON.stringify({ ...wire, ...patch });
    expect(deserialize(mutate({ id: 5 })).ok).toBe(false);
    expect(deserialize(mutate({ indexed: 'yes' })).ok).toBe(false);
    expect(deserialize(mutate({ fps: 'fast' })).ok).toBe(false);
    expect(deserialize(mutate({ name: null })).ok).toBe(false);
  });

  it('clamps out-of-range opacity on read (defensive)', () => {
    const wire = JSON.parse(serialize(sampleProject()));
    wire.frames[0].layers[0].opacity = 999;
    const r = deserialize(JSON.stringify(wire));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.frames[0].layers[0].opacity).toBe(100);
  });

  it('createProject builds a valid single-frame project that round-trips', () => {
    const p = createProject({
      w: 16,
      h: 16,
      id: 'p2',
      createdAt: '2026-07-01T00:00:00Z',
      name: 'Fresh',
      layers: [layer('base', 16, 16, true)],
    });
    expect(p.frames).toHaveLength(1);
    expect(p.name).toBe('Fresh');
    const r = deserialize(serialize(p));
    expect(r.ok).toBe(true);
  });

  it('reports total pixel bytes', () => {
    const p = sampleProject();
    // 2 frames × 2 layers × 6×5×4 bytes.
    expect(projectPixelBytes(p)).toBe(2 * 2 * 6 * 5 * 4);
  });

  it('exposes the native file extension', () => {
    expect(FORGE_EXTENSION).toBe('.forge');
  });
});
