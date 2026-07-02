/**
 * src/platform/persistence.ts — local project persistence on IndexedDB
 * (ADR-001/006, master-spec §8.6). Autosave + explicit gallery save, list,
 * open, rename, duplicate, delete, all client-only with NO server.
 *
 * The pure engine's {@link serialize}/{@link deserialize} own the `.forge`
 * format; this layer only moves those strings in and out of a key-value store
 * and keeps a lightweight gallery index (name/size/thumbnail) so listing never
 * decodes megabytes of pixels. Every fallible op returns the client-only result
 * envelope (constitution): a failed save NEVER throws and NEVER loses the live
 * buffer — storage-full surfaces an actionable error. The store is injectable so
 * the gallery/quota logic is unit-testable in Node; the default binds to
 * IndexedDB via `idb-keyval`, created lazily so importing this module is safe in
 * a non-DOM context.
 */
import { deserialize, projectPixelBytes, serialize } from '../core/project';
import type { Project, Result } from '../core/types';
import { err, ok } from '../core/types';

/** The minimal async key-value surface this module needs (idb-keyval-shaped). */
export interface KeyValStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** A compact gallery row — enough to render the list without decoding pixels. */
export interface GalleryEntry {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly frames: number;
  readonly layers: number;
  readonly bytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly thumbnailDataUrl?: string;
}

const PROJECT_PREFIX = 'project:';
const META_PREFIX = 'meta:';
const AUTOSAVE_KEY = 'autosave';

const STORAGE_FULL_MESSAGE =
  'Local storage is full. Export a project to a file or delete saved projects, then try again.';

/** Whether an unknown error is an IndexedDB/quota "out of space" failure. */
function isQuotaError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return (
      e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22
    );
  }
  return (
    typeof e === 'object' && e !== null && (e as { name?: string }).name === 'QuotaExceededError'
  );
}

