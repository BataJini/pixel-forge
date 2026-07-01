/**
 * src/state/historyStore.ts — the stateful undo/redo controller (U-006).
 *
 * Holds the undo/redo stacks of reversible {@link HistoryEntry} commands. Each
 * entry is a pair of side-effecting `undo`/`redo` thunks plus an approximate byte
 * weight; the pure patch/list primitives and the eviction math live in
 * `src/core/history.ts` so this layer only owns the mutable stacks + the wiring.
 *
 * Guarantees (master-spec §3.6 / §6, ADR-005):
 *   - recording a new edit CLEARS the redo stack (no branching timeline);
 *   - the depth cap (default 100) AND the total-byte cap (default ~64MB) are
 *     enforced on every record, evicting the OLDEST entries first;
 *   - consecutive edits sharing a `coalesceKey` merge into ONE entry (a drag that
 *     is already coalesced upstream still records once, but this makes the
 *     "one gesture = one undo" guarantee robust across call sites).
 */
import {
  applyPatch,
  capByBudget,
  DEFAULT_HISTORY_DEPTH,
  DEFAULT_HISTORY_MAX_BYTES,
  type Patch,
  type PatchDirection,
  patchByteSize,
} from '../core/history';

/** A reversible command on the timeline. `undo`/`redo` perform the side effects. */
export interface HistoryEntry {
  /** Human-facing label (e.g. "Pencil", "Fill", "Paste"). */
  readonly label: string;
  /** Approximate retained bytes, for the total-byte cap. */
  readonly bytes: number;
  /**
   * Optional key: an incoming entry with the same key merges into the previous
   * (see {@link History.record}). The merge keeps the PREVIOUS entry's `undo` and
   * the INCOMING entry's `redo`, so it is only correct when the previous `undo`
   * already restores everything the merged sequence touched.
   *
   * That holds for a coalesced drag (each pixel patch's `undo` reverts back to the
   * same pre-gesture baseline). It does NOT hold for two pixel {@link patchEntry}
   * commands whose dirty rects are DISJOINT: keeping only the first `undo` would
   * leave the later sub-step's pixels un-reverted. So never set `coalesceKey` on
   * disjoint pixel patches — U-006 does not (the drag→one-entry guarantee comes
   * from `ToolSession.settleEdit`, not from stack coalescing). A future consumer
   * (U-007/U-008) that wants patch coalescing must first union the patches' rects.
   */
  readonly coalesceKey?: string;
  /** Revert this edit. */
  undo(): void;
  /** Re-apply this edit. */
  redo(): void;
}

/** The minimal surface {@link ToolSession} needs to record edits. */
export interface HistorySink {
  record(entry: HistoryEntry): void;
}

/** Options for a {@link History}. */
export interface HistoryOptions {
  maxDepth?: number;
  maxBytes?: number;
  /** Notified after any stack mutation (record/undo/redo/clear). */
  onChange?: (history: History) => void;
}

/** A readonly snapshot of the timeline for UI (button enablement + tooltips). */
export interface HistorySnapshot {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly depth: number;
  readonly redoDepth: number;
  readonly bytes: number;
}

/** Sum the byte weights of a stack. */
function totalBytes(stack: readonly HistoryEntry[]): number {
  let sum = 0;
  for (const e of stack) {
    sum += e.bytes;
  }
  return sum;
}

/**
 * The undo/redo controller. Newest entries are at the END of each stack.
 */
export class History implements HistorySink {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly maxDepth: number;
  private readonly maxBytes: number;
  private readonly onChange: (history: History) => void;

  constructor(options: HistoryOptions = {}) {
    this.maxDepth = Math.max(1, Math.trunc(options.maxDepth ?? DEFAULT_HISTORY_DEPTH));
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_HISTORY_MAX_BYTES);
    this.onChange = options.onChange ?? (() => {});
  }

  /** Record a new edit: clears redo, coalesces, enforces caps, then notifies. */
  record(entry: HistoryEntry): void {
    this.redoStack = [];
    const prev = this.undoStack[this.undoStack.length - 1];
    if (entry.coalesceKey !== undefined && prev && prev.coalesceKey === entry.coalesceKey) {
      // Merge: undo to BEFORE the first, redo to AFTER the latest.
      this.undoStack[this.undoStack.length - 1] = {
        label: entry.label,
        bytes: prev.bytes + entry.bytes,
        coalesceKey: entry.coalesceKey,
        undo: prev.undo,
        redo: entry.redo,
      };
    } else {
      this.undoStack.push(entry);
    }
    this.enforceCaps();
    this.onChange(this);
  }

  /** Undo the most recent edit. Returns whether anything was undone. */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }
    entry.undo();
    this.redoStack.push(entry);
    this.onChange(this);
    return true;
  }

  /** Redo the most recently undone edit. Returns whether anything was redone. */
  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) {
      return false;
    }
    entry.redo();
    this.undoStack.push(entry);
    this.onChange(this);
    return true;
  }

  /** Drop the entire timeline (e.g. on opening a new project). */
  clear(): void {
    if (this.undoStack.length === 0 && this.redoStack.length === 0) {
      return;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.onChange(this);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  get bytes(): number {
    return totalBytes(this.undoStack);
  }

  /** A readonly snapshot for UI binding. */
  snapshot(): HistorySnapshot {
    const undoTop = this.undoStack[this.undoStack.length - 1] ?? null;
    const redoTop = this.redoStack[this.redoStack.length - 1] ?? null;
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoTop ? undoTop.label : null,
      redoLabel: redoTop ? redoTop.label : null,
      depth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      bytes: this.bytes,
    };
  }

  private enforceCaps(): void {
    const { kept } = capByBudget(this.undoStack, this.maxDepth, this.maxBytes);
    if (kept.length !== this.undoStack.length) {
      this.undoStack = kept;
    }
  }
}

/** The layer/frame ids used for single-surface (preview) pixel history. */
export const PREVIEW_LAYER_ID = 'layer-0';
export const PREVIEW_FRAME_ID = 'frame-0';

/**
 * Build a {@link HistoryEntry} from a pixel {@link Patch}. `apply` performs the
 * blit onto the live layer buffer and repaint; it is invoked with the direction
 * so a single closure serves both undo and redo.
 *
 * NOTE: leave `coalesceKey` undefined for disjoint pixel patches — see the
 * {@link HistoryEntry.coalesceKey} contract; merging disjoint rects would drop the
 * later sub-step's revert. U-006 never coalesces patch entries.
 */
export function patchEntry(
  patch: Patch,
  apply: (patch: Patch, dir: PatchDirection) => void,
  label: string,
  coalesceKey?: string,
): HistoryEntry {
  return {
    label,
    bytes: patchByteSize(patch),
    coalesceKey,
    undo: () => apply(patch, 'undo'),
    redo: () => apply(patch, 'redo'),
  };
}

export { applyPatch };
