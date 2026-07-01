import { expect, test } from '@playwright/test';

const BASE = process.env.VITE_BASE ?? '/pixel-forge/';

// End-to-end smoke: the built app boots on its base path and renders the shell.
test('app boots and shows the PixelForge wordmark', async ({ page }) => {
  await page.goto(BASE);

  const heading = page.getByRole('heading', { level: 1, name: 'PixelForge' });
  await expect(heading).toBeVisible();

  await expect(page).toHaveTitle(/PixelForge/);
});

test('has no uncaught console errors on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(errors).toEqual([]);
});
