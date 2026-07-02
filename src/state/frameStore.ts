/**
 * src/state/frameStore.ts — the stateful, undoable animation-frame controller (U-008).
 *
 * Owns the mutable ordered frame list (index 0 = first), the active frame id, the
 * active (aligned) layer id, the global FPS, and playback/onion configuration, plus
 * an undo/redo {@link History}. The pure algebra lives in `src/core/frames.ts`
 * (immutable ops) and `src/core/buffer.ts` (`composite`); this layer holds the
 * mutable pointers and wires every structural op to ONE reversible history entry, so
 * add / duplicate / delete / reorder frames, per-frame duration, and add-layer-to-all-
 * frames are all undoable (master-spec §3.5/§3.6, ADR-005, ADR-014).
 *
 * Layers are consistent across frames (§3.5): the active layer id refers to the same
 * aligned layer in every frame; `addLayer` inserts it into all frames at once.
 *
 * Undo model (mirrors {@link LayerStack}, ADR-015):
 *   - Structural ops record a lightweight STATE snapshot {frames, activeFrameId,
 *     activeLayerId}. Frames/layers are immutable, so a snapshot shares pixel buffers
 *     by reference and costs O(#frames·#layers), never O(#pixels).
 *   - A pixel edit on the active frame's active layer records a dirty-rect {@link Patch}
 *     (U-006), copy-on-write at `beginStroke` so in-place stroke writes never corrupt a
 *     buffer still referenced by an older snapshot.
 *
 * Perf (§6): composited frames are cached in a `WeakMap<Frame, PixelBuffer>` keyed by
 * frame identity. Because frames are immutable, an unchanged frame (an onion ghost)
 * reuses its cached composite; only edited frames recomposite. The active frame is
 * recomposited live during a stroke via {@link getActiveComposite}.
 *
 * No DOM dependency — the panel supplies paint coordinates and drives playback via a
 * rAF hook. It is the single source of change notifications (subscribe/getSnapshot)
 * so React can bind via `useSyncExternalStore`.
 */
import { cloneBuffer, composite, setPixelMut } from '../core/buffer';
import {
  addLayerToAllFrames,
  blankFrame,
  canDeleteFrame,
  clampFps,
  deleteFrame as coreDeleteFrame,
  duplicateFrame as coreDuplicateFrame,
  moveFrame as coreMoveFrame,
  setFrameDuration as coreSetDuration,
  DEFAULT_FPS,
  makeFrame,
} from '../core/frames';
import {
  applyPatch,
  makePatch,
  type Patch,
  type PatchDirection,
  patchByteSize,
  pixelRect,
} from '../core/history';
import { blankLayer } from '../core/layers';
import { unionRect } from '../core/rect';
import type { Frame, Layer, PixelBuffer, Rect, RGBA } from '../core/types';
import { History, type HistorySnapshot } from './historyStore';

/** Onion-skin display configuration (not undoable — a view preference). */
export interface OnionConfig {
  readonly enabled: boolean;
  readonly before: number;
  readonly after: number;
  /** Nearest-ghost opacity (0..1); farther ghosts fall off from here. */
  readonly opacity: number;
}

export const DEFAULT_ONION: OnionConfig = { enabled: true, before: 1, after: 1, opacity: 0.5 };

