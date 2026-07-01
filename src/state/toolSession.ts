/**
 * src/state/toolSession.ts — the interactive drawing-tool controller (U-004).
 *
 * Bridges pointer gestures (already mapped to integer art coordinates) to the
 * pure engine tools in `src/core`. It owns the transient per-gesture state so a
 * whole drag resolves to ONE logical edit (ready for U-006 history), applies the
 * global modifiers (brush size, mirror, pixel-perfect, dither, fill tolerance)
 * and the active selection mask, and pushes dirty-rect updates to a minimal
 * {@link RenderTarget}. It has no DOM dependency — the UI supplies a real
 * `PixelRenderer` as the target and the mapped coordinates.
 */
import {
  blitOverInto,
  clearRegionWhere,
  cloneBuffer,
  copyRegion,
  copyRegionWhere,
  drawEllipseInto,
  drawLineInto,
  drawRectInto,
  extractRegion,
  floodFillInto,
} from '../core/buffer';
import { applyPatch, makePatch, type Patch } from '../core/history';
import { type Point2, snapLineEndpoint } from '../core/path';
import { clampRect, isEmptyRect, makeRect, rectFromPoints, unionRect } from '../core/rect';
import {
  addRect,
  createSelection,
  isSelectionEmpty,
  selectAll,
  selectionContains,
  selectRect,
  subtractRect,
} from '../core/selection';
import {
  type MirrorConfig,
  NO_MIRROR,
  type PaintStyle,
  paintStroke,
  sampleColor,
  translateBuffer,
} from '../core/tools';
import type { PixelBuffer, Rect, RGBA, Selection } from '../core/types';
import { type HistorySink, PREVIEW_FRAME_ID, PREVIEW_LAYER_ID, patchEntry } from './historyStore';

/** The ten tools of the belt (master-spec §3.2). */
export type ToolId =
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'eyedropper'
  | 'select'
  | 'move'
  | 'hand';

/** Pointer modifier keys relevant to the tools. */
export interface PointerMods {
  shift?: boolean;
  alt?: boolean;
}

/** The full global tool configuration (the eventual Zustand "tool store"). */
export interface ToolState {
  tool: ToolId;
  fg: RGBA;
  bg: RGBA;
  brushSize: number;
  mirror: MirrorConfig;
  pixelPerfect: boolean;
  dither: boolean;
  tolerance: number;
  contiguous: boolean;
  rectFilled: boolean;
  ellipseFilled: boolean;
}

/** The minimal surface of the render pipeline the session drives. */
export interface RenderTarget {
  updateRegion(buf: PixelBuffer, rect: Rect): void;
  setComposite(buf: PixelBuffer): void;
  setSelectionOverlay?(rect: Rect | null): void;
}

const TRANSPARENT: RGBA = [0, 0, 0, 0];

const DEFAULT_STATE: ToolState = {
  tool: 'pencil',
  fg: [255, 106, 26, 255],
  bg: [18, 16, 14, 255],
  brushSize: 1,
  mirror: { ...NO_MIRROR },
  pixelPerfect: false,
  dither: false,
  tolerance: 0,
  contiguous: true,
  rectFilled: false,
  ellipseFilled: false,
};

type Gesture =
  | { kind: 'none' }
  | { kind: 'freehand'; color: RGBA; base: PixelBuffer | null; path: Point2[]; dirty: Rect | null }
  | {
      kind: 'shape';
      tool: 'line' | 'rect' | 'ellipse';
      start: Point2;
      base: PixelBuffer;
      last: Rect | null;
    }
  | { kind: 'select'; start: Point2; mode: 'replace' | 'add' | 'subtract' }
  | { kind: 'move'; start: Point2; base: PixelBuffer }
  | { kind: 'floatMove'; grab: Point2; origin: Point2 };

/**
 * The clipboard payload: a detached copy of the selection's pixels (mask shape
 * preserved as transparency) plus the origin it was cut/copied from, so paste can
 * land the floating selection back in place.
 */
interface Clip {
  pixels: PixelBuffer;
  x: number;
  y: number;
}

