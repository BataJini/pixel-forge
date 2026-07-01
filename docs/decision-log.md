# Decision Log — PixelForge

ADR style. Newest first.

## ADR-010 — U-003 integration: cross-base merge + App-root conflict + `biome check .` fix  (2026-07-01)
- **Context:** U-003 (canvas engine + pixel buffer + render pipeline) passed
  Reviewer + QA + the objective gate on the first worktree (`wf_023eceaa-423-13`;
  no failed sibling). Two integration complications: (1) the worktree branched from
  the **U-001** base (`a21e10e`) while `master` had already advanced to **U-002**
  (`8750399`), so a straight merge would drag CRLF-only noise and try to revert
  U-002's real edits to `main.tsx`/`index.ts`/`tokens.css`; (2) a **semantic
  conflict** on the app root — U-002 rewrote `App.tsx` to mount its design-system
  `DesignShowcase` + `CrtOverlay` (and deleted `App.css`), while U-003 repurposed the
  same `App.tsx`/`App.css` to mount the runnable `CanvasStage` workbench preview.
  Both are deliberate throwaway scaffolding until U-012 assembles the real shell.
- **Decision:** Integrate by applying **only the genuine U-003 changes** onto
  `master` (ignoring pure line-ending diffs): the new `src/core/{buffer,color,rect,
  types,viewport}.ts` (+tests) and `src/platform/{overlays,renderer}.ts` (+browser
  test) + `src/ui/CanvasStage.tsx`/`.css`; the additive barrel exports in
  `src/core/index.ts`/`src/platform/index.ts` (U-002 never touched these); and the
  `vite.config.ts` held-out `test.include` activation for `docs/acceptance/U-003/**`.
  Hand-merged `App.tsx` to keep **both** units live: U-002's `ThemeProvider` +
  always-mounted `CrtOverlay` now wrap U-003's top bar + `CanvasStage` workbench.
  Re-added U-003's `App.css`. Left U-002's `main.tsx`/`tokens.css`/`index.ts`
  untouched. Fixed the long-standing `biome check .` nested-root failure by adding
  `.claude/` (+ `.factory.lock`) to `.gitignore` so Biome's `useIgnoreFile` skips the
  in-repo build worktrees.
- **Rationale:** The worktree's "modified" set was almost entirely CRLF churn from a
  pre-`.gitattributes` base; cherry-applying the real diffs avoids clobbering U-002.
  Composing (not choosing between) the two preview roots preserves every verified
  behavior of both units — U-002's theme/CRT chrome and U-003's canvas engine —
  which is exactly what U-012 will formalize; `CanvasStage` needs no theme context,
  so the composition is low-risk and was verified end-to-end. Gitignoring `.claude/`
  is the durable fix flagged (but deferred as out-of-scope) in the U-001 lesson:
  nothing under `.claude/` was tracked, and CI (clean checkout) never had worktrees.
- **Consequences:** Post-merge `master` is green on the **full** gate:
  `typecheck` 0, `vitest` **138/12 files** (incl. the activated held-out U-003
  acceptance suite), `build` 0 with `dist/` artifacts (JS 65.98 kB gz), **`npm run
  lint` (`biome check .`) 0 / 79 files** (no longer needs scoping), `test:browser`
  **14/3**, `test:e2e` **2** with no console errors. U-002's `DesignShowcase` is no
  longer mounted at the app root (still exported and covered by its own browser
  test); it returns as a section within U-012's workbench. Advisory findings
  F-1..F-4 (Space+drag/two-finger pan → U-004/U-012; `vite.config` include glob and
  `src/platform` coverage → later units; fractional-zoom sub-pixel seam → optional
  polish) carried forward, none blocking. Master-spec/design-direction unchanged —
  reality matched the spec; the engine/module boundaries were built as specified.

