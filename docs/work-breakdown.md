# Work Breakdown — PixelForge

Units in dependency order. Each maps to a section of `master-spec.md`.
The engine builds a unit only when all its deps are `verified`.

| id | title | deps | spec ref | status |
|----|-------|------|----------|--------|
| U-001 | Project scaffold + tooling + CI/deploy | — | §1 | verified |
| U-002 | Design system & retro UI chrome (Forge) | U-001 | design-direction, §3 | pending |
| U-003 | Canvas engine + pixel buffer + render pipeline | U-001 | §3.1, §4.1, §5 | pending |
| U-004 | Drawing tools | U-003 | §3.2, §5 | pending |
| U-005 | Color & palette system | U-002, U-003 | §3.3, §4.4, §5 | pending |
| U-006 | History / undo-redo | U-003, U-004 | §3.6, §5 | pending |
| U-007 | Layers panel & management | U-003, U-006 | §3.4, §4.1 | pending |
| U-008 | Animation frames + timeline + onion skin | U-003, U-006, U-007 | §3.5 | pending |
| U-009 | Export: PNG (scaled) + SVG | U-003 | §3.8, §5 | pending |
| U-010 | Export: GIF + spritesheet (+JSON atlas) | U-008, U-009 | §3.8, §5 | pending |
| U-011 | Project persistence + dialogs + image import | U-003, U-005, U-007 | §2, §3.8, §4.3 | pending |
| U-012 | App shell: layout, menus, shortcuts, command palette, help | U-002, U-004, U-005, U-006, U-007, U-011 | §2, §3, §3.7 | pending |
| U-013 | A11y + performance + PWA/offline + final polish | U-008, U-009, U-010, U-011, U-012 | §6, §8 | pending |

## Unit detail

### U-001 — Project scaffold + tooling + CI/deploy
- Spec ref: §1
- Scope: Vite 7 + React 19 + TS project; folder structure (`src/core`, `src/ui`,
  `src/state`, `src/platform`); Biome lint/format; Vitest 4 (unit + Browser Mode
  via Playwright provider) + Playwright E2E configured; a trivial passing test;
  `npm run build` produces a static `dist/`; base path config; CI workflow (build
  + test + lint) and static deploy config (Cloudflare Pages / GitHub Pages).
- Acceptance criteria: `npm ci && npm run build` exits 0 and emits `dist/index.html`;
  `npm test` runs and the sample test passes; lint passes; dev server boots; folder
  contracts exist. Held-out: `docs/acceptance/U-001`.
- Deps: —
- **Status: verified** (2026-07-01, integrated to `master`). Built over 2
  iterations (`wf_023eceaa-423-2` failed review/QA/gate; `wf_023eceaa-423-6` fixed
  all four blockers and passed Reviewer + QA + objective gate). Post-merge in
  `master`: `npm ci`/`build`/`test`/`typecheck` all exit 0, `dist/index.html` +
  hashed JS/CSS present, source lints clean (Biome exit 0 over the deliverable).
- Follow-ups carried forward (advisory, non-blocking — see decision-log ADR-008):
  - **F-1 (MEDIUM):** `.github/workflows/ci.yml` triggers/deploys on `main`, but the
    integration branch is `master`; reconcile before the first real deploy (rename
    branch to `main` or repoint the workflow). Fold into U-012/U-013 or a deploy task.
  - **F-2 (LOW):** coverage `include` scoped to `src/core/**`; widen when
    `ui/state/platform` gain real logic (revisit in U-002+).
  - **F-3 (LOW):** default `npm test` runs Node env; DOM/browser paths covered by
    `test:browser` + `test:e2e` — keep all three in CI (they are).

### U-002 — Design system & retro UI chrome (Forge)
- Spec ref: design-direction.md, §3
- Scope: theme tokens (CSS vars for all 13 named colors + `--px` grid) with a theme
  provider whose **default theme is Arcade CRT** (neon-on-black ramp) plus Forge and
  hardware themes switchable; self-hosted fonts (Press Start 2P, Pixelify Sans,
  Silkscreen, VT323); bevel system (raised/inset/pressed) as reusable Button/Panel/
  Slider/Dialog/Frame components; 9-slice pixel frame; hard drop-shadow; `steps()`
  motion utilities; **CRT display layer (Off/Subtle/Full, default Subtle)** as a
  pure overlay above content with a one-click clean mode; sound toggle scaffolding
  (WebAudio blip util, muted default); reduced-motion + reduce-sound handling.
  No blur/`border-radius` on chrome.
