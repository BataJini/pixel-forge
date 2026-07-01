# Master Spec — PixelForge

> Source of truth. Extreme detail. Written for agents. Keep in sync with reality.
> Display name: **PixelForge**. Slug: `pixel-forge`. Tagline: "Hammer pixels into
> sprites." Intake questions are RESOLVED (see decision-log ADR-007): hero vibe =
> **Arcade CRT** default theme over the bespoke Forge chrome; desktop-first with
> working touch; animation frames + GIF/spritesheet IN; full layers IN; **max
> canvas 512×512**; palettes = free color + classics with indexed mode off by
> default; local-only (no accounts). Legacy `[Q#]` tags below are informational.

## 1. Overview

- **Problem / goal:** A fast, beautiful, fully client-side browser tool to draw
  pixel art and export it (PNG at integer scale, SVG, animated GIF, spritesheet,
  and a native project file), wrapped in a bespoke retro "forge" aesthetic.
- **Target users:** Hobbyist/indie pixel artists, game-jam devs, and first-timers.
  Desktop-first, touch-supported.
- **Success criteria:**
  1. A user can open the app and draw on a pixel canvas within seconds, with no
     account and no network after first load.
  2. Core tool belt (pencil, eraser, bucket, line, rect, ellipse, eyedropper,
     select+move) works pixel-perfectly with undo/redo.
  3. Layers, animation frames (with onion skin), and a palette system (free color
     + classic hardware palettes) all function.
  4. Exports produce correct artifacts: PNG (transparent, integer nearest-neighbor
     scale), SVG (crisp, rect-merged), GIF (animated), spritesheet PNG + JSON, and
     `.forge` project round-trips losslessly.
  5. Meets performance budgets (§6) and WCAG 2.2 AA; the design matches
     `design-direction.md`; held-out acceptance tests pass.
- **Chosen stack (why → decision-log):** Vite 7 + React 19 + TypeScript; Zustand +
  Immer (metadata) with raw typed-array pixel buffers; hand-rolled Canvas 2D
  three-layer pipeline; IndexedDB (`idb-keyval`); gifenc (GIF) in a Web Worker;
  `browser-fs-access`; Vitest 4 (unit + Browser Mode) + Playwright; Biome; deploy
  Cloudflare Pages / GitHub Pages. See ADR-001..006.

## 2. Information architecture

- **Sitemap / routes** (SPA; hash or single-view, no server routing needed):
  - `/` (default) — **Editor** (the workbench). This is the app.
  - `#gallery` — **Gallery** modal/overlay: locally saved projects (open, rename,
    duplicate, delete, new).
  - `#help` — **Help / Shortcuts** overlay (keyboard map, quick start, about).
  - `#settings` — **Settings** overlay (theme, CRT level, sound, grid defaults,
    reduced-motion state readout, storage usage, data export/wipe).
  - First-run **Welcome / New Canvas** dialog (choose palette + size, dotpict-style
    onboarding) shown when there is no autosaved work.
- **Default theme:** first load uses the **Arcade CRT** theme (neon-on-black accent
  ramp, CRT display layer at "Subtle") over the bespoke Forge chrome. Forge, Game
  Boy, PICO-8, NES, C64, CGA, and Amber themes are switchable in Settings. Theme
  choice affects chrome/accents only — never the canvas artwork or exports.
- **Navigation model:** Single editor screen with overlays/panels; a top menu bar
  (File, Edit, View, Canvas, Help), a left tool rack, right dockable panels
  (Color/Palette, Layers, Frames), and a bottom status bar. Everything reachable
  by keyboard and via a command palette (`Ctrl/Cmd+K`).

## 3. Pages / screens

