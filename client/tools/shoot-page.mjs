// 整页截图(gallery 之外的页面:登录 / 大厅)。姊妹篇 shoot.mjs 只拍画廊场景。
// 用法: node tools/shoot-page.mjs <url> <outPng> [waitMs] [mouseX,mouseY]
//   mouseX,mouseY: 截图前把鼠标移到该窗口坐标(验证吉祥物看鼠标/招牌跟随等交互)。
// 注意:会清掉 localStorage(确保无 token 时落在登录屏);拍大厅请先手动登录后带 token 环境跑。
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5175/';
const out = process.argv[3] || './page.png';
const waitMs = Number(process.argv[4] || 6000);
const mouse = (process.argv[5] || '').split(',').map(Number);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page err]', m.text().slice(0, 200)); });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(waitMs);
if (mouse.length === 2 && !Number.isNaN(mouse[0])) {
  await page.mouse.move(mouse[0], mouse[1]);
  await page.waitForTimeout(800);
}
await page.screenshot({ path: out });
console.log('OK', out);
await browser.close();