/**
 * A floating selection: pixels lifted off the layer (paste or Move-lift) shown
 * composited over `base` at (x,y) until committed. `base` is the layer WITHOUT
 * the floating pixels, so the float can be repositioned non-destructively; the
 * live working buffer is always `base` blitted with `pixels` at the current (x,y).
 */
interface Floating {
  pixels: PixelBuffer;
  base: PixelBuffer;
  x: number;
  y: number;
}

/** A point-reflection transform (used to mirror whole shapes). */
type Transform = (p: Point2) => Point2;

function accumulate(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return unionRect(a, b);
}

/** Undo-entry label for a just-finished direct-mutation gesture, or null. */
function gestureLabel(g: Gesture): string | null {
  if (g.kind === 'freehand') {
    return g.color === TRANSPARENT ? 'Erase' : 'Pencil';
  }
  if (g.kind === 'shape') {
    return g.tool === 'line' ? 'Line' : g.tool === 'rect' ? 'Rectangle' : 'Ellipse';
  }
  if (g.kind === 'move') {
    return 'Move';
  }
  return null;
}

/** The point transforms implied by the enabled mirror axes (1, 2, or 4). */
function mirrorTransforms(w: number, h: number, m: MirrorConfig): Transform[] {
  const rx: Transform = (p) => ({ x: w - 1 - p.x, y: p.y });
  const ry: Transform = (p) => ({ x: p.x, y: h - 1 - p.y });
  const transforms: Transform[] = [(p) => p];
  if (m.x) transforms.push(rx);
  if (m.y) transforms.push(ry);
  if (m.x && m.y) transforms.push((p) => ({ x: w - 1 - p.x, y: h - 1 - p.y }));
  return transforms;
}

/** Constrain a drag end to a square anchored at `start` (Shift for rect/ellipse). */
function squareEnd(start: Point2, end: Point2): Point2 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return { x: start.x + sx * size, y: start.y + sy * size };
}

/** Restore pixels of `rect` that fall OUTSIDE `selection` from `base` (clip). */
function clipToSelection(
  buf: PixelBuffer,
  base: PixelBuffer,
  rect: Rect,
  selection: Selection,
): void {
  copyRegionWhere(buf, base, rect, (x, y) => !selectionContains(selection, x, y));
}

/**
 * Interactive drawing session. Construct with a render target and the working
 * buffer; feed it pointer + keyboard gestures. Not thread-safe (single UI thread).
 */
export class ToolSession {
  private state: ToolState;
  private buffer: PixelBuffer;
  private selection: Selection | null = null;
  private gesture: Gesture = { kind: 'none' };
  private pendingSelectRect: Rect | null = null;
  private clipboard: Clip | null = null;
  private floating: Floating | null = null;
  /** Optional undo/redo sink; when null the session records no history (U-006). */
  private history: HistorySink | null = null;
  /** Committed buffer snapshot before a direct-mutation edit (freehand/shape/fill). */
  private editBase: PixelBuffer | null = null;
  /** Committed buffer snapshot before a floating selection was created (paste/lift). */
  private floatBase: PixelBuffer | null = null;
  /** Label to record when the current floating selection is committed. */
  private floatLabel = 'Paste';

  constructor(
    private readonly target: RenderTarget,
    buffer: PixelBuffer,
    initial: Partial<ToolState> = {},
    private readonly onChange: () => void = () => {},
  ) {
    this.buffer = buffer;
    this.state = { ...DEFAULT_STATE, ...initial, mirror: { ...NO_MIRROR, ...initial.mirror } };
  }

  /** A readonly snapshot of the tool configuration. */
  getState(): Readonly<ToolState> {
    return this.state;
  }

  /** The current working buffer (the source of truth for the artwork). */
  getBuffer(): PixelBuffer {
    return this.buffer;
  }

  /**
   * Attach (or detach with `null`) the undo/redo sink. Once attached, every
   * committed editing op records a single reversible entry (a drag = one entry;
   * U-006). Attaching does not retroactively record existing state.
   */
  attachHistory(history: HistorySink | null): void {
    this.history = history;
  }

  /** The active selection, or `null` when nothing is selected. */
  getSelection(): Selection | null {
    return this.selection;
  }