- Acceptance criteria: token values match design-direction.md exactly for BOTH the
  Arcade CRT default ramp and the Forge ramp; components render with hard-edged
  bevels (no blur, integer offsets); focus ring visible; CRT layer toggles Off/
  Subtle/Full and is a non-interactive overlay (`pointer-events:none`) that does not
  alter DOM/content pixels; reduced-motion disables CRT flicker/sweep; base-token
  contrast passes AA measured with CRT on at Subtle (asserted). Held-out:
  `docs/acceptance/U-002`.
- Deps: U-001

### U-003 — Canvas engine + pixel buffer + render pipeline
- Spec ref: §3.1, §4.1, §5
- Scope: pure `src/core/color.ts`, `buffer.ts` (create/get/set/composite/dirtyRect),
  `types.ts`; three-layer canvas pipeline (offscreen buffers → display canvas with
  `imageSmoothingEnabled=false` → overlay); zoom/pan (`setTransform`), pixel + tile
  grid, checkerboard; dirty-rect + rAF-coalesced repaint; pointer→art-coord mapping.
- Acceptance criteria: color round-trip; buffer create/get/set immutability + OOB
  no-op; composite alpha/z-order correctness; dirtyRect correctness; display canvas
  uses nearest-neighbor; zoom/pan map coordinates correctly; **a single pointer op
  at 512×512 repaints only its dirty rect within one animation frame (no full-canvas
  repaint)**; checkerboard/grid are overlay-only and never in the buffer. Held-out:
  `docs/acceptance/U-003`.
- Deps: U-001

### U-004 — Drawing tools
- Spec ref: §3.2, §5
- Scope: pencil, eraser, bucket (tolerance/contiguous), line (Bresenham, snap,
  pixel-perfect), rectangle (fill/outline), ellipse (midpoint, fill/outline),
  eyedropper, rectangular select (add/subtract, mask), move (nudge/commit), hand;
  brush size, mirror X/Y, pixel-perfect, dither; wire tools to buffer ops + selection
  mask + mirror.
- Acceptance criteria: each tool's `src/core/buffer` op is pixel-correct vs fixtures
  (line endpoints, filled/outline rect & ellipse, flood fill regions incl.
  tolerance, pixel-perfect removes doubled corners); selection constrains edits;
  mirror mirrors. Held-out: `docs/acceptance/U-004`.
- Deps: U-003

### U-005 — Color & palette system
- Spec ref: §3.3, §4.4, §5
- Scope: fg/bg slots + swap/reset; HSV+hue+alpha+hex picker; recent colors; palette
  grid + menu; `src/core/palette.ts` with `BUILTIN_PALETTES` (exact §4.4 hexes),
  `parsePalette` (hex/gpl/pal), export palette; indexed/lock mode + palette-swap
  recolor.
- Acceptance criteria: each built-in palette equals the exact §4.4 hex list and
  count; `parsePalette` handles newline-hex/.gpl/.pal and rejects garbage; indexed
  palette-swap remaps art by index. Held-out: `docs/acceptance/U-005`.
- Deps: U-002, U-003

### U-006 — History / undo-redo
- Spec ref: §3.6, §5
- Scope: `src/core/history.ts` (makePatch/applyPatch, dirty-rect patches),
  structural command objects (layer/frame/resize/paste), undo/redo stacks, depth/
  byte cap, drag-coalescing, keyboard bindings.
- Acceptance criteria: patch undo restores `before` exactly; redo restores `after`;
  round-trip property holds; structural ops invert correctly; depth cap (100) AND
  total-bytes cap (~64MB) enforced with oldest-eviction; a 1px edit at 512×512
  stores only its dirty sub-rect (not a full 1MB buffer); a drag = one entry.
  Held-out: `docs/acceptance/U-006`.
- Deps: U-003, U-004

### U-007 — Layers panel & management
- Spec ref: §3.4, §4.1
- Scope: layer list UI (thumbnail/name/visibility/lock/opacity), add/duplicate/
  delete/rename/reorder(drag)/merge-down/flatten; active-layer selection; enforce ≥1
  layer; all ops undoable.
- Acceptance criteria: composite reflects visibility/opacity/order; merge-down &
  flatten produce correct composite; cannot delete last layer; reorder persists;
  each op undoable. Held-out: `docs/acceptance/U-007`.
- Deps: U-003, U-006

### U-008 — Animation frames + timeline + onion skin
- Spec ref: §3.5
- Scope: frame model + timeline UI (add/duplicate/delete/reorder, per-frame
  duration, FPS), play/pause/loop/ping-pong, onion skin (prev/next tint + range),
  layers consistent across frames; all ops undoable.
