/**
 * src/state/layerStore.ts — the stateful, undoable layer-stack controller (U-007).
 *
 * Owns the mutable ordered layer stack for a single frame (index 0 = bottom), the
 * active-layer id, and an undo/redo {@link History}. The pure algebra lives in
 * `src/core/layers.ts` (immutable ops) and `src/core/buffer.ts` (`composite`); this
 * layer only holds the mutable pointers and wires every op to ONE reversible
 * history entry, so add / duplicate / delete / rename / lock / visibility / opacity
 * / reorder / merge-down / flatten are all undoable (master-spec §3.4/§3.6, ADR-005).
 *
 * Undo model:
 *   - Structural + metadata ops record a lightweight STATE snapshot ({layers,
 *     activeId}). Layer objects/arrays are immutable, so a snapshot shares pixel
 *     buffers by reference and costs O(#layers), never O(#pixels).
 *   - A pixel edit on the active layer records a dirty-rect {@link Patch} (U-006):
 *     `beginStroke` clones the active layer's buffer copy-on-write so mutating it in
 *     place during the stroke can NEVER corrupt a buffer still referenced by an
 *     older history snapshot; `endStroke` diffs and records only the dirty rect.
 *
 * No DOM dependency — the panel supplies the paint coordinates/colors and renders
 * the {@link getComposite} result. It is the single source of change notifications
 * (subscribe/getSnapshot) so React can bind via `useSyncExternalStore`.
 */
import { cloneBuffer, composite, setPixelMut } from '../core/buffer';
import {
  applyPatch,
  makePatch,
  type Patch,
  type PatchDirection,
  patchByteSize,
  pixelRect,
} from '../core/history';
import {
  blankLayer,
  canDeleteLayer,
  deleteLayer as coreDelete,
  duplicateLayer as coreDuplicate,
  flatten as coreFlatten,
  mergeDown as coreMergeDown,
  moveLayer as coreMove,
  setBlend as coreSetBlend,
  setLocked as coreSetLocked,
  setName as coreSetName,
  setOpacity as coreSetOpacity,
  setVisible as coreSetVisible,
  insertLayer,
} from '../core/layers';
import { unionRect } from '../core/rect';
import type { BlendMode, Layer, PixelBuffer, Rect, RGBA } from '../core/types';
import { History, type HistorySnapshot, PREVIEW_FRAME_ID } from './historyStore';

/** A readonly snapshot for React binding (stable identity between changes). */
export interface LayerSnapshot {
  /** Bumps on every change so consumers re-render even on in-place pixel edits. */
  readonly version: number;
  readonly layers: readonly Layer[];
  readonly activeId: string;
  readonly activeIndex: number;
  /** Whether the active layer may be deleted — never the last one, and never a
   * locked layer (its artwork is protected; data-safety). */
  readonly canDelete: boolean;
  /** Whether the active layer has a layer beneath it to merge onto, and neither it
   * nor that layer is locked. */
  readonly canMergeDown: boolean;
  /** Whether there is more than one layer to flatten and no layer is locked. */
  readonly canFlatten: boolean;
  /** Whether the active layer is locked (rejects pixel edits and destructive ops). */
  readonly activeLocked: boolean;
  /** Whether any layer in the stack is locked (blocks flatten-all). */
  readonly anyLocked: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export interface LayerStackOptions {
  /** Seed layers (bottom→top). Defaults to a single blank layer of the given size. */
  readonly initial?: { readonly layers: Layer[]; readonly activeId?: string };
  /** Notified after any change (in addition to `subscribe` listeners). */
  readonly onChange?: () => void;
}

interface StackState {
  readonly layers: Layer[];
  readonly activeId: string;
}

interface Stroke {
  readonly layerId: string;
  /** The committed buffer BEFORE the stroke (kept unmutated for the diff). */
  readonly before: PixelBuffer;
  dirty: Rect | null;
}

function accumulate(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return unionRect(a, b);
}

/**
 * The interactive layer-stack controller. Construct with a canvas size (and
 * optional seed layers); drive it with the management ops and pixel strokes.
 */
export class LayerStack {
  private layers: Layer[];
  private activeId: string;
  private readonly w: number;
  private readonly h: number;
  private readonly history: History;
  private readonly onChangeCb: () => void;
  private readonly listeners = new Set<() => void>();
  private idSeq = 0;
  private nameSeq = 0;
  private version = 0;
  private stroke: Stroke | null = null;
  private snap: LayerSnapshot;

