import { expect, type Locator, type Page, test } from '@playwright/test';

const BASE = process.env.VITE_BASE ?? '/pixel-forge/';

// End-to-end for U-007 (Layers panel & management). Drives the REAL built app as a
// user would — add / undo / reorder / visibility / delete-guard / flatten — and
// asserts on the accessible DOM state (layer rows, names, aria, button enablement)
// so the flow is deterministic (no canvas-pixel race). The panel seeds three
// forge-native layers (Anvil / Heat / Sparks) with Sparks active on top.

const panel = (page: Page): Locator => page.locator('.pf-layers');
const rows = (page: Page): Locator => panel(page).locator('.pf-layer');
const names = async (page: Page): Promise<string[]> =>
  panel(page)
    .locator('.pf-layer__name')
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await expect(panel(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  expect(await names(page)).toEqual(['Sparks', 'Heat', 'Anvil']); // top-first
});

test('add a layer, then undo and redo it', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(panel(page).locator('.pf-layers__status')).toContainText('4 layers');

  await panel(page).getByRole('button', { name: 'Revert last layer change' }).click();
  await expect(rows(page)).toHaveCount(3);

  await panel(page).getByRole('button', { name: 'Reapply last layer change' }).click();
  await expect(rows(page)).toHaveCount(4);
});

test('reorder a layer with the move-down button', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Move layer Sparks down' }).click();
  // Sparks moves below Heat; the new top row is Heat.
  await expect.poll(() => names(page)).toEqual(['Heat', 'Sparks', 'Anvil']);
});

test('toggle a layer visibility', async ({ page }) => {
  const hide = panel(page).getByRole('button', { name: 'Hide layer Sparks' });
  await hide.click();
  await expect(panel(page).getByRole('button', { name: 'Show layer Sparks' })).toBeVisible();
});

test('cannot delete the last remaining layer', async ({ page }) => {
  const del = panel(page).getByRole('button', { name: 'Delete', exact: true });
  await del.click();
  await expect(rows(page)).toHaveCount(2);
  await del.click();
  await expect(rows(page)).toHaveCount(1);
  await expect(del).toBeDisabled(); // last-layer guard
});

test('flatten asks to confirm, then collapses to one layer', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Flatten', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Flatten all' }).click();
  await expect(rows(page)).toHaveCount(1);
});

// U-007 F-3 regression (WCAG 2.1.1, Level A): the whole app is mounted, so
// CanvasStage's window-level keydown handler is active. It must NOT hijack the
// native Enter/Space activation of a focused Layers-panel control. Before the fix
// the handler `preventDefault()`ed Enter/Space for every non-text target, leaving
// the panel entirely keyboard-inoperable.
test('Enter on a focused panel button activates it (keyboard operable)', async ({ page }) => {
  const add = panel(page).getByRole('button', { name: 'Add', exact: true });
  await add.focus();
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(4); // native activation fired → layer added
});

test('Space on a focused visibility toggle activates it (keyboard operable)', async ({ page }) => {
  const eye = panel(page).getByRole('button', { name: 'Hide layer Sparks' });
  await eye.focus();
  await expect(eye).toBeFocused();
  await page.keyboard.press('Space');
  // Space activation toggles visibility → the control relabels to "Show layer Sparks".
  await expect(panel(page).getByRole('button', { name: 'Show layer Sparks' })).toBeVisible();
});