/** A readonly snapshot for React binding (stable identity between changes). */
export interface FrameSnapshot {
  /** Bumps on every change so consumers re-render even on in-place pixel edits. */
  readonly version: number;
  readonly frames: readonly Frame[];
  readonly activeFrameId: string;
  readonly activeIndex: number;
  readonly frameCount: number;
  readonly activeLayerId: string;
  readonly layerCount: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly pingPong: boolean;
  readonly onion: OnionConfig;
  /** Whether a frame can be deleted (never the last one). */
  readonly canDeleteFrame: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export interface FrameStackOptions {
  /** Seed frames. Defaults to a single blank frame with one blank layer. */
  readonly initial?: {
    readonly frames: Frame[];
    readonly activeFrameId?: string;
    readonly activeLayerId?: string;
    readonly fps?: number;
  };
  /** Notified after any change (in addition to `subscribe` listeners). */
  readonly onChange?: () => void;
}

interface StackState {
  readonly frames: Frame[];
  readonly activeFrameId: string;
  readonly activeLayerId: string;
}

interface Stroke {
  readonly frameId: string;
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
 * The interactive frame-stack controller. Construct with a canvas size (and optional
 * seed frames); drive it with the frame/layer ops, per-frame painting, and playback.
 */
export class FrameStack {
  private frames: Frame[];
  private activeFrameId: string;
  private activeLayerId: string;
  private fps: number;
  private loop = true;
  private pingPong = false;
  private onion: OnionConfig = DEFAULT_ONION;
  private readonly w: number;
  private readonly h: number;
  private readonly history: History;
  private readonly onChangeCb: () => void;
  private readonly listeners = new Set<() => void>();
  private readonly compositeCache = new WeakMap<Frame, PixelBuffer>();
  private frameSeq = 0;
  private layerSeq = 0;
  private version = 0;
  private stroke: Stroke | null = null;
  private snap: FrameSnapshot;

