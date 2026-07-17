// VoxRoom 几何量验证:__voxperf(renderer.info)在 体素墙 vs 贴图墙 的 tris/calls 对比
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('[page exc]', String(e).slice(0, 200)));
await page.goto(`${base}/voxlab.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(10000);

const perf = async (label) => {
  await page.waitForTimeout(2500);
  const p = await page.evaluate(() => window.__voxperf);
  console.log(`${label}:`, JSON.stringify(p));
};
await perf('体素全开(默认)');
await page.mouse.click(640, 400);
await page.waitForTimeout(600);
await page.keyboard.press('KeyM');   // 墙梁 → 贴图
await perf('贴图墙梁');
await page.keyboard.press('KeyM');   // 切回体素
await perf('体素墙梁(回切)');
await browser.close();
