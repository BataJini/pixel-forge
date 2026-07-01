import { expect, test } from '@playwright/test';

const BASE = process.env.VITE_BASE ?? '/pixel-forge/';

// End-to-end U-009: open the Export dialog from the editor and confirm a real
// PNG/SVG download fires. We remove `showSaveFilePicker` first so browser-fs-access
// takes its blob-download fallback (the path Firefox/Safari users get, and the
// only one Playwright can intercept) — this also asserts the fallback works.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Force the browser-fs-access blob-download fallback (the Firefox/Safari path,
    // and the only save route Playwright can intercept). browser-fs-access gates on
    // `'showOpenFilePicker' in self`; the File System Access entry points are
    // configurable own properties of the global, so delete them before the app
    // bundle evaluates and computes `supported`.
    const g = globalThis as Record<string, unknown>;
    delete g.showOpenFilePicker;
    delete g.showSaveFilePicker;
  });
  await page.goto(BASE);
});

test('opens the Export dialog and downloads a PNG of the drawn art', async ({ page }) => {
  await page.getByRole('button', { name: 'Export…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('PNG scale')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export PNG' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('pixelforge.png');
  await expect(dialog.getByText(/PNG exported/)).toBeVisible();
});

test('downloads an SVG from the Export dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export SVG' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('pixelforge.svg');
});
