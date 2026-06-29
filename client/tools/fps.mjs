// rAF frame-rate probe for the offline gallery (perf investigation).
// NOTE: headless uses swiftshader (CPU GL) — absolute fps is NOT the user's GPU,
// but BEFORE/AFTER deltas on the same renderer indicate where the cost is.
// Usage: node tools/fps.mjs <baseUrl> <scene> [warmMs] [measureMs]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5175';
const scene = process.argv[3] || 'huds';
const warm = Number(process.argv[4] || 3500);
const measure = Number(process.argv[5] || 3000);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${base}/preview/gallery.html?scene=${scene}`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(warm);
const frames = await page.evaluate((ms) => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  function tick() { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(n); }
  requestAnimationFrame(tick);
}), measure);
const fps = (frames / (measure / 1000));
console.log(`scene=${scene}  frames=${frames}  ~${fps.toFixed(1)} fps  (over ${measure}ms, swiftshader)`);
await browser.close();
