// Final micro-probe: exact defaultPrevented for Ctrl-modified keys + New->Welcome.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4173/pixel-forge/';
const out = {};
const log = (k, v) => { out[k] = v; console.log(`\n### ${k}\n` + JSON.stringify(v, null, 2)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.pf-stage__well');
await page.waitForTimeout(200);

// Normalized lowercase probe keys.
await page.evaluate(() => {
  window.__p = {};
  window.addEventListener('keydown', (e) => {
    const k = (e.ctrlKey||e.metaKey?'ctrl-':'') + (e.shiftKey?'shift-':'') + e.key.toLowerCase();
    window.__p[k] = e.defaultPrevented;
  }, false);
});
await page.mouse.click(700, 450);
await page.waitForTimeout(50);
for (const combo of ['Control+s','Control+n','Control+o','Control+z','Control+k','Control+a']) {
  await page.keyboard.press(combo);
  await page.waitForTimeout(50);
  await page.keyboard.press('Escape'); // close palette if Ctrl+K opened it
  await page.waitForTimeout(40);
}
const p = await page.evaluate(() => window.__p);
log('defaultPrevented_exact', {
  'Ctrl+S save': p['ctrl-s'],
  'Ctrl+N new': p['ctrl-n'],
  'Ctrl+O open': p['ctrl-o'],
  'Ctrl+Z undo (control)': p['ctrl-z'],
  'Ctrl+K palette (control)': p['ctrl-k'],
  'Ctrl+A selectAll (control)': p['ctrl-a'],
  raw: p,
});

// Does clicking the ProjectWorkbench "New" button open the Welcome onboarding?
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.pf-stage__well');
const newBtn = page.locator('button', { hasText: /^New$/ }).first();
const newCount = await newBtn.count();
let welcomeOpenedByNew = false, welcomeContents = null;
if (newCount) {
  await newBtn.click();
  await page.waitForTimeout(200);
  welcomeOpenedByNew = await page.evaluate(() => !!document.querySelector('dialog.pf-welcome[open]'));
  welcomeContents = await page.evaluate(() => {
    const d = document.querySelector('dialog.pf-welcome[open]');
    if (!d) return null;
    return { heading: d.querySelector('h1,h2,[class*=title]')?.textContent?.trim(), buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()) };
  });
}
log('new_opens_welcome', { newButtonExists: newCount > 0, welcomeOpenedByNew, welcomeContents });

await ctx.close();
await browser.close();
const fs = await import('node:fs');
fs.writeFileSync(join(DIR, 'qa2-micro-results.json'), JSON.stringify(out, null, 2));
console.log('\n=== MICRO DONE ===');
