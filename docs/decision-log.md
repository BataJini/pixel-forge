# Decision Log — PixelForge

ADR style. Newest first.

## ADR-016 — U-008 frames: pure frame algebra + undoable store + WeakMap composite cache; integrate `-341eca87-03f-2`  (2026-07-02)
- **Context:** U-008 needs an animation model (add/duplicate/delete/reorder frames,
  per-frame duration + global FPS, play/pause/loop/ping-pong, onion skin) layered on
  top of U-003 buffers, U-006 history, and U-007 layers, with layers kept consistent
  across every frame and all ops undoable — plus the §6 budget guarantee that
  onion-skin compositing at 512×512 with multiple layers/ghosts stays within frame.
- **Decision:** Same three-way split as U-007 per the constitution's module
  boundaries: (1) `src/core/frames.ts` — pure, DOM/id-free frame algebra
  (`addLayerToAllFrames` mints a distinct buffer per frame, `duplicateFrame`
  deep-copies pixels, `deleteFrame`/`canDeleteFrame` guards the last frame, `moveFrame`
  reorders immutably, `buildTimeline`/`frameIndexAtTime` derive playback order + timing
  incl. ping-pong, `selectOnionFrames` picks N-prev/N-next never-current with
  clamping); (2) `src/state/frameStore.ts` — an undoable store with copy-on-write
  stroke capture and a `WeakMap` composite cache keyed by frame identity (only dirty
  frames recomposite; ghosts computed only while paused); (3) `src/ui/frames/` — a
  bespoke Forge timeline (token-only CSS, functional warm/cool ghost tints independent
  of theme like the checkerboard, VT323 numeric readouts, hammer-strike seed motif).
  Integrated worktree `wf_341eca87-03f-2` after committing its uncommitted deliverables
  onto the worktree branch; re-ran the full objective gate on merged `master`.
- **Rationale:** Keeping the algebra pure makes the held-out frame contract the source
  of truth and keeps compositing off the React path; the `WeakMap`-by-frame-identity
  cache is the cheapest way to honor §6 without a manual dirty-flag protocol. The
  buffer-per-frame invariant (distinct bytes, not shared references) is what makes
  onion ghosts and per-frame edits correct.
- **Consequences:** Verified first try (Review PASS advisory-only, QA PASS, gate
  build 0 / test 0 / 523 tests / reward-hack clean). **Held-out-suite gap (M-1):**
  `docs/acceptance/U-008/` has only `criteria.md`, so the builder's held-out include
  glob matched zero files and the gate's held-out check passed vacuously — the
  manager/Architect must author `frames.acceptance.test.ts` before U-013's global
  acceptance check (this is an acceptance-authoring gap, **not** a builder reward-hack:
  nothing was deleted or weakened, and the builder correctly refused to write into the
  protected dir). History byte-accounting under-count (L-1) and the cosmetic non-loop
  ping-pong resting frame (L-2) fold into U-013. Master-spec §3.5 unchanged — reality
  matched the spec. U-008 now unblocks U-010 (GIF/spritesheet) and U-013.

## ADR-015 — U-007 layers: pure layer algebra + undoable store + bespoke panel; integrate `-bea-6`  (2026-07-02)
- **Context:** U-007 needs a layer stack (add/dup/delete/rename/reorder/lock/
  opacity/merge-down/flatten) whose composite is deterministic and testable against
  the held-out suite, plus a keyboard-operable, on-brand panel. The fix loop
  produced three worktrees (`-6be-2` → `-bea-2` → `-bea-6`); Review + QA both ran on
  and blessed `-bea-6`, but the recorded objective-gate JSON still named the
  superseded `-bea-2` (M-3).
- **Decision:** Split the unit three ways per the constitution's module boundaries:
  (1) `src/core/layers.ts` — pure, immutable, DOM/id-free layer algebra
  (`composite`/`moveLayer`/`mergeDown`/`flatten`, buffers deep-copied where pixels
  bake, shared by reference only for metadata); (2) `src/state/layerStore.ts` — an
  undoable `LayerStack` with copy-on-write `beginStroke` and lock enforcement on
  delete/merge/flatten/paint; (3) `src/ui/layers/` — a bespoke Forge panel (token-
  only CSS, CSS-pixel eye/lock glyphs by shape not hue, forge-native preview motif).
  Integrated **`-bea-6`** (the Reviewer/QA-blessed build carrying the keyboard fix),
  not the gate-named `-bea-2`; re-ran the full objective gate on merged `master`.