### Screen: Editor (`/`)
- **Purpose:** The workbench — draw, edit, manage layers/frames/palette, export.
- **Layout & components:**
  - **Top menu/marquee bar:** app logo (Press Start 2P), menus (File, Edit, View,
    Canvas, Help), theme/CRT/sound quick toggles, project title (editable),
    save-state indicator ("Forged"/"Unsaved"/"Saving…").
  - **Left tool rack (vertical):** bevelled buttons for Pencil, Eraser, Bucket
    Fill, Line, Rectangle, Ellipse, Eyedropper, Select (marquee), Move, Hand/Pan,
    plus tool-modifier row (mirror X/Y, pixel-perfect toggle, dither toggle, brush
    size). Active tool glows Ember. Each has a tooltip (name + shortcut).
  - **Center anvil (canvas well):** recessed inset panel holding the display
    canvas over a transparency checkerboard, with the overlay canvas (grid,
    cursor/brush preview, selection marquee, onion-skin ghosts). Zoom/pan here.
  - **Right workbench panels (dockable/collapsible):**
    - **Color/Palette panel:** current fg/bg color swatches (swap/reset), HSV+hex
      color picker, recent colors strip, active palette grid, palette menu (load
      classic, import, save, new, edit), indexed/lock-mode toggle **[Q6]**.
    - **Layers panel:** layer list (thumbnail, name, visibility eye, opacity,
      lock), add/duplicate/delete/merge-down/flatten/reorder (drag), blend/opacity.
    - **Frames panel / timeline:** frame thumbnails, add/duplicate/delete/reorder,
      per-frame duration, FPS, play/pause/loop, onion-skin toggle + range **[Q3]**.
  - **Bottom status bar (VT323):** cursor coords `x,y`, hovered pixel color,
    zoom %, canvas WxH, active tool, selection size, storage/quota hint.
- **Buttons & actions (exact behavior):** see the tool + panel behavior tables in
  §3.1–§3.6. Menu items map to the same commands as the command palette (§3.7).
- **States:**
  - **Default:** canvas with current project; tool active; panels docked.
  - **Empty (first run / no autosave):** Welcome/New Canvas dialog over a dimmed
    editor; empty-state anvil art if dismissed with no canvas.
  - **Loading:** brief skeleton while fonts + last autosave hydrate from IndexedDB.
  - **Busy (export/encode):** non-blocking progress toast (GIF/spritesheet encode
    runs in a worker); UI stays responsive.
  - **Error:** friendly inline errors (import failed, storage full, export failed)
    with a retry/dismiss; never lose the current buffer.
  - **Success:** confirmation toast + chiptune success blip (if sound on).
- **Data / API used:** all local — engine (`src/core`), stores (`src/state`),
  platform glue (`src/platform`). No network.

### 3.1 Canvas & viewport behavior
- **Configurable size:** presets 8×8, 16×16, 32×32, 64×64, 128×128, plus custom
  W×H, plus hardware presets (Game Boy 160×144, NES tile 8×8, etc.). Max
  **512×512** (hard cap enforced with a warning above it). Custom sizes accept any
  W,H in `1..512`. Performance targets (§6) apply at the 512×512 ceiling.
- **Grid:** pixel grid overlay toggle (auto-shown when zoomed enough to see
  pixels), plus optional tile grid every N pixels (e.g. 8/16) with its own color.
- **Zoom:** wheel/pinch zoom centered on cursor; integer zoom steps preferred
  (…50%, 100%, 200%, 400%, 800%, 1600%…); fit-to-screen and 100% commands.
- **Pan:** Space+drag, middle-drag, Hand tool, or two-finger drag (touch).
- **Checkerboard:** neutral transparency backdrop (`#C8C8C8`/`#8F8F8F`), scales
  with zoom, never exported.
- **Coordinate readout & pixel hover** shown in status bar.

### 3.2 Drawing tools (each: behavior, options, shortcut)
- **Pencil (B):** sets pixels along the pointer path to fg color; brush size
  1..N (square); optional **pixel-perfect** mode removes doubled corner pixels on
  diagonal strokes; respects mirror axes. Alt = temporary eyedropper.
- **Eraser (E):** sets pixels to transparent (alpha 0) on the active layer; brush
  size; respects mirror.
- **Bucket Fill (G):** 4-neighbour flood fill of the contiguous region matching
  the target pixel color within a **tolerance** (default 0 = exact); option
  "fill whole layer of matching color" (global, non-contiguous); respects
  selection mask if a selection is active.
- **Line (L):** click-drag straight line (Bresenham), fg color, brush size,
  Shift = snap to 0/45/90°, pixel-perfect option.
- **Rectangle (U then toggle):** click-drag rect outline; Shift = square; option
  filled vs outline; fg for stroke, bg for fill (filled mode).
- **Ellipse (U toggle):** click-drag midpoint ellipse (crisp integer raster);
  Shift = circle; filled vs outline.
- **Eyedropper / Color Picker (I):** click samples the composited pixel color (or
  active-layer pixel, per option) into fg (Alt+click → bg).
