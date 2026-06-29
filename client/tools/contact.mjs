// Contact-sheet generator for the art bake-off.
// Tiles screenshots into one labeled grid PNG (rows = scenes, cols = styles)
// so the whole comparison can be reviewed in a single image. Zero extra deps:
// builds an HTML grid of file:// <img>s and screenshots it with Playwright.
//
// Usage: node tools/contact.mjs <manifest.json> <outPng>
//   manifest = {
//     title: "Art bake-off",
//     styles: [{ key:"tavern", label:"暖光酒馆", dir:"C:/.../shots_tavern" }, ...],
//     scenes: [{ key:"huds", label:"牌桌/HUD" }, ...],
//     thumbW: 460            // optional, px width per thumbnail
//   }
// Expects each style dir to contain <sceneKey>.png.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
const out = process.argv[3] || './contact.png';
const tw = manifest.thumbW || 460;

// Inline images as base64 data URIs: file:// <img>s are blocked under setContent.
const cell = (styleDir, sceneKey) => {
  const p = `${styleDir}/${sceneKey}.png`;
  if (!existsSync(p)) return `<div class="miss">missing<br>${sceneKey}</div>`;
  const b64 = readFileSync(p).toString('base64');
  return `<img src="data:image/png;base64,${b64}" width="${tw}">`;
};

const head = `<tr><th class="corner">${manifest.title || ''}</th>${manifest.styles
  .map((s) => `<th>${s.label}<div class="sub">${s.key}</div></th>`).join('')}</tr>`;
const rows = manifest.scenes.map((sc) =>
  `<tr><th class="rowlbl">${sc.label}<div class="sub">${sc.key}</div></th>${manifest.styles
    .map((s) => `<td>${cell(s.dir, sc.key)}</td>`).join('')}</tr>`).join('');

const html = `<!doctype html><meta charset="utf8"><body>
<style>
  body{margin:0;background:#15171c;font-family:system-ui,'Segoe UI',sans-serif;color:#e8e8ee}
  table{border-collapse:collapse;margin:0 auto}
  th,td{padding:8px;text-align:center;vertical-align:middle}
  th{font-size:20px;font-weight:700;color:#f1d488}
  th.rowlbl{font-size:18px;color:#cfe;writing-mode:horizontal-tb;max-width:130px}
  th.corner{color:#9aa}
  .sub{font-size:12px;color:#889;font-weight:400;margin-top:2px}
  img{display:block;border:1px solid #333;border-radius:6px}
  .miss{width:${tw}px;height:${Math.round(tw * 0.62)}px;display:flex;align-items:center;justify-content:center;color:#a55;border:1px dashed #533;border-radius:6px}
</style>
<table>${head}${rows}</table></body>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 100, height: 100 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
const table = await page.$('table');
const box = await table.boundingBox();
await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('contact sheet ->', out);
