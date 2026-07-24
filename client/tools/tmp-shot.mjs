import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(process.argv[2], { timeout: 25000 });
await page.waitForTimeout(Number(process.argv[4] || 10000));
await page.screenshot({ path: process.argv[3], timeout: 90000 });
console.log('OK', process.argv[3]);
await browser.close();