- **Select — rectangular marquee (M):** drag to select; Shift adds, Alt subtracts;
  produces a selection mask that constrains all drawing/fill; Ctrl+A select all,
  Esc/Ctrl+D deselect. Copy/Cut/Paste (Ctrl+C/X/V) operate on the selection;
  paste creates a floating selection placed with Move.
- **Move (V):** moves the current layer's pixels, or the floating selection, by
  whole pixels (arrow keys nudge 1px, Shift+arrow 10px); commit on tool change /
  Enter.
- **Hand / Pan (H / Space):** pan the viewport (no pixel change).
- **Tool modifiers (global):** brush size slider, mirror-X, mirror-Y, pixel-perfect
  toggle, dither toggle (checkerboard between fg/bg while drawing), fill tolerance.
- **Dither brush [advanced]:** when dither is on, pencil/fill alternate fg/bg in a
  Bayer pattern for 16-bit shading.
- **Shade / lighten-darken [advanced, optional]:** nudges sampled pixels toward the
  next lighter/darker palette color (indexed mode) or by an HSL step (free mode).

### 3.3 Color & palette
- **Foreground/background** color slots (X swap, D reset to black/white).
- **Picker:** HSV square + hue slider + hex input (`#RRGGBB`/`#RRGGBBAA`) + alpha
  slider; recent-colors strip (dedup, capped, persisted).
- **Palettes:** active palette grid (click = set fg, right/long-press = set bg).
  Built-in classic palettes (exact hexes in §4.4): Forge Ramp (default UI),
  Game Boy DMG (4), PICO-8 (16), NES (~54), CGA 16, Commodore 64 (Pepto 16),
  plus a couple of modern favorites (DB16, optional). Palette menu: load built-in,
  import (`.hex`/`.gpl`/`.pal` → newline-hex is the LCD), export current palette
  (`.hex`/`.gpl`), new/rename/duplicate/delete, add/remove/reorder swatches,
  edit swatch.
- **Indexed / palette-lock mode [Q6, default: available, off by default]:** when
  on, drawing is restricted to the active palette; a live **palette-swap** recolors
  the artwork by index (the killer retro feature). Free-color mode is the default.

### 3.4 Layers
- Per-frame layer stack (add, duplicate, delete, rename, reorder by drag,
  visibility toggle, lock toggle, opacity 0–100%, merge-down, flatten-all). Blend
  mode default Normal (others optional). Active layer highlighted; thumbnails live.
- New layers are transparent; deleting the last layer is prevented; flatten warns.

### 3.5 Animation frames & timeline **[Q3, default: included]**
- Frame list with thumbnails; add/duplicate/delete/reorder; per-frame duration
  (ms) and a global FPS; play/pause/stop, loop toggle, ping-pong optional.
- **Onion skinning:** show N previous (red-tinted) and N next (blue-tinted) frames
  as ghosts under the current frame; range + opacity configurable; toggle.
- A frame contains the full layer stack; layers are consistent across frames
  (add-layer adds to all frames). Live preview plays the composite.
- If frames are excluded via **[Q3]**, the app is single-frame; GIF/spritesheet
  export and the timeline are hidden.

### 3.6 Undo/redo & history (Edit menu)
- Undo (Ctrl+Z), Redo (Ctrl+Shift+Z / Ctrl+Y). Depth default 100 / byte-capped.
- Every pixel edit, tool op, layer/frame structural change, palette change, resize,
  and paste is undoable via the patch/command model (ADR-005). A drag = one entry.

### 3.7 Commands, menus & shortcuts
- **Command palette (Ctrl/Cmd+K):** fuzzy-search every command.
- **File:** New, Open (gallery), Save, Save As, Import Image (PNG), Export ▸ (PNG…,
  SVG, GIF, Spritesheet, Project .forge), Duplicate, Delete.
- **Edit:** Undo, Redo, Cut, Copy, Paste, Select All, Deselect, Flip H/V, Rotate
  90°, Clear layer.
- **View:** Zoom In/Out, Fit, 100%, Toggle Pixel Grid, Toggle Tile Grid, Toggle
  CRT, Toggle Sound, Toggle panels.
- **Canvas:** Resize, Crop to selection, Trim transparent, Change palette,
  Indexed mode.
- **Help:** Shortcuts, Quick start, About.
- **Full key map** documented in the Help overlay and in §6/acceptance.

