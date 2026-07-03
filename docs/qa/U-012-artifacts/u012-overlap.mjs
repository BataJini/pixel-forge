import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/pixel-forge/';
const intersect = (a, b) => {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { overlapW: Math.round(ix), overlapH: Math.round(iy), overlaps: ix > 2 && iy > 2 };
};
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const out = {};
  for (const w of [1440, 768, 375]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(400);
    const rects = await page.evaluate(() => {
      const g = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height) }; };
      return {
        stage: g('.pf-stage'),
        dock: g('.pf-dock'),
        menubar: g('.pf-menubar'),
        toolRack: g('[aria-label="Drawing tools"]'),
        projbar: g('.pf-projbar'),
      };
    });
    const r = {};
    if (rects.stage && rects.dock) r.stage_vs_dock = intersect(rects.stage, rects.dock);
    if (rects.toolRack && rects.projbar) r.toolRack_vs_projbar = intersect(rects.toolRack, rects.projbar);
    if (rects.menubar && rects.projbar) r.menubar_vs_projbar = intersect(rects.menubar, rects.projbar);
    out[w] = { rects, overlaps: r };
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
};
run().catch(e => { console.error(e); process.exit(1); });
