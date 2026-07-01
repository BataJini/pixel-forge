# Held-out acceptance — U-001 Scaffold + tooling + CI/deploy

> Authoritative. Builder must NOT edit. Verifier runs these.

## Machine-checkable
1. `npm ci` (or `npm install`) exits 0.
2. `npm run build` exits 0 and produces `dist/index.html` plus hashed JS/CSS assets.
3. `npm test` runs the configured runner (Vitest) and the sample test passes (exit 0).
4. `npm run lint` (Biome) exits 0 on a clean tree.
5. TypeScript typecheck (`tsc --noEmit` or build) exits 0.
6. Repository contains the module folders: `src/core/`, `src/ui/`, `src/state/`,
   `src/platform/`.
7. Playwright is installed and an E2E config exists; `npx playwright test` is
   runnable (may be a single smoke test).
8. Vite `base` is configured for the chosen static host; a deploy config/workflow
   file exists (e.g. `.github/workflows/*.yml` or Cloudflare Pages config).

## Manual / review
- Dev server (`npm run dev`) boots and serves the app locally.
- No secrets committed; `.gitignore` covers `node_modules`, `dist`, env files.
