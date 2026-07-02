# Lessons — <PROJECT>

Durable **process** lessons learned during the build, so later units stop
repeating mistakes. Process and architecture only — never visual/style (each
project's design stays isolated and unique). Appended by the Doc agent whenever a
unit is verified, especially after a fix that took several iterations.

- **Whole-tree tooling trips over in-repo worktrees (U-001).** `biome check .`
  (and any `.`-scoped tool) run from the project root during integration walks into
  `.claude/worktrees/wf_*/`, finds the nested `biome.json`, and fails with "nested
  root configuration" — a false failure that has nothing to do with the deliverable.
  Root cause: the factory keeps build worktrees under `.claude/` inside the repo, and
  neither `.gitignore` nor `biome.json` excludes `.claude`. Process rule going
  forward: verify a unit's `.`-scoped checks against the committed deliverable
  (scope the tool to `src test e2e` + config files, or run in a clean checkout / CI),
  not the integration tree with live worktrees present. Ideal fix (needs a code
  agent, out of Doc scope): add `.claude/` to `.gitignore` and to `biome.json`
  `files.includes` as `!.claude`. CI is unaffected (clean checkout has no worktrees).
- **A unit that adds dependencies needs `npm install` in `master` before post-merge verify (U-002).**
  U-002 added four devDeps (`@fontsource/*`, `@vitest/browser-playwright`) that lived only in
  the worktree's `node_modules`. The squash-merge brought the updated `package.json`/lock into
  `master` but not the installed packages; running `build`/`test` straight away would fail (or
  silently use stale deps). Process rule: after merging a unit whose `package.json` changed, run
  `npm install` in the integration tree first, *then* run the post-merge gate (typecheck/test/
  build). Confirm the merge diff before installing so a tampered lockfile can't pull surprises.
- **Builder worktrees can hold the deliverable as uncommitted working-tree changes (U-002).**
  `worktree-wf_023eceaa-423-12` had zero commits past the U-001 base — the entire design system
  sat as unstaged/untracked files. A plain `git merge <branch>` from `master` would have been a
  no-op and silently "integrated" nothing. Process rule: before merging, verify the branch
  actually contains commits (`git log master..<branch>`); if the deliverable is uncommitted,
  stage+commit it on the branch first, then `git merge --squash` for a single clean integrate
  commit. Always re-check `git status`/`--stat` after the merge to confirm the files really landed.
- **A worktree branched from an older base needs genuine-diff filtering, not a raw merge (U-003).**
  `wf_023eceaa-423-13` was cut from the U-001 base (`a21e10e`) *before* U-002 landed, and
  predates `.gitattributes` (`eol=lf`), so its working tree showed ~20 files as "modified"
  that were **pure CRLF churn** plus a handful of real edits. A blind `git merge`/`--squash`
  would have reverted U-002's genuine changes to `main.tsx`/`index.ts`/`tokens.css` back to the
  a21e10e line-ending-normalized versions. Process rule: when a unit's base is behind `master`,
  isolate the real changes with `git diff --ignore-cr-at-eol <base>` first, then apply **only**
  those (new files + the files with non-whitespace diffs) onto `master`; never trust the raw
  "modified" set on a pre-`.gitattributes` worktree. Always re-run the full gate after.
- **Two units can silently fight over the same throwaway preview root (U-003).**
  Both U-002 and U-003 repurposed `App.tsx`/`App.css` as *their* runnable proof (U-002 →
  `DesignShowcase`, U-003 → `CanvasStage`), and U-002 had *deleted* `App.css`. Integration is
  not "pick one": compose them so no verified behavior is lost (U-002's `ThemeProvider`+
  `CrtOverlay` now wrap U-003's `CanvasStage`), and record which prior preview got unmounted
  (`DesignShowcase`) so it isn't assumed gone. Process rule: when consecutive units both edit a
  shared scaffolding entrypoint, expect a *semantic* conflict even when git reports no textual
  one, and reconcile by composition; defer the real assembly to the designated shell unit (U-012).
- **The U-001 `biome check .` nested-root fix is now applied (U-003).** Added `.claude/` (+
  `.factory.lock`) to `.gitignore`; Biome's `useIgnoreFile` now skips the in-repo build
  worktrees, so `npm run lint` (`biome check .`) passes unscoped (79 files, 0 issues) even with
  live worktrees present. The earlier "scope the tool / run in a clean checkout" workaround is no
  longer required for lint. Still prune spent worktrees at integration to keep the tree tidy.
- **Objective gate must target the winning worktree, not the first one (U-001).**
  The first gate/QA/review artifacts were written against the failed `-2` worktree
  (`artifactsPresent:false`) and had to be explicitly superseded by re-runs against
  the `-6` fix worktree. When a unit fixes across iterations, re-point Reviewer/QA/
  Verifier at the new worktree and mark the old artifacts as superseded to avoid a
  stale FAIL blocking a genuinely-passing build.
- **A green held-out gate does NOT mean full master-spec conformance — reconcile the
  spec section against `criteria.md` at integrate time (U-004).** The held-out
  `docs/acceptance/U-004` (7/7) and the authoritative `criteria.md` manual list both
  passed, yet master-spec §3.2 also lists a Pencil "Alt = temporary eyedropper"
  modifier that is simply not implemented — invisible to the gate because it was never
  encoded as a criterion. A stale `gate/U-004.json` still pointing at the failed `-23`
  worktree compounded the risk (the real PASS was `-36`). Process rule for the Doc
  agent: before flipping `verified`, (a) confirm the gate/review/QA artifacts all name
  the *same winning* worktree, and (b) diff the master-spec section against the
  held-out `criteria.md` and record every spec detail the criteria don't cover as an
  explicit deferral (decision-log + work-breakdown) — otherwise convenience details
  silently ship missing. Prefer recording a deferral over editing the spec when the
  detail is genuinely owned by a later unit (here U-012's modifier map).
- **When a worktree is cut from the current `master` tip, integration is a clean
  squash — but still commit-then-`--squash`, never a raw merge (U-004).** Unlike U-003
  (older base → CRLF churn) and U-002 (shared-scaffold semantic conflict), U-004's
  `-36` worktree branched from `master@ccb5290` with `package.json` unchanged, so
  base == tip and the squash was a faithful 1:1 of the reviewed diff (no genuine-diff
  filtering, no `npm install` needed). The deliverable was still *uncommitted* in the
  worktree, so the U-002 rule held: `git add -A && commit` on the branch first, then
  `git merge --squash` from `master`, then re-run the full gate on `master` before
  flipping status. Confirm base==tip cheaply with `git log master..<branch>` (empty
  before the commit) + an empty `package.json`/lock diff to know the easy path applies.
- **A worktree cut from an old master must be re-tested *combined with* the units
  that landed since — Reviewer/QA "PASS" on the stale base is not enough (U-005).**
  U-005's `-43` worktree branched from `master@ccb5290` (pre-U-004) and was reviewed,
  QA'd, and gated there. All three passed — but every one of them validated U-005 over
  a tree that did **not** contain U-004. Because U-004 and U-005 had *independently*
  rewritten the same file (`src/ui/CanvasStage.tsx`) from the shared U-003 base, the
  integration was a genuine 3-way semantic merge, and the U-004+U-005 combination had
  literally never been executed before the Doc agent ran it. Process rules for the
  Doc/integrator: (a) before trusting a green upstream gate, check the worktree's base
  (`git merge-base <branch> master`) against the current `master` tip — if it is
  behind, expect real conflicts and treat the upstream PASS as "passed in isolation,
  not integrated"; (b) when two units touch the same file from a common ancestor,
  reconcile onto the *newer* architecture (here U-004's `ToolSession`) and re-implement
  the older unit's feature on it rather than pasting the older unit's now-divergent
  code; (c) the only gate that counts for flipping `verified` is the full suite re-run
  on the merged `master` — here it caught nothing broken only because the feature was
  re-wired deliberately and the migrated browser/e2e tests were re-run to prove the
  palette-lock still holds on the new draw path. Never mark `verified` off the
  worktree's own gate when the base was stale.
- **A merge updates the manifest, not `node_modules`; sync deps before trusting the
  post-merge gate — and trust the compiler over git's "clean merge" (U-009).** U-009
  added a runtime dep (`browser-fs-access`) in the worktree, so its upstream gate was
  green *because that worktree had already `npm install`ed it*. Merging into `master`
  brought the new `package.json`/`package-lock.json` entries but **not** the installed
  package, so the very first post-merge `npm run typecheck` failed with a false red
  (`Cannot find module 'browser-fs-access'`) that had nothing to do with the code.
  Process rule for the Doc/integrator: whenever a merge touches `package.json`/lock,
  run `npm install` to reconcile `node_modules` *before* running the gate, then re-run
  from clean — do not diagnose the code off an unsynced environment. Second half of the
  same lesson: git resolved most of `CanvasStage.tsx` as a *clean* textual 3-way merge
  yet left a dangling reference — the dialog's `getSource` still pointed at the U-003-era
  `bufferRef` that U-005 had refactored into `sessionRef.current.getBuffer()`. No
  conflict marker flagged it; only `tsc` did. A conflict-marker-free merge is not a
  correct merge — a green typecheck/build on the merged tree is the real proof, so run
  it even when `git merge` reports zero conflicts.
- **When a unit re-enters the loop over a FLAKY test, integrate the reviewer-named fix
  build and prove the code is untouched — never trust the earliest-recorded gate (U-006).**
  U-006's first gate/verifier evidence pointed at worktree `-51`, but that build FAILED
  Review on a HIGH: a race-flaky `e2e/history.spec.ts` (baseline sampled before first
  paint, ~25%/run under 6-worker load). The builder produced a superset fix build `-55`,
  and the Reviewer explicitly instructed "integrate `-55`, not `-51`." A stale reading of
  the objective-gate JSON (which named `-51`) would have merged the flaky build. Process
  rules for the Doc/integrator: (a) read the **Review verdict's handoff line** for which
  worktree to integrate — the gate JSON may reference an earlier sibling; the newest
  Reviewer-blessed build wins. (b) For a flake fix, confirm it is **test-only** before
  merging: `diff` the production files between the original and fix worktrees
  (`-51` vs `-55` differed only in the e2e spec + a doc-comment; zero undo/redo logic
  changed) — a test-only delta means the already-verified engine still holds and you are
  not re-validating logic, only de-flaking. (c) A single green gate does NOT clear a
  flake — the Reviewer's 84× stress run under the exact 6-worker load (0 failures, incl.
  16 runs of the previously-flaky test) is the evidence that closes it; a lone pass could
  be the ~75% that happened to succeed. (d) Still re-run the full gate on merged `master`
  regardless (build 0 / 419 tests / reward-hack clean here) — integration is only proven
  on the merged tree, per the standing rule above.
- **When a fix loop spawns multiple sibling worktrees under one workflow id, the
  objective-gate JSON can name an *earlier* sibling than the one Review AND QA
  actually blessed — reconcile all three before merging (U-007).** U-007's lineage
  was `-6be-2` (Review FAIL) → `-bea-2` (gate PASS but QA/Review FAIL on a WCAG
  2.1.1 keyboard blocker) → `-bea-6` (the keyboard fix). `docs/gate/U-007.json`
  recorded PASS against `-bea-2`, yet both `docs/reviews/U-007.md` and
  `docs/qa/U-007.md` had moved on and passed only `-bea-6` (a small `CanvasStage.tsx`
  guard + regression tests on top of `-bea-2`). Worse, the round-1 QA artifacts
  under `docs/qa/U-007-artifacts/` referenced a *third*, superseded architecture
  (`-6be-2`'s `layersController`, which failed 2/5 held-out) — stale evidence that
  would mislead a naive reader. Process rules for the Doc/integrator: (a) the build
  to integrate is the one the **Review verdict + QA both name in their handoff**,
  not whatever the gate JSON references — when they disagree, the newest build that
  Review *and* QA blessed wins, and you must re-run the objective gate on it (I did:
  `-bea-6` post-merge on master = build 0, 473/33, held-out 5/5). (b) A builder's
  worktree branch may sit at the same commit as `master` with all deliverables
  **uncommitted** in the working tree — commit them on the worktree branch first,
  then `merge --no-ff`, so the integration is a real reviewable merge and not a
  pile of loose files. (c) Treat older `-artifacts/` logs as stale unless their
  named worktree matches the integrated build; cite only the round that validated
  the merged build so the docs don't drift.
- **An empty held-out acceptance dir makes the objective gate's "held-out tests
  pass" check pass *vacuously* — a silent hole in the verification story (U-008).**
  `docs/acceptance/U-008/` shipped only `criteria.md` with no `*.acceptance.test.ts`
  (unlike U-003/U-004/U-006/U-007/U-009, which each ship one). The builder correctly
  added the `docs/acceptance/U-008/**` include glob to `vite.config.ts` and correctly
  refused to author files inside the protected dir — so the glob matched **zero**
  files and the gate reported "held-out tests pass" while running *nothing*
  builder-independent. The gate JSON's own `evidence` even flagged this, yet all four
  headline criteria (`build=0`, `test=0`, artifacts present, no reward-hack) were
  literally satisfied, so nothing *blocked*. Root cause: the held-out suite is an
  Architect/manager deliverable authored **before** the unit builds, and that step
  was skipped for U-008; the Verifier treats "glob matched 0 files" as a pass rather
  than an alarm. Process rules going forward: (a) the Architect must author each
  unit's `docs/acceptance/<unit>/*.acceptance.test.ts` (importing ONLY that unit's
  pure `src/core/*` module per the boundary rule) as a build precondition, and the
  Plan step should refuse to mark a unit `ready` if its acceptance dir has only
  `criteria.md`; (b) the objective gate must treat a held-out include glob that
  matches **zero** files as a FAIL (or an explicit `heldOutFilesMatched: 0` flag the
  Verifier must clear), never a silent pass — a vacuous check is worse than no check
  because it reads green. For U-008 this is a tracked manager action item (M-1),
  scheduled before U-013's global acceptance run; it is explicitly **not** a builder
  reward-hack (nothing was deleted or weakened) and the four machine-checkable
  criteria are independently covered by QA's own unit/browser/e2e re-runs.