### 3.8 Export dialogs (exact behavior)
- **Export PNG:** choose scale (1×,2×,4×,8×,16×,32×), background (transparent vs
  matte color), current frame vs all frames (all → sequence zip). Produces a
  nearest-neighbor PNG of `artW*scale × artH*scale`. Downloads via
  `browser-fs-access` (File System Access where available, blob fallback).
- **Export SVG:** greedy rect-merged SVG (`shape-rendering="crispEdges"`), one
  group/path per color, viewBox = art size; transparent pixels omitted.
- **Export GIF [needs frames]:** choose scale, loop count (default infinite), per
  the frame durations/FPS; encoded with gifenc in a Web Worker; progress toast.
- **Export Spritesheet [needs frames]:** layout (grid / horizontal / vertical
  strip), cell size = frame size, padding/margin, optional power-of-two; outputs a
  PNG + a companion JSON atlas (frame name → `{x,y,w,h,duration}`, tags).
- **Export Project (.forge):** JSON (see §4.3), losslessly reopenable.
- **Import Image (PNG):** load into a new canvas or as a new layer (with size
  handling); reject > 512×512 cap with a friendly error.
- **Clean-export invariant (hard rule):** ALL exports (PNG, SVG, GIF, spritesheet,
  `.forge`) read from the composited pixel buffers, never from the on-screen
  presentation. The CRT display layer (scanlines/glow/bloom/flicker/curvature) and
  the transparency checkerboard MUST NOT appear in any exported artifact. Exports
  are the raw pixels the user drew. Held-out tests assert exports are effect-free.

## 4. Data model

### 4.1 Core types (`src/core/types.ts`)
```
type RGBA = [number, number, number, number];        // 0..255 each
interface PixelBuffer { w: number; h: number; data: Uint8ClampedArray; } // RGBA, len w*h*4
interface Layer { id: string; name: string; visible: boolean; locked: boolean;
                  opacity: number; blend: 'normal'|string; buffer: PixelBuffer; }
interface Frame { id: string; durationMs: number; layers: Layer[]; }  // layers align across frames by index/id
interface Palette { id: string; name: string; colors: RGBA[]; source?: string; }
interface Selection { mask: Uint8Array; w: number; h: number; bounds: Rect; } // 0/1 per pixel
interface Rect { x: number; y: number; w: number; h: number; }
interface Project {
  schema: 1; id: string; name: string; w: number; h: number;
  frames: Frame[]; palette: Palette | null; indexed: boolean;
  fps: number; createdAt: string; updatedAt: string; thumbnailDataUrl?: string;
}
```
- Constraints: `1 ≤ w,h ≤ 512` (maxCanvas = 512); layer count ≥ 1; frame count ≥ 1;
  opacity 0..100; colors 0..255; ids are unique strings.

### 4.2 App state (`src/state`, Zustand)
- Document store: current `Project`, active frame/layer ids, selection, palette,
  indexed flag, dirty/saved status.
- Tool store: active tool, fg/bg color, brush size, mirror flags, pixel-perfect,
  dither, tolerance, recent colors.
- View store: zoom, pan offset, grid toggles, theme, CRT level, sound on/off.
- History store: undo/redo stacks of commands (metadata only; patches hold typed
  arrays outside Immer).

### 4.3 Project file `.forge` (JSON, human-diffable)
- Top-level = `Project` with schema version. Pixel data per layer stored as
  **base64 of the raw RGBA `Uint8ClampedArray`** (or PNG data URL) — never a JSON
  number array. Includes palette, frames, durations, tags, indexed flag, canvas
  size, and a thumbnail. `deserialize` validates schema and bounds and returns the
  client-only result envelope on malformed input.

### 4.4 Built-in palettes (exact hex — authoritative)
- **Game Boy DMG (4):** `#0F380F #306230 #8BAC0F #9BBC0F`
- **PICO-8 (16):** `#000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8
  #FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA`
- **CGA 16:** `#000000 #0000AA #00AA00 #00AAAA #AA0000 #AA00AA #AA5500 #AAAAAA
  #555555 #5555FF #55FF55 #55FFFF #FF5555 #FF55FF #FFFF55 #FFFFFF`
- **Commodore 64 (Pepto 16):** `#000000 #FFFFFF #68372B #70A4B2 #6F3D86 #588D43
  #352879 #B8C76F #6F4F25 #433900 #9A6759 #444444 #6C6C6C #9AD284 #6C5EB5 #959595`
