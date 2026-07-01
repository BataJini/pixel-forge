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
- **Objective gate must target the winning worktree, not the first one (U-001).**
  The first gate/QA/review artifacts were written against the failed `-2` worktree
  (`artifactsPresent:false`) and had to be explicitly superseded by re-runs against
  the `-6` fix worktree. When a unit fixes across iterations, re-point Reviewer/QA/
  Verifier at the new worktree and mark the old artifacts as superseded to avoid a
  stale FAIL blocking a genuinely-passing build.