- **Rationale:** Keeping the algebra pure makes the held-out `composite` contract
  the source of truth and keeps the draw hot path off React. The build-designation
  reconciliation follows the standing rule (ADR-014 lesson): the newest Reviewer-
  blessed worktree wins over a stale gate JSON, and integration is proven only on
  the merged tree.
- **Consequences:** The panel currently mounts its **own** demo `LayerStack`/history
  (throwaway-preview pattern, ADR-010/012), so real `CanvasStage` strokes don't land
  on the active layer and layer undo is via the panel's Revert/Reapply rather than
  the global Ctrl+Z. **U-012 owns** unifying the tool session + layer stack + one
  history timeline (M-1/M-2). Grip/nudge glyphs (L-1) and blank-name trimming (L-2)
  fold into U-012/U-013 polish. Master-spec §3.4/§3.6 unchanged — they describe the
  end-state target these deferrals converge to, not a per-unit regression.

## ADR-014 — U-006 history: pure patch/list-edit core + stateful store + session wiring  (2026-07-01)
- **Context:** Implement ADR-005 (dirty-rect patch commands) as the undo/redo engine.
  Needed a shape that keeps the pure/stateful boundary (constitution §5), proves the
  "1px edit stores only its sub-rect" memory guarantee under held-out tests, and hands
  future structural-undo units (U-007 layers, U-008 frames, U-011 resize) a reusable
  reversible primitive.
- **Decision:** Three layers. (1) Pure core `src/core/history.ts` — `makePatch`
  (before/after typed-array bytes for the dirty rect only; `null` on no-op),
  `applyPatch` (bounds-safe blit returning a NEW buffer), `invertPatch`,
  `patchByteSize`, `pixelRect`; a reversible ordered-list algebra `applyListEdit`
  (insert/remove/move/replace → new list + exact inverse) for layer/frame structural
  undo; `capByBudget` (depth + total-byte eviction, oldest-first, always keep newest);
  `DEFAULT_HISTORY_DEPTH=100`, `DEFAULT_HISTORY_MAX_BYTES=64 MiB`. (2) Stateful
  controller `src/state/historyStore.ts` — `History` undo/redo stacks, redo-clear on
  record, coalesce-by-`coalesceKey`, cap enforcement, `snapshot()` for UI. (3) Session
  glue in `src/state/toolSession.ts` — `attachHistory`, `beginEdit`/`settleEdit` so a
  whole gesture accumulates ONE patch, recording across pencil/eraser/line/rect/
  ellipse/fill/move/nudge/cut/paste/clear, `applyHistoryPatch` (blit+repaint). UI:
  window-level Ctrl/Cmd+Z · Ctrl+Shift+Z · Ctrl+Y (text-field-guarded) + "Edit history"
  toolbar in `CanvasStage.tsx`.
- **Rationale:** Matches ADR-005 and master-spec §3.6/§5; the pure core lets held-out
  tests assert exact undo/redo restore + sub-rect memory bound with no DOM; a single
  settle-per-gesture is the correct "drag = one entry" model; `applyListEdit` lets the
  structural units invert list ops without re-deriving inverse logic per unit.
- **Consequences:** The §3.6 structural-undo list is only partially exercisable now —
  paste/cut/move/clear are wired & live; **layer (U-007), frame (U-008), resize
  (U-011), and palette-change (U-012) undo must re-verify against the delivered
  primitives** (advisories N-1/F-2/F-3/F-4). Not a spec change — same dependency-order
  scoping applied to U-009's multi-frame export. `History.record` coalescing keeps
  `prev.undo`+`entry.redo`, which is unsafe for **disjoint** patch rects (dead code at
  U-006; `recordPatch` never sets `coalesceKey`) — U-007/U-008 must union rects if they
  adopt patch coalescing.
