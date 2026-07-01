/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Base path for a GitHub Pages project site (https://<user>.github.io/pixel-forge/).
// Overridable via VITE_BASE (e.g. "/" for Cloudflare Pages or a custom domain).
const base = process.env.VITE_BASE ?? '/pixel-forge/';

// https://vite.dev/config/  +  https://vitest.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    // Fast, DOM-free unit run. Pure engine (src/core) is testable in isolation.
    // Component/DOM behavior is covered by Vitest Browser Mode (test:browser)
    // and Playwright E2E (test:e2e) in real browsers.
    environment: 'node',
    // Held-out acceptance tests live in docs/acceptance/<unit>/ and import the pure
    // engine by exact path. Each unit ACTIVATES its own held-out suite here once the
    // modules it targets exist, so `npm test` (and the objective gate) exercises the
    // authoritative tests for every built unit while leaving future units' tests —
    // which reference not-yet-built modules — out of the run. Builder never edits the
    // test files themselves (constitution); activating an already-present file only
    // makes the independent gate reproducible via `npm test`.
    include: [
      'src/**/*.test.{ts,tsx}',
      'test/**/*.test.{ts,tsx}',
      'docs/acceptance/U-003/**/*.test.{ts,tsx}',
      'docs/acceptance/U-004/**/*.test.{ts,tsx}',
      'docs/acceptance/U-005/**/*.test.{ts,tsx}',
      'docs/acceptance/U-006/**/*.test.{ts,tsx}',
      'docs/acceptance/U-009/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/*.browser.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
