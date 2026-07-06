# Held-out acceptance — U-009 Export PNG + SVG

> Authoritative. Builder must NOT edit.

## Machine-checkable
- `export.acceptance.test.ts` passes (SVG viewBox/crispEdges, transparent-pixel
  omission, merged rect count << pixel count).
- **PNG (Browser Mode):** `scaleToCanvas(buffer, scale)` yields a canvas of
  `w*scale × h*scale`; every source pixel maps to an exact `scale×scale` block; the
  set of distinct colors in the output equals the set in the source (nearest-neighbor
  introduces NO intermediate colors) for scales 1,2,4,8. Verified at the max canvas:
  a 512×512 buffer at 4× yields a 2048×2048 canvas.
- **Effect-free:** exporters read the composited pixel buffer, not the screen. A
  test with the CRT layer set to Full confirms the exported PNG/SVG pixels are
  byte-identical to the export with CRT Off (no scanlines/glow/checkerboard leak).

## Manual / review (QA — Playwright download interception)
- Export PNG dialog: scale 1/2/4/8/16/32, transparent vs matte background, current
  vs all frames; triggers a `.png` download of the right dimensions.
- Transparent background exports with alpha; matte flattens onto the chosen color.
- Export SVG downloads a `.svg` that re-rasterizes to the source image.
- With the CRT layer visibly ON, exported PNG/SVG contain no scanlines/glow/
  checkerboard (spot-checked pixels equal the clean buffer).
- `browser-fs-access` used with a blob-download fallback on browsers without the
  File System Access API.