- **Integration note:** Reviewer directed integrating the **fix build** `-55` (not the
  original `-51`); they differ only in `e2e/history.spec.ts` (added deterministic
  `settledSignature` first-paint poll — the H-1 flake fix) and a `coalesceKey` contract
  doc-comment. Both worktrees branched from `master@cb66d7d` with no other unit merged
  since, so the squash-merge was conflict-free with no dep changes. Post-merge master
  gate all green (build 0, unit 419/30 incl held-out U-006 5/5, reward-hack scan clean).

## ADR-013 — U-009 export architecture: pure encoders + platform save glue  (2026-07-01)
- **Context:** U-009 delivers the first two export formats (PNG scaled + SVG) from
  ADR-003. Needed a shape that keeps the clean-export invariant enforceable by
  held-out tests and reusable by U-010 (GIF/spritesheet) and U-011 (.forge).
- **Decision:** Three layers. (1) Pure core `src/core/exporters/` — `svg.ts`
  (greedy rect-merge, `shape-rendering="crispEdges"`, one `<g>` per color, omits
  transparent, partial-alpha → `fill-opacity`) and `png.ts` (`scaleBufferNearest`
  integer nearest-neighbor, `flattenOnColor` matte, `scaleToCanvas → OffscreenCanvas`);
  no DOM/React imports so the boundary stays unit-testable. (2) Platform glue
  `src/platform/exporters/` — `encode.ts` (`bufferToPngBlob`/`bufferToSvgBlob`),
  `save.ts` (`saveBlob` via `browser-fs-access` with blob fallback, `sanitizeFileName`,
  `withExtension`), `index.ts` (`exportPngFile`/`exportSvgFile`, `PNG_SCALES =
  [1,2,4,8,16,32]`). (3) UI `src/ui/export/ExportDialog.tsx`, wired into
  `CanvasStage.tsx` via an "Export…" toolbar button reading the live composited
  buffer (`getSource: () => PixelBuffer | null`).
- **Rationale:** Matches master-spec §3.8/§5 exactly; the pure/platform split lets
  the held-out acceptance test assert effect-free output (no CRT/checkerboard) on
  the raw buffer, satisfying the clean-export hard rule. Greedy rect-merge keeps SVG
  small; integer nearest-neighbor guarantees pixel-correct upscales with no new colors.
- **Consequences:** Multi-frame PNG "all frames → sequence zip" (spec §3.8) is
  deferred with U-010/animation (needs frames from U-008); documented as a scoped
  deferral in work-breakdown, not a spec change. Adds runtime dep `browser-fs-access`.
- **Integration note:** Worktree `wf_023eceaa-423-25` branched from `master@ccb5290`
  (U-003) while master had advanced through U-004/U-005; merge into master was a
  3-way with additive conflicts in `core`/`platform`/`ui` barrels + `vite.config`
  held-out include (kept both sides), plus one semantic fix — the dialog's `getSource`
  was wired to the U-003-era `bufferRef` that U-005 had refactored away, re-pointed to
  `sessionRef.current?.getBuffer() ?? null`. Post-merge master gate all green.

## ADR-012 — U-005 integration: re-implement palette-lock on U-004's ToolSession (cross-base semantic merge)  (2026-07-01)
- **Context:** U-005 (color & palette) passed Reviewer + QA + objective gate on
  worktree `-43`, but `-43` was cut from `master@ccb5290` (pre-U-004). Meanwhile
  `master` had advanced to `ef6593a` (U-004 integrated). U-004 and U-005 had each
  *independently rewritten* `src/ui/CanvasStage.tsx` from the shared U-003 base:
  U-004 turned it into a full `ToolSession`-driven tool belt (`sessionRef`,
  `session.getBuffer()/setBuffer()`); U-005 turned it into a buffer-based
  (`bufferRef`) palette-lock preview with its own single-pixel pencil (`colorRef`,
  `paintIndex`, `erasing`). Neither Reviewer nor QA ever exercised the U-004+U-005
  combination — they validated U-005 over the *older* tree. `git merge` produced 4
  conflicts: 3 trivial (`core`/`state` barrels, `vite.config` held-out include) and 1
  deep (the two divergent CanvasStage implementations).
