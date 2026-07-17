// RulesPanel 渲染基线快照（EDITOR_OVERHAUL §1.3）：开 /preview.html → 开教程面板 → DFS 点遍全部章节，
// 抓每章 .tut-content innerHTML（剥 data-* 归一化）存 JSON。抽取 TutorialContent 前后各跑一次，diff 必须为空。
// 用法：node tools/tutorial-baseline.mjs <vite端口> <输出文件>
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const PORT = process.argv[2] || '5219';
const OUT = process.argv[3] || 'baseline.json';
const norm = (html) => html.replace(/\sdata-[\w-]+="[^"]*"/g, '');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto(`http://localhost:${PORT}/preview.html?phase=LOBBY`);
await page.waitForSelector('.rules-root .hud-icon-btn', { timeout: 60000 });
await page.waitForTimeout(2500);

// 章节树结构（含嵌套）从真数据模块拿
const tree = await page.evaluate(async () => {
  const m = await import('/src/text/index.js');
  const walk = (ns) => ns.map((n) => ({ id: n.id, title: n.title, children: walk(n.children ?? []) }));
  return walk(m.T.rules.chapters ?? []);
});

await page.click('.rules-root .hud-icon-btn');
await page.waitForSelector('.rules-overlay .tut-nav');

const out = [];
async function clickNav(title) {
  // 在当前可见 nav 项里按标题找（标题在真数据里唯一）；点击后轮询等内容标题切换
  const items = page.locator('.tut-nav-item', { hasText: title });
  await items.first().click();
  await page.waitForFunction((t) => {
    const el = document.querySelector('.tut-content-title');
    return el && el.textContent.replace(/\s/g, '').includes(t.replace(/\s/g, ''));
  }, title, { timeout: 15000 });
}
async function visit(node) {
  await clickNav(node.title);
  const html = await page.$eval('.tut-content', (e) => e.innerHTML);
  out.push({ id: node.id, title: node.title, html: norm(html) });
  for (const c of node.children) await visit(c);
}
for (const top of tree) await visit(top);

writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`baseline: ${out.length} chapters → ${OUT}`);
await browser.close();
