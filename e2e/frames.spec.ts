import { expect, type Locator, type Page, test } from '@playwright/test';

const BASE = process.env.VITE_BASE ?? '/pixel-forge/';

// End-to-end for U-008 (Animation frames + timeline + onion skin). Drives the REAL
// built app as a user would — add / duplicate / delete-guard / reorder / add-layer /
// onion toggle / step / play-pause / undo — and asserts on the accessible DOM state
// (frame cells, aria, status, stable data-frame-id order) so the flow is
// deterministic. The timeline seeds four forge frames (a hammer-strike loop) with
// frame 1 active.

const panel = (page: Page): Locator => page.locator('.pf-frames');
const cells = (page: Page): Locator => panel(page).locator('.pf-frame');
const order = async (page: Page): Promise<string[]> =>
  cells(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-frame-id') ?? ''));
const activeIndex = async (page: Page): Promise<number> =>
  cells(page).evaluateAll((els) =>
    els.findIndex((el) => el.getAttribute('aria-current') === 'true'),
  );

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await expect(panel(page)).toBeVisible();
  await expect(cells(page)).toHaveCount(4);
  expect(await order(page)).toEqual(['frame-1', 'frame-2', 'frame-3', 'frame-4']);
});

test('add a frame, then undo and redo it', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Add frame', exact: true }).click();
  await expect(cells(page)).toHaveCount(5);
  await expect(panel(page).locator('.pf-frames__status')).toContainText('5 frames');

  await panel(page).getByRole('button', { name: 'Revert last frame change' }).click();
  await expect(cells(page)).toHaveCount(4);

  await panel(page).getByRole('button', { name: 'Reapply last frame change' }).click();
  await expect(cells(page)).toHaveCount(5);
});

test('duplicate the active frame', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(cells(page)).toHaveCount(5);
});

test('reorder a frame with the move-later button', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Move frame 1 later' }).click();
  await expect.poll(() => order(page)).toEqual(['frame-2', 'frame-1', 'frame-3', 'frame-4']);
});

test('per-frame duration input is editable', async ({ page }) => {
  const dur = cells(page).first().locator('.pf-frame__durinput');
  await dur.fill('300');
  await dur.blur();
  await expect(dur).toHaveValue('300');
});

test('add a layer to every frame keeps the layer set aligned', async ({ page }) => {
  await expect(panel(page).locator('.pf-frames__status')).toContainText('2 layers'); // Anvil + Spark
  await panel(page).getByRole('button', { name: '+ Layer (all frames)' }).click();
  await expect(panel(page).locator('.pf-frames__status')).toContainText('3 layers');
});

test('cannot delete the last remaining frame', async ({ page }) => {
  const del = panel(page).getByRole('button', { name: 'Delete', exact: true });
  await del.click();
  await expect(cells(page)).toHaveCount(3);
  await del.click();
  await del.click();
  await expect(cells(page)).toHaveCount(1);
  await expect(del).toBeDisabled(); // last-frame guard
});

test('onion skin toggles the ghost overlay', async ({ page }) => {
  // Default-on: a ghost overlay canvas is present under the current frame.
  await expect(panel(page).locator('.pf-fpreview__onion')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Disable onion skin' }).click();
  await expect(panel(page).locator('.pf-fpreview__onion')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Enable onion skin' }).click();
  await expect(panel(page).locator('.pf-fpreview__onion')).toHaveCount(1);
});

test('stepping moves the active frame deterministically', async ({ page }) => {
  expect(await activeIndex(page)).toBe(0);
  await panel(page).getByRole('button', { name: 'Next frame' }).click();
  await expect.poll(() => activeIndex(page)).toBe(1);
  await panel(page).getByRole('button', { name: 'Previous frame' }).click();
  await expect.poll(() => activeIndex(page)).toBe(0);
});

test('play advances the animation, pause halts it', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Play', exact: true }).click();
  // The active frame advances past frame 1 within a few frame durations.
  await expect.poll(() => activeIndex(page), { timeout: 3000 }).not.toBe(0);
  await panel(page).getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
