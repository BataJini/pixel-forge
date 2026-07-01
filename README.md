# PixelForge

> Hammer pixels into sprites.

A fast, beautiful, **fully client-side** browser pixel-art editor. No accounts,
no server, works offline after first load. This repository is built unit by unit
(see `docs/work-breakdown.md`); **U-001** establishes the project scaffold,
tooling, and CI/deploy.

## Stack

| Concern | Choice |
| --- | --- |
| Build / dev server | **Vite 7** |
| UI | **React 19** + **TypeScript 5.9** |
| Lint & format | **Biome 2** (one tool, no ESLint/Prettier) |
| Unit tests | **Vitest 4** (Node) + **Browser Mode** via Playwright provider |
| E2E | **Playwright** |
| Deploy | **GitHub Pages** (default) / **Cloudflare Pages** |

## Module boundaries (`src/`)

The codebase is organized by responsibility, and downstream held-out tests import
the pure engine by exact path — do not rename these folders:

- `src/core/` — pure, deterministic engine primitives. **No React/DOM/browser globals.**
- `src/ui/` — React components, panels, dialogs, app shell.
- `src/state/` — application state stores (Zustand).
- `src/platform/` — browser glue (Canvas, files, IndexedDB, audio, workers).

Design tokens (the single source of visual truth, derived from
`docs/design-direction.md`) live in `src/styles/tokens.css` as CSS variables.

## Getting started

```bash
npm ci
npm run dev      # start the dev server
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) then build a static `dist/` |
| `npm run preview` | Serve the built `dist/` on the base path |
| `npm test` | Vitest unit run (Node, fast, no browser) |
| `npm run coverage` | Unit run with V8 coverage (80% threshold on `src/core`) |
| `npm run test:browser` | Vitest Browser Mode in real Chromium (`*.browser.test.tsx`) |
| `npm run test:e2e` | Playwright E2E smoke |
| `npm run lint` | Biome lint + format check |
| `npm run format` | Biome auto-format |
| `npm run typecheck` | `tsc -b` (no emit) |

The first time you run browser/E2E tests locally, install the browser:
`npx playwright install chromium`.

## Base path & deploy

The app is served under a configurable base path (`VITE_BASE`, default
`/pixel-forge/` for a GitHub Pages project site).

- **GitHub Pages** — `.github/workflows/ci.yml` lints, typechecks, tests, and
  builds on every push/PR, then deploys `dist/` to Pages from `main`. Enable
  Pages → "GitHub Actions" in repo settings.
- **Cloudflare Pages** — build command `npm run build`, output directory `dist`.
  Set `VITE_BASE=/` (root domain) in the project's environment variables.

## Conventions

- **TDD**: failing test first, then implement, then refactor.
- Immutability by default; the only mutable state is the per-layer pixel buffer,
  mutated exclusively through the (later) buffer API and captured as history
  patches (see `docs/constitution.md`).
- No network at runtime; fonts and assets are self-hosted.
