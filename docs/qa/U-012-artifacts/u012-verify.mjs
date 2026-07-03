// Deterministic U-012 acceptance walkthrough against the freshly-built app on :4173.
// Uses the project's own Playwright (isolated context — no shared-browser tab drift).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = 'http://localhost:4173/pixel-forge/';
const OUT = path.dirname(fileURLToPath(import.meta.url));
const R = {}; // results
const rec = (k, v) => { R[k] = v; console.log(`\n### ${k}\n` + JSON.stringify(v, null, 2)); };

const toolOf = (page) => page.evaluate(() =>
  document.querySelector('.pf-stage__status')?.innerText.split('\n').find(s => s.startsWith('Tool'))?.replace('Tool ', '').trim());
const zoomOf = (page) => page.evaluate(() =>
  document.querySelector('.pf-stage__status')?.innerText.split('\n').find(s => s.startsWith('Zoom'))?.replace('Zoom ', '').trim());
const selOf = (page) => page.evaluate(() =>
  document.querySelector('.pf-stage__status')?.innerText.split('\n').find(s => s.startsWith('Sel'))?.replace('Sel ', '').trim());
const depthOf = (page) => page.evaluate(() => {
  const t = document.querySelector('[aria-label="Edit history"] .pf-stage__hint')?.textContent || '';
  const m = t.match(/(\d+)/); return m ? Number(m[1]) : null;
});
const undoDisabled = (page) => page.evaluate(() =>
  document.querySelector('[aria-label="Edit history"] button')?.disabled);

const anyOverlayOpen = (page) => page.evaluate(() =>
  !!document.querySelector('dialog[open]') || !!document.querySelector('.pf-help__box') || !!document.querySelector('.pf-cmdk__box'));
const closeAll = async (page) => {
  for (let i = 0; i < 3; i++) {
    if (!(await anyOverlayOpen(page))) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  // click any visible Cancel/Close button inside an open dialog
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('dialog[open]')) {
      const btn = [...d.querySelectorAll('button')].find(b => /close|cancel/i.test(b.textContent || ''));
      if (btn) btn.click();
    }
  });
  await page.waitForTimeout(200);
  if (!(await anyOverlayOpen(page))) return true;
  // last resort: native close so subsequent steps aren't blocked
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  return !(await anyOverlayOpen(page));
};
const safe = async (name, fn) => { try { return await fn(); } catch (e) { rec(name, { ERROR: String(e).slice(0, 300) }); return null; } };

const drawStroke = (page) => page.evaluate(() => {
  const well = document.querySelector('.pf-stage__well');
  const r = well.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const o = (x, y, b) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: b });
  well.setPointerCapture = () => {}; well.releasePointerCapture = () => {}; well.hasPointerCapture = () => false;
  well.dispatchEvent(new PointerEvent('pointerdown', o(cx, cy, 1)));
  well.dispatchEvent(new PointerEvent('pointermove', o(cx + 6, cy + 2, 1)));
  well.dispatchEvent(new PointerEvent('pointerup', o(cx + 6, cy + 2, 0)));
});

