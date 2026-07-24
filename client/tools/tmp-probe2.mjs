import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 360, height: 220 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 400)));
await page.goto(url, { timeout: 25000 }).catch((e) => console.log('goto fail', e.message));
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(3000);
  const t0 = Date.now();
  const r = await page.evaluate(() => ({ canvas: !!document.querySelector('canvas'), kids: document.getElementById('root')?.children.length ?? -1 })).catch((e) => `EVAL-FAIL ${e.message.slice(0, 60)}`);
  console.log(`t+${(i + 1) * 3}s eval ${Date.now() - t0}ms:`, JSON.stringify(r));
}
await page.screenshot({ path: process.argv[3] });
console.log('OK');
await browser.close();