  constructor(w: number, h: number, options: LayerStackOptions = {}) {
    this.w = Math.max(1, Math.trunc(w));
    this.h = Math.max(1, Math.trunc(h));
    this.onChangeCb = options.onChange ?? (() => {});
    this.history = new History({ onChange: () => this.emit() });
    if (options.initial && options.initial.layers.length > 0) {
      this.layers = options.initial.layers.slice();
      this.seedSequences(this.layers);
      this.activeId = options.initial.activeId ?? this.layers[this.layers.length - 1].id;
      if (this.indexOf(this.activeId) < 0) {
        this.activeId = this.layers[this.layers.length - 1].id;
      }
    } else {
      const first = blankLayer(this.nextId(), this.nextName(), this.w, this.h);
      this.layers = [first];
      this.activeId = first.id;
    }
    this.snap = this.buildSnapshot();
  }

  // ── subscription surface (useSyncExternalStore) ────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LayerSnapshot => this.snap;

  // ── readonly accessors ─────────────────────────────────────────────────────

  getLayers(): readonly Layer[] {
    return this.layers;
  }

  getActiveId(): string {
    return this.activeId;
  }

  getActiveIndex(): number {
    return this.indexOf(this.activeId);
  }

  getActiveLayer(): Layer | null {
    const i = this.getActiveIndex();
    return i < 0 ? null : this.layers[i];
  }

  getSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  /** The current flattened composite of the whole stack (a fresh buffer). */
  getComposite(): PixelBuffer {
    return composite(this.layers);
  }

  historySnapshot(): HistorySnapshot {
    return this.history.snapshot();
  }

  // ── selection (not undoable) ───────────────────────────────────────────────

  setActive(id: string): void {
    if (id === this.activeId || this.indexOf(id) < 0) {
      return;
    }
    this.activeId = id;
    this.emit();
  }

  setActiveIndex(index: number): void {
    if (index >= 0 && index < this.layers.length) {
      this.setActive(this.layers[index].id);
    }
  }

  // ── undo / redo ─────────────────────────────────────────────────────────────

  undo(): boolean {
    return this.history.undo();
  }

  redo(): boolean {
    return this.history.redo();
  }

  // ── structural + metadata ops (each = one undo entry) ──────────────────────

  /** Add a fresh transparent layer directly above the active layer; it becomes
   * active. */
  addLayer(name?: string): void {
    const at = this.getActiveIndex() + 1;
    const layer = blankLayer(this.nextId(), name ?? this.nextName(), this.w, this.h);
    this.commit(
      'Add layer',
      { layers: insertLayer(this.layers, at, layer), activeId: layer.id },
      this.bufferBytes(),
    );
  }

  /** Duplicate the given (or active) layer; the copy lands above it and becomes
   * active. */
  duplicateLayer(index: number = this.getActiveIndex()): void {
    if (!this.inRange(index)) {
      return;
    }
    const newId = this.nextId();
    const next = coreDuplicate(this.layers, index, newId);
    this.commit('Duplicate layer', { layers: next, activeId: newId }, this.bufferBytes());
  }

  /** Delete the given (or active) layer. Refuses to remove the last remaining
   * layer OR a locked layer (a lock protects its artwork from destruction;
   * data-safety). Returns whether anything was deleted. */
  deleteLayer(index: number = this.getActiveIndex()): boolean {
    if (!canDeleteLayer(this.layers) || !this.inRange(index) || this.layers[index].locked) {
      return false;
    }
    const removedBytes = this.layers[index].buffer.data.length;
    const next = coreDelete(this.layers, index);
    const newActive = next[Math.min(index, next.length - 1)].id;
    this.commit('Delete layer', { layers: next, activeId: newActive }, removedBytes);
    return true;
  }

  /** Rename a layer. Consecutive renames of the same layer coalesce into one
   * undo entry (so typing a name is a single step). */
  renameLayer(index: number, name: string): void {
    if (!this.inRange(index)) {
      return;
    }
    this.commit(
      'Rename layer',
      { layers: coreSetName(this.layers, index, name), activeId: this.activeId },
      0,
      `rename:${this.layers[index].id}`,
    );
  }

  setVisible(index: number, visible: boolean): void {
    if (!this.inRange(index)) {
      return;
    }
    this.commit(visible ? 'Show layer' : 'Hide layer', {
      layers: coreSetVisible(this.layers, index, visible),
      activeId: this.activeId,
    });
  }

