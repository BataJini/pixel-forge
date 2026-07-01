import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Vitest 4 Browser Mode via the Playwright provider (real Chromium).
// Runs ONLY *.browser.test.tsx and is intentionally separate from `npm test`
// so the default unit run stays fast and needs no browser download.
// Requires a browser: `npx playwright install chromium`.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.browser.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
