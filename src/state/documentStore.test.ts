import { beforeEach, describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../core/buffer';
import type { PixelBuffer, Project, Result } from '../core/types';
import { ok } from '../core/types';
import { type DocGalleryEntry, type DocPersistence, DocumentStore } from './documentStore';

const RED: [number, number, number, number] = [255, 0, 0, 255];

/** In-memory persistence double, with a togglable save failure. */
class FakePersistence implements DocPersistence {
  projects = new Map<string, Project>();
  autosaved: Project | null = null;
  failSave: { code: string; message: string } | null = null;

  private entry(p: Project): DocGalleryEntry {
    return {
      id: p.id,
      name: p.name,
      w: p.w,
      h: p.h,
      frames: p.frames.length,
      layers: p.frames.reduce((n, f) => n + f.layers.length, 0),
      bytes: 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
  async saveProject(project: Project): Promise<Result<DocGalleryEntry>> {
    if (this.failSave) {
      return { ok: false, error: this.failSave };
    }
    this.projects.set(project.id, project);
    return ok(this.entry(project));
  }
  async saveAutosave(project: Project): Promise<Result<void>> {
    if (this.failSave) {
      return { ok: false, error: this.failSave };
    }
    this.autosaved = project;
    return ok(undefined);
  }
  async loadProject(id: string): Promise<Result<Project>> {
    const p = this.projects.get(id);
    return p ? ok(p) : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'missing' } };
  }
  async listProjects(): Promise<Result<DocGalleryEntry[]>> {
    return ok([...this.projects.values()].map((p) => this.entry(p)));
  }
  async deleteProject(id: string): Promise<Result<void>> {
    this.projects.delete(id);
    return ok(undefined);
  }
  async renameProject(id: string, name: string, now: string): Promise<Result<DocGalleryEntry>> {
    const p = this.projects.get(id);
    if (!p) return { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'missing' } };
    const next = { ...p, name, updatedAt: now };
    this.projects.set(id, next);
    return ok(this.entry(next));
  }
  async duplicateProject(
    id: string,
    newId: string,
    name: string,
    now: string,
  ): Promise<Result<DocGalleryEntry>> {
    const p = this.projects.get(id);
    if (!p) return { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'missing' } };
    const next = { ...p, id: newId, name, createdAt: now, updatedAt: now };
    this.projects.set(newId, next);
    return ok(this.entry(next));
  }
  async loadAutosave(): Promise<Result<Project | null>> {
    return ok(this.autosaved);
  }
  async clearAutosave(): Promise<Result<void>> {
    this.autosaved = null;
    return ok(undefined);
  }
}

/** Manual timer harness so autosave debouncing is deterministic. */
class Timers {
  private queue = new Map<number, () => void>();
  private seq = 0;
  set = (fn: () => void, _ms: number): number => {
    this.seq += 1;
    this.queue.set(this.seq, fn);
    return this.seq;
  };
  clear = (h: number): void => {
    this.queue.delete(h);
  };
  runAll(): void {
    const fns = [...this.queue.values()];
    this.queue.clear();
    for (const fn of fns) fn();
  }
  pending(): number {
    return this.queue.size;
  }
}

let persistence: FakePersistence;
let timers: Timers;
let seq: number;

function nextId(): string {
  seq += 1;
  return `p${seq}`;
}

function makeStore(): DocumentStore {
  seq = 0;
  return new DocumentStore(persistence, {
    now: () => '2026-07-02T00:00:00Z',
    genId: nextId,
    setTimer: timers.set,
    clearTimer: timers.clear,
    renderThumbnail: () => 'data:thumb',
    initialSize: { w: 4, h: 4 },
  });
}

beforeEach(() => {
  persistence = new FakePersistence();
  timers = new Timers();
});

async function flush(store: DocumentStore): Promise<void> {
  timers.runAll();
  await store.flushAutosave();
}

describe('DocumentStore — new / edit / autosave', () => {
  it('starts saved and marks unsaved on edit, then autosaves after debounce', async () => {
    const store = makeStore();
    expect(store.getSnapshot().saveState).toBe('saved');
    store.getStack().stampPixel(1, 1, RED);
    expect(store.getSnapshot().saveState).toBe('unsaved');
    expect(timers.pending()).toBe(1);
    await flush(store);
    expect(persistence.autosaved).not.toBeNull();
    expect(persistence.autosaved?.frames[0].layers.length).toBeGreaterThan(0);
  });

  it('New resets the document to a fresh id + size and schedules autosave', async () => {
    const store = makeStore();
    store.newProject({ w: 16, h: 16, name: 'Sprite' });
    const snap = store.getSnapshot();
    expect(snap.w).toBe(16);
    expect(snap.name).toBe('Sprite');
    expect(snap.saveState).toBe('unsaved');
    await flush(store);
    expect(persistence.autosaved?.w).toBe(16);
  });

  it('clamps a New canvas request above 512', () => {
    const store = makeStore();
    store.newProject({ w: 999, h: 600 });
    expect(store.getSnapshot().w).toBe(512);
    expect(store.getSnapshot().h).toBe(512);
  });
});

