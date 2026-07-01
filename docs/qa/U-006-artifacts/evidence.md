# U-006 QA — raw evidence log

Worktree: `.claude/worktrees/wf_023eceaa-423-51` (branch `worktree-wf_023eceaa-423-51`, base `cb66d7d`).
Node v24.14.1 / npm 11.11.0. All commands run in the worktree.

## Objective commands (real exit codes observed)

| Command | Result | Exit |
|---|---|---|
| `npm test` (vitest run) | 30 files / **419 tests passed** (incl. held-out `docs/acceptance/U-006`) | 0 |
| `npx vitest run` (U-006 files only, verbose) | **47 passed** — held-out 5/5, core 24, store 15, session 8, cap 3 | 0 |
| `npm run typecheck` (`tsc -b`) | no errors | 0 |
| `npm run lint` (`biome check .`) | Checked 133 files, no fixes | 0 |
| `npm run coverage` | All files 96.43% stmts; **core 97%**, **history.ts 96.15% stmts / 92.59% br / 88.88% fn**; ≥80 thresholds met | 0 |
| `npm run build` (`tsc -b && vite build`) | dist emitted; index JS 279.00 kB (gzip 88.64 kB), CSS 26.47 kB | 0 |
| `npm run test:browser` (Vitest Browser Mode, real Chromium) | 8 files / **38 passed** | 0 |
| `npx playwright test` | **9 passed** — history.spec 3/3, export 2/2, indexed-lock 2/2, smoke 2/2 (incl. "no uncaught console errors on load") | 0 |

Held-out `docs/acceptance/U-006/history.acceptance.test.ts` is byte-identical to `master` (git shows no modification) and passes as part of `npm test`.

## Live manual QA (preview server `http://localhost:4188/pixel-forge/`, real mouse/keyboard)

Display-canvas pixel signature = position-weighted sum of `getImageData` (identical buffers → identical value; any change perturbs it).

Run 1 — drag + buttons:
- baseline: `0 steps`, Undo+Redo disabled, sig=1595462337
- after one continuous drag (8 moves): `1 step`, Undo enabled, sig=50101703 (changed)
- Undo button: `0 steps`, Undo disabled/Redo enabled, sig=**1595462337 (exact baseline)**
- Redo button: `1 step`, Redo disabled/Undo enabled, sig=**50101703 (exact drawn)**

Run 2 — keyboard + depth + redo-clear + structural Clear:
- three distinct strokes → `3 steps`
- Ctrl+Z ×3 → sig == base, `0 steps`, Undo disabled
- Ctrl+Y, Ctrl+Shift+Z, Ctrl+Y → sig == 3-stroke sig, `3 steps` (both redo bindings work)
- undo then a NEW stroke → Redo disabled (redo stack cleared)
- Clear button → `3 steps`→`4 steps` (one entry), pixels changed; Undo restores pre-Clear exactly

Run 3 — text-guard + paste:
- Ctrl+Z while focused in Hex `<input>` → step count & sig unchanged (window handler correctly ignores form fields)
- select→Ctrl+C→Ctrl+V→Arrow nudges→Enter (commit) → `1 step`→`2 steps` (paste = ONE entry), pixels changed; Undo restores pre-paste exactly

Run 4 — depth cap in the running app:
- 110 distinct single-pixel edits → readout caps at **`100 steps`**; draining Undo yields exactly **100** undos (oldest 10 evicted). `capHeldAt100 = true`.
- (First two cap attempts returned 8 / 0 entries — a leftover marquee selection from the prior run constrained the pencil and my well-relative grid missed art pixels; both were harness-state/coordinate artifacts, resolved by Escape-deselect + calibrated pixel centers. Not app faults.)

Console after all interaction: only 2 errors, both extension-origin — `http://localhost:4188/meta.json` (MetaMask) and `browserextension.trustpilot.com` — plus MetaMask contentscript warnings. **Zero app-origin errors**; all `/pixel-forge/**` requests returned 200. Matches the clean Playwright "no uncaught console errors" E2E.

Screenshot: `live-app-2-steps.png` (seeded Forge motif + two test strokes, Undo enabled / Redo disabled / "2 steps").
