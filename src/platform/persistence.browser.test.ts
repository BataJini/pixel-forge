import { afterEach, describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../core/buffer';
import { createProject } from '../core/project';
import type { Layer, Project } from '../core/types';
import { createProjectStore, estimateStorage, requestPersistentStorage } from './persistence';

/** A unique id per run so tests never collide in the shared IndexedDB store. */
function uid(): string {
  return `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function project(id: string, name: string): Project {
  const layer: Layer = {
    id: 'l1',
    name: 'Base',
    visible: true,
    locked: false,
    opacity: 100,
    blend: 'normal',
    buffer: setPixel(createBuffer(8, 8), 2, 2, [255, 0, 0, 255]),
  };
  return createProject({
    w: 8,
    h: 8,
    id,
    name,
    createdAt: '2026-07-02T00:00:00Z',
    layers: [layer],
  });
}

const created: string[] = [];

afterEach(async () => {
  const store = createProjectStore();
  for (const id of created.splice(0)) {
    await store.deleteProject(id);
  }
});

describe('ProjectStore — real IndexedDB', () => {
  it('saves, lists, opens, and deletes a project through IndexedDB', async () => {
    const store = createProjectStore();
    const id = uid();
    created.push(id);

    const saved = await store.saveProject(project(id, 'IDB Hero'));
    expect(saved.ok).toBe(true);

    const list = await store.listProjects();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.some((e) => e.id === id && e.name === 'IDB Hero')).toBe(true);

    const loaded = await store.loadProject(id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(getPixel(loaded.value.frames[0].layers[0].buffer, 2, 2)).toEqual([255, 0, 0, 255]);

    const del = await store.deleteProject(id);
    expect(del.ok).toBe(true);
    const after = await store.loadProject(id);
    expect(after.ok).toBe(false);
    created.splice(created.indexOf(id), 1);
  });

  it('round-trips the autosave slot through IndexedDB', async () => {
    const store = createProjectStore();
    const id = uid();
    await store.saveAutosave(project(id, 'Session'));
    const restored = await store.loadAutosave();
    expect(restored.ok).toBe(true);
    if (!restored.ok || !restored.value) return;
    expect(restored.value.name).toBe('Session');
    await store.clearAutosave();
    const cleared = await store.loadAutosave();
    expect(cleared.ok && cleared.value).toBeNull();
  });

  it('requests persistent storage and estimates usage without throwing', async () => {
    expect(typeof (await requestPersistentStorage())).toBe('boolean');
    const est = await estimateStorage();
    expect(est === null || typeof est.usage === 'number').toBe(true);
  });
});
