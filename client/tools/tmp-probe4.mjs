import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const seen = new Set();
page.on('console', (m) => { if (m.type() !== 'error' && m.type() !== 'warning') return; const t = `${m.type()}: ${m.text()}`.slice(0, 350); if (!seen.has(t)) { seen.add(t); console.log(t); } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 800)));
await page.goto(url, { timeout: 25000 }).catch((e) => console.log('goto fail', e.message));
await page.waitForTimeout(9000);
// rAF 心跳检测:1.5s 内 rAF 跑了几帧
const beat = await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const tick = () => { n++; if (n < 1000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => res(n), 1500);
}));
console.log('rAF frames in 1.5s:', beat);
await browser.close();
