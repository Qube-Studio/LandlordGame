// Headless screenshot harness for the offline gallery (art-iteration tooling).
// Usage: node tools/shoot.mjs <baseUrl> <outDir> <scene1,scene2,...> [waitMs]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:5175';
const outDir = process.argv[3] || './shots';
const scenes = (process.argv[4] || 'avatars,notes,lobby,huds,finalize,coin,investorBet,reflip').split(',');
const waitMs = Number(process.argv[5] || 2600);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page err]', m.text().slice(0, 200)); });

for (const scene of scenes) {
  const url = `${base}/preview/gallery.html?scene=${scene}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(waitMs);
    const file = `${outDir}/${scene}.png`;
    await page.screenshot({ path: file });
    console.log('OK  ', scene, '->', file);
  } catch (e) {
    console.log('FAIL', scene, e.message.slice(0, 160));
  }
}
await browser.close();
console.log('done');