  /** Replace the working buffer (new canvas / resize) and drop any gesture. Does
   * NOT record history — use {@link replaceBufferWithHistory} for undoable swaps. */
  setBuffer(buffer: PixelBuffer): void {
    this.buffer = buffer;
    this.gesture = { kind: 'none' };
    this.selection = null;
    this.floating = null;
    this.editBase = null;
    this.floatBase = null;
    this.target.setComposite(buffer);
    this.target.setSelectionOverlay?.(null);
    this.onChange();
  }

  /**
   * Replace the whole layer buffer as a SINGLE undoable edit (Clear layer, fill
   * all). Requires the replacement to match the current size (a dimension change
   * is a structural resize command, handled in U-011). Falls back to
   * {@link setBuffer} when there is no history or nothing changed.
   */
  replaceBufferWithHistory(next: PixelBuffer, label: string): void {
    const prev = this.buffer;
    if (this.history && prev.w === next.w && prev.h === next.h) {
      const patch = makePatch(PREVIEW_LAYER_ID, PREVIEW_FRAME_ID, prev, next);
      if (patch) {
        this.recordPatch(patch, label);
      }
    }
    this.setBuffer(next);
  }

  /** Whether the clipboard holds pixels that can be pasted. */
  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  /** The floating (uncommitted paste/move) selection's bounds, or `null`. */
  getFloatingBounds(): Rect | null {
    if (!this.floating) {
      return null;
    }
    return makeRect(
      this.floating.x,
      this.floating.y,
      this.floating.pixels.w,
      this.floating.pixels.h,
    );
  }

  /** Patch the tool configuration (merges shallowly; mirror merges too). */
  update(patch: Partial<ToolState>): void {
    this.state = {
      ...this.state,
      ...patch,
      mirror: { ...this.state.mirror, ...patch.mirror },
    };
    this.onChange();
  }

  /** Convenience: switch the active tool. Commits a floating selection first
   * (spec: "commit on tool change") unless we are staying on Move to reposition it. */
  setTool(tool: ToolId): void {
    if (this.floating && tool !== 'move') {
      this.commitFloating();
    }
    this.update({ tool });
  }

  /** Swap foreground and background colors (X). */
  swapColors(): void {
    this.update({ fg: this.state.bg, bg: this.state.fg });
  }

  /** Select the whole canvas (Ctrl+A). */
  selectAllPixels(): void {
    this.commitFloating();
    this.selection = selectAll(this.buffer.w, this.buffer.h);
    this.target.setSelectionOverlay?.(this.selection.bounds);
    this.onChange();
  }

  /** Clear the selection (Ctrl+D / Esc). Commits any floating selection in place
   * first so pasted/moved pixels are never silently lost (data-safety). */
  clearSelection(): void {
    this.commitFloating();
    this.selection = null;
    this.target.setSelectionOverlay?.(null);
    this.onChange();
  }

  /** Copy the active selection (or floating selection) to the clipboard.
   * Returns whether anything was copied. */
  copySelection(): boolean {
    if (this.floating) {
      this.clipboard = {
        pixels: cloneBuffer(this.floating.pixels),
        x: this.floating.x,
        y: this.floating.y,
      };
      return true;
    }
    const sel = this.selection;
    if (!sel || isSelectionEmpty(sel)) {
      return false;
    }
    const b = sel.bounds;
    this.clipboard = {
      pixels: extractRegion(this.buffer, b, (x, y) => selectionContains(sel, x, y)),
      x: b.x,
      y: b.y,
    };
    return true;
  }

  /** Cut the active selection (or floating selection): copy to clipboard, then
   * remove the pixels from the layer. Returns whether anything was cut. */
  cut(): boolean {
    if (this.floating) {
      this.copySelection();
      // Committed change = the layer BEFORE the float (floatBase) → the float's
      // base (a hole for a lifted selection; unchanged for a pasted float).
      const base = this.floatBase;
      this.buffer = cloneBuffer(this.floating.base);
      this.floating = null;
      this.selection = null;
      if (this.history && base) {
        const patch = makePatch(PREVIEW_LAYER_ID, PREVIEW_FRAME_ID, base, this.buffer);
        if (patch) {
          this.recordPatch(patch, 'Cut');
        }
      }
      this.floatBase = null;
      this.target.setComposite(this.buffer);
      this.target.setSelectionOverlay?.(null);
      this.onChange();
      return true;
    }
    const sel = this.selection;
    if (!this.copySelection() || !sel) {
      return false;
    }
    this.beginEdit();
    const dirty = clearRegionWhere(this.buffer, sel.bounds, (x, y) => selectionContains(sel, x, y));
    if (dirty) {
      this.target.updateRegion(this.buffer, dirty);
    }
    this.settleEdit('Cut');
    this.selection = null;
    this.target.setSelectionOverlay?.(null);
    this.onChange();
    return true;
  }

