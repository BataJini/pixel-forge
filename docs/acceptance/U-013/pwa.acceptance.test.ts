// Held-out acceptance — U-013 PWA manifest + service worker presence. Builder must NOT edit.
// Targets master-spec §8 (installable, offline). Runs against the production build in
// dist/ (the objective gate runs `npm run build` first). Browser-level a11y / offline /
// keyboard-only checks live in e2e/a11y-pwa.spec.ts (Playwright + axe).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = (p: string): string => resolve(process.cwd(), 'dist', p);

describe('U-013 held-out acceptance — installable PWA build artifacts', () => {
  it('a service worker is emitted', () => {
    expect(existsSync(dist('sw.js'))).toBe(true);
  });

  it('the web app manifest declares an installable, standalone app', () => {
    const path = dist('manifest.webmanifest');
    expect(existsSync(path)).toBe(true);
    const m = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(m.name).toBeTruthy();
    expect(m.display).toBe('standalone');
    expect(typeof m.start_url).toBe('string');
    expect(typeof m.theme_color).toBe('string');
  });

  it('the manifest ships 192 + 512 icons including a maskable one', () => {
    const m = JSON.parse(readFileSync(dist('manifest.webmanifest'), 'utf8')) as {
      icons?: { sizes?: string; purpose?: string; src?: string }[];
    };
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512')).toBe(true);
    expect(icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBe(true);
    // the referenced icon files physically exist in the build
    for (const i of icons) {
      if (i.src) {
        expect(existsSync(dist(i.src))).toBe(true);
      }
    }
  });
});