  constructor(w: number, h: number, options: FrameStackOptions = {}) {
    this.w = Math.max(1, Math.trunc(w));
    this.h = Math.max(1, Math.trunc(h));
    this.onChangeCb = options.onChange ?? (() => {});
    this.history = new History({ onChange: () => this.emit() });
    this.fps = clampFps(options.initial?.fps ?? DEFAULT_FPS);
    if (options.initial && options.initial.frames.length > 0) {
      this.frames = options.initial.frames.slice();
      this.seedSequences(this.frames);
      this.activeFrameId = options.initial.activeFrameId ?? this.frames[0].id;
      if (this.frameIndexOf(this.activeFrameId) < 0) {
        this.activeFrameId = this.frames[0].id;
      }
      this.activeLayerId = options.initial.activeLayerId ?? this.firstLayerId();
      if (!this.layerExists(this.activeLayerId)) {
        this.activeLayerId = this.firstLayerId();
      }
    } else {
      const first = blankFrame(this.nextFrameId(), this.w, this.h, this.nextLayerId());
      this.frames = [first];
      this.activeFrameId = first.id;
      this.activeLayerId = first.layers[0].id;
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

  getSnapshot = (): FrameSnapshot => this.snap;

  // ── readonly accessors ─────────────────────────────────────────────────────

  getFrames(): readonly Frame[] {
    return this.frames;
  }

  getActiveFrameId(): string {
    return this.activeFrameId;
  }

  getActiveIndex(): number {
    return this.frameIndexOf(this.activeFrameId);
  }

  getActiveFrame(): Frame | null {
    const i = this.getActiveIndex();
    return i < 0 ? null : this.frames[i];
  }

  getActiveLayerId(): string {
    return this.activeLayerId;
  }

  getFps(): number {
    return this.fps;
  }

  getOnion(): OnionConfig {
    return this.onion;
  }

  getSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  historySnapshot(): HistorySnapshot {
    return this.history.snapshot();
  }

  /**
   * The composited pixels of `frame` (a fresh buffer). Cached by frame identity: an
   * unchanged frame (e.g. an onion ghost) reuses its cache entry; only edited frames
   * recomposite (§6 perf). The active frame is bypassed while a stroke is in flight
   * because its buffer is mutating in place.
   */
  getFrameComposite(frame: Frame): PixelBuffer {
    if (this.stroke && frame.id === this.stroke.frameId) {
      return composite(frame.layers.slice());
    }
    const cached = this.compositeCache.get(frame);
    if (cached) {
      return cached;
    }
    const out = composite(frame.layers.slice());
    this.compositeCache.set(frame, out);
    return out;
  }

  /** The active frame's live composite (always fresh — reflects an in-flight stroke). */
  getActiveComposite(): PixelBuffer {
    const frame = this.getActiveFrame();
    return frame ? composite(frame.layers.slice()) : composite([]);
  }

  // ── playback / onion config (not undoable) ─────────────────────────────────

  setFps(fps: number): void {
    const next = clampFps(fps);
    if (next !== this.fps) {
      this.fps = next;
      this.emit();
    }
  }

  setLoop(loop: boolean): void {
    if (loop !== this.loop) {
      this.loop = loop;
      this.emit();
    }
  }

  setPingPong(pingPong: boolean): void {
    if (pingPong !== this.pingPong) {
      this.pingPong = pingPong;
      this.emit();
    }
  }

  setOnion(patch: Partial<OnionConfig>): void {
    this.onion = { ...this.onion, ...patch };
    this.emit();
  }

  toggleOnion(): void {
    this.setOnion({ enabled: !this.onion.enabled });
  }

  // ── active frame / layer selection (not undoable) ──────────────────────────

  setActiveFrame(id: string): void {
    if (id === this.activeFrameId || this.frameIndexOf(id) < 0) {
      return;
    }
    this.activeFrameId = id;
    this.emit();
  }

  setActiveFrameIndex(index: number): void {
    if (index >= 0 && index < this.frames.length) {
      this.setActiveFrame(this.frames[index].id);
    }
  }

  setActiveLayer(id: string): void {
    if (id === this.activeLayerId || !this.layerExists(id)) {
      return;
    }
    this.activeLayerId = id;
    this.emit();
  }

  // ── undo / redo ─────────────────────────────────────────────────────────────

  undo(): boolean {
    return this.history.undo();
  }

  redo(): boolean {
    return this.history.redo();
  }

  // ── frame structural ops (each = one undo entry) ───────────────────────────

  /** Add a fresh BLANK frame (aligned to the current layer set) after the active
   * frame; it becomes active. New frame layers mirror the aligned ids/metadata but
   * carry fresh transparent buffers. */
  addFrame(): void {
    const active = this.getActiveFrame();
    const layers: Layer[] = active
      ? active.layers.map((l) => ({
          ...l,
          buffer: blankLayer(l.id, l.name, this.w, this.h).buffer,
        }))
      : [blankLayer(this.nextLayerId(), 'Layer 1', this.w, this.h)];
    const frame = makeFrame(this.nextFrameId(), layers, active?.durationMs);
    const at = this.getActiveIndex() + 1;
    const frames = [...this.frames.slice(0, at), frame, ...this.frames.slice(at)];
    this.commit('Add frame', this.state(frames, frame.id), this.frameBytes());
  }

  /** Duplicate the active frame (deep-copying pixels); the copy lands after it and
   * becomes active. */
  duplicateFrame(index: number = this.getActiveIndex()): void {
    if (!this.frameInRange(index)) {
      return;
    }
    const newId = this.nextFrameId();
    const frames = coreDuplicateFrame(this.frames, index, newId);
    this.commit('Duplicate frame', this.state(frames, newId), this.frameBytes());
  }

  /** Delete the active (or given) frame. Refuses the last remaining frame. Returns
   * whether anything was deleted. */
  deleteFrame(index: number = this.getActiveIndex()): boolean {
    if (!canDeleteFrame(this.frames) || !this.frameInRange(index)) {
      return false;
    }
    const removedBytes = this.frames[index].layers.reduce((n, l) => n + l.buffer.data.length, 0);
    const frames = coreDeleteFrame(this.frames, index);
    const newActive = frames[Math.min(index, frames.length - 1)].id;
    this.commit('Delete frame', this.state(frames, newActive), removedBytes);
    return true;
  }

  /** Reorder: move the frame at `from` to `to`. */
  moveFrame(from: number, to: number): void {
    if (from === to || !this.frameInRange(from)) {
      return;
    }
    this.commit(
      'Reorder frames',
      this.state(coreMoveFrame(this.frames, from, to), this.activeFrameId),
    );
  }

  /** Move the active frame later (+1) or earlier (-1) in the timeline. */
  moveActiveFrame(direction: 1 | -1): void {
    const from = this.getActiveIndex();
    const to = from + direction;
    if (to >= 0 && to < this.frames.length) {
      this.moveFrame(from, to);
    }
  }

  /** Set a frame's duration (ms). Consecutive edits on the same frame (a slider
   * drag / stepper hold) coalesce into one undo entry. */
  setFrameDuration(index: number, durationMs: number): void {
    if (!this.frameInRange(index)) {
      return;
    }
    const frames = coreSetDuration(this.frames, index, durationMs);
    this.commit(
      'Frame duration',
      this.state(frames, this.activeFrameId),
      0,
      `duration:${this.frames[index].id}`,
    );
  }

  // ── layer op that stays aligned across frames (§3.5) ───────────────────────

  /** Add a fresh transparent layer to EVERY frame (aligned id/metadata), above the
   * active layer; it becomes the active layer. Held-out criterion 1. */
  addLayer(name?: string): void {
    const id = this.nextLayerId();
    const layerName = name ?? `Layer ${this.layerSeq}`;
    const at = this.activeLayerIndex() + 1;
    const frames = addLayerToAllFrames(this.frames, at, id, layerName, { w: this.w, h: this.h });
    const prev: StackState = this.currentState();
    const next: StackState = { frames, activeFrameId: this.activeFrameId, activeLayerId: id };
    this.applyState(next);
    this.history.record({
      label: 'Add layer (all frames)',
      bytes: 256 + this.frameBytes(),
      undo: () => this.applyState(prev),
      redo: () => this.applyState(next),
    });
  }

  // ── per-frame pixel editing on the active layer (dirty-rect patch) ──────────

  /** Begin a stroke on the active frame's active layer (copy-on-write). No-op on a
   * locked/missing active layer. */
  beginStroke(): void {
    const frame = this.getActiveFrame();
    const li = this.activeLayerIndex();
    const layer = frame && li >= 0 ? frame.layers[li] : null;
    if (!frame || !layer || layer.locked) {
      this.stroke = null;
      return;
    }
    const before = layer.buffer;
    const working = cloneBuffer(before);
    const frames = this.frames.map((f) =>
      f.id === frame.id
        ? { ...f, layers: f.layers.map((l, i) => (i === li ? { ...l, buffer: working } : l)) }
        : f,
    );
    this.frames = frames;
    this.stroke = { frameId: frame.id, layerId: layer.id, before, dirty: null };
    this.emit();
  }

  /** Paint one pixel (or transparent to erase) on the active frame's active layer. */
  paint(x: number, y: number, color: RGBA): void {
    const stroke = this.stroke;
    if (!stroke) {
      return;
    }
    const buffer = this.layerBufferOf(stroke.frameId, stroke.layerId);
    if (buffer && setPixelMut(buffer, x, y, color)) {
      stroke.dirty = accumulate(stroke.dirty, pixelRect(x, y));
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
    const after = this.layerBufferOf(stroke.frameId, stroke.layerId);
    if (!after) {
      return;
    }
    const patch = makePatch(stroke.layerId, stroke.frameId, stroke.before, after);
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

  /** Convenience: paint a single committed pixel as one edit. */
  stampPixel(x: number, y: number, color: RGBA, label = 'Paint'): void {
    this.beginStroke();
    this.paint(x, y, color);
    this.endStroke(label);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private applyPixelPatch(patch: Patch, dir: PatchDirection): void {
    const buffer = this.layerBufferOf(patch.frameId, patch.layerId);
    if (!buffer) {
      return;
    }
    const next = applyPatch(buffer, patch, dir);
    this.frames = this.frames.map((f) =>
      f.id === patch.frameId
        ? {
            ...f,
            layers: f.layers.map((l) => (l.id === patch.layerId ? { ...l, buffer: next } : l)),
          }
        : f,
    );
    // History.onChange drives the single emit after this returns.
  }

  private commit(label: string, next: StackState, createdBytes = 0, coalesceKey?: string): void {
    const prev = this.currentState();
    this.applyState(next);
    this.history.record({
      label,
      bytes: 256 + createdBytes,
      coalesceKey,
      undo: () => this.applyState(prev),
      redo: () => this.applyState(next),
    });
  }

  private currentState(): StackState {
    return {
      frames: this.frames,
      activeFrameId: this.activeFrameId,
      activeLayerId: this.activeLayerId,
    };
  }

  private state(frames: Frame[], activeFrameId: string): StackState {
    return { frames, activeFrameId, activeLayerId: this.activeLayerId };
  }

  /** Set the live pointers (no notification — the caller/History drives `emit`). */
  private applyState(state: StackState): void {
    this.frames = state.frames;
    this.activeFrameId =
      this.frameIndexOf(state.activeFrameId) >= 0
        ? state.activeFrameId
        : (this.frames[0]?.id ?? '');
    this.activeLayerId = this.layerExists(state.activeLayerId)
      ? state.activeLayerId
      : this.firstLayerId();
  }

  private emit(): void {
    this.snap = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
    this.onChangeCb();
  }

  private buildSnapshot(): FrameSnapshot {
    this.version += 1;
    const h = this.history.snapshot();
    const active = this.getActiveFrame();
    return {
      version: this.version,
      frames: this.frames,
      activeFrameId: this.activeFrameId,
      activeIndex: this.getActiveIndex(),
      frameCount: this.frames.length,
      activeLayerId: this.activeLayerId,
      layerCount: active?.layers.length ?? 0,
      fps: this.fps,
      loop: this.loop,
      pingPong: this.pingPong,
      onion: this.onion,
      canDeleteFrame: canDeleteFrame(this.frames),
      canUndo: h.canUndo,
      canRedo: h.canRedo,
      undoLabel: h.undoLabel,
      redoLabel: h.redoLabel,
    };
  }

  private frameIndexOf(id: string): number {
    return this.frames.findIndex((f) => f.id === id);
  }

  private frameInRange(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.frames.length;
  }

  private activeLayerIndex(): number {
    const frame = this.getActiveFrame();
    return frame ? frame.layers.findIndex((l) => l.id === this.activeLayerId) : -1;
  }

  private firstLayerId(): string {
    return this.frames[0]?.layers[0]?.id ?? '';
  }

  private layerExists(id: string): boolean {
    return this.frames.some((f) => f.layers.some((l) => l.id === id));
  }

  private layerBufferOf(frameId: string, layerId: string): PixelBuffer | null {
    const frame = this.frames.find((f) => f.id === frameId);
    const layer = frame?.layers.find((l) => l.id === layerId);
    return layer?.buffer ?? null;
  }

  private frameBytes(): number {
    return this.w * this.h * 4;
  }

  private nextFrameId(): string {
    this.frameSeq += 1;
    return `frame-${this.frameSeq}`;
  }

  private nextLayerId(): string {
    this.layerSeq += 1;
    return `layer-${this.layerSeq}`;
  }

  /** Advance id/name counters past any seeded frames/layers so generated ids stay
   * unique across the aligned layer set. */
  private seedSequences(frames: readonly Frame[]): void {
    for (const frame of frames) {
      const fm = /^frame-(\d+)$/.exec(frame.id);
      if (fm) {
        this.frameSeq = Math.max(this.frameSeq, Number(fm[1]));
      }
      for (const layer of frame.layers) {
        const lm = /^layer-(\d+)$/.exec(layer.id);
        if (lm) {
          this.layerSeq = Math.max(this.layerSeq, Number(lm[1]));
        }
      }
    }
  }
}

/** Convenience: build a frame from existing layers (panel motifs, imports). */
export function frameFromLayers(id: string, layers: Layer[], durationMs?: number): Frame {
  return makeFrame(id, layers, durationMs);
}