  /** Paste the clipboard as a floating selection placed at its origin, ready to be
   * repositioned with Move (spec §3.2). Returns whether anything was pasted. */
  paste(): boolean {
    if (!this.clipboard) {
      return false;
    }
    this.commitFloating();
    this.update({ tool: 'move' });
    // Snapshot the committed layer BEFORE the paste, so committing the float later
    // records the paste as a single 'Paste' undo entry (U-006).
    this.floatBase = this.history ? cloneBuffer(this.buffer) : null;
    this.floatLabel = 'Paste';
    this.floating = {
      pixels: cloneBuffer(this.clipboard.pixels),
      base: cloneBuffer(this.buffer),
      x: this.clipboard.x,
      y: this.clipboard.y,
    };
    this.selection = null;
    this.renderFloating();
    this.onChange();
    return true;
  }

  /** Commit a floating selection in place (tool change / Enter). No-op when none. */
  commitFloatingSelection(): void {
    if (this.floating) {
      this.commitFloating();
      this.onChange();
    }
  }

  /** Begin a gesture at art pixel (x,y). */
  pointerDown(x: number, y: number, mods: PointerMods = {}): void {
    const p: Point2 = { x, y };
    switch (this.state.tool) {
      case 'pencil':
        this.beginFreehand(p, this.paintColor());
        break;
      case 'eraser':
        this.beginFreehand(p, TRANSPARENT);
        break;
      case 'bucket':
        this.bucketFill(p);
        break;
      case 'line':
      case 'rect':
      case 'ellipse':
        this.beginEdit();
        this.gesture = {
          kind: 'shape',
          tool: this.state.tool,
          start: p,
          base: cloneBuffer(this.buffer),
          last: null,
        };
        break;
      case 'eyedropper':
        this.pickColor(p, mods);
        break;
      case 'select':
        this.beginSelect(p, mods);
        break;
      case 'move':
        this.beginMove(p);
        break;
      case 'hand':
        break;
    }
  }

  /** Continue the active gesture at art pixel (x,y). */
  pointerMove(x: number, y: number, mods: PointerMods = {}): void {
    const p: Point2 = { x, y };
    switch (this.gesture.kind) {
      case 'freehand':
        this.continueFreehand(p);
        break;
      case 'shape':
        this.previewShape(p, mods);
        break;
      case 'select': {
        const rect = rectFromPoints(this.gesture.start.x, this.gesture.start.y, x, y);
        this.pendingSelectRect = rect;
        this.target.setSelectionOverlay?.(rect);
        break;
      }
      case 'move':
        this.previewMove(p);
        break;
      case 'floatMove':
        this.previewFloatMove(p);
        break;
      case 'none':
        break;
    }
  }

  /** Finish the active gesture. */
  pointerUp(_mods: PointerMods = {}): void {
    const g = this.gesture;
    if (g.kind === 'select') {
      this.commitSelect();
    }
    // The label for the just-finished direct-mutation gesture, if any. A whole
    // drag collapses to ONE history entry via this single settle (U-006).
    const label = gestureLabel(g);
    // A floatMove leaves the selection floating (commit on tool change / Enter).
    this.gesture = { kind: 'none' };
    if (label) {
      this.settleEdit(label);
    }
    this.onChange();
  }

