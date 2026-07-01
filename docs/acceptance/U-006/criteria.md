# Held-out acceptance — U-006 History / undo-redo

> Authoritative. Builder must NOT edit.

## Machine-checkable
- `history.acceptance.test.ts` passes (undo/redo exact restore, round-trip, null on
  no-op, patch stores only the dirty sub-rect).

## Manual / review (QA)
- Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo across every editing op.
- A continuous drag (multi-pixel stroke) collapses to ONE undo entry.
- Structural ops (add/remove/reorder layer & frame, resize, paste) undo/redo correctly.
- History depth cap (default 100) / byte cap enforced; oldest entries dropped.
- Redo stack cleared after a new edit following an undo.
