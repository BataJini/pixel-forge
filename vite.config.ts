/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Base path for a GitHub Pages project site (https://<user>.github.io/pixel-forge/).
// Overridable via VITE_BASE (e.g. "/" for Cloudflare Pages or a custom domain).
const base = process.env.VITE_BASE ?? '/pixel-forge/';

// https://vite.dev/config/  +  https://vitest.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    // U-013 — installable, offline-capable PWA. Workbox precaches the built app
    // shell so a second (or offline) load boots and lets the user draw + export
    // with no network. No third-party requests (fonts are self-hosted).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        navigateFallback: `${base}index.html`,
      },
      manifest: {
        name: 'PixelForge',
        short_name: 'PixelForge',
        description:
          'A fast, fully client-side browser pixel-art editor. Hammer pixels into sprites.',
        theme_color: '#06070c',
        background_color: '#06070c',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
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
    // Colocated unit tests (src/**) plus the standalone suites under tests/ — the
    // module-boundary scaffold and the held-out acceptance suites in tests/acceptance/
    // (one folder per unit). The acceptance suites import the pure engine by exact
    // path and are the authoritative, independently-runnable spec for each unit.
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
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