describe('DocumentStore — explicit save + gallery', () => {
  it('saves to the gallery and restores it losslessly', async () => {
    const store = makeStore();
    store.newProject({ w: 6, h: 6, name: 'Hero' });
    store.getStack().stampPixel(2, 3, RED);
    const saved = await store.save();
    expect(saved.ok).toBe(true);
    expect(store.getSnapshot().saveState).toBe('saved');

    const list = await store.listProjects();
    expect(list.ok && list.value.map((e) => e.name)).toContain('Hero');

    // Re-open into a second store instance → same pixel survives.
    const store2 = makeStore();
    const opened = await store2.openById(store.currentId());
    expect(opened.ok).toBe(true);
    const layer = store2.getStack().getLayers()[0];
    expect(getPixel(layer.buffer, 2, 3)).toEqual(RED);
  });

  it('surfaces a friendly error on save failure without losing the buffer', async () => {
    const store = makeStore();
    store.getStack().stampPixel(0, 0, RED);
    persistence.failSave = { code: 'STORAGE_FULL', message: 'Local storage is full.' };
    const saved = await store.save();
    expect(saved.ok).toBe(false);
    expect(store.getSnapshot().saveState).toBe('error');
    expect(store.getSnapshot().lastError).toMatch(/full/i);
    // Buffer intact.
    expect(getPixel(store.getStack().getLayers()[0].buffer, 0, 0)).toEqual(RED);
  });
});

describe('DocumentStore — canvas ops (undoable)', () => {
  it('resizes the canvas and is undoable', () => {
    const store = makeStore();
    store.getStack().stampPixel(0, 0, RED);
    store.resizeCanvas(8, 8, 'top-left');
    expect(store.getSnapshot().w).toBe(8);
    expect(getPixel(store.getStack().getLayers()[0].buffer, 0, 0)).toEqual(RED);
    store.getStack().undo();
    expect(store.getSnapshot().w).toBe(4);
  });

  it('crops the canvas to a region and is undoable', () => {
    const store = makeStore();
    store.getStack().stampPixel(2, 2, RED);
    const cropped = store.cropCanvas({ x: 2, y: 2, w: 2, h: 2 });
    expect(cropped.ok).toBe(true);
    expect(store.getSnapshot().w).toBe(2);
    expect(getPixel(store.getStack().getLayers()[0].buffer, 0, 0)).toEqual(RED);
    store.getStack().undo();
    expect(store.getSnapshot().w).toBe(4);
  });

  it('trims transparent margins, and no-ops when already tight', () => {
    const store = makeStore();
    store.getStack().stampPixel(1, 1, RED);
    const trimmed = store.trimTransparent();
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(trimmed.value).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(store.getSnapshot().w).toBe(1);
    // Trimming a now-tight canvas is a friendly no-op.
    const again = store.trimTransparent();
    expect(again.ok).toBe(false);
  });

  it('trim on an empty canvas returns a friendly error', () => {
    const store = makeStore();
    const trimmed = store.trimTransparent();
    expect(trimmed.ok).toBe(false);
    if (trimmed.ok) return;
    expect(trimmed.error.code).toBe('TRIM_EMPTY');
  });
});

describe('DocumentStore — image import', () => {
  it('imports as a new canvas sized to the image', () => {
    const store = makeStore();
    const img: PixelBuffer = setPixel(createBuffer(10, 7), 5, 3, RED);
    store.importAsNewCanvas(img, 'Logo');
    expect(store.getSnapshot().w).toBe(10);
    expect(store.getSnapshot().h).toBe(7);
    expect(store.getSnapshot().name).toBe('Logo');
    expect(getPixel(store.getStack().getLayers()[0].buffer, 5, 3)).toEqual(RED);
  });

  it('imports as a new layer placed at the origin (overflow cropped), undoable', () => {
    const store = makeStore(); // 4×4 canvas
    const img: PixelBuffer = setPixel(createBuffer(2, 2), 1, 1, RED);
    const before = store.getStack().getLayers().length;
    store.importAsLayer(img, 'Stamp');
    expect(store.getStack().getLayers().length).toBe(before + 1);
    const top = store.getStack().getActiveLayer();
    expect(top?.name).toBe('Stamp');
    expect(getPixel(top?.buffer as PixelBuffer, 1, 1)).toEqual(RED);
    store.getStack().undo();
    expect(store.getStack().getLayers().length).toBe(before);
  });
});

describe('DocumentStore — autosave restore + multi-frame preservation', () => {
  it('restores an autosaved session', async () => {
    const store = makeStore();
    store.newProject({ w: 5, h: 5, name: 'Session' });
    store.getStack().stampPixel(0, 0, RED);
    await flush(store);

    const fresh = makeStore();
    const restored = await fresh.restoreAutosave();
    expect(restored.ok && restored.value).toBe(true);
    expect(fresh.getSnapshot().name).toBe('Session');
    expect(fresh.getSnapshot().saveState).toBe('unsaved');
  });

  it('preserves extra frames of a loaded multi-frame project across resize + save', async () => {
    const store = makeStore();
    const multi: Project = {
      schema: 1,
      id: 'multi',
      name: 'Anim',
      w: 4,
      h: 4,
      frames: [
        {
          id: 'f1',
          durationMs: 100,
          layers: [layerOf('a', setPixel(createBuffer(4, 4), 0, 0, RED))],
        },
        {
          id: 'f2',
          durationMs: 200,
          layers: [layerOf('b', setPixel(createBuffer(4, 4), 3, 3, RED))],
        },
      ],
      palette: null,
      indexed: false,
      fps: 12,
      createdAt: 't',
      updatedAt: 't',
    };
    store.openProject(multi);
    expect(store.getSnapshot().hasExtraFrames).toBe(true);
    store.resizeCanvas(8, 8);
    const built = store.buildProject();
    expect(built.frames).toHaveLength(2);
    expect(built.frames[1].layers[0].buffer.w).toBe(8);
    expect(getPixel(built.frames[1].layers[0].buffer, 3, 3)).toEqual(RED);
  });
});

function layerOf(id: string, buffer: PixelBuffer) {
  return { id, name: id, visible: true, locked: false, opacity: 100, blend: 'normal', buffer };
}
