# Held-out acceptance — U-005 Color & palette system

> Authoritative. Builder must NOT edit.

## Machine-checkable
- `palette.acceptance.test.ts` passes (exact hexes + counts for Game Boy, PICO-8,
  CGA, C64, NES range/uniqueness; `parsePalette` for hex/gpl and garbage rejection).

## Manual / review (QA)
- fg/bg slots with swap (X) and reset (D); HSV square + hue + alpha + hex input all
  set the current color; recent-colors strip dedups, caps, and persists.
- Palette grid: click sets fg, right/long-press sets bg; load each built-in palette;
  import a `.hex` file; export current palette; add/remove/reorder/edit swatches.
- Indexed / palette-lock mode restricts drawing to the palette and palette-swap
  recolors existing art by index (a pixel drawn with palette index i becomes the new
  color at index i after swap).
- Free-color mode is the default.
