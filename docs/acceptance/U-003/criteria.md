# Held-out acceptance — U-003 Canvas engine + render pipeline

> Authoritative. Builder must NOT edit.

## Machine-checkable
- `buffer.acceptance.test.ts` passes (color round-trip, create/get/set immutability,
  OOB no-op, composite z-order/visibility/alpha, dirtyRect bounds).

## Manual / review (QA in Vitest Browser Mode / Playwright)
- Display canvas renders the buffer with `imageSmoothingEnabled=false` and CSS
  `image-rendering: pixelated` (no anti-aliasing when zoomed).
- Zoom steps are integer-friendly and centered on the cursor; pan via Space+drag,
  middle-drag, and two-finger drag map correctly.
- Pixel grid appears when zoomed in enough; tile grid optional; transparency
  checkerboard shows under transparent pixels and is never part of the exported art.
- Pointer position maps to the correct art-space integer coordinate at all zooms/pans.
- Repaint touches only the dirty rect (observable: drawing one pixel does not
  repaint the whole canvas), coalesced within a frame — verified at the full
  **512×512** canvas (a single pointer op completes within one animation frame).
- The checkerboard and grid are drawn on the overlay only; the pixel buffer contains
  none of them (a freshly created buffer is fully transparent).