  toggleVisible(index: number): void {
    if (this.inRange(index)) {
      this.setVisible(index, !this.layers[index].visible);
    }
  }

  setLocked(index: number, locked: boolean): void {
    if (!this.inRange(index)) {
      return;
    }
    this.commit(locked ? 'Lock layer' : 'Unlock layer', {
      layers: coreSetLocked(this.layers, index, locked),
      activeId: this.activeId,
    });
  }

  toggleLocked(index: number): void {
    if (this.inRange(index)) {
      this.setLocked(index, !this.layers[index].locked);
    }
  }

  /** Set a layer's opacity (0..100). Consecutive opacity edits on the same layer
   * (a slider drag) coalesce into one undo entry. */
  setOpacity(index: number, opacity: number): void {
    if (!this.inRange(index)) {
      return;
    }
    this.commit(
      'Layer opacity',
      { layers: coreSetOpacity(this.layers, index, opacity), activeId: this.activeId },
      0,
      `opacity:${this.layers[index].id}`,
    );
  }

  setBlend(index: number, blend: BlendMode): void {
    if (!this.inRange(index)) {
      return;
    }
    this.commit('Blend mode', {
      layers: coreSetBlend(this.layers, index, blend),
      activeId: this.activeId,
    });
  }

  /** Reorder: move the layer at `from` to `to` (stack indices; 0 = bottom). */
  moveLayer(from: number, to: number): void {
    if (from === to || !this.inRange(from)) {
      return;
    }
    this.commit('Reorder layers', {
      layers: coreMove(this.layers, from, to),
      activeId: this.activeId,
    });
  }

  /** Move the active layer up (+1, toward the top) or down (-1). */
  moveActive(direction: 1 | -1): void {
    const from = this.getActiveIndex();
    const to = from + direction;
    if (to >= 0 && to < this.layers.length) {
      this.moveLayer(from, to);
    }
  }

  /** Merge the given (or active) layer down onto the one beneath it. Returns
   * whether anything merged (false for the bottom layer, or when either the merged
   * layer or the one beneath it is locked — merging would destroy that protected
   * artwork; data-safety). */
  mergeDown(index: number = this.getActiveIndex()): boolean {
    if (!this.inRange(index) || index < 1) {
      return false;
    }
    if (this.layers[index].locked || this.layers[index - 1].locked) {
      return false;
    }
    const keepId = this.layers[index - 1].id;
    this.commit(
      'Merge down',
      { layers: coreMergeDown(this.layers, index), activeId: keepId },
      this.bufferBytes(),
    );
    return true;
  }

  /** Flatten the whole stack into one layer. Returns whether anything changed
   * (false when there is 0/1 layer, or when any layer is locked — flattening would
   * collapse the protected layer away; data-safety). */
  flatten(): boolean {
    if (this.layers.length <= 1 || this.layers.some((l) => l.locked)) {
      return false;
    }
    const next = coreFlatten(this.layers);
    this.commit('Flatten image', { layers: next, activeId: next[0].id }, this.bufferBytes());
    return true;
  }

  // ── pixel editing on the active layer (dirty-rect patch) ───────────────────

  /**
   * Begin a stroke on the active layer. Copy-on-write: the active layer's buffer
   * is replaced with a fresh clone so in-place stroke writes can never corrupt a
   * buffer still referenced by an older history snapshot. No-op on a locked or
   * missing active layer.
   */
  beginStroke(): void {
    const index = this.getActiveIndex();
    const layer = index < 0 ? null : this.layers[index];
    if (!layer || layer.locked) {
      this.stroke = null;
      return;
    }
    const before = layer.buffer;
    const working = cloneBuffer(before);
    this.layers = this.layers.map((l, i) => (i === index ? { ...l, buffer: working } : l));
    this.stroke = { layerId: layer.id, before, dirty: null };
    this.emit();
  }

  /** Paint one pixel (color, or transparent to erase) on the active layer during a
   * stroke. Writes go through the buffer module (constitution) and update live. */
  paint(x: number, y: number, color: RGBA): void {
    if (!this.stroke) {
      return;
    }
    const layer = this.getActiveLayer();
    if (!layer || layer.id !== this.stroke.layerId || layer.locked) {
      return;
    }
    if (setPixelMut(layer.buffer, x, y, color)) {
      this.stroke.dirty = accumulate(this.stroke.dirty, pixelRect(x, y));
      this.emit();
    }
  }

