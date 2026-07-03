// Focused, corrected re-probes for U-012 (fixes measurement bugs in qa2-drive.mjs).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4173/pixel-forge/';
const out = {};
const log = (k, v) => { out[k] = v; console.log(`\n### ${k}\n` + JSON.stringify(v, null, 2)); };

const browser = await chromium.launch();

// ---------- TRUE FIRST RUN: brand-new context, never visited ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.pf-menubar__label');
  await page.waitForTimeout(800); // allow any first-run effect to fire
  const fr = await page.evaluate(() => ({
    dialogOpenAttr: document.querySelectorAll('dialog[open]').length,
    welcomeOpen: !!document.querySelector('dialog.pf-welcome[open]'),
    anyOpenDialogClasses: [...document.querySelectorAll('dialog[open]')].map(d => d.className),
    hasFirstRunLS: Object.keys(localStorage),
  }));
  log('freshContext_firstRun', fr);
  await ctx.close();
}

// ---------- corrected functional probes ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.pf-stage__well');
await page.waitForTimeout(300);

const rawStatus = () => page.evaluate(() => document.querySelector('.pf-stage__status')?.textContent?.replace(/\s+/g,' ').trim() ?? null);
// tool value = the <b> right after the "Tool" label
const toolVal = () => page.evaluate(() => {
  const spans = [...document.querySelectorAll('.pf-stage__status span')];
  const s = spans.find(sp => /^\s*Tool/.test(sp.textContent));
  return s?.querySelector('b')?.textContent?.trim() ?? null;
});

log('status_raw', { text: await rawStatus() });

// focus body, run tool keys
await page.mouse.click(700, 450);
await page.keyboard.press('Escape'); // clear any selection from the click
const toolKeys = { b:'pencil', e:'eraser', g:'bucket', l:'line', i:'eyedropper', m:'select', v:'move', h:'hand' };
const tk = {};
for (const [k, exp] of Object.entries(toolKeys)) {
  await page.keyboard.press(k);
  await page.waitForTimeout(40);
  const got = (await toolVal())?.toLowerCase();
  tk[k] = { expected: exp, got, ok: got === exp };
}
await page.keyboard.press('u');
await page.waitForTimeout(40);
const u1 = (await toolVal())?.toLowerCase();
await page.keyboard.press('u');
await page.waitForTimeout(40);
const u2 = (await toolVal())?.toLowerCase();
tk['u_toggle'] = { first: u1, second: u2, togglesRectEllipse: (u1==='rect'&&u2==='ellipse')||(u1==='ellipse'&&u2==='rect') };
log('toolKeys_corrected', tk);

// ---------- Ctrl+S / N / O defaultPrevented (fixed key casing) ----------
await page.evaluate(() => {
  window.__p = {};
  const rec = (e) => {
    const key = (e.ctrlKey||e.metaKey?'C-':'') + (e.altKey?'A-':'') + (e.shiftKey?'S-':'') + e.key.toLowerCase();
    window.__p[key] = { defaultPrevented: e.defaultPrevented };
  };
  window.addEventListener('keydown', rec, false); // bubble: runs after app's bubble listeners
});
await page.mouse.click(700, 450);
for (const combo of ['Control+s','Control+n','Control+o','Control+z']) {
  await page.keyboard.press(combo);
  await page.waitForTimeout(40);
}
const probe = await page.evaluate(() => window.__p);
log('ctrlKey_defaultPrevented', {
  'C-s (save)': probe['c-s'] ?? null,
  'C-n (new)': probe['c-n'] ?? null,
  'C-o (open)': probe['c-o'] ?? null,
  'C-z (undo, control)': probe['c-z'] ?? null,
  allKeys: Object.keys(probe),
});

// ---------- undo/redo end-to-end (robust draw at fit zoom) ----------
// Fit to screen so the whole 32x32 art is in view, then draw a long diagonal.
await page.keyboard.press('b'); // pencil
await page.waitForTimeout(40);
// Use the View menu "Fit to Screen" for a known viewport.
await page.locator('.pf-menubar__label', { hasText: /^View$/ }).click();
await page.locator('.pf-menubar__item', { hasText: 'Fit to Screen' }).click();
await page.waitForTimeout(120);
const editHint = () => page.evaluate(() => {
  const tb = [...document.querySelectorAll('.pf-stage__toolbar')].find(t => t.getAttribute('aria-label') === 'Edit history');
  return tb?.querySelector('.pf-stage__hint')?.textContent?.trim() ?? null;
});
const undoBtnDisabled = () => page.evaluate(() => {
  const tb = [...document.querySelectorAll('.pf-stage__toolbar')].find(t => t.getAttribute('aria-label') === 'Edit history');
  const btns = tb ? [...tb.querySelectorAll('button')] : [];
  const undo = btns.find(b => /Undo/i.test(b.textContent));
  const redo = btns.find(b => /Redo/i.test(b.textContent));
  return { undoDisabled: undo?.disabled ?? null, redoDisabled: redo?.disabled ?? null };
});
const well = await page.locator('.pf-stage__well').boundingBox();
// draw across the center of the well
await page.mouse.move(well.x + well.width*0.35, well.y + well.height*0.35);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(well.x + well.width*(0.35 + 0.03*i), well.y + well.height*(0.35 + 0.03*i));
}
await page.mouse.up();
await page.waitForTimeout(150);
const afterDraw = { hint: await editHint(), ...(await undoBtnDisabled()) };
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
const afterUndo = { hint: await editHint(), ...(await undoBtnDisabled()) };
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);
const afterRedo = { hint: await editHint(), ...(await undoBtnDisabled()) };
log('undo_redo_corrected', { afterDraw, afterUndo, afterRedo });

// ---------- ProjectBar buttons (what labels exist; can Welcome/Gallery be reached) ----------
const projectButtons = await page.evaluate(() => {
  const bar = document.querySelector('.pf-projectbar, [class*="projectbar" i], [class*="project" i]');
  return {
    allButtonLabels: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 60),
  };
});
log('project_buttons', projectButtons);

await ctx.close();
await browser.close();
const fs = await import('node:fs');
fs.writeFileSync(join(DIR, 'qa2-focus-results.json'), JSON.stringify(out, null, 2));
console.log('\n=== FOCUS DONE ===');