/** Derive the compact gallery entry for a project. */
export function deriveGalleryEntry(project: Project): GalleryEntry {
  const layers = project.frames.reduce((n, f) => n + f.layers.length, 0);
  const entry: GalleryEntry = {
    id: project.id,
    name: project.name,
    w: project.w,
    h: project.h,
    frames: project.frames.length,
    layers,
    bytes: projectPixelBytes(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  return project.thumbnailDataUrl === undefined
    ? entry
    : { ...entry, thumbnailDataUrl: project.thumbnailDataUrl };
}

/**
 * The project repository. Construct with a {@link KeyValStore} (tests inject an
 * in-memory fake); {@link createProjectStore} binds the default IndexedDB store.
 */
export class ProjectStore {
  constructor(private readonly kv: KeyValStore) {}

  /** Explicit gallery save: writes the full `.forge` blob + its gallery entry. */
  async saveProject(project: Project): Promise<Result<GalleryEntry>> {
    const entry = deriveGalleryEntry(project);
    try {
      await this.kv.set(PROJECT_PREFIX + project.id, serialize(project));
      await this.kv.set(META_PREFIX + project.id, JSON.stringify(entry));
      return ok(entry);
    } catch (e) {
      return this.writeError(e);
    }
  }

  /** Open a saved project by id (validated through `deserialize`). */
  async loadProject(id: string): Promise<Result<Project>> {
    let text: string | undefined;
    try {
      text = await this.kv.get(PROJECT_PREFIX + id);
    } catch {
      return err('STORAGE_READ', 'Could not read from local storage.');
    }
    if (text === undefined) {
      return err('PROJECT_NOT_FOUND', 'That project could not be found.');
    }
    return deserialize(text);
  }

  /** List the gallery, newest first. Skips any unreadable/corrupt entry. */
  async listProjects(): Promise<Result<GalleryEntry[]>> {
    let allKeys: string[];
    try {
      allKeys = await this.kv.keys();
    } catch {
      return err('STORAGE_READ', 'Could not read the project gallery.');
    }
    const entries: GalleryEntry[] = [];
    for (const key of allKeys) {
      if (!key.startsWith(META_PREFIX)) {
        continue;
      }
      try {
        const raw = await this.kv.get(key);
        if (raw !== undefined) {
          const parsed = JSON.parse(raw) as GalleryEntry;
          if (parsed && typeof parsed.id === 'string') {
            entries.push(parsed);
          }
        }
      } catch {
        // Skip a corrupt index row rather than failing the whole listing.
      }
    }
    entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return ok(entries);
  }

  /** Delete a project and its gallery entry. Idempotent. */
  async deleteProject(id: string): Promise<Result<void>> {
    try {
      await this.kv.del(PROJECT_PREFIX + id);
      await this.kv.del(META_PREFIX + id);
      return ok(undefined);
    } catch {
      return err('STORAGE_WRITE', 'Could not delete the project.');
    }
  }

  /** Rename a saved project (updates `updatedAt`). */
  async renameProject(id: string, name: string, now: string): Promise<Result<GalleryEntry>> {
    const loaded = await this.loadProject(id);
    if (!loaded.ok) {
      return loaded;
    }
    return this.saveProject({ ...loaded.value, name, updatedAt: now });
  }

  /** Duplicate a saved project under a fresh id/name. */
  async duplicateProject(
    id: string,
    newId: string,
    name: string,
    now: string,
  ): Promise<Result<GalleryEntry>> {
    const loaded = await this.loadProject(id);
    if (!loaded.ok) {
      return loaded;
    }
    return this.saveProject({
      ...loaded.value,
      id: newId,
      name,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Debounced-autosave sink: persist the working project to the session slot. */
  async saveAutosave(project: Project): Promise<Result<void>> {
    try {
      await this.kv.set(AUTOSAVE_KEY, serialize(project));
      return ok(undefined);
    } catch (e) {
      const written = this.writeError(e);
      return written.ok ? ok(undefined) : { ok: false, error: written.error };
    }
  }

  /** Restore the last autosaved project, or `null` when there is none. */
  async loadAutosave(): Promise<Result<Project | null>> {
    let text: string | undefined;
    try {
      text = await this.kv.get(AUTOSAVE_KEY);
    } catch {
      return err('STORAGE_READ', 'Could not read the autosaved project.');
    }
    if (text === undefined) {
      return ok(null);
    }
    const parsed = deserialize(text);
    return parsed.ok ? ok(parsed.value) : ok(null);
  }

  /** Clear the autosave slot (e.g. after an explicit New with no work). */
  async clearAutosave(): Promise<Result<void>> {
    try {
      await this.kv.del(AUTOSAVE_KEY);
      return ok(undefined);
    } catch {
      return err('STORAGE_WRITE', 'Could not clear the autosave.');
    }
  }

  private writeError(e: unknown): Result<GalleryEntry> {
    if (isQuotaError(e)) {
      return err('STORAGE_FULL', STORAGE_FULL_MESSAGE);
    }
    return err('STORAGE_WRITE', 'Could not save to local storage. Please try again.');
  }
}

// ─── Default IndexedDB binding (lazy, browser-only) ─────────────────────────

const DB_NAME = 'pixelforge';
const STORE_NAME = 'projects';

/**
 * A {@link KeyValStore} backed by IndexedDB via `idb-keyval`, created lazily so
 * this module imports cleanly in Node/unit tests. Any op in a context without
 * IndexedDB rejects with a friendly error (callers already handle it).
 */
export function idbKeyValStore(): KeyValStore {
  // Bind the idb-keyval store on first use; `import()` keeps the dependency off
  // the initial parse path and out of non-DOM contexts.
  let ready: Promise<{
    get: (k: IDBValidKey) => Promise<string | undefined>;
    set: (k: IDBValidKey, v: string) => Promise<void>;
    del: (k: IDBValidKey) => Promise<void>;
    keys: () => Promise<IDBValidKey[]>;
  }> | null = null;

  const bind = async () => {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is unavailable in this environment.');
    }
    const idb = await import('idb-keyval');
    const store = idb.createStore(DB_NAME, STORE_NAME);
    return {
      get: (k: IDBValidKey) => idb.get<string>(k, store),
      set: (k: IDBValidKey, v: string) => idb.set(k, v, store),
      del: (k: IDBValidKey) => idb.del(k, store),
      keys: () => idb.keys(store),
    };
  };

  const api = () => {
    ready ??= bind();
    return ready;
  };

  return {
    async get(key) {
      return (await api()).get(key);
    },
    async set(key, value) {
      return (await api()).set(key, value);
    },
    async del(key) {
      return (await api()).del(key);
    },
    async keys() {
      return (await (await api()).keys()).map(String);
    },
  };
}

/** Build a {@link ProjectStore} bound to the default IndexedDB key-value store. */
export function createProjectStore(store: KeyValStore = idbKeyValStore()): ProjectStore {
  return new ProjectStore(store);
}

/**
 * Ask the browser to make storage persistent so autosaved work is not evicted
 * under pressure (master-spec acceptance §8.6). Best-effort; resolves `false`
 * where unsupported.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return false;
    }
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      return true;
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** A local storage-usage estimate (bytes) for the status-bar quota hint. */
export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

/** Best-effort storage estimate, or `null` where the API is unavailable. */
export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return null;
    }
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}