  /** Finish a stroke, recording the dirty-rect change as ONE undo entry. */
  endStroke(label = 'Paint'): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke?.dirty) {
      return;
    }
    const index = this.indexOf(stroke.layerId);
    if (index < 0) {
      return;
    }
    const patch = makePatch(
      stroke.layerId,
      PREVIEW_FRAME_ID,
      stroke.before,
      this.layers[index].buffer,
    );
    if (!patch) {
      return;
    }
    this.history.record({
      label,
      bytes: patchByteSize(patch),
      undo: () => this.applyPixelPatch(patch, 'undo'),
      redo: () => this.applyPixelPatch(patch, 'redo'),
    });
  }

  /** Convenience: paint a single committed pixel (begin+paint+end) as one edit. */
  stampPixel(x: number, y: number, color: RGBA, label = 'Paint'): void {
    this.beginStroke();
    this.paint(x, y, color);
    this.endStroke(label);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private applyPixelPatch(patch: Patch, dir: PatchDirection): void {
    const index = this.indexOf(patch.layerId);
    if (index < 0) {
      return;
    }
    const nextBuffer = applyPatch(this.layers[index].buffer, patch, dir);
    this.layers = this.layers.map((l, i) => (i === index ? { ...l, buffer: nextBuffer } : l));
    // History.onChange fires after this returns and drives the single emit.
  }

  private commit(label: string, next: StackState, createdBytes = 0, coalesceKey?: string): void {
    const prev: StackState = { layers: this.layers, activeId: this.activeId };
    this.apply(next);
    this.history.record({
      label,
      bytes: 256 + createdBytes,
      coalesceKey,
      undo: () => this.apply(prev),
      redo: () => this.apply(next),
    });
  }

  /** Set the live pointers (no notification — the caller/History drives `emit`). */
  private apply(state: StackState): void {
    this.layers = state.layers;
    this.activeId =
      this.indexOf(state.activeId) >= 0 ? state.activeId : this.fallbackActive(state.layers);
  }

  private fallbackActive(layers: readonly Layer[]): string {
    return layers.length > 0 ? layers[layers.length - 1].id : '';
  }

  private emit(): void {
    this.snap = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
    this.onChangeCb();
  }

  private buildSnapshot(): LayerSnapshot {
    this.version += 1;
    const activeIndex = this.getActiveIndex();
    const h = this.history.snapshot();
    const activeLocked = activeIndex >= 0 ? this.layers[activeIndex].locked : false;
    const belowLocked = activeIndex >= 1 ? this.layers[activeIndex - 1].locked : false;
    const anyLocked = this.layers.some((l) => l.locked);
    return {
      version: this.version,
      layers: this.layers,
      activeId: this.activeId,
      activeIndex,
      // Fold lock state into the capability flags so the panel's buttons disable in
      // lockstep with the store's guards above (single source of truth).
      canDelete: canDeleteLayer(this.layers) && !activeLocked,
      canMergeDown: activeIndex >= 1 && !activeLocked && !belowLocked,
      canFlatten: this.layers.length > 1 && !anyLocked,
      activeLocked,
      anyLocked,
      canUndo: h.canUndo,
      canRedo: h.canRedo,
      undoLabel: h.undoLabel,
      redoLabel: h.redoLabel,
    };
  }

  private indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  private inRange(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.layers.length;
  }

  private bufferBytes(): number {
    return this.w * this.h * 4;
  }

  private nextId(): string {
    this.idSeq += 1;
    return `layer-${this.idSeq}`;
  }

  private nextName(): string {
    this.nameSeq += 1;
    return `Layer ${this.nameSeq}`;
  }

  /** Advance the id/name counters past any seeded layers so generated ids stay
   * unique and generated names don't collide with the seed. */
  private seedSequences(layers: readonly Layer[]): void {
    for (const layer of layers) {
      const idMatch = /^layer-(\d+)$/.exec(layer.id);
      if (idMatch) {
        this.idSeq = Math.max(this.idSeq, Number(idMatch[1]));
      }
      const nameMatch = /^Layer (\d+)$/.exec(layer.name);
      if (nameMatch) {
        this.nameSeq = Math.max(this.nameSeq, Number(nameMatch[1]));
      }
    }
  }
}

/** Convenience: seed a layer from an existing buffer (panel motifs, imports). */
export function layerFromBuffer(id: string, name: string, buffer: PixelBuffer): Layer {
  return {
    id,
    name,
    visible: true,
    locked: false,
    opacity: 100,
    blend: 'normal',
    buffer,
  };
}
