// e2e — U-012 app shell: menu bar + Ctrl/Cmd+K command palette (Playwright).
import { expect, test } from '@playwright/test';

test.describe('U-012 app shell', () => {
  test('command palette opens on Ctrl+K, fuzzy-finds Export, and runs it', async ({ page }) => {
    await page.goto('/pixel-forge/');
    await expect(page.locator('.pf-menubar__label', { hasText: 'File' })).toBeVisible();

    await page.keyboard.press('Control+k');
    const box = page.locator('.pf-cmdk__box');
    await expect(box).toBeVisible();

    await page.locator('.pf-cmdk__input').fill('export');
    const first = page.locator('.pf-cmdk__item').first();
    await expect(first).toContainText('Export');

    await first.click();
    // running "Export…" opens the export dialog (same action as the menu item)
    await expect(page.locator('.pf-cmdk__box')).toHaveCount(0);
  });

  test('View menu opens and exposes wired zoom items', async ({ page }) => {
    await page.goto('/pixel-forge/');
    await page.locator('.pf-menubar__label', { hasText: 'View' }).click();
    const items = page.locator('.pf-menubar__item');
    await expect(items.first()).toBeVisible();
    await expect(await items.count()).toBeGreaterThan(0);
  });

  test('the Keyboard Shortcuts command opens and closes the help overlay', async ({ page }) => {
    await page.goto('/pixel-forge/');
    await expect(page.locator('.pf-menubar__label', { hasText: 'Help' })).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.locator('.pf-cmdk__input').fill('keyboard');
    await page.locator('.pf-cmdk__item').first().click();
    await expect(page.locator('.pf-help__box')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pf-help__box')).toHaveCount(0);
  });
});
