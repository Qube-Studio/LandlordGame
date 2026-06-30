// End-to-end smoke test against the REAL app (real Node server on :3001 via vite proxy).
// Drives: guest login -> create quick room -> dev_fill bots -> walk phases -> settle.
// Captures screenshots + console errors. Usage: node tools/smoke.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:5175';
const outDir = process.argv[3] || './smoke';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 240)));

const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 60000, animations: 'disabled' }); console.log('  shot', name); };
const phase = async () => page.evaluate(() => {
  const el = document.querySelector('.phase-chip, .round-chip, [class*="phase"]');
  return (el?.textContent || '').trim().slice(0, 40);
});

try {
  console.log('1. open real app');
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('01-login');

  console.log('2. register real account (tester flow)');
  const uname = 'smk' + (Date.now() % 100000);
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByPlaceholder('1-16 个字符').fill(uname);
  await page.getByPlaceholder('至少 4 位').fill('test1234');
  await page.getByPlaceholder('再输入一次').fill('test1234');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForTimeout(1500);
  await shot('02-lobby');

  console.log('3. wait for WS connected, then create quick room');
  // 等 WS 连上：连上后大厅 conn-banner 消失、创建房间按钮启用
  try {
    await page.waitForFunction(() => {
      const b = document.querySelector('.conn-banner');
      return !b; // 横幅消失 = connected
    }, { timeout: 25000 });
    console.log('   WS connected (banner gone)');
  } catch {
    const diag = await page.evaluate(() => ({
      banner: document.querySelector('.conn-banner')?.textContent || null,
      ls: Object.keys(localStorage),
    }));
    console.log('   WS NOT connected after 25s. diag:', JSON.stringify(diag));
  }
  await page.getByRole('button', { name: '创建房间' }).first().click({ timeout: 8000 });
  await page.waitForSelector('.r3f-scene, .hud', { timeout: 15000 });
  await page.waitForTimeout(2500);
  await shot('03-game-lobby');
  console.log('   phase:', await phase());

  console.log('4. dev_fill bots (B)');
  await page.keyboard.press('b');
  await page.waitForTimeout(2000);
  await shot('04-filled');
  console.log('   phase:', await phase());

  console.log('5. walk phases via Enter (bots auto-act); screenshot each step');
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2200);
    const ph = await phase();
    await shot(`step-${String(i).padStart(2, '0')}`);
    console.log(`   step ${i} phase: ${ph}`);
  }
} catch (e) {
  console.log('FLOW ERROR:', e.message.slice(0, 200));
  await shot('zz-error');
}

console.log('--- console errors (' + errors.length + ') ---');
for (const e of errors.slice(0, 20)) console.log('  ', e);
await browser.close();
console.log('done');
