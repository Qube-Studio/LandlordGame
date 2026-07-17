// 摄影棚 2.0 持久 E2E 验收套件（EDITOR_OVERHAUL §2.3 全项）。
// 用法：node tools/photo-e2e.mjs   （client/ 或仓库根都可跑；自起自杀 vite 5229，收尾杀全进程树）
//
// E2E 纪律（§2.2⑤/⑥ 与 P②/P③ 踩过的坑，改本文件前必读）：
//  ① SwiftShader flags 必带（--use-angle=swiftshader --enable-unsafe-swiftshader）；断言一律轮询
//    （SwiftShader ~2fps，固定等待必闪断）；整页截图用 CDP Page.captureScreenshot。
//  ② 合成鼠标拖 3D 有失败先例——框选/表面落点/落底/钱堆槽位的几何全走探针直调纯函数硬断言
//    （__photoPick/__photoSurface/__photoDrop/__photoStack），鼠标只测点选与截图证据。
//  ③ 旋转断言比矩阵/朝向向量（四元数旋转 +X 基向量），**禁比欧拉分量**（万向节等价跳变）。
//  ④ 真鼠标点物体前先悬停并轮询 __photoControls.axis 为空——多选 pivot 的平移箭头可能恰压住物体本体，
//    否则点到的是坐标轴（selectionLock 吞 click，断言悬空）。
//  ⑤ setTransform 之后必须轮询 __photoItems 的世界盒同步（React 同帧未刷到 group 时 store 与
//    three 对象脱节），再触发依赖几何的操作。
//  ⑥ Windows 下杀 vite 要 taskkill /F /T 连子进程一起（npx 包一层壳，只杀父进程子 node 会存活）。
//  ⑦ 单键快捷键会顺带压进 FlyRig 的 WASD 键表（如 Ctrl+A 的 KeyA=左移一帧）——键盘操作后
//    一律重新读 __photoItems/__photoRig，不缓存屏幕坐标。
//  ⑧ 钱堆槽位的 Node 侧公式是 scene/cards.jsx cardLocal/cardYaw 的**故意独立抄本**——
//    游戏侧改布局本套件必须红，这正是「与游戏逐值一致」的验收意义。
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5229;
const BASE = `http://localhost:${PORT}`;
const URL_ = `${BASE}/photo.html`;
const SHOT = path.join(CLIENT, 'tools/photo-e2e.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${extra}`); }
};
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const vNear = (a, b, eps = 1e-4) => a.length === b.length && a.every((x, i) => near(x, b[i], eps));
const S = (t) => console.log(`\n== ${t}`);

// ---- Node 侧独立数学（与页面 three 代码交叉验证） ----
const rotYAround = (v, p, th) => {
  const dx = v[0] - p[0], dz = v[2] - p[2], c = Math.cos(th), s = Math.sin(th);
  return [p[0] + c * dx + s * dz, v[1], p[2] - s * dx + c * dz];
};
const quatFromEulerXYZ = (x, y, z) => {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
};
const applyQuat = (q, v) => {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx];
};
const rectHits = (rect, aabb) => {
  const xmin = Math.min(rect.x1, rect.x2), xmax = Math.max(rect.x1, rect.x2);
  const ymin = Math.min(rect.y1, rect.y2), ymax = Math.max(rect.y1, rect.y2);
  return aabb.maxX >= xmin && aabb.minX <= xmax && aabb.maxY >= ymin && aabb.minY <= ymax;
};
// 钱堆槽位公式（坑⑧：scene/cards.jsx cardLocal/cardYaw 的故意独立抄本）
const COL_H = 5;
const STACK_SPOTS = [[0, 0], [0.17, 0.07], [-0.15, 0.11], [0.07, -0.17], [-0.11, -0.15], [0.21, -0.08], [-0.2, -0.04], [0.04, 0.19]];
const TABLE_TOP = 1.0;
const cardLocalN = (i) => {
  const col = Math.floor(i / COL_H), row = i % COL_H;
  const [sx, sz] = STACK_SPOTS[col % STACK_SPOTS.length];
  return [sx + ((row % 2) - 0.5) * 0.025, TABLE_TOP + 0.022 + row * 0.034 + col * 0.009, sz + Math.sin(row * 2.1) * 0.02];
};
const cardYawN = (i) => ((i * 37) % 34 - 17) * Math.PI / 180;

// ---- vite 自起（端口占用先检——别把别人的 vite 当成自己的）----
const portBusy = await fetch(BASE, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
if (portBusy) { console.error(`端口 ${PORT} 已被占用——本套件要自起自杀专属 vite，请先停掉占用者`); process.exit(1); }
const vite = spawn(`npx vite --port ${PORT} --strictPort`, {
  cwd: CLIENT, shell: true,
  env: { ...process.env, VITE_CACHE_DIR: 'node_modules/.vite-p' },   // P 轨专属缓存（§3 端口纪律）
});
vite.stdout.on('data', () => {});
vite.stderr.on('data', (d) => console.error(`[vite] ${String(d).trim()}`));
const killVite = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(vite.pid)]); // 坑⑥
    else vite.kill('SIGKILL');
  } catch { /* 已退出 */ }
};
process.on('SIGINT', () => { killVite(); process.exit(130); });

