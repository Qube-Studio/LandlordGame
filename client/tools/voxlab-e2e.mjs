// VoxLab 隔离区 E2E 冒烟:指针锁 → 行走 → 准心摆放人物 → 右键删除 → V 切换吊灯资产。
// 用法: node tools/voxlab-e2e.mjs [base] [outDir]   (默认 http://localhost:5175 / ./voxlab-shots)
// 断言走 window.__voxlab 探针(同 __walkRig 先例);headless FPS 无意义,只验正确性。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5175';
const outDir = process.argv[3] || './voxlab-shots';
mkdirSync(outDir, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page err]', m.text().slice(0, 200)); });
await page.goto(`${base}/voxlab.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(8000); // 体素合并 + 纹理烘焙预热

const probe = () => page.evaluate(() => window.__voxlab);
// 探针在 useFrame 里逐帧刷新,SwiftShader ~2fps——断言一律轮询等到条件或超时
const waitProbe = async (cond, ms = 4000) => {
  const t0 = Date.now();
  let st = await probe();
  while (!cond(st) && Date.now() - t0 < ms) {
    await page.waitForTimeout(250);
    st = await probe();
  }
  return st;
};

// 1. 点击画布 → 指针锁定
await page.mouse.click(720, 450);
let st = await waitProbe((s) => s?.locked === true);
ok(st?.locked === true, '点击画布 → 指针锁定');

// 2. WASD 行走:W 前进,位置应向 -z 移动(SwiftShader 掉帧严重,只验方向不验距离)
const z0 = st.pos[1];
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
st = await probe();
ok(st.pos[1] < z0 - 0.03, `W 前进(z ${z0.toFixed(2)} → ${st.pos[1].toFixed(2)})`);

// 3. 低头看地 → 准心=floor
await page.mouse.move(720, 450 + 320, { steps: 8 }); // 锁定态:移动=转视角(俯)
await page.waitForTimeout(300);
st = await probe();
ok(st.aim?.kind === 'floor', `低头 → 准心指地(${st.aim?.kind})`);

// 4. 左键摆放人物
await page.mouse.down(); await page.mouse.up();
st = await waitProbe((s) => s.chars === 1);
ok(st.chars === 1, `左键 → 摆放人物(${st.chars} 个)`);
await page.screenshot({ path: `${outDir}/voxlab-placed.png` });

// 5. 滚轮切角色 + 移开准心(避开刚摆的人物)再摆一个
const role0 = st.role;
await page.mouse.wheel(0, 120);
st = await waitProbe((s) => s.role !== role0);
ok(st.role !== role0, `滚轮换角色(${role0} → ${st.role})`);
// 向左转开视角直到准心指地(第一个人物就在正前方,指到人时点击按设计不落子)
for (let i = 0; i < 6; i++) {
  await page.mouse.move(720 - 200, 770, { steps: 4 });
  await page.waitForTimeout(250);
  st = await probe();
  if (st.aim?.kind === 'floor') break;
}
ok(st.aim?.kind === 'floor', `转开视角 → 准心指地(${st.aim?.kind})`);
await page.mouse.down(); await page.mouse.up();
st = await waitProbe((s) => s.chars === 2);
ok(st.chars === 2, `再摆一个(${st.chars} 个)`);

// 6. V 切换吊灯 → 现有资产
await page.keyboard.press('KeyV');
await page.waitForTimeout(800);
st = await probe();
ok(st.swaps?.chandelier === false, 'V → 吊灯切回现有资产');
await page.mouse.move(720, 300, { steps: 8 }); // 抬头看吊灯
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/voxlab-raster-chand.png` });

// 7. 切回体素 + 全景截图
await page.keyboard.press('KeyV');
await page.waitForTimeout(800);
st = await probe();
ok(st.swaps?.chandelier === true, 'V → 吊灯切回体素资产');
await page.screenshot({ path: `${outDir}/voxlab-vox-chand.png` });

console.log(`\n${pass} 通过, ${fail} 失败(截图在 ${outDir})`);
await browser.close();
process.exit(fail ? 1 : 0);