- Acceptance criteria: adding a layer adds to all frames; playback advances by
  durations/FPS; onion ghosts render prev/next only; reorder/delete correct; frame
  ops undoable; **onion-skin compositing at 512×512 with multiple layers/ghosts
  stays within frame budget** (cache composited frames; recomposite only dirty).
  Held-out: `docs/acceptance/U-008`.
- Deps: U-003, U-006, U-007

### U-009 — Export: PNG (scaled) + SVG
- Spec ref: §3.8, §5
- Scope: `png.ts` nearest-neighbor scale export (1–32×, transparent/matte, current/
  all frames); `svg.ts` greedy rect-merge (`crispEdges`, per-color, omit
  transparent); download via `browser-fs-access` with blob fallback; export dialogs.
- Acceptance criteria: PNG output dims = art×scale and introduces no intermediate
  colors (palette count preserved); SVG parses, has viewBox + crispEdges, merged
  rect count << pixel count for solid art, and re-rasterizes to the source image;
  **exports are effect-free (no CRT scanlines/glow, no checkerboard) and correct at
  512×512** (e.g. 512×512 @ 4× = 2048×2048 PNG). Held-out: `docs/acceptance/U-009`.
- Deps: U-003

### U-010 — Export: GIF + spritesheet (+JSON atlas)
- Spec ref: §3.8, §5
- Scope: gifenc-based animated GIF in a Web Worker (scale, loop, per-frame delay),
  progress toast; `spritesheet.ts` packFrames (grid/strip, padding/margin, optional
  POT) → PNG + JSON atlas; export dialogs.
- Acceptance criteria: GIF is a valid animated GIF with frame count = frames and
  correct logical size; spritesheet PNG dims + JSON atlas frame rects/durations are
  correct; encode runs off-main-thread and handles 512×512 × many frames without
  freezing the UI; **GIF/spritesheet output is effect-free** (raw pixels, no CRT/
  checkerboard). Held-out: `docs/acceptance/U-010`.
- Deps: U-008, U-009

### U-011 — Project persistence + dialogs + image import
- Spec ref: §2, §3.8, §4.3
- Scope: `project.ts` serialize/deserialize (`.forge`, base64 pixels, lossless);
  IndexedDB gallery (`idb-keyval`): save/save-as/open/rename/duplicate/delete/list +
  thumbnails; autosave (debounced) + hydrate-on-load; `storage.persist()`; New/
  Resize/Crop/Trim dialogs; import PNG (new canvas or layer) with caps; storage-full
  handling.
- Acceptance criteria: `serialize→deserialize` round-trips a multi-layer, multi-frame
  project losslessly; save→reload restores exact project; gallery CRUD works; import
  and resize reject sizes > 512×512 with a friendly error and no state loss;
  `deserialize` rejects projects exceeding the 512 cap. Held-out:
  `docs/acceptance/U-011`.
- Deps: U-003, U-005, U-007

### U-012 — App shell: layout, menus, shortcuts, command palette, help
- Spec ref: §2, §3, §3.7
- Scope: full workbench layout (menu bar, tool rack, anvil, dockable panels, status
  bar); menus (File/Edit/View/Canvas/Help) wired to commands; command palette
  (Ctrl/Cmd+K); complete keyboard map; Welcome/New onboarding; Help/Shortcuts,
  Settings, Gallery overlays; responsive/touch (pinch-zoom, two-finger pan, bottom
  sheets) **[Q2]**.
- Acceptance criteria: every menu/command reachable by keyboard and command palette;
  documented shortcuts fire the right commands; onboarding appears on first run;
  overlays open/close; layout responsive incl. touch. Held-out:
  `docs/acceptance/U-012`.
- Deps: U-002, U-004, U-005, U-006, U-007, U-011

### U-013 — A11y + performance + PWA/offline + final polish
- Spec ref: §6, §8
- Scope: WCAG 2.2 AA audit + fixes (roles/labels/focus order/keyboard draw path);
  performance pass (dirty-rect within a frame at 512×512, bundle budget, worker
  offloading, INP/LCP/CLS); PWA (manifest + service worker offline caching of shell
  + fonts); reduced-motion/reduce-sound end-to-end; final visual polish vs
  design-direction; global end-to-end acceptance (§8).
- Acceptance criteria: axe/keyboard audit passes on core flows; CRT toggle + clean
  mode work and reduced-motion disables CRT motion; Lighthouse budgets met at the
  512×512 ceiling (draw INP < 200ms, LCP < 2.5s, CLS < 0.1); app works fully offline
  after first load; exports effect-free; global acceptance checklist (§8) green.
  Held-out: `docs/acceptance/U-013`.
- Deps: U-008, U-009, U-010, U-011, U-012