- **NES (~54):** stored as a bundled JSON of ~54 RGB entries using a documented
  decoder profile (FirebrandX/"NES Classic"); the file is the source of truth and
  is validated to be 52–56 unique colors.
- **Forge Ramp (UI default theme):** the 13 tokens in design-direction.md.
- Palette import lowest-common-denominator: newline-delimited `#RRGGBB` list.

## 5. API / contracts (internal module contracts — held-out tests target these)

> No HTTP API (client-only). These are the pure `src/core` signatures the builder
> must implement to exact paths so protected tests can import them. Fallible ops
> return `Result<T> = {ok:true,value:T} | {ok:false,error:{code,message}}`.

- `src/core/color.ts`
  - `hexToRgba(hex: string): RGBA` — accepts `#RGB`,`#RRGGBB`,`#RRGGBBAA`; throws
    on invalid (programmer error) OR exposes `tryHexToRgba(hex): Result<RGBA>`.
  - `rgbaToHex(c: RGBA, withAlpha=false): string` — uppercase `#RRGGBB[AA]`.
  - Round-trip: `hexToRgba(rgbaToHex(c)) === c` for any 8-bit c (alpha preserved
    when `withAlpha`).
- `src/core/buffer.ts`
  - `createBuffer(w,h): PixelBuffer` — all pixels `[0,0,0,0]`.
  - `getPixel(buf,x,y): RGBA` — OOB returns `[0,0,0,0]`.
  - `setPixel(buf,x,y,c): PixelBuffer` — returns a NEW buffer (immutable); OOB is a
    no-op returning an equal buffer. (In-place fast path lives behind the mutation
    API used by tools; the pure `setPixel` is the tested contract.)
  - `floodFill(buf,x,y,c,{tolerance=0,contiguous=true}): PixelBuffer` — 4-neighbour.
  - `drawLine(buf,x0,y0,x1,y1,c,{size=1,pixelPerfect=false}): PixelBuffer` — Bresenham.
  - `drawRect(buf,rect,c,{fill=false,fillColor?}): PixelBuffer`.
  - `drawEllipse(buf,rect,c,{fill=false,fillColor?}): PixelBuffer` — midpoint, crisp.
  - `composite(layers: Layer[]): PixelBuffer` — z-order over, respects visibility/
    opacity; source-over alpha compositing.
  - `dirtyRect(before,after): Rect|null` — bounding box of differing pixels.
- `src/core/history.ts`
  - `makePatch(layerId,frameId,before:PixelBuffer,after:PixelBuffer): Patch|null`
    — stores only the dirty sub-rect's before/after bytes.
  - `applyPatch(buf, patch, dir:'undo'|'redo'): PixelBuffer`.
  - Property: `applyPatch(applyPatch(after,patch,'undo'),patch,'redo')` equals
    `after`; undo of a patch restores `before` exactly.
- `src/core/exporters/png.ts`
  - `scaleToCanvas(buf, scale): OffscreenCanvas` (or ImageData) — nearest-neighbor,
    dims `w*scale × h*scale`, no interpolation.
- `src/core/exporters/svg.ts`
  - `bufferToSvg(buf, {merge=true}): string` — valid SVG, `viewBox="0 0 w h"`,
    `shape-rendering="crispEdges"`, omits fully-transparent pixels; merged mode
    emits far fewer rects than pixel count for solid regions.
- `src/core/exporters/spritesheet.ts`
  - `packFrames(frames, {layout,padding,margin}): {atlas, meta}` — meta lists frame
    rects/durations.
- `src/core/palette.ts`
  - `parsePalette(text, format): Result<Palette>` — supports newline-hex / `.gpl` /
    `.pal`; caps color count; ignores comments; rejects garbage.
  - `BUILTIN_PALETTES` — object with the exact §4.4 hex arrays (Game Boy, PICO-8,
    CGA, C64, NES, Forge).
- `src/core/project.ts`
  - `serialize(project): string` and `deserialize(text): Result<Project>` —
    lossless round-trip; validates schema/bounds; base64 pixel encoding.

## 6. Cross-cutting

- **Auth / roles:** none (no accounts). Everything is single-user local.
- **Validation:** all imports (image, palette, project) validated at the boundary
  with size/dimension/color caps; malformed input rejected with a friendly error
  and no state change. URL/hash params sanitized.
