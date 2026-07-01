import { expect, type Page, test } from '@playwright/test';

const BASE = process.env.VITE_BASE ?? '/pixel-forge/';

// End-to-end reproduction of the U-005 QA finding F-1: "Indexed / palette-lock
// mode restricts drawing to the palette." Drives the REAL built app exactly as a
// user would — load Game Boy, set an off-palette foreground, draw on the canvas —
// and reads the display canvas pixels to verify the lock end to end.

const MAGENTA = 0xff00ff; // off-palette foreground (#FF00FF); absent from Game Boy DMG
const GAMEBOY = [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f];

/** A stable probe point a few px off the well centre, so it lands mid-pixel
 * (the 32×32 art has an even centre that would otherwise sit on a pixel edge). */
async function probePoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.pf-stage__well').boundingBox();
  if (!box) {
    throw new Error('canvas well has no bounding box');
  }
  return { x: Math.floor(box.x + box.width / 2) + 3, y: Math.floor(box.y + box.height / 2) + 3 };
}

async function loadPalette(page: Page, id: string): Promise<void> {
  await page.locator('.pf-palmenu .pf-select').selectOption(id);
}

async function setForegroundHex(page: Page, hex: string): Promise<void> {
  const input = page.locator('.pf-picker__hexinput');
  await input.fill(hex);
  await input.press('Enter');
}

/** Left-click once at `pt` to paint a single pixel with the pencil. */
async function drawAt(page: Page, pt: { x: number; y: number }): Promise<void> {
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** The opaque display-canvas color (packed 0xRRGGBB) at a viewport point. */
async function displayPixelAt(page: Page, pt: { x: number; y: number }): Promise<number | null> {
  return page.evaluate((p) => {
    const well = document.querySelector('.pf-stage__well');
    const canvas = well?.querySelectorAll('canvas')[1] as HTMLCanvasElement | undefined;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round((p.x - rect.left) * dpr);
    const y = Math.round((p.y - rect.top) * dpr);
    const d = ctx.getImageData(x, y, 1, 1).data;
    return d[3] === 255 ? (d[0] << 16) | (d[1] << 8) | d[2] : null;
  }, pt);
}

/** Every opaque color (packed 0xRRGGBB) anywhere on the display canvas. */
async function displayColors(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const well = document.querySelector('.pf-stage__well');
    const canvas = well?.querySelectorAll('canvas')[1] as HTMLCanvasElement | undefined;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.width === 0) {
      return [];
    }
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) {
        seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      }
    }
    return [...seen];
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('.pf-stage__well canvas').nth(1)).toBeVisible();
});

test('control: in free-color mode an off-palette color CAN be drawn', async ({ page }) => {
  await loadPalette(page, 'gameboy');
  await setForegroundHex(page, '#FF00FF');
  const pt = await probePoint(page);
  await drawAt(page, pt);

  // Free mode paints the raw magenta at the probe point (poll past the rAF repaint).
  await expect.poll(() => displayPixelAt(page, pt)).toBe(MAGENTA);
});

test('locked: palette-lock quantizes existing art and blocks off-palette drawing', async ({
  page,
}) => {
  await loadPalette(page, 'gameboy');
  await setForegroundHex(page, '#FF00FF');
  const pt = await probePoint(page);
  await drawAt(page, pt);
  await expect.poll(() => displayPixelAt(page, pt)).toBe(MAGENTA); // magenta is really there

  // Turn palette-lock ON → the existing off-palette magenta is quantized away.
  await page.locator('.pf-palmenu button', { hasText: 'Indexed' }).click();
  await expect.poll(() => displayColors(page)).not.toContain(MAGENTA);
  const snapped = await displayPixelAt(page, pt);
  expect(snapped).not.toBeNull();
  expect(GAMEBOY).toContain(snapped); // the probe pixel is now a Game Boy color

  // Drawing again with the off-palette foreground cannot re-introduce it.
  await drawAt(page, pt);
  const after = await displayColors(page);
  expect(after).not.toContain(MAGENTA);
  for (const c of after) {
    expect(GAMEBOY).toContain(c); // the whole canvas stays within the palette
  }
  // The panel readout names the exact snapped color the pencil draws with:
  // #FF00FF is nearest Game Boy #306230 (index 1).
  await expect(page.locator('.pf-color__lock')).toContainText('drawing as');
  await expect(page.locator('.pf-color__lock b')).toHaveText('#306230');
});
