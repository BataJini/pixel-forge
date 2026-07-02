/**
 * src/state/documentStore.ts — the live project document controller (U-011).
 *
 * Owns the current {@link Project}'s metadata + a {@link LayerStack} for the
 * active frame, and wires persistence: a debounced AUTOSAVE that never loses work
 * plus explicit gallery Save, plus the undoable canvas ops (resize / crop / trim)
 * and image import (new canvas / new layer). It is DOM-free and depends on
 * persistence + thumbnail rendering through injected functions, so the whole
 * document/autosave/dirty state machine is unit-testable in Node (the UI provides
 * the IndexedDB-backed store and the DOM thumbnail renderer).
 *
 * Frames: the live editor is single-frame here (the timeline lands in U-008), but
 * a loaded multi-frame `.forge` is round-tripped losslessly — the extra frames
 * are preserved verbatim and transformed in lockstep with resize/crop/trim so a
 * load→edit→save cycle never silently drops frames.
 */
import { blitOverInto, cloneBuffer, composite, createBuffer } from '../core/buffer';
import {
  clampCropRect,
  clampDim,
  cropBuffer,
  projectContentBounds,
  type ResizeAnchor,
  resizeBuffer,
} from '../core/canvas';
import type { Frame, Layer, PixelBuffer, Project, Rect, Result } from '../core/types';
import { err, ok } from '../core/types';
import { LayerStack, layerFromBuffer } from './layerStore';

/** A gallery row as returned by the persistence layer (structural, DOM-free). */
export interface DocGalleryEntry {
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

/** The persistence contract the document depends on (injected; ProjectStore fits). */
export interface DocPersistence {
  saveProject(project: Project): Promise<Result<DocGalleryEntry>>;
  saveAutosave(project: Project): Promise<Result<void>>;
  loadProject(id: string): Promise<Result<Project>>;
  listProjects(): Promise<Result<DocGalleryEntry[]>>;
  deleteProject(id: string): Promise<Result<void>>;
  renameProject(id: string, name: string, now: string): Promise<Result<DocGalleryEntry>>;
  duplicateProject(
    id: string,
    newId: string,
    name: string,
    now: string,
  ): Promise<Result<DocGalleryEntry>>;
  loadAutosave(): Promise<Result<Project | null>>;
  clearAutosave(): Promise<Result<void>>;
}

/** Save/dirty state surfaced by the top-bar indicator. */
export type SaveState = 'unsaved' | 'saving' | 'saved' | 'error';

/** Readonly snapshot for React binding (`useSyncExternalStore`). */
export interface DocumentSnapshot {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly frameCount: number;
  readonly saveState: SaveState;
  readonly lastError: string | null;
  /** True when a loaded multi-frame project has frames beyond the edited one. */
  readonly hasExtraFrames: boolean;
}

/** How a new canvas fills its first layer. */
export interface NewProjectOptions {
  readonly w: number;
  readonly h: number;
  readonly name?: string;
  readonly palette?: Project['palette'];
  readonly indexed?: boolean;
  readonly fps?: number;
  /** Optional opaque fill color for the starting layer (else transparent). */
  readonly fill?: [number, number, number, number] | null;
}

export interface DocumentStoreOptions {
  /** Inject a seeded stack (tests); defaults to a single blank layer. */
  readonly stack?: LayerStack;
  readonly now?: () => string;
  readonly genId?: () => string;
  readonly autosaveDelayMs?: number;
  /** Timer hooks (tests inject fakes). Defaults to global set/clearTimeout. */
  readonly setTimer?: (fn: () => void, ms: number) => number;
  readonly clearTimer?: (handle: number) => void;
  /** DOM thumbnail renderer (UI injects `renderThumbnail`; default: none). */
  readonly renderThumbnail?: (buffer: PixelBuffer) => string | null;
  /** Starting canvas size when no stack is injected. */
  readonly initialSize?: { readonly w: number; readonly h: number };
}

const DEFAULT_SIZE = 32;
const DEFAULT_AUTOSAVE_MS = 800;
const DEFAULT_NAME = 'Untitled';

let idCounter = 0;
function fallbackId(): string {
  idCounter += 1;
  return `proj-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
function defaultGenId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `proj-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return fallbackId();
}

export class DocumentStore {
  private readonly persistence: DocPersistence;
  private readonly stack: LayerStack;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly autosaveMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private readonly renderThumbnail: (buffer: PixelBuffer) => string | null;

