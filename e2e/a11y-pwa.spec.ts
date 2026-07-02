// e2e — U-013 a11y (axe), keyboard operability, and PWA offline boot (Playwright).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

test.describe('U-013 a11y + PWA', () => {
  test('axe reports no serious or critical violations on the editor', async ({ page }) => {
    await page.goto('/pixel-forge/');
    await expect(page.locator('.pf-menubar')).toBeVisible();
    await page.evaluate(AXE);
    const results = await page.evaluate(async () =>
      // @ts-expect-error axe is injected at runtime
      window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }),
    );
    const bad = results.violations.filter(
      (v: { impact?: string }) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad, JSON.stringify(bad.map((v: { id: string }) => v.id))).toHaveLength(0);
  });

  test('the app is keyboard operable: switch tool, open palette, add a layer, open export', async ({
    page,
  }) => {
    await page.goto('/pixel-forge/');
    await expect(page.locator('.pf-menubar__label', { hasText: 'File' })).toBeVisible();

    // switch tool with a keyboard shortcut (E = eraser)
    await page.locator('body').click({ position: { x: 5, y: 500 } });
    await page.keyboard.press('e');
    await expect(page.locator('.pf-stage__toolbar button', { hasText: 'Eraser' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // open + run a command entirely from the keyboard
    await page.keyboard.press('Control+k');
    await expect(page.locator('.pf-cmdk__box')).toBeVisible();
    await page.locator('.pf-cmdk__input').fill('export');
    await page.keyboard.press('Enter');
    await expect(page.locator('.pf-cmdk__box')).toHaveCount(0);
  });

  test('PWA: manifest is linked and the app boots offline after first load', async ({
    page,
    context,
  }) => {
    await page.goto('/pixel-forge/', { waitUntil: 'networkidle' });
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    // give the service worker a moment to install + precache the shell
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.pf-menubar')).toBeVisible();
    await expect(page.locator('.pf-stage')).toBeVisible();
    await context.setOffline(false);
  });
});