- **Error handling:** result-envelope for fallible ops; UI shows friendly,
  actionable messages; server-style detail only in console. Buffer never lost on
  error. Storage-full is handled explicitly (prompt to export/free space).
- **i18n:** English v1; all UI strings centralized to allow future locales; layout
  tolerant of longer strings.
- **a11y:** WCAG 2.2 AA; full keyboard operation incl. drawing entry points and all
  dialogs; visible Spark focus ring; ARIA roles/labels on toolbars, sliders,
  dialogs, lists; `prefers-reduced-motion` disables ambient motion (incl. CRT
  flicker/sweep/shimmer); audio off by default; state not hue-only; no >3/sec
  flash; canvas has an accessible description and keyboard nudge for the pointer
  where feasible. **CRT layer** has an explicit Off/Subtle/Full toggle plus a
  one-click clean mode; it never drops base-token contrast below AA (measured with
  the layer on at Subtle).
- **Performance budgets (512×512 ceiling):** LCP < 2.5s, INP < 200ms, CLS < 0.1.
  A pointer draw op repaints only its dirty rect within one animation frame at the
  full **512×512** canvas (a naive full-canvas repaint at 512² = ~1M px is not
  acceptable — dirty-rect + rAF coalescing is mandatory). Layer compositing and
  onion-skin ghosting stay within frame budget at 512×512 with multiple layers/
  ghosts (cache composited layers; only recomposite dirty layers). **History memory
  budget:** dirty-rect patches keep a single stroke small even at 512² (never
  snapshot the full 1MB/layer buffer per edit); enforce the depth cap (default 100)
  AND a total-bytes cap (default ~64MB) with oldest-eviction. GIF/spritesheet/PNG
  encode run off the main thread (Web Worker) and must handle 512×512 × many frames
  without freezing the UI (transfer buffers, show progress). Initial JS bundle
  target < 250KB gz (excl. fonts); fonts self-hosted `.woff2`, subset where
  possible. The CRT display layer must not regress draw INP or canvas repaint;
  under load or reduced-motion it degrades to static/off.
- **Security:** no `eval`; sanitize any user HTML; defensive file parsing; no
  runtime third-party network; CSP-friendly build; treat all imported/fetched data
  as untrusted. No secrets (there are none).
- **Analytics:** none by default (privacy). Any future analytics must be opt-in and
  privacy-preserving.
- **Offline / PWA:** installable PWA with a service worker caching the static app
  shell + fonts so it works fully offline after first load.

## 7. Non-goals / out of scope (v1)
- User accounts, cloud sync, social gallery, sharing links, comments.
- Real-time collaboration / multiplayer.
- Native mobile apps (responsive web + touch only).
- Vector/non-pixel drawing, photo editing, brushes with soft/AA edges.
- Tilemap/level editor, scripting/plugins, `.aseprite` binary read/write (palette
  interop via `.gpl`/`.hex` only).
- AI generation features.

## 8. Global acceptance criteria
1. Fresh load → draw a pixel with the pencil in < 5s, no network calls after first
   load (verify offline works).
2. Every tool in §3.2 produces pixel-correct results verified against held-out
   engine tests; undo/redo restores prior state exactly for each.
3. Layers (add/reorder/hide/opacity/merge/flatten) and, if enabled, frames +
   onion skin + playback all function without data loss.
4. Palette system: load each built-in palette (exact §4.4 hexes), import a
   newline-hex palette, set fg/bg, and (indexed mode) palette-swap recolors art.
5. Exports verified: PNG dims = art×scale with nearest-neighbor (no intermediate
   colors introduced); SVG parses, has `crispEdges`, and rebuilds the image; GIF is
   a valid animated GIF with the right frame count; spritesheet PNG + JSON atlas
   frame rects are correct; `.forge` round-trips losslessly. All exports are
   effect-free (no CRT scanlines/glow, no checkerboard) and correct at 512×512.
6. Save to IndexedDB, reload the page, and restore the exact project (autosave +
   explicit save); gallery open/rename/duplicate/delete work.
7. WCAG 2.2 AA: keyboard-only can draw, switch tools, manage layers, and export;
   focus visible; reduced-motion honored; contrast passes on base tokens.
8. Performance budgets met (§6) on a mid-range laptop; visual output matches
   `design-direction.md` (Forge tokens, bevels, `steps()` motion, no blur/radius on
   chrome) — Reviewer confirms no generic/templated look.