  /** Nudge by whole pixels (Move tool arrow keys): the floating selection when one
   * is active, otherwise the whole layer. */
  nudge(dx: number, dy: number): void {
    if (this.floating) {
      this.floating.x += Math.trunc(dx);
      this.floating.y += Math.trunc(dy);
      this.renderFloating();
      this.onChange();
      return;
    }
    this.beginEdit();
    this.buffer = translateBuffer(this.buffer, dx, dy);
    this.target.setComposite(this.buffer);
    this.settleEdit('Nudge');
    this.onChange();
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Snapshot the committed buffer so a direct-mutation edit can be diffed later. */
  private beginEdit(): void {
    if (this.history) {
      this.editBase = cloneBuffer(this.buffer);
    }
  }

  /** Record the change since {@link beginEdit} as ONE undo entry (or nothing). */
  private settleEdit(label: string): void {
    const base = this.editBase;
    this.editBase = null;
    if (!this.history || !base) {
      return;
    }
    const patch = makePatch(PREVIEW_LAYER_ID, PREVIEW_FRAME_ID, base, this.buffer);
    if (patch) {
      this.recordPatch(patch, label);
    }
  }

  /** Record a pixel patch as a reversible entry bound to this session's buffer. */
  private recordPatch(patch: Patch, label: string): void {
    this.history?.record(patchEntry(patch, (p, dir) => this.applyHistoryPatch(p, dir), label));
  }

  /**
   * Apply an undo/redo patch to the live buffer and repaint. Any uncommitted
   * floating preview is discarded first so undo/redo act on committed pixels only.
   */
  private applyHistoryPatch(patch: Patch, dir: 'undo' | 'redo'): void {
    if (this.floating) {
      this.buffer = this.floating.base;
      this.floating = null;
      this.floatBase = null;
    }
    this.gesture = { kind: 'none' };
    this.buffer = applyPatch(this.buffer, patch, dir);
    this.target.setComposite(this.buffer);
    this.target.setSelectionOverlay?.(this.selection ? this.selection.bounds : null);
    this.onChange();
  }

  private paintColor(): RGBA {
    return this.state.fg;
  }

  private paintStyle(): PaintStyle {
    return { fg: this.state.fg, bg: this.state.bg, dither: this.state.dither };
  }

  private beginFreehand(p: Point2, color: RGBA): void {
    this.beginEdit();
    const usesBase = this.state.pixelPerfect;
    const base = usesBase ? cloneBuffer(this.buffer) : null;
    this.gesture = { kind: 'freehand', color, base, path: [p], dirty: null };
    const style: PaintStyle = color === TRANSPARENT ? { fg: TRANSPARENT } : this.paintStyle();
    const dirty = paintStroke(
      this.buffer,
      [p],
      this.state.brushSize,
      style,
      this.state.mirror,
      this.selection,
    );
    if (this.gesture.kind === 'freehand') {
      this.gesture.dirty = dirty;
    }
    if (dirty) {
      this.target.updateRegion(this.buffer, dirty);
    }
  }

  private continueFreehand(p: Point2): void {
    if (this.gesture.kind !== 'freehand') return;
    const g = this.gesture;
    const style: PaintStyle = g.color === TRANSPARENT ? { fg: TRANSPARENT } : this.paintStyle();
    const prev = g.path[g.path.length - 1];
    g.path.push(p);
    if (g.base && this.state.pixelPerfect) {
      // Pixel-perfect needs the whole path: reset the stroke bbox then repaint.
      const strokeBox = g.dirty
        ? unionRect(g.dirty, rectFromPoints(prev.x, prev.y, p.x, p.y))
        : rectFromPoints(prev.x, prev.y, p.x, p.y);
      copyRegion(this.buffer, g.base, strokeBox);
      const drawn = paintStroke(
        this.buffer,
        g.path,
        this.state.brushSize,
        style,
        this.state.mirror,
        this.selection,
        true,
      );
      g.dirty = accumulate(g.dirty, drawn);
      const repaint = accumulate(strokeBox, drawn);
      if (repaint) this.target.updateRegion(this.buffer, repaint);
    } else {
      const drawn = paintStroke(
        this.buffer,
        [prev, p],
        this.state.brushSize,
        style,
        this.state.mirror,
        this.selection,
      );
      g.dirty = accumulate(g.dirty, drawn);
      if (drawn) this.target.updateRegion(this.buffer, drawn);
    }
  }

  private previewShape(end: Point2, mods: PointerMods): void {
    if (this.gesture.kind !== 'shape') return;
    const g = this.gesture;
    if (g.last) {
      copyRegion(this.buffer, g.base, g.last);
    }
    const drawn = this.drawShape(g.tool, g.start, end, mods);
    if (this.selection && drawn) {
      clipToSelection(this.buffer, g.base, drawn, this.selection);
    }
    const repaint = accumulate(g.last, drawn);
    g.last = drawn;
    if (repaint) {
      this.target.updateRegion(this.buffer, repaint);
    }
  }

  private drawShape(
    tool: 'line' | 'rect' | 'ellipse',
    start: Point2,
    rawEnd: Point2,
    mods: PointerMods,
  ): Rect | null {
    const w = this.buffer.w;
    const h = this.buffer.h;
    const transforms = mirrorTransforms(w, h, this.state.mirror);
    let dirty: Rect | null = null;
    if (tool === 'line') {
      const end = mods.shift ? snapLineEndpoint(start.x, start.y, rawEnd.x, rawEnd.y) : rawEnd;
      for (const t of transforms) {
        const a = t(start);
        const b = t(end);
        dirty = accumulate(
          dirty,
          drawLineInto(this.buffer, a.x, a.y, b.x, b.y, this.state.fg, {
            size: this.state.brushSize,
            pixelPerfect: this.state.pixelPerfect,
          }),
        );
      }
      return dirty;
    }
    const end = mods.shift ? squareEnd(start, rawEnd) : rawEnd;
    const rect = rectFromPoints(start.x, start.y, end.x, end.y);
    for (const t of transforms) {
      const corners = [
        t({ x: rect.x, y: rect.y }),
        t({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 }),
      ];
      const mr = rectFromPoints(corners[0].x, corners[0].y, corners[1].x, corners[1].y);
      if (tool === 'rect') {
        dirty = accumulate(
          dirty,
          drawRectInto(this.buffer, mr, this.state.fg, {
            fill: this.state.rectFilled,
            fillColor: this.state.bg,
          }),
        );
      } else {
        dirty = accumulate(
          dirty,
          drawEllipseInto(this.buffer, mr, this.state.fg, {
            fill: this.state.ellipseFilled,
            fillColor: this.state.bg,
          }),
        );
      }
    }
    return dirty;
  }

  private bucketFill(p: Point2): void {
    if (this.selection && !selectionContains(this.selection, p.x, p.y)) {
      return; // seed outside the selection: nothing to fill
    }
    this.beginEdit();
    const base = this.selection ? cloneBuffer(this.buffer) : null;
    const dirty = floodFillInto(this.buffer, p.x, p.y, this.state.fg, {
      tolerance: this.state.tolerance,
      contiguous: this.state.contiguous,
    });
    if (dirty && base && this.selection) {
      clipToSelection(this.buffer, base, dirty, this.selection);
    }
    if (dirty) {
      this.target.updateRegion(this.buffer, dirty);
    }
    this.settleEdit('Fill');
    this.onChange();
  }

  private pickColor(p: Point2, mods: PointerMods): void {
    const color = sampleColor(this.buffer, p.x, p.y);
    this.update(mods.alt ? { bg: color } : { fg: color });
  }

  private beginSelect(p: Point2, mods: PointerMods): void {
    this.commitFloating(); // starting a new marquee commits any floating selection
    const mode = mods.shift ? 'add' : mods.alt ? 'subtract' : 'replace';
    this.gesture = { kind: 'select', start: p, mode };
    this.pendingSelectRect = makeRect(p.x, p.y, 1, 1);
    this.target.setSelectionOverlay?.(this.pendingSelectRect);
  }

  private commitSelect(): void {
    if (this.gesture.kind !== 'select') return;
    const g = this.gesture;
    // `pointerUp` doesn't carry the end point; use the overlay's last rect via
    // the start as a fallback for a pure click (collapses to deselect on replace).
    const w = this.buffer.w;
    const h = this.buffer.h;
    const rect = this.pendingSelectRect ?? makeRect(g.start.x, g.start.y, 1, 1);
    this.pendingSelectRect = null;
    if (g.mode === 'replace') {
      this.selection = rect.w <= 1 && rect.h <= 1 ? null : selectRect(w, h, rect);
    } else if (g.mode === 'add') {
      this.selection = addRect(this.selection ?? createSelection(w, h), rect);
    } else {
      this.selection = subtractRect(this.selection ?? createSelection(w, h), rect);
    }
    if (this.selection && isSelectionEmpty(this.selection)) {
      this.selection = null;
    }
    this.target.setSelectionOverlay?.(this.selection ? this.selection.bounds : null);
  }

  private previewMove(p: Point2): void {
    if (this.gesture.kind !== 'move') return;
    const dx = p.x - this.gesture.start.x;
    const dy = p.y - this.gesture.start.y;
    this.buffer = translateBuffer(this.gesture.base, dx, dy);
    this.target.setComposite(this.buffer);
  }

  /**
   * Begin a Move gesture at `p`. With a floating selection active, grab it; with a
   * (non-floating) selection active, lift its pixels into a floating selection
   * (leaving a transparent hole) and grab that; otherwise move the whole layer.
   */
  private beginMove(p: Point2): void {
    if (this.floating) {
      this.beginFloatMove(p);
      return;
    }
    if (this.selection && !isSelectionEmpty(this.selection)) {
      this.liftSelection();
      this.beginFloatMove(p);
      return;
    }
    this.beginEdit();
    this.gesture = { kind: 'move', start: p, base: cloneBuffer(this.buffer) };
  }

  /** Lift the active selection's pixels off the layer into a floating selection. */
  private liftSelection(): void {
    const sel = this.selection;
    if (!sel || isSelectionEmpty(sel)) {
      return;
    }
    const b = sel.bounds;
    // Snapshot the committed layer BEFORE the lift so a lift+move commits as one
    // 'Move' entry (erase-here + draw-there restored together on undo; U-006).
    this.floatBase = this.history ? cloneBuffer(this.buffer) : null;
    this.floatLabel = 'Move';
    const base = cloneBuffer(this.buffer);
    clearRegionWhere(base, b, (x, y) => selectionContains(sel, x, y));
    const pixels = extractRegion(this.buffer, b, (x, y) => selectionContains(sel, x, y));
    this.floating = { pixels, base, x: b.x, y: b.y };
    this.selection = null;
    this.renderFloating();
  }

  private beginFloatMove(p: Point2): void {
    if (!this.floating) return;
    this.gesture = {
      kind: 'floatMove',
      grab: p,
      origin: { x: this.floating.x, y: this.floating.y },
    };
  }

  private previewFloatMove(p: Point2): void {
    if (this.gesture.kind !== 'floatMove' || !this.floating) return;
    this.floating.x = this.gesture.origin.x + (p.x - this.gesture.grab.x);
    this.floating.y = this.gesture.origin.y + (p.y - this.gesture.grab.y);
    this.renderFloating();
  }

  /** Recompute the live buffer as `base` blitted with the floating pixels at the
   * current offset and push it (plus the marquee) to the render target. */
  private renderFloating(): void {
    if (!this.floating) return;
    const buf = cloneBuffer(this.floating.base);
    blitOverInto(buf, this.floating.pixels, this.floating.x, this.floating.y);
    this.buffer = buf;
    this.target.setComposite(buf);
    this.target.setSelectionOverlay?.(this.getFloatingBounds());
  }

  /**
   * Bake the floating selection into the layer at its current position. The live
   * buffer already reflects `base` + float, so this just drops the float state and
   * re-selects the placed region (clamped) so it stays selected for further edits.
   */
  private commitFloating(): void {
    const bounds = this.getFloatingBounds();
    if (!this.floating || !bounds) {
      return;
    }
    const base = this.floatBase;
    const label = this.floatLabel;
    this.floating = null;
    this.floatBase = null;
    // The live buffer already reflects base + float; record the net committed
    // change as ONE entry (a paste or a whole selection move; U-006).
    if (this.history && base) {
      const patch = makePatch(PREVIEW_LAYER_ID, PREVIEW_FRAME_ID, base, this.buffer);
      if (patch) {
        this.recordPatch(patch, label);
      }
    }
    const placed = clampRect(bounds, this.buffer.w, this.buffer.h);
    this.selection = isEmptyRect(placed) ? null : selectRect(this.buffer.w, this.buffer.h, placed);
    this.target.setComposite(this.buffer);
    this.target.setSelectionOverlay?.(this.selection ? this.selection.bounds : null);
  }
}