let browser = null;
try {
  {
    const t0 = Date.now(); let up = false;
    while (Date.now() - t0 < 60000 && !(up = await fetch(URL_, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false))) await sleep(400);
    if (!up) throw new Error('vite 5229 60s 未就绪');
    console.log('vite 5229 就绪');
  }

  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  const shot = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  [shot] ${file}`);
  };

  // 轮询求值（纪律①）：fn 在页内跑，truthy 即返回
  const poll = async (fn, ms = 10000, step = 250, arg = undefined) => {
    const t0 = Date.now();
    let v = await page.evaluate(fn, arg);
    while (!v && Date.now() - t0 < ms) { await sleep(step); v = await page.evaluate(fn, arg); }
    return v;
  };
  const items = () => page.evaluate(() => window.__photoItems?.() ?? null);
  const store = () => page.evaluate(() => {
    const s = window.__photoStore.getState();
    return {
      selection: s.selection, past: s.past.length, future: s.future.length, snap: s.snap,
      marquee: s.marquee, mode: s.mode,
      items: s.items.map((it) => ({ id: it.id, kind: it.kind, props: it.props, pos: it.pos, rot: it.rot, scale: it.scale, name: it.name, hidden: it.hidden, locked: it.locked })),
    };
  });
  const item = async (id) => (await store()).items.find((it) => it.id === id);
  // 期望框选命中集（Node 侧独立算：store 顺序 × 探针 AABB 相交 × 非 hidden/locked）——与 pick.js 交叉验证
  const expectedIn = async (rect) => {
    const s = await store(); const m = await items();
    return s.items.filter((i) => !i.hidden && !i.locked && m[i.id] && rectHits(rect, m[i.id].screenAABB)).map((i) => i.id);
  };
  // 场景注入（每组用例独立注入，互不污染；importScene 顺带清撤回栈与选择）
  const inject = (list) => page.evaluate((arr) => {
    window.__photoStore.getState().importScene({
      app: 'fate-photo', version: 1, hideOverhead: false, postFx: true,
      camera: { pos: [5.6, 4.4, 7.8], yaw: 0.62, pitch: -0.34 },
      items: arr,
    });
    window.__photoStore.getState().setMode('arrange');
  }, list);
  const note = (id, pos, extra = {}) => ({ id, kind: 'note', props: { value: 10 }, pos, rot: [0, 0, 0], scale: [1, 1, 1], seed: 0, ...extra });
  const mounted = (ids) => poll((want) => {
    const m = window.__photoItems?.(); return m && want.every((id) => m[id]) ? m : null;
  }, 15000, 250, ids);
  // 真鼠标点物体（纪律④）：先悬停、轮询没抓到坐标轴再按
  const clickWorldItem = async (id, mods = []) => {
    const m = await items();
    const a = m[id].screenAABB;
    const x = (a.minX + a.maxX) / 2, y = (a.minY + a.maxY) / 2;
    await page.mouse.move(x, y);
    await poll(() => { const c = window.__photoControls; return !c || !c.axis ? true : null; }, 6000, 200);
    for (const k of mods) await page.keyboard.down(k);
    await page.mouse.down(); await sleep(150); await page.mouse.up();
    for (const k of mods) await page.keyboard.up(k);
  };

  // ---------------- S1 启动 · 探针齐全 ----------------
  S('S1 启动 · 探针齐全');
  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('fate.photo.scene.v1'));   // 从已知空场起步
  await page.reload({ waitUntil: 'networkidle' });
  await poll(() => !!(window.__photoStore && window.__photoItems && window.__photoPick && window.__photoSurface && window.__photoDrop && window.__photoStack && window.__photoFocus), 30000);
  ok(await page.evaluate(() => !!(window.__photoStore && window.__photoRig && window.__photoProject && window.__photoItems && window.__photoPick && window.__photoSurface && window.__photoDrop && window.__photoStack && window.__photoSpawn && window.__photoFocus)),
    'S1a 探针齐全 __photoStore/Rig/Project/Items/Pick/Surface/Drop/Stack/Spawn/Focus');
  await page.evaluate(() => { const s = window.__photoStore.getState(); if (s.help) s.toggleHelp(); });   // 帮助卡收起，别挡真鼠标用例

  // ---------------- S2 点选 / Ctrl 加选（真鼠标） ----------------
  S('S2 点选 / Ctrl 加选（真鼠标）');
  await inject([note('n1', [-1.2, 1.03, 0]), note('n2', [0.9, 1.03, 0.5], { props: { value: 5 } }),
    { id: 'crate', kind: 'note', props: { value: 2 }, pos: [2.2, 1.4, -1.2], rot: [0, 0, 0], scale: [3, 20, 3], seed: 0 },
    { id: 'c1', kind: 'char', props: { role: 'farmer' }, pos: [-2.6, 0, 2.0], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 }]);
  ok(!!(await mounted(['n1', 'n2', 'crate', 'c1'])), 'S2a 四物挂载并进注册表');
  await clickWorldItem('n1');
  let sel = await poll(() => { const s = window.__photoStore.getState().selection; return s.length === 1 ? s : null; }, 8000);
  ok(JSON.stringify(sel) === JSON.stringify(['n1']), `S2b 点选=单选：${JSON.stringify(sel)}`);
  await clickWorldItem('n2', ['Control']);
  sel = await poll(() => { const s = window.__photoStore.getState().selection; return s.length === 2 ? s : null; }, 8000);
  ok(JSON.stringify(sel) === JSON.stringify(['n1', 'n2']), `S2c Ctrl+点=加选且末位主选：${JSON.stringify(sel)}`);

  // ---------------- S3 框选矩形命中（探针直调 __photoPick） ----------------
  S('S3 框选矩形命中（探针直调）');
  {
    let m = await items();
    const tiny = (() => { const a = m.n1.screenAABB; const cx = (a.minX + a.maxX) / 2, cy = (a.minY + a.maxY) / 2; return { x1: cx - 3, y1: cy - 3, x2: cx + 3, y2: cy + 3 }; })();
    const expTiny = await expectedIn(tiny);
    const gotTiny = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), tiny);
    ok(gotTiny.includes('n1') && JSON.stringify(gotTiny) === JSON.stringify(expTiny), `S3a AABB 内小矩形命中（相交即选中）：${JSON.stringify(gotTiny)}`, `期望 ${JSON.stringify(expTiny)}`);

    const rect = {
      x1: Math.min(m.n1.screenAABB.minX, m.n2.screenAABB.minX) - 6, y1: Math.min(m.n1.screenAABB.minY, m.n2.screenAABB.minY) - 6,
      x2: Math.max(m.n1.screenAABB.maxX, m.n2.screenAABB.maxX) + 6, y2: Math.max(m.n1.screenAABB.maxY, m.n2.screenAABB.maxY) + 6,
    };
    const exp = await expectedIn(rect);
    const got = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), rect);
    ok(got.includes('n1') && got.includes('n2') && JSON.stringify(got) === JSON.stringify(exp), `S3b 覆盖 n1+n2 矩形=独立 AABB 相交集：${JSON.stringify(got)}`, `期望 ${JSON.stringify(exp)}`);
    const got2 = await page.evaluate((r) => window.__photoPick(r.x2, r.y2, r.x1, r.y1), rect);
    ok(JSON.stringify(got2) === JSON.stringify(got), 'S3c 矩形任意对角顺序等价');
    const gotCorner = await page.evaluate(() => window.__photoPick(4, 96, 44, 136));
    ok(JSON.stringify(gotCorner) === JSON.stringify(await expectedIn({ x1: 4, y1: 96, x2: 44, y2: 136 })), `S3d 角落矩形与相交集一致（通常为空）：${JSON.stringify(gotCorner)}`);

    await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { locked: true }));
    const gotLocked = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), rect);
    ok(!gotLocked.includes('n2') && gotLocked.includes('n1'), `S3e locked 物不进框选：${JSON.stringify(gotLocked)}`);
    await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { locked: false, hidden: true }));
    await poll(() => !window.__photoItems().n2, 6000);
    const gotHidden = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), rect);
    ok(!gotHidden.includes('n2') && gotHidden.includes('n1'), `S3f hidden 物不进框选（注册表天然剔除）：${JSON.stringify(gotHidden)}`);
    await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { hidden: false }));
    await poll(() => !!window.__photoItems().n2, 6000);
  }

  // ---------------- S4 多选 gizmo 平移两物等 delta（矩阵比对：pos/rot/scale 全量） ----------------
  S('S4 多选 gizmo 平移（等 delta + 一步历史 + 撤回链含 selection）');
  {
    await page.evaluate(() => window.__photoStore.getState().setSelection(['n1', 'n2']));
    const pv = await poll(() => {
      const c = window.__photoControls;
      return (c?.object && c.object.children.length === 0) ? [c.object.position.x, c.object.position.y, c.object.position.z] : null;
    }, 10000);
    const m = await items();
    const uMin = [0, 1, 2].map((i) => Math.min(m.n1.worldBox3.min[i], m.n2.worldBox3.min[i]));
    const uMax = [0, 1, 2].map((i) => Math.max(m.n1.worldBox3.max[i], m.n2.worldBox3.max[i]));
    ok(pv && vNear(pv, [0, 1, 2].map((i) => (uMin[i] + uMax[i]) / 2), 1e-3), `S4a pivot=选中集 Box3 质心：${JSON.stringify(pv?.map((x) => +x.toFixed(3)))}`);

    const before = await store();
    await page.evaluate(() => {
      const c = window.__photoControls;
      c.dispatchEvent({ type: 'dragging-changed', value: true });
      c.object.position.x += 0.6; c.object.position.z += 0.4; c.object.updateMatrixWorld(true);
      c.dispatchEvent({ type: 'objectChange' });
      c.dispatchEvent({ type: 'dragging-changed', value: false });
    });
    const after = await store();
    const d = (id, f) => {
      const a = after.items.find((i) => i.id === id)[f], b = before.items.find((i) => i.id === id)[f];
      return a.map((x, i) => x - b[i]);
    };
    ok(vNear(d('n1', 'pos'), [0.6, 0, 0.4]) && vNear(d('n2', 'pos'), [0.6, 0, 0.4]), `S4b 平移两物等 delta [0.6,0,0.4]：n1=${JSON.stringify(d('n1', 'pos').map((x) => +x.toFixed(4)))}`);
    ok(vNear(d('n1', 'rot'), [0, 0, 0]) && vNear(d('n1', 'scale'), [0, 0, 0]) && vNear(d('n2', 'rot'), [0, 0, 0]) && vNear(d('n2', 'scale'), [0, 0, 0]), 'S4c 平移不动旋转/缩放分量（矩阵其余分量不变）');
    ok(after.past === before.past + 1, 'S4d 整次拖拽=一步历史');
    await page.evaluate(() => window.__photoStore.getState().undo());
    const und = await store();
    ok(vNear(und.items.find((i) => i.id === 'n1').pos, before.items.find((i) => i.id === 'n1').pos)
      && JSON.stringify(und.selection) === JSON.stringify(['n1', 'n2']), 'S4e 撤回复位且撤回链含 selection');
  }

  // ---------------- S5 带旋转两物绕 pivot 旋转后世界位置正确 ----------------
  S('S5 带初始旋转的两物绕 pivot 旋转（位置=绕质心公式，朝向=四元数向量，禁比欧拉）');
  {
    // n1 先带 30° 初始 yaw；setTransform 后轮询世界盒同步（纪律⑤：盒 x 宽从 0.42 → ~0.65）
    await page.evaluate(() => { const s = window.__photoStore.getState(); s.setSelection([]); s.setTransform('n1', { rot: [0, Math.PI / 6, 0] }); });
    await poll(() => { const b = window.__photoItems().n1.worldBox3; return (b.max[0] - b.min[0]) > 0.6 ? true : null; }, 10000);
    await page.evaluate(() => window.__photoStore.getState().setSelection(['n1', 'n2']));
    const pv = await poll(() => {
      const c = window.__photoControls;
      return (c?.object && c.object.children.length === 0) ? [c.object.position.x, c.object.position.y, c.object.position.z] : null;
    }, 10000);
    const before = await store();
    await page.evaluate(() => {
      const c = window.__photoControls;
      c.dispatchEvent({ type: 'dragging-changed', value: true });
      c.object.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
      c.object.updateMatrixWorld(true);
      c.dispatchEvent({ type: 'objectChange' });
      c.dispatchEvent({ type: 'dragging-changed', value: false });
    });
    const after = await store();
    for (const id of ['n1', 'n2']) {
      const p0 = before.items.find((i) => i.id === id).pos;
      const exp = rotYAround(p0, pv, Math.PI / 2);
      const got = after.items.find((i) => i.id === id).pos;
      ok(vNear(got, exp, 1e-3), `S5a ${id} 绕 pivot 旋转后世界位置正确：${JSON.stringify(got.map((x) => +x.toFixed(4)))}`, `期望 ${JSON.stringify(exp.map((x) => +x.toFixed(4)))}`);
    }
    // 朝向：n1 原 30° + pivot 90° = 120°；n2 = 90°（+X 基向量经四元数旋转比对）
    const fwdOf = (id) => applyQuat(quatFromEulerXYZ(...after.items.find((i) => i.id === id).rot), [1, 0, 0]);
    const expFwd = (th) => [Math.cos(th), 0, -Math.sin(th)];
    ok(vNear(fwdOf('n1'), expFwd(Math.PI / 6 + Math.PI / 2), 1e-3), `S5b n1 朝向=初始30°+90°：${JSON.stringify(fwdOf('n1').map((x) => +x.toFixed(4)))}`);
    ok(vNear(fwdOf('n2'), expFwd(Math.PI / 2), 1e-3), `S5c n2 朝向=90°：${JSON.stringify(fwdOf('n2').map((x) => +x.toFixed(4)))}`);
    await page.evaluate(() => { const s = window.__photoStore.getState(); s.undo(); s.undo(); });   // 退回：旋转拖拽 + setTransform
  }

  // ---------------- S6 表面落点纯函数（y≈crate 顶） ----------------
  S('S6 表面落点纯函数 __photoSurface');
  {
    const m = await items();
    const topY = m.crate.worldBox3.max[1];
    const cx = (m.crate.worldBox3.min[0] + m.crate.worldBox3.max[0]) / 2;
    const cz = (m.crate.worldBox3.min[2] + m.crate.worldBox3.max[2]) / 2;
    const sp = await page.evaluate(([x, y, z]) => window.__photoProject(x, y, z), [cx, topY, cz]);
    await page.evaluate(() => window.__photoStore.getState().setSelection(['n1']));
    const hit = await page.evaluate(([x, y]) => window.__photoSurface(x, y), [sp.x, sp.y]);
    ok(hit && near(hit.point[1], topY, 0.01), `S6a 选中 n1 射向 crate 顶心 → y≈crate 顶 ${topY.toFixed(3)}：${hit ? hit.point[1].toFixed(3) : 'null'}`);
    await page.evaluate(() => window.__photoStore.getState().setSelection(['crate']));
    const hit2 = await page.evaluate(([x, y]) => window.__photoSurface(x, y), [sp.x, sp.y]);
    ok(hit2 && hit2.point[1] < topY - 0.3, `S6b 选中 crate 后同射线穿透命中身后更低表面（自命中排除）：y=${hit2 ? hit2.point[1].toFixed(3) : 'null'}`);
    const tp = await page.evaluate(() => window.__photoProject(0, 1.0, 0));
    const hit3 = await page.evaluate(([x, y]) => window.__photoSurface(x, y, []), [tp.x, tp.y]);
    ok(hit3 && hit3.point[1] > 0.9 && hit3.point[1] < 1.15, `S6c 桌心命中 y≈桌面：${hit3 ? hit3.point[1].toFixed(3) : 'null'}`);
  }

  // ---------------- S7 V 落底（一摞升序 / 互穿顶出 / 键盘路径） ----------------
  S('S7 V 落底');
  {
    // 落底摞放 (1.6, 0.9)（吊灯罩不到处）且起始高度全部低于吊灯底——初始位过高会落在吊灯臂顶，
    // 那是正确产品行为但测不了「落桌成摞」（P② 交接单点名的坑，首轮 S7e 即栽在 3.6 高度上）
    await inject([note('d1', [1.6, 1.4, 0.9]), note('d2', [1.6, 1.9, 0.9], { props: { value: 5 } }),
      note('d3', [1.6, 2.4, 0.9], { props: { value: 2 } }), note('d4', [0.6, 1.5, -0.2], { props: { value: 1 } })]);
    ok(!!(await mounted(['d1', 'd2', 'd3', 'd4'])), 'S7a 落底场景四张钞挂载');
    const tp = await page.evaluate(() => window.__photoProject(1.6, 1.0, 0.9));
    const tHit = await page.evaluate(([x, y]) => window.__photoSurface(x, y, ['d1', 'd2', 'd3', 'd4']), [tp.x, tp.y]);
    ok(!!tHit, `S7b 堆底桌面高度测得 y=${tHit ? tHit.point[1].toFixed(4) : 'null'}`);
    const tableY = tHit.point[1];

    const before = await store();
    await page.evaluate(() => { window.__photoStore.getState().setSelection(['d1', 'd2', 'd3']); window.__photoDrop(); });
    const m = await items();
    ok(near(m.d1.worldBox3.min[1], tableY, 0.01), `S7c d1 落桌面：min.y=${m.d1.worldBox3.min[1].toFixed(4)}`);
    ok(near(m.d2.worldBox3.min[1], m.d1.worldBox3.max[1], 0.005), `S7d d2 摞在 d1 顶：${m.d2.worldBox3.min[1].toFixed(4)}`);
    ok(near(m.d3.worldBox3.min[1], m.d2.worldBox3.max[1], 0.005), `S7e d3 摞在 d2 顶：${m.d3.worldBox3.min[1].toFixed(4)}`);
    const st1 = await store();
    const ys = ['d1', 'd2', 'd3'].map((id) => st1.items.find((i) => i.id === id).pos[1]);
    ok(ys[0] < ys[1] && ys[1] < ys[2], `S7f 一摞保序（升序逐落）：${JSON.stringify(ys.map((y) => +y.toFixed(3)))}`);
    ok(st1.past === before.past + 1, 'S7g 一次落底=一步历史');
    await page.evaluate(() => window.__photoStore.getState().undo());
    const st2 = await store();
    ok(near(st2.items.find((i) => i.id === 'd1').pos[1], 1.4) && near(st2.items.find((i) => i.id === 'd3').pos[1], 2.4), 'S7h 落底可一步撤回');

    // 互穿顶出：d4 底面压进桌面 0.01（钞厚 0.035，pos 在几何中心）→ V 后顶回桌面
    await page.evaluate((y) => {
      const s = window.__photoStore.getState();
      s.setTransform('d4', { pos: [0.6, y, -0.2] });
      s.setSelection(['d4']);
      window.__photoDrop();
    }, tableY - 0.01 + 0.035 / 2);
    const m2 = await items();
    ok(near(m2.d4.worldBox3.min[1], tableY, 0.005), `S7i 互穿物 V 后向上顶出到桌面：min.y=${m2.d4.worldBox3.min[1].toFixed(4)}`);

    // 键盘 V 路径
    await page.evaluate(() => {
      const s = window.__photoStore.getState();
      const d4 = s.items.find((i) => i.id === 'd4');
      s.setTransform('d4', { pos: [d4.pos[0], d4.pos[1] + 0.5, d4.pos[2]] });
    });
    await page.keyboard.press('v');
    const vOk = await poll((ty) => {
      const m3 = window.__photoItems();
      return m3.d4 && Math.abs(m3.d4.worldBox3.min[1] - ty) < 0.005 ? true : null;
    }, 8000, 300, tableY);
    ok(!!vOk, 'S7j 键盘 V 落底生效（d4 回桌面）');
  }

  // ---------------- S8 Shift+D / Del 批量（撤回链含 selection） ----------------
  S('S8 Shift+D 批量复制 / Del 批量删除');
  {
    await page.evaluate(() => window.__photoStore.getState().setSelection(['d1', 'd2']));
    const before = await store();
    await page.keyboard.press('Shift+D');
    const dup = await poll((n) => { const s = window.__photoStore.getState(); return s.items.length === n + 2 ? true : null; }, 8000, 250, before.items.length);
    ok(!!dup, 'S8a Shift+D 复制两物（items +2）');
    const after = await store();
    const clones = after.items.slice(-2);
    ok(JSON.stringify(after.selection) === JSON.stringify(clones.map((c) => c.id)), `S8b 副本成为新选择集：${JSON.stringify(after.selection)}`);
    const src = (i) => before.items.find((x) => x.id === ['d1', 'd2'][i]);
    ok([0, 1].every((i) => vNear(clones[i].pos, [src(i).pos[0] + 0.4, src(i).pos[1], src(i).pos[2] + 0.4])), 'S8c 副本整组偏移 +0.4/+0.4');
    ok([0, 1].every((i) => clones[i].props.value === src(i).props.value && clones[i].kind === src(i).kind), 'S8d 副本深拷贝同 kind/props');
    ok(after.past === before.past + 1, 'S8e 一次批量复制=一步历史');
    await page.evaluate(() => window.__photoStore.getState().undo());
    const und = await store();
    ok(und.items.length === before.items.length && JSON.stringify(und.selection) === JSON.stringify(['d1', 'd2']), 'S8f 撤回删掉副本且 selection 恢复原选中');

    // Del 批量删除
    const b2 = await store();
    await page.keyboard.press('Delete');
    const del = await poll((n) => window.__photoStore.getState().items.length === n - 2, 8000, 250, b2.items.length);
    ok(!!del, 'S8g Del 批量删除（items -2）');
    const a2 = await store();
    ok(a2.selection.length === 0 && !a2.items.some((i) => i.id === 'd1' || i.id === 'd2'), 'S8h 删除后选择清空且 d1/d2 消失');
    ok(a2.past === b2.past + 1, 'S8i 一次批量删除=一步历史');
    await page.evaluate(() => window.__photoStore.getState().undo());
    const u2 = await store();
    ok(u2.items.some((i) => i.id === 'd1') && JSON.stringify(u2.selection) === JSON.stringify(['d1', 'd2']), 'S8j 撤回复活删除物且撤回链含 selection');
  }

  // ---------------- S9 Ctrl+A / Esc ----------------
  S('S9 Ctrl+A 全选 / Esc 清选');
  {
    await page.evaluate(() => { const s = window.__photoStore.getState(); s.setItemMeta('d3', { hidden: true }); s.setItemMeta('d4', { locked: true }); s.setSelection([]); });
    await poll(() => !window.__photoItems().d3, 6000);
    await page.keyboard.press('Control+a');
    const sel9 = await poll(() => { const s = window.__photoStore.getState().selection; return s.length ? s : null; }, 8000);
    ok(JSON.stringify(sel9) === JSON.stringify(['d1', 'd2']), `S9a Ctrl+A 全选可交互物（hidden d3/locked d4 不入选）：${JSON.stringify(sel9)}`);
    await page.keyboard.press('Escape');
    ok(!!(await poll(() => window.__photoStore.getState().selection.length === 0, 6000)), 'S9b Esc（arrange 无框选）=清选');
    await page.evaluate(() => { const s = window.__photoStore.getState(); s.setItemMeta('d3', { hidden: false }); s.setItemMeta('d4', { locked: false }); });
  }

  // ---------------- S10 Outliner 重命名 / hidden / locked（DOM 行为） ----------------
  S('S10 Outliner');
  {
    await inject([note('o1', [-1.2, 1.03, 0]), note('o2', [0.0, 1.03, 0.3], { props: { value: 5 } }),
      note('o3', [0.9, 1.03, -0.4], { props: { value: 2 } }), note('o4', [1.6, 1.03, 0.6], { props: { value: 1 } })]);
    await mounted(['o1', 'o2', 'o3', 'o4']);
    const rows = page.locator('.ph-out-row');
    ok(await rows.count() === 4, 'S10a 大纲列出 4 行');

    // 行点选 / Ctrl 加选 / Shift 范围
    await rows.nth(0).click();
    ok(JSON.stringify((await store()).selection) === JSON.stringify(['o1']), 'S10b 行点选=单选');
    await rows.nth(1).click({ modifiers: ['Control'] });
    ok(JSON.stringify((await store()).selection) === JSON.stringify(['o1', 'o2']), 'S10c 行 Ctrl 点=加选');
    await rows.nth(3).click({ modifiers: ['Shift'] });
    ok(JSON.stringify((await store()).selection) === JSON.stringify(['o2', 'o3', 'o4']), `S10d 行 Shift 点=主选到目标的范围（目标成主选）：${JSON.stringify((await store()).selection)}`);

    // 双击重命名：Enter 提交 / Esc 取消
    await rows.nth(0).dblclick();
    await page.locator('.ph-out-rn').fill('金库箱');
    await page.keyboard.press('Enter');
    ok(!!(await poll(() => window.__photoStore.getState().items[0].name === '金库箱', 6000)), 'S10e 双击重命名 Enter 提交 → item.name 更新');
    ok((await rows.nth(0).textContent()).includes('金库箱'), 'S10f 行内显示自定义名');
    await rows.nth(0).dblclick();
    await page.locator('.ph-out-rn').fill('半途而废');
    await page.keyboard.press('Escape');
    await poll(() => !document.querySelector('.ph-out-rn'), 6000);
    ok((await store()).items[0].name === '金库箱', 'S10g 重命名 Esc 取消不改名');

    // 眼睛=hidden：不渲染不进注册表；选择集即时剔除
    await page.evaluate(() => window.__photoStore.getState().setSelection(['o1', 'o2']));
    await rows.nth(1).locator('.ph-out-btn').first().click();
    ok(!!(await poll(() => !window.__photoItems().o2 && window.__photoStore.getState().items[1].hidden, 8000)), 'S10h 眼睛 → hidden：出注册表（不渲染不进射线/框选/截图）');
    ok(JSON.stringify((await store()).selection) === JSON.stringify(['o1']), 'S10i 隐藏即时请出选择集');
    await rows.nth(1).locator('.ph-out-btn').first().click();
    ok(!!(await poll(() => !!window.__photoItems().o2, 8000)), 'S10j 再点眼睛 → 复显回注册表');

    // 锁=locked：可见（注册表仍在）但框选跳过、真鼠标点选不中（落到 onPointerMissed=清选）
    await rows.nth(2).locator('.ph-out-btn').nth(1).click();
    await poll(() => window.__photoStore.getState().items[2].locked, 6000);
    const mo = await items();
    ok(!!mo.o3, 'S10k 锁定物仍可见（注册表在）');
    const a3 = mo.o3.screenAABB;
    const gotLk = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), { x1: a3.minX - 4, y1: a3.minY - 4, x2: a3.maxX + 4, y2: a3.maxY + 4 });
    ok(!gotLk.includes('o3'), `S10l 锁定物不进框选：${JSON.stringify(gotLk)}`);
    await page.evaluate(() => window.__photoStore.getState().setSelection(['o1']));
    await clickWorldItem('o3');
    ok(!!(await poll(() => window.__photoStore.getState().selection.length === 0, 8000)), 'S10m 真鼠标点锁定物=不可点选（落到 onPointerMissed 清选，Blender 语义）');
    await rows.nth(2).locator('.ph-out-btn').nth(1).click();
    await poll(() => !window.__photoStore.getState().items[2].locked, 6000);

    // 右键菜单：删除
    await rows.nth(3).click({ button: 'right' });
    ok(!!(await poll(() => !!document.querySelector('.ph-menu'), 6000)), 'S10n 行右键出菜单');
    const nBefore = (await store()).items.length;
    await page.locator('.ph-menu button.danger').click();
    ok(!!(await poll((n) => window.__photoStore.getState().items.length === n - 1 && !document.querySelector('.ph-menu'), 8000, 250, nBefore)), 'S10o 菜单删除生效且菜单关闭');
    await page.evaluate(() => window.__photoStore.getState().undo());
  }

  // ---------------- S11 钱堆生成器（槽位与游戏 cardLocal/cardYaw 逐值一致） ----------------
  S('S11 钱堆生成器');
  {
    const stack = await page.evaluate(() => window.__photoStack(13, { value: 5 }));
    ok(stack.length === 13, 'S11a __photoStack(13) 生成 13 张');
    // 逐值一致：相对首张的位移 = cardLocal(i)−cardLocal(0)（基点由出生射线定，槽位形状必须逐值同源）；
    // yaw 绝对相等 = cardYaw(i)
    let allPos = true, allYaw = true, allProps = true;
    for (let i = 0; i < 13; i++) {
      const relGot = stack[i].pos.map((x, k) => x - stack[0].pos[k]);
      const l = cardLocalN(i), l0 = cardLocalN(0);
      if (!vNear(relGot, l.map((x, k) => x - l0[k]), 1e-9)) allPos = false;
      if (!near(stack[i].rot[1], cardYawN(i), 1e-12) || stack[i].rot[0] !== 0 || stack[i].rot[2] !== 0) allYaw = false;
      if (stack[i].props.value !== 5) allProps = false;
    }
    ok(allPos, 'S11b 13 张槽位相对位移与游戏 cardLocal 逐值一致（含跨小叠 col 散布）');
    ok(allYaw, 'S11c 13 张 yaw 与游戏 cardYaw 逐值一致');
    ok(allProps, 'S11d 面额 props 逐张带上');
    const clamp0 = await page.evaluate(() => window.__photoStack(0).length);
    const clamp99 = await page.evaluate(() => window.__photoStack(99).length);
    ok(clamp0 === 1 && clamp99 === 40, `S11e 张数钳制 [1,40]：0→${clamp0}，99→${clamp99}`);

    // 工具栏「+钱堆」按钮（默认 8 张面额 1）：一步历史、生成后整组全选可拖
    const before = await store();
    await page.getByRole('button', { name: '+钱堆' }).click();
    const grown = await poll((n) => window.__photoStore.getState().items.length === n + 8, 10000, 250, before.items.length);
    ok(!!grown, 'S11f 工具栏 +钱堆 生成 8 张独立 note 物品');
    const after = await store();
    const newIds = after.items.slice(-8).map((i) => i.id);
    ok(JSON.stringify(after.selection) === JSON.stringify(newIds), 'S11g 生成后自动全选成组（可整组拖）');
    ok(after.items.slice(-8).every((i) => i.kind === 'note' && i.props.value === 1), 'S11h 全部为 note 且面额=选择器默认 1');
    ok(after.past === before.past + 1, 'S11i 一次生成=一步历史');
  }

  // ---------------- S12 F 聚焦 ----------------
  S('S12 F 聚焦（dist=radius/tan(fov/2)×1.2，退距反解）');
  {
    await page.evaluate(() => window.__photoStore.getState().setSelection(['o1', 'o2']));
    const m = await items();
    const uMin = [0, 1, 2].map((i) => Math.min(m.o1.worldBox3.min[i], m.o2.worldBox3.min[i]));
    const uMax = [0, 1, 2].map((i) => Math.max(m.o1.worldBox3.max[i], m.o2.worldBox3.max[i]));
    const center = [0, 1, 2].map((i) => (uMin[i] + uMax[i]) / 2);
    const radius = Math.max(Math.hypot(uMax[0] - uMin[0], uMax[1] - uMin[1], uMax[2] - uMin[2]) / 2, 0.35);
    const dist = radius / Math.tan((55 * Math.PI / 180) / 2) * 1.2;   // Canvas fov=55
    const rig0 = await page.evaluate(() => window.__photoRig);
    await page.keyboard.press('f');
    const rig = await poll((p0) => {
      const r = window.__photoRig;
      return Math.hypot(r.pos[0] - p0[0], r.pos[1] - p0[1], r.pos[2] - p0[2]) > 0.05 ? r : null;
    }, 10000, 250, rig0.pos);
    ok(!!rig, 'S12a 按 F 相机应聚焦请求移动');
    const dv = [center[0] - rig.pos[0], center[1] - rig.pos[1], center[2] - rig.pos[2]];
    const dGot = Math.hypot(...dv);
    ok(near(dGot, dist, 0.02), `S12b 机位到中心距离=退距公式：${dGot.toFixed(3)} ≈ ${dist.toFixed(3)}`);
    const cp = Math.cos(rig.pitch), spn = Math.sin(rig.pitch), cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
    const fwd = [-sy * cp, spn, -cy * cp];
    ok(vNear(dv.map((x) => x / dGot), fwd, 0.02), 'S12c 视线正对选中集中心（lookAt 反解 yaw/pitch）');
  }

  // ---------------- S13 场景文件（name/hidden/locked 序列化 + 旧文件导入兼容） ----------------
  S('S13 场景文件序列化 / 旧文件导入');
  {
    await page.evaluate(() => { const s = window.__photoStore.getState(); s.setItemMeta('o2', { hidden: true }); s.setItemMeta('o3', { locked: true }); });
    const data = await page.evaluate(() => window.__photoStore.getState().serialize());
    ok(data.app === 'fate-photo' && data.version === 1 && Array.isArray(data.camera?.pos), 'S13a 场景文件骨架（app/version/camera）');
    ok(data.items.every((i) => typeof i.name === 'string' && typeof i.hidden === 'boolean' && typeof i.locked === 'boolean'), 'S13b 每个物体都带 name/hidden/locked');
    const o1 = data.items.find((i) => i.id === 'o1'), o2 = data.items.find((i) => i.id === 'o2'), o3 = data.items.find((i) => i.id === 'o3');
    ok(o1.name === '金库箱' && o2.hidden === true && o3.locked === true, 'S13c 重命名/隐藏/锁定如实入档');

    // 旧场景文件（P③ 之前的格式：无 name/hidden/locked，还夹杂未知字段）→ 消毒回落默认即兼容
    const okImport = await page.evaluate(() => window.__photoStore.getState().importScene({
      app: 'fate-photo', version: 1, hideOverhead: false, postFx: true,
      camera: { pos: [5.6, 4.4, 7.8], yaw: 0.62, pitch: -0.34 },
      items: [
        { id: 'old1', kind: 'note', props: { value: 10 }, pos: [-0.8, 1.03, 0], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0, junk: 123 },
        { id: 'old2', kind: 'char', props: { role: 'landlord' }, pos: [-2.4, 0, 2.0], rot: [0, 0, 0], scale: [1, 1, 1], seed: 1 },
      ],
    }));
    ok(okImport === true, 'S13d 旧文件 importScene 接受');
    const raw = await page.evaluate(() => window.__photoStore.getState().items.map((i) => ({ id: i.id, keys: Object.keys(i).sort(), name: i.name, hidden: i.hidden, locked: i.locked })));
    ok(raw.length === 2 && raw.every((i) => i.name === '' && i.hidden === false && i.locked === false), 'S13e 旧物体回落默认 name=\'\'/hidden=false/locked=false');
    ok(raw.every((i) => !i.keys.includes('junk')), 'S13f 未知字段被白名单剥掉');
    ok(!!(await mounted(['old1', 'old2'])), 'S13g 旧场景物体正常挂载渲染');
    const st13 = await store();
    ok(st13.selection.length === 0 && st13.past === 0 && st13.future === 0, 'S13h 导入清选择与撤回栈');
  }

  // ---------------- S14 截图目检（多选线框 + outliner + 钱堆场景） ----------------
  S('S14 CDP 截图目检');
  {
    await page.evaluate(() => {
      const s = window.__photoStore.getState();
      s.addMoneyStack(window.__photoStack(12, { value: 10 }));   // 生成即整组全选 → 多选线框 + pivot gizmo
    });
    const st14 = await store();
    ok(st14.selection.length === 12, 'S14a 钱堆 12 张生成并整组全选（线框可见性前提）');
    await poll(() => {
      const c = window.__photoControls;
      return (c?.object && c.object.children.length === 0) ? true : null;   // 多选 pivot gizmo 挂上
    }, 10000);
    ok(await page.locator('.ph-outliner .ph-out-row').count() === 14, 'S14b outliner 同框列出 14 行（2 旧物 + 12 钱堆）');
    await sleep(2500);   // SwiftShader ~2fps：多等几帧让线框/gizmo/钱堆全渲进帧缓冲
    await shot(SHOT);
  }

  ok(pageErrors.length === 0, 'S15 页面 0 JS 错误', pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  fail++;
  console.error(`\n中断：${e?.stack || e}`);
} finally {
  try { if (browser) await browser.close(); } catch { /* 已关 */ }
  killVite();
}

console.log(`\n== 结果: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
