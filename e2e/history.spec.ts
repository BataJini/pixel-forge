import { expect, type Page, test } from '@playwright/test';

const BASE = process.env.VITE_BASE ?? '/pixel-forge/';

// End-to-end U-006: draw on the REAL canvas with a real mouse, then prove
// undo/redo (buttons + Ctrl+Z / Ctrl+Y) restore the exact displayed pixels and
// that a whole drag is a single undo step. We read the display canvas' pixels
// through getImageData so the assertions reflect what the user actually sees.

/** A numeric signature of the display canvas' pixels (byte-position weighted). */
async function displaySignature(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.pf-stage__well canvas');
    const display = canvases[1]; // backdrop=0, display=1, overlay=2
    const ctx = display.getContext('2d');
    if (!ctx || display.width === 0 || display.height === 0) {
      return 0;
    }
    const { data } = ctx.getImageData(0, 0, display.width, display.height);
    let sig = 0;
    for (let i = 0; i < data.length; i++) {
      // Position-weighted running sum: any pixel change perturbs the signature,
      // while identical buffers produce the identical value (exact round-trip).
      sig = (sig + data[i] * ((i % 1023) + 1)) % 2147483647;
    }
    return sig;
  });
}

/**
 * Wait for the display canvas' first sizing + paint to settle, then return its
 * stable pixel signature.
 *
 * The display canvas mounts at width 0 and is sized + composited by a
 * ResizeObserver-driven fit (see CanvasStage.tsx `applyFit`). Under parallel CPU
 * load that first paint can lag the <h1> becoming visible — the only thing
 * `beforeEach` waits for. Reading the signature too early yields 0 (width 0 → the
 * guard in `displaySignature`) or a transient pre-settle value, which never
 * equals the real seeded buffer that an undo restores → a ~25% flake. We poll
 * until the signature is non-zero AND unchanged across consecutive reads (an idle
 * frame). This is a deterministic wait, not a fixed sleep, and the returned value
 * is the true settled baseline the round-trip assertions compare against.
 */
async function settledSignature(page: Page): Promise<number> {
  let last = -1;
  let stableReads = 0;
  await expect
    .poll(
      async () => {
        const sig = await displaySignature(page);
        stableReads = sig !== 0 && sig === last ? stableReads + 1 : 0;
        last = sig;
        return stableReads;
      },
      { timeout: 15_000, intervals: [50, 75, 100, 150, 200] },
    )
    .toBeGreaterThanOrEqual(2);
  return last;
}

async function drawStroke(page: Page): Promise<void> {
  const well = page.locator('.pf-stage__well');
  const box = await well.boundingBox();
  if (!box) throw new Error('canvas well not found');
  const x0 = box.x + box.width * 0.28;
  const y0 = box.y + box.height * 0.28;
  const x1 = box.x + box.width * 0.72;
  const y1 = box.y + box.height * 0.72;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  // Several intermediate points → a continuous drag (one undo entry).
  for (let s = 1; s <= 6; s++) {
    await page.mouse.move(x0 + ((x1 - x0) * s) / 6, y0 + ((y1 - y0) * s) / 6);
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1, name: 'PixelForge' })).toBeVisible();
  // Guard the whole suite against the first-paint race: hold every test body until
  // the display canvas has actually sized and painted its seeded artwork, so both
  // baseline sampling and the first drag land on a settled canvas.
  await settledSignature(page);
});

test('a drag is one undo step; buttons restore the exact pixels', async ({ page }) => {
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });

  // Nothing drawn yet → both disabled.
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  const baseline = await settledSignature(page);

  await drawStroke(page);

  // One drag recorded exactly one step, and the drawing changed the display.
  await expect(page.getByText(/^1 step$/)).toBeVisible();
  await expect(undo).toBeEnabled();
  const drawn = await displaySignature(page);
  expect(drawn).not.toBe(baseline);

  // Undo restores the exact pre-draw pixels.
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await expect.poll(() => displaySignature(page)).toBe(baseline);

  // Redo re-applies the exact stroke.
  await redo.click();
  await expect(redo).toBeDisabled();
  await expect(undo).toBeEnabled();
  await expect.poll(() => displaySignature(page)).toBe(drawn);
});

test('Ctrl+Z / Ctrl+Y keyboard shortcuts undo and redo', async ({ page }) => {
  const baseline = await settledSignature(page);
  await drawStroke(page);
  const drawn = await displaySignature(page);
  expect(drawn).not.toBe(baseline);

  await page.keyboard.press('Control+z');
  await expect.poll(() => displaySignature(page)).toBe(baseline);

  await page.keyboard.press('Control+y');
  await expect.poll(() => displaySignature(page)).toBe(drawn);

  // Ctrl+Shift+Z also redoes: undo once, then redo via the alternate binding.
  await page.keyboard.press('Control+z');
  await expect.poll(() => displaySignature(page)).toBe(baseline);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => displaySignature(page)).toBe(drawn);
});

test('a new edit after an undo clears the redo stack', async ({ page }) => {
  const redo = page.getByRole('button', { name: 'Redo' });

  await drawStroke(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(redo).toBeEnabled();

  // Draw again → the redo branch is discarded.
  await drawStroke(page);
  await expect(redo).toBeDisabled();
});