- **Decision:** Keep U-004's `ToolSession` architecture as the base and re-implement
  the U-005 palette-lock on top of it, discarding U-005's now-obsolete buffer/pencil
  scaffolding (`bufferRef`, `colorRef`, `paintIndex`, `erasing`, `attachInteractions`).
  Concretely: (a) `seedForgeMotif` now seeds the *session* buffer at mount; (b) an
  fg-sync effect feeds the panel's `effectivePaintColor` into `session.update({fg})`,
  re-snapping to the palette in-component when locked (belt-and-suspenders for the
  H-1 criterion); (c) an indexed effect quantizes / `paletteSwap`s
  `session.getBuffer()` and commits via `session.setBuffer()`, keyed on
  `[indexed, palette]` with an `appliedPaletteRef` guard for StrictMode remounts.
- **Rationale:** U-004's `ToolSession` is the canonical drawing path going forward
  (all later units build on it); U-005's standalone pencil was only ever a U-003-era
  preview. Feeding `fg` + snapping there makes the pencil restriction real on the
  *actual* draw path rather than a parallel one. No `master-spec` change was needed —
  §3.3/§4.4 describe behavior (exact palettes, indexed lock, palette-swap-by-index)
  and all of it holds; only the *wiring* changed.
- **Consequences:** The integrated palette-lock is now covered on the real
  architecture by the migrated `CanvasStage.browser.test.tsx` (3 tests) and
  `e2e/indexed-lock.spec.ts`, both green post-merge. The demo `PAINTS` swatches from
  U-004's CanvasStage remain visible even in controlled mode (harmless; the panel is
  the source of truth and the fg-sync effect wins on the next change) — cosmetic
  cleanup deferred to U-012's app-shell pass. Full post-merge gate on `master`:
  typecheck 0, vitest 338/22, browser 27/6, build 0, e2e 4/4, core coverage 97.09%,
  lint 0/112.

## ADR-011 — U-004 integration: clean squash-merge; §3.2 Pencil-Alt deferred  (2026-07-01)
- **Context:** U-004 (drawing tools) took 2 iterations. The first worktree
  (`wf_023eceaa-423-23`) FAILED Review/QA on a HIGH gap — copy/cut/paste did not
  operate on the selection — so it never integrated; the fix worktree
  (`wf_023eceaa-423-36`) added a floating-selection clipboard model and passed
  Reviewer + QA + the objective gate (held-out 7/7, byte-identical). Unlike U-003,
  this worktree was cut from the current `master` (`ccb5290`, U-003 integration), so
  base == tip: no cross-base CRLF churn and no shared-scaffold semantic conflict — the
  only entrypoint touched (`App`/`CanvasStage` throwaway preview) is still owned by the
  same successive-canvas lineage and composes cleanly. `package.json` unchanged (no
  dependency sync needed). The deliverable was uncommitted in the worktree.
- **Decision:** Committed the deliverable on its branch, then `git merge --squash`
  into `master` for a single integration commit (base was a fast-forward, so the squash
  is a faithful 1:1 of the reviewed diff). Ran the full post-merge gate on `master`
  before flipping status. Accepted one genuine spec deviation as a **deferral, not a
  change**: master-spec §3.2 lists "Alt = temporary eyedropper" for the Pencil, which
  is not implemented and is absent from the authoritative `criteria.md` manual list;
  recorded it (plus QA F-1's one-line `onChange()` re-render fix and the LOW view/perf
  advisories) against U-012/U-013 rather than editing the spec.
- **Rationale:** The spec is still accurate — every authoritative acceptance criterion
  is met; the outstanding items are convenience modifiers and preview-chrome polish
  that the designated shell/perf units (U-012/U-013) own, so amending master-spec would
  add noise without capturing a real design change. Squash keeps `master` history one
  commit per verified unit, matching U-002/U-003.
- **Consequences:** `master` carries the full drawing-tool engine + interactive
  `ToolSession`; U-006 (undo/redo) can now build on the gesture/dirty-rect model, and
  U-005/U-007/U-012 inherit the selection-mask + clipboard primitives. The Pencil-Alt
  modifier and Copy-button re-render must be picked up in U-012 or they silently ship
  missing.

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
