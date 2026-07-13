// VoxLab 隔离区 E2E 冒烟:指针锁 → 行走 → 摆放(地面/桌面/天花板) → 旋转/缩放 → 换笔刷 →
// V 切换吊灯 → 导入 .vox → 刷新持久化。
// 用法: node tools/voxlab-e2e.mjs [base] [outDir]   (默认 http://localhost:5175 / ./voxlab-shots)
// 断言走 window.__voxlab 探针(useFrame 逐帧刷新,SwiftShader ~2fps——断言一律轮询 waitProbe,
// 固定等待必闪断);准心指到已摆模型时点击不落子是产品行为(测试须转开视角);截图=证据不炸断言。
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
// 持久层清零(上次运行/手玩的存档会破坏计数基线),再冷加载
await page.evaluate(async () => {
  localStorage.removeItem('voxlab.scene');
  await new Promise((res) => { const r = indexedDB.deleteDatabase('voxlab'); r.onsuccess = r.onerror = r.onblocked = res; });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(8000); // 体素合并 + 纹理烘焙预热

const probe = () => page.evaluate(() => window.__voxlab);
const shot = async (name) => {
  try {
    await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 60000 });
  } catch {
    console.log(`  (截图 ${name} 超时,跳过)`);
  }
};
const waitProbe = async (cond, ms = 5000) => {
  const t0 = Date.now();
  let st = await probe();
  while (!cond(st) && Date.now() - t0 < ms) {
    await page.waitForTimeout(250);
    st = await probe();
  }
  return st;
};
// 锁定态的鼠标坐标是"虚拟游标":重复 move 到同一坐标=零增量,视角纹丝不动——
// 所有视角操控必须换坐标;cursor 自己记账,越界前折返。
const cursor = { x: 720, y: 450 };
const look = async (dx, dy) => {
  cursor.x = Math.min(1380, Math.max(60, cursor.x + dx));
  cursor.y = Math.min(860, Math.max(40, cursor.y + dy));
  await page.mouse.move(cursor.x, cursor.y, { steps: 6 });
  await page.waitForTimeout(600); // SwiftShader ~2fps:等到探针真跟上这次转头,防扫描读过期帧越窗
};
// 俯仰扫描找表面(只动 pitch 不动 yaw;dy 每步像素,越界自动折返继续)。
// 每步必须等探针的 pitch 真变化再判定——桌面的俯仰窗口只有 ~2 步宽,读一次过期帧就越窗。
const pitchScan = async (wants, stepDy = -45, iters = 18) => {
  const wantSet = Array.isArray(wants) ? wants : [wants];
  let st = await probe();
  for (let i = 0; i < iters && !wantSet.includes(st.aim?.surface); i++) {
    if ((stepDy < 0 && cursor.y <= 41) || (stepDy > 0 && cursor.y >= 859)) stepDy = -stepDy;
    const prev = st?.pitch;
    await look(0, stepDy);
    st = await waitProbe((s) => s?.pitch !== prev, 3000);
  }
  return st;
};
const walk = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForTimeout(300);
};

// 编排注意:headless 行走比实时慢一个量级(2fps × dt 限步),摆下的模型挡视线后走不开——
// 所以先摆远处表面(桌面/悬挂,视线畅通),后摆近处地面;多个地面件用不同偏航扇区,互不遮挡。

// 1. 点击画布 → 指针锁定
await page.mouse.click(720, 450);
let st = await waitProbe((s) => s?.locked === true);
ok(st?.locked === true, '点击画布 → 指针锁定');

// 2. WASD 行走:W 前进,位置应向 -z 移动(只验方向不验距离)
const z0 = st.pos[1];
await walk(['KeyW'], 1500);
st = await probe();
ok(st.pos[1] < z0 - 0.03, `W 前进(z ${z0.toFixed(2)} → ${st.pos[1].toFixed(2)})`);

// 3. 桌面摆放(初始朝向正对桌子,微俯扫描进桌面俯仰窗口)
st = await pitchScan('table', 20, 15);
ok(st.aim?.surface === 'table', `准心找到桌面(${st.aim?.surface},y=${st.aim?.y?.toFixed(2)})`);
if (st.aim?.surface === 'table') {
  await page.mouse.down(); await page.mouse.up();
  st = await waitProbe((s) => s.chars === 1);
  ok(st.chars === 1, `桌面摆放(${st.chars} 个)`);
} else { fail++; console.error('  ✗ 桌面摆放(跳过:未找到桌面)'); }