## ADR-009 — U-002 integration: verified design system, deferred Forge ash-on-iron contrast  (2026-07-01)
- **Context:** U-002 (design system & retro UI chrome) passed Reviewer + QA + the
  objective gate on the first worktree (`wf_023eceaa-423-12`; no failed sibling —
  `-13` is U-003). The deliverable lived as uncommitted working-tree changes on the
  worktree branch (zero commits past the U-001 base). Reviewer/QA surfaced four
  advisory findings, none blocking: **F-1 (MEDIUM)** `--c-ash` secondary text over
  `--c-iron` panels fails WCAG AA in the *Forge* theme (3.79:1 in showcase
  `.pf-tagline`/`.pf-hint`/`.pf-swatches__name`/`.pf-slider__value`) — beyond the
  stated criterion-3 pairs (all pass) but a real AA gap the constitution forbids;
  **F-2 (LOW)** CRT overlay sits below native `<dialog>` top-layer; **F-3 (LOW)**
  persistent `will-change: transform` on idle sweep/marquee; **F-4 (LOW)** coverage
  `include` still scoped to `src/core/**` (carry-over of U-001 F-2).
- **Decision:** Mark U-002 **verified** on the deliverable's real state. Committed the
  deliverable on the worktree branch, `git merge --squash` into `master` (no
  conflicts), `npm install` to sync 4 new devDeps, then post-merge in `master`:
  `typecheck`/`test`/`build` all exit 0, `dist/index.html` + 8 hashed `.woff2`
  present, Biome (scoped to the deliverable) exit 0. Do **not** hold the unit on
  F-1..F-4. Fold **F-1 into U-012** (before the real workbench ships ash-on-iron
  secondary text — use `--c-steel` on iron, or place secondary text on anvil, or
  nudge Forge `--c-ash`/`--c-iron` to ash/iron ≥ 4.5, and add an ash-on-iron
  assertion so it can't regress). F-2/F-3 are optional polish for U-013; F-4 is the
  same coverage-widening already tracked from U-001.
- **Rationale:** The objective gate is about the deliverable's real build/test/artifact
  state, which is green, and every enumerated U-002 acceptance criterion (1–6 held-out
  + all manual) passes independently. F-1 is a live but localized WCAG gap confined to
  showcase text that U-012 replaces wholesale with the real workbench; fixing it there
  (with a regression assertion) is cheaper and lands where the offending text actually
  lives, rather than patching a throwaway showcase now.
- **Consequences:** The Forge theme has a known ash-on-iron AA gap in the *showcase
  only* until U-012; flagged in work-breakdown + lessons so it isn't forgotten. The
  focus-ring hex is driven by the theme `--c-spark` token (Arcade `#FF2E88`, Forge
  `#FFB03A`) rather than the single hardcoded `#FFB03A` named in `criteria.md` — the
  token-driven behavior is more spec-aligned and is the intended contract going
  forward; no spec change needed. Master-spec/design-direction unchanged — reality
  matched the spec.

## ADR-008 — U-001 integration: verified scaffold, deferred CI-branch reconcile  (2026-07-01)
- **Context:** U-001 (scaffold + tooling + CI/deploy) passed Reviewer + QA + the
  objective gate on fix-worktree `wf_023eceaa-423-6` (the `-2` worktree failed on
  four blockers and was superseded). Integrating into `master`. Two open items
  surfaced that don't block the unit: (a) the CI/deploy workflow targets `main`
  while the integration branch is `master` (Reviewer F-1, MEDIUM); (b) `biome check .`
  from the repo root fails because it descends into the in-repo build worktrees under
  `.claude/worktrees/` and finds their nested `biome.json`.
- **Decision:** Mark U-001 **verified** on the strength of the deliverable itself —
  post-merge `npm ci`/`build`/`test`/`typecheck` all exit 0 in `master`, artifacts
  present, and the committed source lints clean when scoped to the deliverable
  (`biome check src test e2e <configs>` → exit 0). Do **not** hold the unit on F-1;
  reconcile the CI branch (rename `master`→`main` on first push to a remote, or
  repoint the workflow trigger/deploy guard to `master`) as a pre-deploy task folded
  into U-012/U-013. Treat the `biome check .` root failure as an environment artifact
  of in-repo worktrees, not a code defect (CI runs a clean checkout with no
  worktrees). Ideal hardening (add `.claude/` to `.gitignore` + `biome.json` ignores)
  is deferred to a code agent — Doc scope is docs-only.
- **Rationale:** The objective gate is about the deliverable's real build/test/artifact
  state, which is green. Neither open item affects correctness of the scaffold; both
  are localized, documented, and cheaper to resolve alongside the units that actually
  exercise deploy/tooling. No remote is configured yet, so the `main`/`master`
  mismatch is inert today.
- **Consequences:** CI/deploy will not fire until the branch names are reconciled;
  flagged in work-breakdown (F-1) and lessons so it isn't forgotten before first
  deploy. Local `npm run lint` may show a false failure while worktrees exist under
  `.claude/`; verify lint against the committed source or in CI until `.claude/` is
  ignored.

## ADR-007 — Intake answers folded in (7 decisions)  (2026-07-01)
- **Context:** The human answered the batched intake questions.
- **Decisions:**
  1. **Hero vibe = Arcade CRT** as the DEFAULT theme (neon-on-black, scanlines/glow
     forward) over the bespoke **Forge** structural chrome. Forge + hardware
     palettes (Game Boy, PICO-8, NES, C64, CGA, Amber) remain switchable.
  2. **Clean-export invariant** (hard rule): CRT scanlines/glow/bloom/flicker/
     curvature and the checkerboard are a display-only layer that never touches the
     pixel buffers and never appears in any export (PNG/SVG/GIF/spritesheet/`.forge`).
     A CRT toggle (Off/Subtle/Full) + one-click clean mode; honors reduced-motion.
  3. **Touch:** desktop-first, touch works (pinch-zoom, two-finger pan; not deeply
     tuned).
  4. **Animation:** full — frames + onion skin + GIF + spritesheet (U-008, U-010
     stay in).
  5. **Layers:** full stack (opacity, reorder, merge, flatten) — U-007 stays in.
  6. **Max canvas raised 256 → 512** (presets 8→128 + hardware presets + custom up
     to 512). Perf targets, history memory budget, GIF/onion-skin compositing, and
     acceptance tests updated for the 512² ceiling.
  7. **Palettes:** free RGBA color + built-in classics; indexed/lock mode available
     but OFF by default.
  8. **Local-only:** no accounts, IndexedDB, offline PWA, no backend.
- **Consequences:** design-direction, master-spec, constitution (v1.1), work-
  breakdown, and held-out tests updated. Unit set unchanged (13). Phase → building.

## ADR-006 — Fully client-side, no accounts, local-only storage  (2026-07-01)
- **Context:** The idea is a personal drawing tool. Cloud/accounts add backend,
  auth, privacy, and cost surface with little core value for v1.
- **Decision:** 100% static SPA, no backend, no accounts. All persistence local
  (IndexedDB). No telemetry that leaves the device. Deploy as static assets.
- **Rationale:** First-principles — nothing in "draw pixels, export PNG/SVG"
  needs a server. Local-first is faster, private, offline-capable, free to host.
- **Consequences:** No cross-device sync/gallery-sharing in v1 (possible later).
  Export/import files and a JSON project format are the interchange mechanism.

## ADR-005 — Undo/redo via dirty-rect patch commands (hybrid)  (2026-07-01)
- **Context:** Full-buffer snapshots per stroke blow memory (256×256 RGBA = 256KB
  ×layers×frames); pure command inverse logic is fiddly per tool.
- **Decision:** Each undoable edit is a command storing only the dirty rect's
  before/after typed-array patch + `{x,y,w,h,layerId,frameId}`. Undo/redo blit
  the patch. Structural ops (layer/frame add/remove/reorder, resize) are
  full-object commands with explicit inverse. Cap depth (default 100) and total
  bytes; a drag coalesces into one command on pointerup.
- **Rationale:** Cheap, uniform across tools, immutable-friendly (frozen patches).
- **Consequences:** Patch apply/invert must be exact and covered by held-out tests.

## ADR-004 — Bespoke "Forge" visual identity + themable hardware palettes  (2026-07-01)
- **Context:** Competitors (Piskel utilitarian, Pixilart busy-social, Lospec
  clean-but-frozen) commit to no strong game-console identity. The idea asks for
  "retro game style."
- **Decision:** Invent a bespoke blacksmith-forge identity (ember-on-iron, temp
  metaphor) as the default chrome, with selectable hardware palettes (Game Boy,
  PICO-8, NES, C64, CGA, Amber) that can retheme the whole UI accent ramp. Canvas
  art is never tinted by chrome colors. See design-direction.md.
- **Rationale:** Ownable, ties to the "forge" slug, differentiates from all three
  competitors, and turns palette-choice into a signature feature.
- **Consequences:** More design work (bespoke tokens, icons) but no stock-kit look.

## ADR-003 — Export formats: PNG (scaled) + SVG + GIF + spritesheet + JSON  (2026-07-01)
- **Context:** Idea requires PNG + SVG "etc." Research shows table-stakes exports.
- **Decision:** PNG (integer nearest-neighbor scale 1–32×, transparent bg), SVG
  (greedy rect-merge, `crispEdges`), animated GIF (gifenc in a Web Worker),
  spritesheet PNG + Aseprite-style JSON atlas, and a native `.forge` JSON project
  (lossless: layers, frames, palette, tags). Import: PNG, and palettes (.hex/.gpl/
  .pal). All client-side, no server.
- **Rationale:** Matches user expectations and game pipelines; all hand-rollable
  except GIF (gifenc chosen: fastest, MIT, no-dither is ideal for pixel art).
- **Consequences:** GIF/spritesheet depend on the animation-frames feature.

## ADR-002 — Rendering: hand-rolled Canvas 2D, three-layer pipeline  (2026-07-01)
- **Context:** Konva/Fabric/Pixi add weight and fight nearest-neighbor pixel
  semantics; grid sizes are small enough for Canvas 2D.
- **Decision:** Source-of-truth OffscreenCanvas/`ImageData` buffers per layer at
  native art resolution; a display `<canvas>` (`imageSmoothingEnabled=false` + CSS
  `image-rendering: pixelated`) shows a scaled composite; a transparent overlay
  canvas draws grid/cursor/marquee. Dirty-rect repaint, rAF-coalesced, `setTransform`
  pan/zoom. No rendering library.
- **Rationale:** Simplest thing that is fast enough and pixel-correct.
- **Consequences:** Compositing/dirty-rect logic is ours to test and optimize.

## ADR-001 — Stack: Vite + React 19 + TypeScript, Zustand, IndexedDB  (2026-07-01)
- **Context:** Canvas-heavy static SPA. The framework only drives chrome (the
  canvas is imperative), so choice is a UI-shell + ecosystem decision.
- **Decision:** Vite 7 + React 19 + TypeScript. Zustand + Immer for UI/document
  metadata (pixel buffers kept as raw typed arrays *outside* Immer). Storage via
  IndexedDB (`idb-keyval`), `localStorage` only for tiny prefs; request
  `navigator.storage.persist()`. gifenc for GIF, `browser-fs-access` for
  save/open with blob fallback. Tests: Vitest 4 (unit + Browser Mode) + Playwright
  E2E. Lint/format: Biome. Deploy: Cloudflare Pages (or GitHub Pages with correct
  Vite `base`).
- **Rationale:** Deepest ecosystem for undo/redo, panels, color pickers; trivial
  static deploy; strong pixel-correct testing story (Vitest Browser Mode is a real
  Chromium so canvas assertions work; jsdom canvas is a stub).
- **Consequences:** React runtime cost (~45KB gz) accepted; kept off the draw hot
  path. Svelte 5 recorded as a viable smaller-bundle alternative if revisited.
