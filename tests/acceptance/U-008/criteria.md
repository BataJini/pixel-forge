# Held-out acceptance — U-008 Animation frames + timeline + onion skin

> Authoritative. Builder must NOT edit. (Gated by intake Q3; if frames excluded,
> this unit and U-010 are dropped from the plan.)

## Machine-checkable (Vitest)
- Adding a layer adds a corresponding layer to EVERY frame (layer set stays aligned).
- Adding/duplicating/deleting/reordering frames updates the frame list correctly;
  duplicate deep-copies pixel buffers (editing the copy does not change the source).
- Playback order + timing derive from per-frame `durationMs` / global `fps`.
- Onion-skin selection returns only the N previous and N next frames (never the
  current), respecting the configured range and clamping at the ends.

## Manual / review (QA)
- Timeline UI: add/duplicate/delete/reorder frames, per-frame duration, FPS control.
- Play / pause / stop / loop (and ping-pong if built) animate the composite live.
- Onion ghosts render previous (warm tint) under next (cool tint) at reduced opacity;
  toggle + range configurable; disabled cleanly when off.
- All frame ops undoable (with U-006).
