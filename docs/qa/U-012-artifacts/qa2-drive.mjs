// Independent QA drive for U-012 — exercises the app shell against the running
// preview build. Every assertion is OBSERVED in a real Chromium page; nothing is
// inferred. Run: node docs/qa/U-012-artifacts/qa2-drive.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4173/pixel-forge/';
const shot = (page, name) => page.screenshot({ path: join(DIR, name) });
const results = {};
const log = (k, v) => { results[k] = v; console.log(`\n### ${k}\n` + JSON.stringify(v, null, 2)); };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Capture app-origin console errors only.
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.pf-menubar__label');

// ---------- TRUE FIRST RUN: clear all storage + IndexedDB, reload ----------
const cleared = await page.evaluate(async () => {
  localStorage.clear();
  sessionStorage.clear();
  const names = new Set(['pixelforge', 'keyval-store']);
  if (indexedDB.databases) {
    for (const d of await indexedDB.databases()) if (d.name) names.add(d.name);
  }
  const out = {};
  for (const n of names) {
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase(n);
      r.onsuccess = () => { out[n] = 'deleted'; res(); };
      r.onerror = () => { out[n] = 'error'; res(); };
      r.onblocked = () => { out[n] = 'blocked'; res(); };
    });
  }
  return out;
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.pf-menubar__label');
await page.waitForTimeout(600); // give first-run effects time to open a dialog
const firstRun = await page.evaluate(() => ({
  dialogOpenAttr: document.querySelectorAll('dialog[open]').length,
  roleDialog: [...document.querySelectorAll('[role="dialog"]')].filter(d => d.offsetParent !== null || d.open).length,
  welcomeOpen: !!document.querySelector('.pf-welcome[open], dialog.pf-welcome[open]'),
  welcomeExists: !!document.querySelector('.pf-welcome'),
  cmdkOpen: document.querySelectorAll('.pf-cmdk__box').length,
  helpOpen: document.querySelectorAll('.pf-help__box').length,
  visibleModal: [...document.querySelectorAll('dialog')].map(d => ({ cls: d.className, open: d.open })),
}));
log('firstRun_afterClearStorage', { cleared, firstRun });
await shot(page, 'qa2-01-firstrun-cleared.png');

// ---------- MENU BAR ENUMERATION (Canvas menu present?) ----------
const menu = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.pf-menubar__label')].map(b => b.textContent.trim());
  return { labels, hasCanvas: labels.includes('Canvas'), expectedOrder: ['File','Edit','View','Canvas','Help'] };
});
log('menuBar_labels', menu);

// Open each present menu, enumerate items + whether each has a shortcut hint.
const menuItems = {};
for (const label of menu.labels) {
  await page.locator('.pf-menubar__label', { hasText: new RegExp(`^${label}$`) }).click();
  const items = await page.evaluate(() => [...document.querySelectorAll('.pf-menubar__item')].map(b => ({
    title: b.querySelector('.pf-menubar__item-title')?.textContent?.trim(),
    kbd: b.querySelector('.pf-menubar__kbd')?.textContent?.trim() ?? null,
    disabled: b.disabled,
  })));
  menuItems[label] = items;
  await page.keyboard.press('Escape');
}
log('menu_items', menuItems);

// Verify a menu item is truly wired: View -> Reset Zoom (100%) should change status Zoom.
const zoomBefore = await page.evaluate(() => document.querySelector('.pf-stage__status')?.textContent);
await page.locator('.pf-menubar__label', { hasText: /^View$/ }).click();
await page.locator('.pf-menubar__item', { hasText: 'Reset Zoom' }).click();
const zoomAfter = await page.evaluate(() => document.querySelector('.pf-stage__status')?.textContent);
log('menu_wiring_resetZoom', {
  before: zoomBefore?.match(/Zoom\s*([0-9]+%)/)?.[1] ?? null,
  after: zoomAfter?.match(/Zoom\s*([0-9]+%)/)?.[1] ?? null,
});

// ---------- CRITERION 1: command palette Ctrl+K -> export -> runs Export dialog ----------
await page.keyboard.press('Control+k');
await page.waitForSelector('.pf-cmdk__box');
const cmdkOpened = await page.evaluate(() => ({
  role: document.querySelector('.pf-cmdk')?.getAttribute('role'),
  ariaModal: document.querySelector('.pf-cmdk')?.getAttribute('aria-modal'),
  itemCount: document.querySelectorAll('.pf-cmdk__item').length,
  focused: document.activeElement?.className,
}));
await page.locator('.pf-cmdk__input').fill('export');
const firstItem = await page.locator('.pf-cmdk__item').first().textContent();
await page.locator('.pf-cmdk__input').press('Enter');
await page.waitForTimeout(200);
const exportDlg = await page.evaluate(() => {
  const d = document.querySelector('dialog.pf-export') || document.querySelector('.pf-export');
  return {
    paletteClosed: document.querySelectorAll('.pf-cmdk__box').length === 0,
    exportOpen: !!(d && (d.open || d.offsetParent !== null)),
    heading: document.querySelector('dialog.pf-export [class*="title"], dialog.pf-export h2, .pf-export h2')?.textContent?.trim() ?? null,
  };
});
log('crit1_palette_export', { cmdkOpened, firstItem: firstItem?.replace(/\s+/g,' ').trim(), exportDlg });
await shot(page, 'qa2-02-export-via-palette.png');
// close export dialog if open
await page.keyboard.press('Escape');
await page.evaluate(() => { const d = document.querySelector('dialog.pf-export'); if (d && d.open) d.close(); });
await page.waitForTimeout(150);

