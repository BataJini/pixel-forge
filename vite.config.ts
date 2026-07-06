import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

// Base path for a GitHub Pages project site (https://<user>.github.io/pixel-forge/).
// Overridable via VITE_BASE (e.g. "/" for Cloudflare Pages or a custom domain).
const base = process.env.VITE_BASE ?? '/pixel-forge/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    // Installable, offline-capable PWA. Workbox precaches the built app shell so a
    // second (or offline) load boots and lets the user draw + export with no network.
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
});
