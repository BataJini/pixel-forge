import { describe, expect, it } from 'vitest';
import { createBuffer, setPixel } from '../core/buffer';
import { createProject } from '../core/project';
import type { Layer, Project, RGBA } from '../core/types';
import { deriveGalleryEntry, type KeyValStore, ProjectStore } from './persistence';

const EMBER: RGBA = [255, 106, 26, 255];

/** In-memory KeyValStore for Node unit tests, with an optional write blocker. */
class FakeStore implements KeyValStore {
  private readonly map = new Map<string, string>();
  failNextSet: Error | null = null;

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    if (this.failNextSet) {
      const e = this.failNextSet;
      this.failNextSet = null;
      throw e;
    }
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  size(): number {
    return this.map.size;
  }
}

function makeProject(id: string, name: string, paint = false): Project {
  const layer: Layer = {
    id: 'l1',
    name: 'Base',
    visible: true,
    locked: false,
    opacity: 100,
    blend: 'normal',
    buffer: paint ? setPixel(createBuffer(8, 8), 1, 1, EMBER) : createBuffer(8, 8),
  };
  return createProject({
    w: 8,
    h: 8,
    id,
    name,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    layers: [layer],
  });
}

describe('ProjectStore', () => {
  it('saves and restores a project losslessly', async () => {
    const store = new ProjectStore(new FakeStore());
    const p = makeProject('p1', 'First', true);
    const saved = await store.saveProject(p);
    expect(saved.ok).toBe(true);
    const loaded = await store.loadProject('p1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.name).toBe('First');
    expect(Array.from(loaded.value.frames[0].layers[0].buffer.data)).toEqual(
      Array.from(p.frames[0].layers[0].buffer.data),
    );
  });

  it('lists gallery entries newest-first without decoding pixels', async () => {
    const store = new ProjectStore(new FakeStore());
    await store.saveProject({ ...makeProject('a', 'Alpha'), updatedAt: '2026-07-01T00:00:00Z' });
    await store.saveProject({ ...makeProject('b', 'Beta'), updatedAt: '2026-07-03T00:00:00Z' });
    await store.saveProject({ ...makeProject('c', 'Gamma'), updatedAt: '2026-07-02T00:00:00Z' });
    const list = await store.listProjects();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((e) => e.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(list.value[0].w).toBe(8);
    expect(list.value[0].layers).toBe(1);
  });

  it('returns a not-found error for a missing project', async () => {
    const store = new ProjectStore(new FakeStore());
    const loaded = await store.loadProject('nope');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('deletes a project and its gallery entry', async () => {
    const fake = new FakeStore();
    const store = new ProjectStore(fake);
    await store.saveProject(makeProject('p1', 'One'));
    expect(fake.size()).toBe(2); // project + meta
    await store.deleteProject('p1');
    expect(fake.size()).toBe(0);
    const list = await store.listProjects();
    expect(list.ok && list.value).toEqual([]);
  });

  it('renames a saved project', async () => {
    const store = new ProjectStore(new FakeStore());
    await store.saveProject(makeProject('p1', 'Old'));
    const renamed = await store.renameProject('p1', 'New Name', '2026-07-05T00:00:00Z');
    expect(renamed.ok).toBe(true);
    const loaded = await store.loadProject('p1');
    expect(loaded.ok && loaded.value.name).toBe('New Name');
    expect(loaded.ok && loaded.value.updatedAt).toBe('2026-07-05T00:00:00Z');
  });

  it('duplicates a saved project under a new id', async () => {
    const store = new ProjectStore(new FakeStore());
    await store.saveProject(makeProject('p1', 'Original', true));
    const dup = await store.duplicateProject('p1', 'p2', 'Original copy', '2026-07-06T00:00:00Z');
    expect(dup.ok).toBe(true);
    const loaded = await store.loadProject('p2');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.id).toBe('p2');
    expect(loaded.value.name).toBe('Original copy');
    // Pixels copied.
    expect(loaded.value.frames[0].layers[0].buffer.data[(1 * 8 + 1) * 4]).toBe(255);
  });

  it('surfaces a friendly STORAGE_FULL error on a quota exception', async () => {
    const fake = new FakeStore();
    const store = new ProjectStore(fake);
    fake.failNextSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const saved = await store.saveProject(makeProject('p1', 'Big'));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('STORAGE_FULL');
    expect(saved.error.message).toMatch(/full/i);
  });

  it('reports a generic write error on other failures', async () => {
    const fake = new FakeStore();
    const store = new ProjectStore(fake);
    fake.failNextSet = new Error('disk on fire');
    const saved = await store.saveProject(makeProject('p1', 'X'));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('STORAGE_WRITE');
  });

  it('autosaves and restores the working project', async () => {
    const store = new ProjectStore(new FakeStore());
    expect((await store.loadAutosave()).ok).toBe(true);
    const empty = await store.loadAutosave();
    expect(empty.ok && empty.value).toBeNull();
    await store.saveAutosave(makeProject('cur', 'Working', true));
    const restored = await store.loadAutosave();
    expect(restored.ok).toBe(true);
    if (!restored.ok || !restored.value) return;
    expect(restored.value.name).toBe('Working');
    await store.clearAutosave();
    const cleared = await store.loadAutosave();
    expect(cleared.ok && cleared.value).toBeNull();
  });

  it('treats a corrupt autosave as no autosave (no throw)', async () => {
    const fake = new FakeStore();
    await fake.set('autosave', 'not a project');
    const store = new ProjectStore(fake);
    const restored = await store.loadAutosave();
    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.value).toBeNull();
  });

  it('derives a compact gallery entry', () => {
    const p = { ...makeProject('p1', 'Title'), thumbnailDataUrl: 'data:,x' };
    const entry = deriveGalleryEntry(p);
    expect(entry).toMatchObject({ id: 'p1', name: 'Title', w: 8, h: 8, frames: 1, layers: 1 });
    expect(entry.bytes).toBe(8 * 8 * 4);
    expect(entry.thumbnailDataUrl).toBe('data:,x');
  });
});
