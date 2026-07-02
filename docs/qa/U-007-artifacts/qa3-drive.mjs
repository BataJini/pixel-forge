// Independent QA driver for U-007 (Layers). Drives the REAL built app.
import { chromium } from 'playwright';

const URL = 'http://localhost:4321/pixel-forge/';
const ART = 'C:/Users/bata/Projects/pixel-forge/docs/qa/U-007-artifacts';
const log = [];
let pass = 0, fail = 0, warn = 0;
const rec = (ok, name, detail) => {
  const tag = ok === true ? 'PASS' : ok === 'warn' ? 'WARN' : 'FAIL';
  if (ok === true) pass++; else if (ok === 'warn') warn++; else fail++;
  const line = `[${tag}] ${name}${detail ? ' :: ' + detail : ''}`;
  log.push(line);
  console.log(line);
};

const consoleErrors = [];
const pageErrors = [];

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });

  const panel = page.locator('.pf-layers');
  const rows = panel.locator('.pf-layer');
  const names = () => panel.locator('.pf-layer__name').evaluateAll((els) => els.map((e) => e.value));
  const count = () => rows.count();
  const status = () => panel.locator('.pf-layers__status').innerText();
  // hash the live composite preview canvas
  const compositeHash = () => page.locator('.pf-lpreview__canvas').evaluate((c) => {
    const d = c.toDataURL();
    let h = 0; for (let i = 0; i < d.length; i++) { h = (h * 31 + d.charCodeAt(i)) | 0; }
    return h + ':' + d.length;
  });
  const activeThumbHash = () => panel.locator('.pf-layer[data-active="true"] .pf-layer__thumb').evaluate((c) => {
    const d = c.toDataURL(); let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0; return h;
  });

  // --- Smoke / seed ---
  rec((await panel.isVisible()) === true, 'Layers panel renders', 'selector .pf-layers');
  const n0 = await count();
  rec(n0 === 3, 'Seeds 3 layers', `count=${n0}`);
  const seedNames = await names();
  rec(JSON.stringify(seedNames) === JSON.stringify(['Sparks', 'Heat', 'Anvil']), 'Seed order top-first', seedNames.join(','));
  await page.screenshot({ path: `${ART}/qa3-01-initial.png` });

  // active highlighted
  const activeName = await panel.locator('.pf-layer[data-active="true"] .pf-layer__name').inputValue().catch(() => null);
  const ariaCurrent = await panel.locator('.pf-layer[aria-current="true"]').count();
  rec(activeName === 'Sparks' && ariaCurrent === 1, 'Active layer highlighted (aria-current + data-active)', `active=${activeName} ariaCurrentRows=${ariaCurrent}`);

  // --- Add (pointer) ---
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  const nAdd = await count();
  rec(nAdd === 4, 'Add layer (pointer click)', `count 3->${nAdd}`);
  rec((await status()).includes('4 layer'), 'Status readout updates', await status());
  await page.screenshot({ path: `${ART}/qa3-02-add.png` });

  // --- Undo/redo the add ---
  await panel.getByRole('button', { name: 'Revert last layer change' }).click();
  rec((await count()) === 3, 'Undo add -> 3', `count=${await count()}`);
  await panel.getByRole('button', { name: 'Reapply last layer change' }).click();
  rec((await count()) === 4, 'Redo add -> 4', `count=${await count()}`);

  // --- Duplicate ---
  // active is the newly added top layer; duplicate it
  const beforeDup = await names();
  await panel.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const afterDup = await names();
  const hasCopy = afterDup.some((nm) => /copy$/.test(nm));
  rec((await count()) === 5 && hasCopy, 'Duplicate adds a " copy" layer', afterDup.join(','));
  await page.screenshot({ path: `${ART}/qa3-03-duplicate.png` });
  // undo duplicate back to 4
  await panel.getByRole('button', { name: 'Revert last layer change' }).click();
  rec((await count()) === 4, 'Undo duplicate -> 4', `count=${await count()}`);

  // --- Rename ---
  const nameInput = panel.locator('.pf-layer[data-active="true"] .pf-layer__name');
  await nameInput.fill('Glow');
  await nameInput.blur();
  rec((await names()).includes('Glow'), 'Rename active layer to "Glow"', (await names()).join(','));
  await page.screenshot({ path: `${ART}/qa3-04-rename.png` });

  // --- Visibility toggle changes composite ---
  const hashVisible = await compositeHash();
  const sparksHide = panel.getByRole('button', { name: 'Hide layer Sparks' });
  await sparksHide.click();
  const hashHidden = await compositeHash();
  rec(hashVisible !== hashHidden, 'Hiding a visible seeded layer changes composite', `visible=${hashVisible} hidden=${hashHidden}`);
  const showBtn = panel.getByRole('button', { name: 'Show layer Sparks' });
  rec((await showBtn.count()) === 1, 'Toggle relabels to "Show layer Sparks"', `showBtnCount=${await showBtn.count()}`);
  await showBtn.click();
  rec((await compositeHash()) === hashVisible, 'Showing restores composite exactly', 'hash restored');

  // --- Lock rejects paint ---
  // activate Anvil (bottom) and lock it, then verify paint hint says locked
  await panel.getByRole('button', { name: 'Select layer Anvil' }).click();
  await panel.getByRole('button', { name: 'Lock layer Anvil' }).click();
  const lockedHint = await panel.locator('.pf-layers__hint [role="status"]').count();
  const beforeLockPaint = await compositeHash();
  // try to paint on the preview while active layer is locked
  const preview = panel.locator('.pf-lpreview');
  const box = await preview.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6); await page.mouse.up();
  const afterLockPaint = await compositeHash();
  rec(lockedHint === 1 && beforeLockPaint === afterLockPaint, 'Locked active layer rejects paint (composite unchanged + locked hint shown)', `lockedHint=${lockedHint} unchanged=${beforeLockPaint === afterLockPaint}`);
  await page.screenshot({ path: `${ART}/qa3-05-lock.png` });
  await panel.getByRole('button', { name: 'Unlock layer Anvil' }).click();

  // --- Opacity slider scales contribution ---
  await panel.getByRole('button', { name: 'Select layer Sparks' }).click();
  const opacity = panel.getByRole('slider', { name: 'Opacity of layer Sparks' });
  const opFull = await compositeHash();
  await opacity.focus();
  await opacity.fill('0');
  const op0 = await compositeHash();
  rec(opFull !== op0, 'Opacity 0% changes composite (top contribution removed)', `full=${opFull} zero=${op0}`);
  await opacity.fill('100');
  rec((await compositeHash()) === opFull, 'Opacity 100% restores full contribution', 'restored');
  await page.screenshot({ path: `${ART}/qa3-06-opacity.png` });

  // --- Reorder via move-down button changes order + composite winner ---
  const beforeOrder = await names();
  await panel.getByRole('button', { name: `Move layer ${beforeOrder[0]} down` }).click();
  const afterOrder = await names();
  rec(afterOrder[0] === beforeOrder[1] && afterOrder[1] === beforeOrder[0], 'Move-down button reorders top two layers', `${beforeOrder.join(',')} -> ${afterOrder.join(',')}`);
  await page.screenshot({ path: `${ART}/qa3-07-reorder.png` });
  await panel.getByRole('button', { name: 'Revert last layer change' }).click();
  rec(JSON.stringify(await names()) === JSON.stringify(beforeOrder), 'Undo reorder restores order', (await names()).join(','));

  // --- Merge down: count-1, composite preserved ---
  const beforeMergeHash = await compositeHash();
  const beforeMergeCount = await count();
  // select second-from-top so merge-down is enabled and merges onto the one below
  const topName = (await names())[0];
  await panel.getByRole('button', { name: `Select layer ${topName}` }).click();
  const mergeBtn = panel.getByRole('button', { name: /Merge/ });
  const mergeEnabled = await mergeBtn.isEnabled();
  await mergeBtn.click();
  const afterMergeCount = await count();
  const afterMergeHash = await compositeHash();
  rec(mergeEnabled && afterMergeCount === beforeMergeCount - 1, 'Merge-down reduces layer count by 1', `count ${beforeMergeCount}->${afterMergeCount}`);
  rec(afterMergeHash === beforeMergeHash, 'Merge-down preserves composite exactly', `sig ${beforeMergeHash === afterMergeHash}`);
  await page.screenshot({ path: `${ART}/qa3-08-merge.png` });
  await panel.getByRole('button', { name: 'Revert last layer change' }).click();
  rec((await count()) === beforeMergeCount && (await compositeHash()) === beforeMergeHash, 'Undo merge restores layers + composite', `count=${await count()}`);

  // --- Live thumbnail updates while painting ---
  await panel.getByRole('button', { name: 'Select layer Sparks' }).click();
  const thumbBefore = await activeThumbHash();
  const compBeforePaint = await compositeHash();
  const pbox = await preview.boundingBox();
  await page.mouse.move(pbox.x + pbox.width * 0.3, pbox.y + pbox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(pbox.x + pbox.width * 0.35, pbox.y + pbox.height * 0.35);
  await page.mouse.move(pbox.x + pbox.width * 0.4, pbox.y + pbox.height * 0.4);
  await page.mouse.up();
  const thumbAfter = await activeThumbHash();
  const compAfterPaint = await compositeHash();
  rec(thumbBefore !== thumbAfter, 'Active-layer thumbnail updates live while painting', `thumb ${thumbBefore}->${thumbAfter}`);
  rec(compBeforePaint !== compAfterPaint, 'Painting changes live composite', 'composite changed');
  await page.screenshot({ path: `${ART}/qa3-09-painted-thumbnail.png` });
  // paint stroke is undoable
  await panel.getByRole('button', { name: 'Revert last layer change' }).click();
  rec((await compositeHash()) === compBeforePaint, 'Undo paint stroke restores composite', 'restored');

  // --- Flatten warns, cancel keeps, confirm collapses ---
  const preFlattenCount = await count();
  const preFlattenHash = await compositeHash();
  await panel.getByRole('button', { name: 'Flatten', exact: true }).click();
  const dlg = page.locator('dialog[open]');
  const dlgVisible = await dlg.isVisible();
  const dlgText = await dlg.innerText();
  rec(dlgVisible && /flatten/i.test(dlgText), 'Flatten opens a confirm dialog with a warning', dlgText.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: `${ART}/qa3-10-flatten-dialog.png` });
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  rec((await count()) === preFlattenCount, 'Cancel keeps all layers', `count=${await count()}`);
  // confirm
  await panel.getByRole('button', { name: 'Flatten', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Flatten all' }).click();
  const flatCount = await count();
  const flatHash = await compositeHash();
  rec(flatCount === 1, 'Flatten all collapses to 1 layer', `count=${flatCount}`);
  rec(flatHash === preFlattenHash, 'Flatten preserves the composite exactly', `sig ${flatHash === preFlattenHash}`);
  await page.screenshot({ path: `${ART}/qa3-11-flattened.png` });

  // delete guard at count 1
  const del = panel.getByRole('button', { name: 'Delete', exact: true });
  rec((await del.isDisabled()) === true, 'Delete disabled at last remaining layer', `disabled=${await del.isDisabled()}`);
  // undo flatten
  await panel.getByRole('button', { name: 'Revert last layer change' }).click();
  rec((await count()) === preFlattenCount, 'Undo flatten restores layers', `count=${await count()}`);

  // ============ KEYBOARD OPERABILITY (prior blocking defect F-1/F-3) ============
  // Install a window-level probe registered AFTER the app's handler so it observes
  // the final defaultPrevented state for Enter/Space (bubble phase, same target).
  await page.evaluate(() => {
    window.__kbd = { enterPrevented: null, spacePrevented: null };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') window.__kbd.enterPrevented = e.defaultPrevented;
      if (e.key === ' ') window.__kbd.spacePrevented = e.defaultPrevented;
    });
  });

  const addBtn = panel.getByRole('button', { name: 'Add', exact: true });
  await addBtn.focus();
  const addFocused = await addBtn.evaluate((el) => el === document.activeElement);
  const beforeKbdCount = await count();
  await page.keyboard.press('Enter');
  const afterKbdCount = await count();
  const enterPrevented = await page.evaluate(() => window.__kbd.enterPrevented);
  rec(addFocused && afterKbdCount === beforeKbdCount + 1, 'KEYBOARD: Enter on focused Add button adds a layer (WCAG 2.1.1)', `count ${beforeKbdCount}->${afterKbdCount}`);
  rec(enterPrevented === false, 'KEYBOARD: canvas handler no longer preventDefaults Enter on the button', `enter.defaultPrevented=${enterPrevented}`);

  const eye = panel.getByRole('button', { name: 'Hide layer Sparks' });
  await eye.focus();
  const eyeFocused = await eye.evaluate((el) => el === document.activeElement);
  await page.keyboard.press('Space');
  const relabeled = await panel.getByRole('button', { name: 'Show layer Sparks' }).count();
  const spacePrevented = await page.evaluate(() => window.__kbd.spacePrevented);
  rec(eyeFocused && relabeled === 1, 'KEYBOARD: Space on focused visibility toggle toggles it (WCAG 2.1.1)', `relabeledToShow=${relabeled}`);
  rec(spacePrevented === false, 'KEYBOARD: canvas handler no longer preventDefaults Space on the button', `space.defaultPrevented=${spacePrevented}`);
  await page.getByRole('button', { name: 'Show layer Sparks' }).click(); // restore visible

  // Ctrl+Z must STILL work globally (modifier combos are app-global by design)
  await addBtn.focus();
  const preCtrlZ = await count();
  await page.keyboard.press('Control+z');
  const postCtrlZ = await count();
  rec(postCtrlZ === preCtrlZ - 1, 'KEYBOARD: Ctrl+Z still undoes globally even with a button focused', `count ${preCtrlZ}->${postCtrlZ}`);

  // Tab reachability of core controls
  await page.evaluate(() => document.querySelector('.pf-layers .pf-btn')?.focus());
  const focusVisible = await page.locator('.pf-layers :focus').count();
  rec(focusVisible >= 1, 'A focus target inside the panel is focusable', `focused=${focusVisible}`);

  // ============ SECURITY SMOKE: XSS in layer name ============
  const payload = '<img src=x onerror="window.__xss=1">';
  const secName = panel.locator('.pf-layer[data-active="true"] .pf-layer__name');
  await secName.fill(payload);
  await secName.blur();
  await page.waitForTimeout(150);
  const xss = await page.evaluate(() => window.__xss);
  const injectedImg = await page.locator('.pf-layers img[src="x"]').count();
  const storedVal = await panel.locator('.pf-layer[data-active="true"] .pf-layer__name').inputValue();
  rec(xss === undefined && injectedImg === 0 && storedVal === payload, 'SECURITY: XSS layer name renders inert (stored verbatim, no script/img)', `__xss=${xss} injectedImg=${injectedImg}`);

  // ============ Console / page error sweep ============
  rec(consoleErrors.length === 0, 'No console errors during entire session', consoleErrors.slice(0, 3).join(' | ') || 'clean');
  rec(pageErrors.length === 0, 'No uncaught page errors during entire session', pageErrors.slice(0, 3).join(' | ') || 'clean');

  await page.screenshot({ path: `${ART}/qa3-12-final.png`, fullPage: true });
  await browser.close();

  console.log(`\n==== SUMMARY: ${pass} PASS / ${fail} FAIL / ${warn} WARN ====`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
