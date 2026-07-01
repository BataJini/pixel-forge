// Vendor the self-hosted pixel fonts from their @fontsource packages into
// src/assets/fonts/ so the .woff2 files live IN the repo (committed) and the app
// makes zero third-party font requests at runtime (constitution: no runtime
// network; design-direction: self-hosted .woff2 via Fontsource, all OFL).
//
// Run: `npm run fonts:vendor`. Deterministic; safe to re-run. The @fontsource/*
// packages are devDependencies used ONLY as the provenance source here — nothing
// imports them at runtime; src/styles/fonts.css declares our own @font-face rules
// against the vendored files.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dest = join(root, 'src', 'assets', 'fonts');
const src = join(root, 'node_modules', '@fontsource');

/** @type {ReadonlyArray<readonly [string, string]>} package → subset-weight file */
const FILES = [
  ['press-start-2p', 'press-start-2p-latin-400-normal.woff2'],
  ['pixelify-sans', 'pixelify-sans-latin-400-normal.woff2'],
  ['pixelify-sans', 'pixelify-sans-latin-500-normal.woff2'],
  ['pixelify-sans', 'pixelify-sans-latin-600-normal.woff2'],
  ['pixelify-sans', 'pixelify-sans-latin-700-normal.woff2'],
  ['silkscreen', 'silkscreen-latin-400-normal.woff2'],
  ['silkscreen', 'silkscreen-latin-700-normal.woff2'],
  ['vt323', 'vt323-latin-400-normal.woff2'],
];

mkdirSync(dest, { recursive: true });
for (const [pkg, file] of FILES) {
  copyFileSync(join(src, pkg, 'files', file), join(dest, file));
  process.stdout.write(`vendored ${file}\n`);
}
process.stdout.write(`Done: ${FILES.length} font files -> src/assets/fonts/\n`);
