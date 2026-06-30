// Presentation smoke: does the in-game disconnect banner appear when the network drops?
// Validates the client liveness self-check (35s no-inbound watchdog -> connected=false -> banner).
// Usage: node tools/disco.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:5175';
const outDir = process.argv[3] || './disco';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${outDir}/${n}.png`, timeout: 60000, animations: 'disabled' });
const probe = () => page.evaluate(() => {
  const b = document.querySelector('.hud-disconnect, [class*="disconnect"]');
  return { el: b?.textContent?.trim() || null, hasText: /连接已断开|正在重连|断开/.test(document.body.innerText) };
});

try {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const uname = 'dsc' + (Date.now() % 100000);
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByPlaceholder('1-16 个字符').fill(uname);
  await page.getByPlaceholder('至少 4 位').fill('test1234');
  await page.getByPlaceholder('再输入一次').fill('test1234');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForFunction(() => !document.querySelector('.conn-banner'), { timeout: 25000 });
  await page.getByRole('button', { name: '创建房间' }).first().click();
  await page.waitForSelector('.hud', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await shot('01-connected');
  console.log('in game, connected. dropping network (waiting for 35s watchdog)...');

  await ctx.setOffline(true);
  let banner = { el: null, hasText: false };
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(5000);
    banner = await probe();
    const shown = banner.el || banner.hasText;
    console.log(`  +${(i + 1) * 5}s: ${shown ? 'BANNER SHOWN' : '—'}`);
    if (shown) break;
  }
  await shot('02-offline');
  console.log('result:', JSON.stringify(banner), '->', (banner.el || banner.hasText) ? 'BANNER OK ✅' : 'BANNER MISSING ❌');
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 200));
  await shot('zz-error');
}
await browser.close();
console.log('done');
