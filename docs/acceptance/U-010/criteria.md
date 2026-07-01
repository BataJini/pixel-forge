# Held-out acceptance — U-010 Export GIF + spritesheet (+JSON atlas)

> Authoritative. Builder must NOT edit. (Depends on U-008 frames.)

## Machine-checkable (Vitest)
- `packFrames(frames, {layout,padding,margin})` returns meta whose frame rects:
  - number of frame entries == number of input frames;
  - rects are non-overlapping and lie within the atlas bounds;
  - each rect w/h == frame size; spacing == configured padding; outer margin applied;
  - meta carries each frame's `duration`.
- Grid, horizontal-strip, and vertical-strip layouts produce the expected atlas
  dimensions for a known frame count/size.
- GIF encode (headless/Browser Mode): output bytes begin with `GIF89a`; decoding
  reports an image count == number of frames and the correct logical width/height.
- **Effect-free:** GIF/spritesheet pixels come from composited buffers; with the CRT
  layer ON vs OFF the encoded output is identical (no scanlines/glow/checkerboard).
- Handles a 512×512 frame set without freezing (encode in a worker).

## Manual / review (QA — Playwright)
- Export GIF dialog: scale, loop count (default infinite), uses frame durations;
  encoding runs in a Web Worker (UI stays responsive; progress toast shown).
- Export Spritesheet dialog: layout, padding/margin, optional power-of-two; downloads
  a PNG + a companion `.json` atlas; the atlas slices back to the correct frames.