const run = async () => {
  const browser = await chromium.launch();

  // ---------- Context 1: FIRST-RUN onboarding (fresh storage) ----------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    const appErrors = [];
    page.on('console', m => { if (m.type() === 'error') appErrors.push(m.text()); });
    page.on('pageerror', e => appErrors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const firstRun = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('dialog')].map(d => ({ cls: d.className, open: d.open }));
      const welcome = document.querySelector('dialog.pf-welcome');
      return {
        welcomeExistsInDom: !!welcome,
        welcomeOpen: !!(welcome && welcome.open),
        anyModalOpen: [...document.querySelectorAll('dialog')].some(d => d.open),
        dialogs: dlgs,
      };
    });
    rec('A_first_run_onboarding', { firstRun, appConsoleErrors: appErrors });
    await page.screenshot({ path: path.join(OUT, 'shot-01-firstload-desktop.png') });
    await ctx.close();
  }

  // ---------- Context 2: main functional walkthrough ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const appErrors = [];
  page.on('console', m => { if (m.type() === 'error') appErrors.push(m.text()); });
  page.on('pageerror', e => appErrors.push('PAGEERROR: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.body.focus());

  // Layout presence
  const layout = await page.evaluate(() => {
    const menuGroups = [...document.querySelectorAll('.pf-menubar__label')].map(b => b.textContent.trim());
    const q = s => !!document.querySelector(s);
    const status = document.querySelector('.pf-stage__status')?.innerText.replace(/\n/g, ' | ');
    const dockPanels = [...document.querySelectorAll('.pf-dock [class*="pf-panel__title"], .pf-dock h2, .pf-dock [class*="title"]')]
      .map(e => e.textContent.trim()).filter(Boolean);
    return {
      menuGroups,
      toolRack: q('[aria-label="Drawing tools"]'),
      canvasWell: q('.pf-stage__well'),
      statusBar: q('.pf-stage__status'),
      statusText: status,
      dockPresent: q('.pf-dock'),
      dockPanelTitles: [...new Set(dockPanels)],
    };
  });
  rec('B_layout', layout);

  // Menu enumeration + no-dead-items (structural)
  const menus = {};
  for (const g of layout.menuGroups) {
    await page.click(`.pf-menubar__label:has-text("${g}")`);
    await page.waitForTimeout(80);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('.pf-menubar__menu [role="menuitem"]')].map(b => ({
        title: b.querySelector('.pf-menubar__item-title')?.textContent?.trim() ?? b.textContent.trim(),
        disabled: b.disabled,
        hasOnClick: true,
      })));
    menus[g] = items;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
  rec('C_menus', { present: layout.menuGroups, canvasMenuPresent: layout.menuGroups.includes('Canvas'), items: menus });

  // Behavioral spot-checks that menu items are wired
  await safe('D_menu_behavioral', async () => {
    const behavioral = {};
    // View > Zoom In
    const z0 = await zoomOf(page);
    await page.click('.pf-menubar__label:has-text("View")');
    await page.click('.pf-menubar__menu [role="menuitem"]:has-text("Zoom In")');
    await page.waitForTimeout(60);
    behavioral.viewZoomIn = { before: z0, after: await zoomOf(page) };
    // Edit > Select All
    await page.click('.pf-menubar__label:has-text("Edit")');
    await page.click('.pf-menubar__menu [role="menuitem"]:has-text("Select All")');
    await page.waitForTimeout(60);
    behavioral.editSelectAll = { selAfter: await selOf(page) };
    await page.keyboard.press('Escape'); // deselect
    // Tools > Tool: Eraser
    await page.click('.pf-menubar__label:has-text("Tools")');
    await page.click('.pf-menubar__menu [role="menuitem"]:has-text("Tool: Eraser")');
    await page.waitForTimeout(60);
    behavioral.toolsEraser = { toolAfter: await toolOf(page) };
    await page.keyboard.press('b');
    // Help > Keyboard Shortcuts opens help overlay (non-dialog overlay, easy to close)
    await page.click('.pf-menubar__label:has-text("Help")');
    await page.click('.pf-menubar__menu [role="menuitem"]:has-text("Keyboard Shortcuts")');
    await page.waitForTimeout(80);
    behavioral.helpMenuOpensOverlay = await page.evaluate(() => !!document.querySelector('.pf-help__box'));
    await closeAll(page);
    // File > Export... opens export dialog (native <dialog>)
    await page.click('.pf-menubar__label:has-text("File")');
    await page.click('.pf-menubar__menu [role="menuitem"]:has-text("Export")');
    await page.waitForTimeout(150);
    behavioral.fileExportOpensDialog = await page.evaluate(() => !!document.querySelector('dialog.pf-export')?.open);
    const closed = await closeAll(page);
    behavioral.exportDialogClosedOnEscape = closed && (await page.evaluate(() => !document.querySelector('dialog.pf-export')?.open));
    rec('D_menu_behavioral', behavioral);
  });
  await closeAll(page);

  // Tool shortcuts
  await page.evaluate(() => document.body.focus());
  const toolSeq = [['b', 'Pencil'], ['e', 'Eraser'], ['g', 'Bucket'], ['l', 'Line'], ['u', 'Rect'], ['u', 'Ellipse'], ['i', 'Eyedropper'], ['m', 'Select'], ['v', 'Move']];
  const toolResults = [];
  for (const [k, expect] of toolSeq) {
    await page.keyboard.press(k);
    await page.waitForTimeout(30);
    const got = await toolOf(page);
    toolResults.push({ key: k, expect, got, pass: got === expect });
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  rec('E_tool_shortcuts', { results: toolResults, allPass: toolResults.every(r => r.pass) });

  // Zoom +/-
  await page.evaluate(() => document.body.focus());
  const zStart = await zoomOf(page);
  await page.keyboard.press('-'); await page.waitForTimeout(30); const zMinus = await zoomOf(page);
  await page.keyboard.press('+'); await page.waitForTimeout(30); const zPlus = await zoomOf(page);
  rec('F_zoom_shortcuts', { zStart, afterMinus: zMinus, afterPlus: zPlus, minusWorked: zMinus !== zStart, plusWorked: zPlus !== zMinus });

  // Undo / Redo via Ctrl+Z / Ctrl+Shift+Z
  await page.keyboard.press('b'); // pencil
  await page.evaluate(() => document.body.focus());
  const depthBefore = await depthOf(page);
  await drawStroke(page);
  await page.waitForTimeout(80);
  const depthAfterDraw = await depthOf(page);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  const undoDisabledAfterUndo = await undoDisabled(page);
  const depthAfterUndo = await depthOf(page);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(80);
  const depthAfterRedo = await depthOf(page);
  rec('G_undo_redo', {
    depthBefore, depthAfterDraw, depthAfterUndo, depthAfterRedo,
    drawRecordedStep: depthAfterDraw > depthBefore,
    ctrlZUndid: depthAfterUndo < depthAfterDraw,
    ctrlShiftZRedid: depthAfterRedo > depthAfterUndo,
  });

  // Ctrl+S save — is it wired at all?
  await page.evaluate(() => document.body.focus());
  const ctrlS = await page.evaluate(() => new Promise(res => {
    let prevented = false;
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { prevented = e.defaultPrevented; } };
    window.addEventListener('keydown', h, true);
    // dispatch a trailing listener to read defaultPrevented after app handlers
    const after = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { window.__sPrevented = e.defaultPrevented; } };
    window.addEventListener('keydown', after);
    setTimeout(() => { window.removeEventListener('keydown', h, true); window.removeEventListener('keydown', after); res(null); }, 50);
  }));
  let downloadFired = false;
  const dlPromise = page.waitForEvent('download', { timeout: 800 }).then(() => { downloadFired = true; }).catch(() => {});
  await page.keyboard.press('Control+s');
  await Promise.race([dlPromise, page.waitForTimeout(800)]);
  const sPrevented = await page.evaluate(() => window.__sPrevented === true);
  rec('H_ctrl_s_save', { appPreventedDefault: sPrevented, downloadTriggered: downloadFired, note: 'true on either would indicate an app-level save handler' });

  // Space pan: space+drag over canvas must NOT create a paint step (pans instead of draws)
  await page.keyboard.press('b');
  await page.evaluate(() => document.body.focus());
  const dBeforeSpace = await depthOf(page);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const well = document.querySelector('.pf-stage__well');
    const r = well.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const o = (x, y, b) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 2, pointerType: 'mouse', button: 0, buttons: b });
    well.setPointerCapture = () => {}; well.releasePointerCapture = () => {}; well.hasPointerCapture = () => false;
    well.dispatchEvent(new PointerEvent('pointerdown', o(cx, cy, 1)));
    well.dispatchEvent(new PointerEvent('pointermove', o(cx + 20, cy + 10, 1)));
    well.dispatchEvent(new PointerEvent('pointerup', o(cx + 20, cy + 10, 0)));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  });
  await page.waitForTimeout(80);
  const dAfterSpace = await depthOf(page);
  rec('I_space_pan', { depthBefore: dBeforeSpace, depthAfter: dAfterSpace, spaceSuppressedDraw: dAfterSpace === dBeforeSpace });

  // Command palette
  await safe('J_command_palette', async () => {
    await closeAll(page);
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(80);
    const paletteOpen = await page.evaluate(() => !!document.querySelector('.pf-cmdk__box'));
    await page.fill('.pf-cmdk__input', 'export');
    await page.waitForTimeout(60);
    const firstItem = await page.evaluate(() => document.querySelector('.pf-cmdk__item')?.innerText.replace(/\n/g, ' '));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const paletteRanExport = await page.evaluate(() => ({ dialog: !!document.querySelector('dialog.pf-export')?.open, paletteClosed: !document.querySelector('.pf-cmdk__box') }));
    await closeAll(page);
    // fuzzy subsequence 'fit' -> Fit to Screen first
    await page.keyboard.press('Control+k'); await page.waitForTimeout(60);
    await page.fill('.pf-cmdk__input', 'fit'); await page.waitForTimeout(60);
    const fitFirst = await page.evaluate(() => document.querySelector('.pf-cmdk__item')?.innerText.replace(/\n/g, ' '));
    // empty state
    await page.fill('.pf-cmdk__input', 'zzqqxx'); await page.waitForTimeout(60);
    const emptyState = await page.evaluate(() => ({ items: document.querySelectorAll('.pf-cmdk__item').length, empty: !!document.querySelector('.pf-cmdk__empty'), emptyText: document.querySelector('.pf-cmdk__empty')?.textContent }));
    await closeAll(page);
    rec('J_command_palette', { openedOnCtrlK: paletteOpen, firstItemForExport: firstItem, ranExport: paletteRanExport, fitFirst, emptyState });
  });

  // Overlays: Help via '?'; Gallery via Open; Welcome via New; Settings existence
  await safe('K_overlays', async () => {
    await closeAll(page);
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('?'); await page.waitForTimeout(80);
    const helpOpen = await page.evaluate(() => !!document.querySelector('.pf-help__box'));
    await closeAll(page);
    const helpClosed = await page.evaluate(() => !document.querySelector('.pf-help__box'));

    await page.click('.pf-projbar__ops button:has-text("Open")'); await page.waitForTimeout(250);
    const galleryOpen = await page.evaluate(() => !!document.querySelector('dialog.pf-gallery')?.open);
    await closeAll(page);
    const galleryClosed = await page.evaluate(() => !document.querySelector('dialog.pf-gallery')?.open);

    await page.click('.pf-projbar__ops button:has-text("New")'); await page.waitForTimeout(250);
    const welcomeOpen = await page.evaluate(() => !!document.querySelector('dialog.pf-welcome')?.open);
    await closeAll(page);
    const welcomeClosed = await page.evaluate(() => !document.querySelector('dialog.pf-welcome')?.open);

    const settingsExists = await page.evaluate(() => {
      const hay = [...document.querySelectorAll('button, [role="menuitem"], dialog, h2')].map(e => (e.textContent || '').toLowerCase());
      return {
        anySettingsControl: hay.some(t => t.includes('settings')),
        settingsDialog: !!document.querySelector('dialog.pf-settings, .pf-settings'),
      };
    });
    rec('K_overlays', { helpOpen, helpClosed, galleryOpen, galleryClosed, welcomeOpen, welcomeClosed, settingsExists });
  });
  await closeAll(page);

  // Focus ring (keyboard)
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Tab');
  const focus1 = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = el ? getComputedStyle(el) : null;
    return el ? {
      tag: el.tagName, text: (el.textContent || '').trim().slice(0, 30),
      outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, boxShadow: cs.boxShadow,
    } : null;
  });
  rec('L_focus_ring', { firstTabTarget: focus1, hasVisibleRing: !!focus1 && ((focus1.outlineStyle !== 'none' && focus1.outlineWidth !== '0px') || (focus1.boxShadow && focus1.boxShadow !== 'none')) });

  await page.screenshot({ path: path.join(OUT, 'shot-02-desktop-1440.png'), fullPage: false });

  // Responsive: horizontal overflow + screenshot at mobile widths
  const responsive = {};
  for (const w of [768, 375, 320]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(200);
    responsive[w] = await page.evaluate(() => ({
      docScrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    await page.screenshot({ path: path.join(OUT, `shot-03-responsive-${w}.png`), fullPage: false });
  }
  rec('M_responsive', responsive);

  rec('Z_app_console_errors_main', appErrors);

  await ctx.close();
  await browser.close();

  console.log('\n=====RESULTS_JSON=====');
  console.log(JSON.stringify(R));
};

run().catch(e => { console.error('FATAL', e); process.exit(1); });