// Palette empty-state probes: 'save', 'settings', 'theme', 'canvas'
async function paletteProbe(q) {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.pf-cmdk__box');
  await page.locator('.pf-cmdk__input').fill(q);
  const res = await page.evaluate(() => ({
    items: [...document.querySelectorAll('.pf-cmdk__item .pf-cmdk__title')].map(t => t.textContent.trim()),
    empty: document.querySelectorAll('.pf-cmdk__empty').length,
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  return res;
}
const probes = {};
for (const q of ['save', 'settings', 'theme', 'canvas', 'resize', 'crop', 'new', 'open']) probes[q] = await paletteProbe(q);
log('crit_palette_probes', probes);

// ---------- CRITERION 2: shortcut set ----------
// Install a probe that records defaultPrevented for the next keydown of interest.
await page.evaluate(() => {
  window.__probe = {};
  window.addEventListener('keydown', (e) => {
    const k = (e.ctrlKey || e.metaKey ? 'C-' : '') + (e.shiftKey ? 'S-' : '') + e.key.toLowerCase();
    window.__probe[k] = { defaultPrevented: e.defaultPrevented };
  }, false); // bubble phase: after app handlers (which are also bubble but added earlier)
});
const readTool = () => page.evaluate(() => document.querySelector('.pf-stage__status')?.textContent?.match(/Tool\s*([a-z]+)/i)?.[1] ?? null);
const readZoom = () => page.evaluate(() => document.querySelector('.pf-stage__status')?.textContent?.match(/Zoom\s*([0-9]+)%/)?.[1] ?? null);

// focus the body/well so canvas shortcuts are eligible
await page.mouse.click(720, 450);
const toolKeys = { b:'pencil', e:'eraser', g:'bucket', l:'line', i:'eyedropper', m:'select', v:'move' };
const toolResults = {};
for (const [key, expected] of Object.entries(toolKeys)) {
  await page.keyboard.press(key);
  await page.waitForTimeout(50);
  const got = (await readTool())?.toLowerCase();
  toolResults[key] = { expected, got, ok: got === expected };
}
// U toggles rect/ellipse
await page.keyboard.press('u');
await page.waitForTimeout(50);
const uTool = (await readTool())?.toLowerCase();
toolResults['u'] = { expected: 'rect|ellipse', got: uTool, ok: uTool === 'rect' || uTool === 'ellipse' };
log('crit2_toolKeys', toolResults);

// zoom +/-
const z0 = await readZoom();
await page.keyboard.press('+');
await page.waitForTimeout(50);
const z1 = await readZoom();
await page.keyboard.press('-');
await page.waitForTimeout(50);
const z2 = await readZoom();
log('crit2_zoom', { z0, afterPlus: z1, afterMinus: z2, plusChanged: z1 !== z0, minusChanged: z2 !== z1 });

// Space pan (defaultPrevented)
await page.keyboard.press('Space');
await page.waitForTimeout(50);
// Ctrl+S save probe
await page.keyboard.press('Control+s').catch(() => {});
await page.waitForTimeout(50);
// Ctrl+N, Ctrl+O
await page.keyboard.press('Control+n').catch(() => {});
await page.keyboard.press('Control+o').catch(() => {});
await page.waitForTimeout(50);
const probeKeys = await page.evaluate(() => window.__probe);
log('crit2_probe_defaultPrevented', {
  space: probeKeys[' '] ?? probeKeys['spacebar'] ?? null,
  ctrlS: probeKeys['c-s'] ?? null,
  ctrlN: probeKeys['c-n'] ?? null,
  ctrlO: probeKeys['c-o'] ?? null,
});

// Undo/redo end-to-end: draw a stroke, check history step, Ctrl+Z, Ctrl+Shift+Z.
await page.keyboard.press('b'); // pencil
await page.waitForTimeout(50);
const well = await page.locator('.pf-stage__well').boundingBox();
await page.mouse.move(well.x + 80, well.y + 80);
await page.mouse.down();
await page.mouse.move(well.x + 140, well.y + 140, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(120);
const stepAfterDraw = await page.evaluate(() => document.querySelector('.pf-stage__hint')?.textContent?.trim() ?? null);
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
const stepAfterUndo = await page.evaluate(() => document.querySelector('.pf-stage__hint')?.textContent?.trim() ?? null);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(120);
const stepAfterRedo = await page.evaluate(() => document.querySelector('.pf-stage__hint')?.textContent?.trim() ?? null);
log('crit2_undo_redo', { stepAfterDraw, stepAfterUndo, stepAfterRedo });

// ---------- CRITERION 4: overlays open/close ----------
// Help via menu -> Escape
await page.locator('.pf-menubar__label', { hasText: /^Help$/ }).click();
await page.locator('.pf-menubar__item', { hasText: 'Keyboard Shortcuts' }).click();
await page.waitForTimeout(120);
const helpOpen = await page.evaluate(() => document.querySelectorAll('.pf-help__box').length);
const helpRows = await page.evaluate(() => document.querySelectorAll('.pf-help__box tr, .pf-help__box li, .pf-help__row').length);
await shot(page, 'qa2-03-help-overlay.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(120);
const helpAfterEsc = await page.evaluate(() => document.querySelectorAll('.pf-help__box').length);
log('crit4_help', { helpOpen, helpRows, helpAfterEsc, closesOnEscape: helpOpen > 0 && helpAfterEsc === 0 });

// Gallery: reachable from a menu/command? open via Project bar "Open" and test Escape.
const galleryReach = await page.evaluate(() => {
  const inMenu = [...document.querySelectorAll('.pf-menubar__item-title')].some(t => /gallery|open/i.test(t.textContent));
  return { inMenuOrCommand: inMenu };
});
// find an Open button in the project bar
let galleryOpened = 0, galleryAfterEsc = null, galleryCloseBtn = false;
const openBtn = page.locator('button', { hasText: /^Open$/ }).first();
if (await openBtn.count()) {
  await openBtn.click().catch(() => {});
  await page.waitForTimeout(150);
  galleryOpened = await page.evaluate(() => document.querySelectorAll('dialog.pf-gallery[open], .pf-gallery[open]').length + document.querySelectorAll('[class*="gallery"]:not([hidden])').length);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  galleryAfterEsc = await page.evaluate(() => document.querySelectorAll('dialog.pf-gallery[open]').length);
  await shot(page, 'qa2-04-gallery.png');
}
log('crit4_gallery', { galleryReach, galleryOpened, galleryAfterEsc });

// Settings overlay existence
const settings = await page.evaluate(() => ({
  nodes: document.querySelectorAll('[class*="settings" i], [class*="preferences" i], [aria-label*="settings" i]').length,
  inMenu: [...document.querySelectorAll('.pf-menubar__item-title')].some(t => /settings|preferences/i.test(t.textContent)),
}));
log('crit4_settings', settings);

// Welcome reachable via a "New" button (even if not auto)
let welcomeViaNew = 0;
const newBtn = page.locator('button', { hasText: /^New$/ }).first();
if (await newBtn.count()) {
  await newBtn.click().catch(() => {});
  await page.waitForTimeout(150);
  welcomeViaNew = await page.evaluate(() => document.querySelectorAll('dialog.pf-welcome[open], .pf-welcome[open]').length);
  await shot(page, 'qa2-05-welcome-via-new.png');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const d = document.querySelector('dialog.pf-welcome'); if (d && d.open) d.close(); });
}
log('crit4_welcome_via_new', { welcomeViaNew });

// ---------- MANUAL: responsive at 375 ----------
await page.setViewportSize({ width: 375, height: 780 });
await page.waitForTimeout(300);
const responsive = await page.evaluate(() => {
  const dock = document.querySelector('.pf-dock');
  const cs = dock ? getComputedStyle(dock) : null;
  return {
    docDisplay: cs?.display ?? null,
    flexDirection: cs?.flexDirection ?? null,
    bottomSheetNodes: document.querySelectorAll('[class*="sheet" i], [class*="bottom-sheet" i]').length,
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  };
});
log('manual_responsive_375', responsive);
await shot(page, 'qa2-06-mobile-375.png');

// ---------- MANUAL: keyboard focus ring ----------
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);
await page.evaluate(() => document.body.focus());
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focusRing = await page.evaluate(() => {
  const el = document.activeElement;
  const cs = el ? getComputedStyle(el) : null;
  const matchesFocusVisible = el ? el.matches(':focus-visible') : false;
  return {
    tag: el?.tagName,
    cls: el?.className,
    matchesFocusVisible,
    boxShadow: cs?.boxShadow?.slice(0, 80) ?? null,
    outline: cs?.outlineStyle + ' ' + cs?.outlineWidth,
  };
});
log('manual_focus_ring', focusRing);
await shot(page, 'qa2-07-desktop-workbench.png');

// ---------- console errors (app-origin only) ----------
log('console_errors_appOrigin', consoleErrors.filter(e => !/extension|meta\.json|trustpilot|metamask/i.test(e)));
log('console_errors_all_count', { total: consoleErrors.length });

await browser.close();

// Write machine-readable summary
const fs = await import('node:fs');
fs.writeFileSync(join(DIR, 'qa2-results.json'), JSON.stringify(results, null, 2));
console.log('\n=== DONE — results written to qa2-results.json ===');