  private id: string;
  private name: string;
  private palette: Project['palette'];
  private indexed: boolean;
  private fps: number;
  private createdAt: string;
  private updatedAt: string;
  private extraFrames: Frame[] = [];

  private saveState: SaveState = 'saved';
  private lastError: string | null = null;
  private version = 0;
  private autosaveHandle: number | null = null;
  private snap: DocumentSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(persistence: DocPersistence, options: DocumentStoreOptions = {}) {
    this.persistence = persistence;
    this.now = options.now ?? (() => new Date().toISOString());
    this.genId = options.genId ?? defaultGenId;
    this.autosaveMs = options.autosaveDelayMs ?? DEFAULT_AUTOSAVE_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
    this.renderThumbnail = options.renderThumbnail ?? (() => null);
    const size = options.initialSize ?? { w: DEFAULT_SIZE, h: DEFAULT_SIZE };
    this.stack = options.stack ?? new LayerStack(size.w, size.h);
    const t = this.now();
    this.id = this.genId();
    this.name = DEFAULT_NAME;
    this.palette = null;
    this.indexed = false;
    this.fps = 12;
    this.createdAt = t;
    this.updatedAt = t;
    this.stack.subscribe(() => this.onDocChange());
    this.snap = this.buildSnapshot();
  }

  // ── React binding ───────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DocumentSnapshot => this.snap;

  /** The active-frame layer stack (bind the Layers panel + canvas to it). */
  getStack(): LayerStack {
    return this.stack;
  }

  // ── project assembly ────────────────────────────────────────────────────────

  /** Compose the current document into a {@link Project} (with a thumbnail). */
  buildProject(): Project {
    const layers = this.stack.getLayers().map((l) => l);
    const { w, h } = this.stack.getSize();
    const frame: Frame = { id: 'frame-1', durationMs: 100, layers: layers as Layer[] };
    const project: Project = {
      schema: 1,
      id: this.id,
      name: this.name,
      w,
      h,
      frames: [frame, ...this.extraFrames],
      palette: this.palette,
      indexed: this.indexed,
      fps: this.fps,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
    const thumb = this.renderThumbnail(composite(layers));
    return thumb === null ? project : { ...project, thumbnailDataUrl: thumb };
  }

  // ── New / Open ───────────────────────────────────────────────────────────────

  /** Start a fresh document (Welcome / New). Resets the stack + history. */
  newProject(options: NewProjectOptions): void {
    const w = clampDim(options.w);
    const h = clampDim(options.h);
    const base = createBuffer(w, h);
    if (options.fill && options.fill[3] > 0) {
      const d = base.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = options.fill[0];
        d[i + 1] = options.fill[1];
        d[i + 2] = options.fill[2];
        d[i + 3] = options.fill[3];
      }
    }
    const t = this.now();
    this.id = this.genId();
    this.name = options.name?.trim() || DEFAULT_NAME;
    this.palette = options.palette ?? null;
    this.indexed = options.indexed ?? false;
    this.fps = options.fps ?? 12;
    this.createdAt = t;
    this.updatedAt = t;
    this.extraFrames = [];
    this.stack.reset(w, h, [layerFromBuffer('layer-1', 'Layer 1', base)]);
    this.markDirty();
  }

  /** Load an already-parsed project into the editor (from gallery / autosave). */
  openProject(project: Project): void {
    this.id = project.id;
    this.name = project.name;
    this.palette = project.palette;
    this.indexed = project.indexed;
    this.fps = project.fps;
    this.createdAt = project.createdAt;
    this.updatedAt = project.updatedAt;
    this.extraFrames = project.frames.slice(1).map((f) => ({ ...f, layers: f.layers.slice() }));
    const frame0 = project.frames[0];
    this.stack.reset(project.w, project.h, frame0.layers.slice(), undefined);
    this.setSaveState('saved');
  }

  /** Open a saved project by id. */
  async openById(id: string): Promise<Result<void>> {
    const loaded = await this.persistence.loadProject(id);
    if (!loaded.ok) {
      this.setError(loaded.error.message);
      return { ok: false, error: loaded.error };
    }
    this.openProject(loaded.value);
    return ok(undefined);
  }

