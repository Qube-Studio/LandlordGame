import { chromium } from 'playwright';
const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] || 20000);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 600)));
await page.goto(url, { timeout: 25000 }).catch((e) => console.log('goto fail', e.message));
await page.waitForTimeout(waitMs);
const info = await page.evaluate(() => ({
  canvas: !!document.querySelector('canvas'),
  rootKids: document.getElementById('root')?.children.length ?? -1,
  cls: document.querySelector('.app-stage')?.className ?? null,
  text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 100),
})).catch((e) => `evaluate fail: ${e.message.slice(0, 120)}`);
console.log('DOM:', JSON.stringify(info));
if (out) { await page.screenshot({ path: out }); console.log('OK', out); }
await browser.close();
