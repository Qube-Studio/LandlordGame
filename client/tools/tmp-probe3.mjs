import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(url, { timeout: 25000 }).catch((e) => console.log('goto fail', e.message));
await page.waitForTimeout(8000);
const fonts = await page.evaluate(() => {
  const arr = [];
  document.fonts.forEach((f) => arr.push(`${f.family} ${f.weight} ${f.status}`));
  return { status: document.fonts.status, list: arr.slice(0, 30) };
});
console.log(JSON.stringify(fonts, null, 1));
await browser.close();