// 4. 悬挂摆放:抬头,横梁或天花板皆可(视角度先撞到哪个)
st = await pitchScan(['ceiling', 'beam'], -60, 16);
ok(['ceiling', 'beam'].includes(st.aim?.surface), `抬头 → 准心指${st.aim?.surface === 'beam' ? '横梁' : '天花板'}`);
const beforeCeil = st.chars;
await page.mouse.down(); await page.mouse.up();
st = await waitProbe((s) => s.chars === beforeCeil + 1);
ok(st.chars === beforeCeil + 1, `悬挂摆放(${st.chars} 个)`);
await shot('voxlab-hang');

// 5. R 换笔刷 + Q 旋转 + 滚轮缩放(虚影变换)
const role0 = st.role;
await page.keyboard.press('KeyR');
st = await waitProbe((s) => s.role !== role0);
ok(st.role !== role0, `R 换笔刷(${role0} → ${st.role})`);
await page.keyboard.press('KeyQ');
await page.keyboard.press('KeyQ');
st = await waitProbe((s) => (s.ghostRot ?? 0) > 0.4);
ok(st.ghostRot > 0.4, `Q 旋转虚影(rot=${st.ghostRot?.toFixed(2)})`);
await page.mouse.wheel(0, -240); // 上滚两格=×1.21
st = await waitProbe((s) => (s.ghostScale ?? 1) > 1.15);
ok(st.ghostScale > 1.15, `滚轮放大(×${st.ghostScale?.toFixed(2)})`);

// 6. 地面摆放(带旋转/缩放):低头 + 偏航转开(悬挂件正上方,不挡低角度射线)
await look(0, 700); await look(0, 300); // 压到最低俯角
await look(-360, 0);                    // 左转一个扇区,地面开阔
st = await waitProbe((s) => s.aim?.surface === 'floor', 5000);
ok(st.aim?.surface === 'floor', `低头转开 → 准心指地(${JSON.stringify(st.aim)})`);
const beforeFloor = st.chars;
await page.mouse.down(); await page.mouse.up();
st = await waitProbe((s) => s.chars === beforeFloor + 1);
ok(st.chars === beforeFloor + 1, `地面摆放(${st.chars} 个)`);
await shot('voxlab-placed');

// 7. V 切换吊灯资产
await page.keyboard.press('KeyV');
st = await waitProbe((s) => s.swaps?.chandelier === false);
ok(st.swaps?.chandelier === false, 'V → 吊灯切回现有资产');
await page.keyboard.press('KeyV');
st = await waitProbe((s) => s.swaps?.chandelier === true);
ok(st.swaps?.chandelier === true, 'V → 吊灯切回体素资产');

// 8. 导入素材:注入 .vox(隐藏 input;拖拽同一入口)→ 笔刷自动切到导入件 → 换扇区摆放
await page.setInputFiles('input[type=file]', new URL('../src/assets/vox/chandelier-deluxe.vox', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
st = await waitProbe((s) => s.imports === 1);
ok(st.imports === 1, `导入 .vox(${st.imports} 个素材)`);
ok(String(st.role).startsWith('vox'), `笔刷自动切到导入件(${st.role})`);
await look(-360, 0);                    // 再左转一个扇区(避开上一件)
st = await waitProbe((s) => s.aim?.surface === 'floor', 5000);
ok(st.aim?.surface === 'floor', `转开扇区 → 准心指地(${st.aim?.surface})`);
const charsBefore = st.chars;
await page.mouse.down(); await page.mouse.up();
st = await waitProbe((s) => s.chars === charsBefore + 1, 10000); // 首次解析+合并 ~0.7s
ok(st.chars === charsBefore + 1, `摆放导入素材(${st.chars} 个)`);
await page.waitForTimeout(1500);
await shot('voxlab-imported');

// 9. 刷新持久化:素材(IndexedDB)与摆放(localStorage)都应还在
const persisted = { chars: st.chars, imports: st.imports };
await page.waitForTimeout(600); // 等 300ms 去抖落盘
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(8000);
cursor.x = 720; cursor.y = 450;
await page.mouse.click(720, 450); // 回锁(探针在 useFrame 里,点一下保证有帧)
st = await waitProbe((s) => s?.chars === persisted.chars && s?.imports === persisted.imports, 10000);
ok(st?.imports === persisted.imports, `刷新后素材还在(${st?.imports} 个)`);
ok(st?.chars === persisted.chars, `刷新后摆放还在(${st?.chars} 个)`);
await page.waitForTimeout(1500);
await shot('voxlab-persisted');

console.log(`\n${pass} 通过, ${fail} 失败(截图在 ${outDir})`);
await browser.close();
process.exit(fail ? 1 : 0);
