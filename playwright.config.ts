import { defineConfig, devices } from '@playwright/test';

// The app is served under the Vite `base`. Keep this in sync with vite.config.ts.
const BASE = process.env.VITE_BASE ?? '/pixel-forge/';
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

// https://playwright.dev/docs/test-configuration
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `${ORIGIN}${BASE}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build then serve the static app on the base path so `npx playwright test`
    // works from a clean checkout with no separate build step.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `${ORIGIN}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
