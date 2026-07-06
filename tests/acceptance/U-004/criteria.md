# Held-out acceptance — U-004 Drawing tools

> Authoritative. Builder must NOT edit.

## Machine-checkable
- `tools.acceptance.test.ts` passes (line endpoints + contiguity, rect outline vs
  fill, ellipse symmetry, flood fill contiguous vs global with divider).

## Manual / review (QA)
- Pencil sets fg along the pointer path; pixel-perfect mode removes doubled corner
  pixels on diagonals; brush size ≥ 1 works.
- Eraser sets alpha 0 on the active layer only.
- Bucket respects tolerance and an active selection mask.
- Line snaps to 0/45/90° with Shift; rectangle → square, ellipse → circle with Shift.
- Eyedropper samples composited (or active-layer) color into fg; Alt → bg.
- Rectangular select builds a mask that constrains all edits; add (Shift) / subtract
  (Alt); Ctrl+A / Ctrl+D; copy/cut/paste operate on the selection.
- Move nudges by whole pixels (arrows / Shift+arrows) and commits on tool change.
- Mirror-X / mirror-Y mirror strokes across the chosen axis.
- Every tool op is a single undo entry per gesture (verified with U-006).