  /** Restore the last autosaved session, or `false` when there is none. */
  async restoreAutosave(): Promise<Result<boolean>> {
    const loaded = await this.persistence.loadAutosave();
    if (!loaded.ok) {
      return { ok: false, error: loaded.error };
    }
    if (loaded.value === null) {
      return ok(false);
    }
    this.openProject(loaded.value);
    this.setSaveState('unsaved');
    return ok(true);
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  /** Explicit gallery save. Surfaces a friendly error without losing the buffer. */
  async save(): Promise<Result<DocGalleryEntry>> {
    this.setSaveState('saving');
    this.updatedAt = this.now();
    const result = await this.persistence.saveProject(this.buildProject());
    if (result.ok) {
      this.setSaveState('saved');
    } else {
      this.setError(result.error.message);
    }
    return result;
  }

  /** Rename the current document (persisted on the next save/autosave). */
  setName(name: string): void {
    const clean = name.trim() || DEFAULT_NAME;
    if (clean === this.name) {
      return;
    }
    this.name = clean;
    this.markDirty();
  }

  // ── Canvas ops (undoable via the stack) ─────────────────────────────────────

  /** Resize the canvas to `w × h`, keeping pixels anchored (default top-left). */
  resizeCanvas(w: number, h: number, anchor: ResizeAnchor = 'top-left'): void {
    const nw = clampDim(w);
    const nh = clampDim(h);
    const cur = this.stack.getSize();
    if (nw === cur.w && nh === cur.h) {
      return;
    }
    const prevExtra = this.extraFrames;
    const nextExtra = this.mapExtraFrames((buf) => resizeBuffer(buf, nw, nh, anchor));
    this.stack.resizeCanvas(nw, nh, (buf) => resizeBuffer(buf, nw, nh, anchor), 'Resize canvas', {
      apply: () => {
        this.extraFrames = nextExtra;
      },
      revert: () => {
        this.extraFrames = prevExtra;
      },
    });
  }

  /** Crop the canvas to `rect` (clamped). Returns whether it changed anything. */
  cropCanvas(rect: Rect): Result<void> {
    const cur = this.stack.getSize();
    const clamped = clampCropRect(rect, cur.w, cur.h);
    if (!clamped) {
      return err('CROP_EMPTY', 'The crop region is outside the canvas.');
    }
    if (clamped.w === cur.w && clamped.h === cur.h && clamped.x === 0 && clamped.y === 0) {
      return ok(undefined); // no-op crop
    }
    const prevExtra = this.extraFrames;
    const nextExtra = this.mapExtraFrames((buf) => cropBuffer(buf, clamped));
    this.stack.resizeCanvas(
      clamped.w,
      clamped.h,
      (buf) => cropBuffer(buf, clamped),
      'Crop canvas',
      {
        apply: () => {
          this.extraFrames = nextExtra;
        },
        revert: () => {
          this.extraFrames = prevExtra;
        },
      },
    );
    return ok(undefined);
  }

  /** Trim fully-transparent margins from every side. */
  trimTransparent(): Result<Rect> {
    const bounds = projectContentBounds(this.buildBoundsProject());
    const cur = this.stack.getSize();
    if (!bounds) {
      return err('TRIM_EMPTY', 'There is nothing to trim — the canvas is empty.');
    }
    if (bounds.x === 0 && bounds.y === 0 && bounds.w === cur.w && bounds.h === cur.h) {
      return err('TRIM_TIGHT', 'The canvas is already trimmed to its content.');
    }
    const prevExtra = this.extraFrames;
    const nextExtra = this.mapExtraFrames((buf) => cropBuffer(buf, bounds));
    this.stack.resizeCanvas(bounds.w, bounds.h, (buf) => cropBuffer(buf, bounds), 'Trim canvas', {
      apply: () => {
        this.extraFrames = nextExtra;
      },
      revert: () => {
        this.extraFrames = prevExtra;
      },
    });
    return ok(bounds);
  }

  // ── Image import ─────────────────────────────────────────────────────────────

  /** Import a decoded image as a brand-new canvas sized to the image. */
  importAsNewCanvas(buffer: PixelBuffer, name = 'Imported'): void {
    const t = this.now();
    this.id = this.genId();
    this.name = name;
    this.palette = null;
    this.indexed = false;
    this.createdAt = t;
    this.updatedAt = t;
    this.extraFrames = [];
    this.stack.reset(buffer.w, buffer.h, [
      layerFromBuffer('layer-1', 'Imported', cloneBuffer(buffer)),
    ]);
    this.markDirty();
  }

  /** Import a decoded image as a new layer on the current canvas (placed at 0,0,
   * overflow cropped). Undoable. */
  importAsLayer(buffer: PixelBuffer, name = 'Imported'): void {
    const { w, h } = this.stack.getSize();
    const canvasBuf = createBuffer(w, h);
    blitOverInto(canvasBuf, buffer, 0, 0);
    this.stack.addLayerWithBuffer(canvasBuf, name);
  }

  // ── persistence passthroughs the UI needs ───────────────────────────────────

  listProjects(): Promise<Result<DocGalleryEntry[]>> {
    return this.persistence.listProjects();
  }
  deleteProject(id: string): Promise<Result<void>> {
    return this.persistence.deleteProject(id);
  }
  renameSaved(id: string, name: string): Promise<Result<DocGalleryEntry>> {
    return this.persistence.renameProject(id, name, this.now());
  }
  duplicateSaved(id: string, name: string): Promise<Result<DocGalleryEntry>> {
    return this.persistence.duplicateProject(id, this.genId(), name, this.now());
  }

  /** The id of the currently-open document (to highlight it in the gallery). */
  currentId(): string {
    return this.id;
  }

  /** Cancel any pending autosave timer (unmount cleanup). */
  dispose(): void {
    if (this.autosaveHandle !== null) {
      this.clearTimer(this.autosaveHandle);
      this.autosaveHandle = null;
    }
    this.listeners.clear();
  }

  /** Force the pending autosave to run now (tests / explicit flush). */
  async flushAutosave(): Promise<void> {
    if (this.autosaveHandle !== null) {
      this.clearTimer(this.autosaveHandle);
      this.autosaveHandle = null;
    }
    await this.runAutosave();
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** A project whose frames include the extra frames, for content-bounds math. */
  private buildBoundsProject(): Project {
    const layers = this.stack.getLayers() as Layer[];
    const { w, h } = this.stack.getSize();
    return {
      schema: 1,
      id: this.id,
      name: this.name,
      w,
      h,
      frames: [{ id: 'frame-1', durationMs: 100, layers }, ...this.extraFrames],
      palette: this.palette,
      indexed: this.indexed,
      fps: this.fps,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private mapExtraFrames(map: (buf: PixelBuffer) => PixelBuffer): Frame[] {
    return this.extraFrames.map((frame) => ({
      ...frame,
      layers: frame.layers.map((l) => ({ ...l, buffer: map(l.buffer) })),
    }));
  }

  private onDocChange(): void {
    // A stack edit (pixel/layer/canvas op) dirties the doc and reschedules autosave.
    if (this.saveState !== 'unsaved') {
      this.saveState = 'unsaved';
    }
    this.scheduleAutosave();
    this.emit();
  }

  private markDirty(): void {
    this.saveState = 'unsaved';
    this.lastError = null;
    this.scheduleAutosave();
    this.emit();
  }

  private setSaveState(state: SaveState): void {
    this.saveState = state;
    if (state !== 'error') {
      this.lastError = null;
    }
    this.emit();
  }

  private setError(message: string): void {
    this.saveState = 'error';
    this.lastError = message;
    this.emit();
  }

  private scheduleAutosave(): void {
    if (this.autosaveHandle !== null) {
      this.clearTimer(this.autosaveHandle);
    }
    this.autosaveHandle = this.setTimer(() => {
      this.autosaveHandle = null;
      void this.runAutosave();
    }, this.autosaveMs);
  }

  private async runAutosave(): Promise<void> {
    this.updatedAt = this.now();
    const result = await this.persistence.saveAutosave(this.buildProject());
    if (!result.ok) {
      this.setError(result.error.message);
    }
  }

  private emit(): void {
    this.snap = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): DocumentSnapshot {
    this.version += 1;
    const { w, h } = this.stack.getSize();
    return {
      version: this.version,
      id: this.id,
      name: this.name,
      w,
      h,
      frameCount: 1 + this.extraFrames.length,
      saveState: this.saveState,
      lastError: this.lastError,
      hasExtraFrames: this.extraFrames.length > 0,
    };
  }
}
