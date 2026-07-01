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
