// P② 核心交互验证（探针直调硬断言 + 鼠标全链路只作截图证据，EDITOR_OVERHAUL §2.2/§2.3）。
// 用法: node tools/tmp-p2-verify.mjs [base] [outDir]
// 断言一律轮询（SwiftShader ~2fps）；截图走 CDP Page.captureScreenshot。
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5229';
const outDir = process.argv[3] || 'C:/Users/quberen/AppData/Local/Temp/claude/c--Users-quberen-LandlordGame/984f1954-d808-4d22-adc9-ebde3bb974d5/scratchpad/p2-shots';
mkdirSync(outDir, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${extra}`); }
};
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const vNear = (a, b, eps = 1e-4) => a.length === b.length && a.every((x, i) => near(x, b[i], eps));

// ---- 数学（Node 侧独立实现，与页面代码交叉验证） ----
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
const rectOfAABBs = (aabbs, pad = 0) => ({
  x1: Math.min(...aabbs.map(a => a.minX)) - pad, y1: Math.min(...aabbs.map(a => a.minY)) - pad,
  x2: Math.max(...aabbs.map(a => a.maxX)) + pad, y2: Math.max(...aabbs.map(a => a.maxY)) + pad,
});
const rectHits = (rect, aabb) => {
  const xmin = Math.min(rect.x1, rect.x2), xmax = Math.max(rect.x1, rect.x2);
  const ymin = Math.min(rect.y1, rect.y2), ymax = Math.max(rect.y1, rect.y2);
  return aabb.maxX >= xmin && aabb.minX <= xmax && aabb.maxY >= ymin && aabb.minY <= ymax;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
const cdp = await ctx.newCDPSession(page);
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  [shot] ${name}.png`);
};
const poll = async (fn, ms = 8000, step = 250) => {
  const t0 = Date.now();
  let v = await page.evaluate(fn);
  while (!v && Date.now() - t0 < ms) { await page.waitForTimeout(step); v = await page.evaluate(fn); }
  return v;
};
const items = () => page.evaluate(() => window.__photoItems?.() ?? null);
const store = () => page.evaluate(() => {
  const s = window.__photoStore.getState();
  return { selection: s.selection, past: s.past.length, future: s.future.length, snap: s.snap, marquee: s.marquee, mode: s.mode, items: s.items.map(it => ({ id: it.id, pos: it.pos, rot: it.rot, scale: it.scale, hidden: it.hidden, locked: it.locked })) };
});
const item = async (id) => (await store()).items.find(it => it.id === id);
// 期望命中集（Node 侧独立算：store 顺序 × 探针 AABB 相交 × 非 hidden/locked）——与 pick.js 交叉验证
const expectedIn = async (rect) => {
  const s = await store(); const m = await items();
  return s.items.filter(i => !i.hidden && !i.locked && m[i.id] && rectHits(rect, m[i.id].screenAABB)).map(i => i.id);
};

await page.goto(`${base}/photo.html`, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => localStorage.removeItem('fate.photo.scene.v1'));
await page.reload({ waitUntil: 'networkidle' });
await poll(() => !!(window.__photoStore && window.__photoItems && window.__photoPick && window.__photoSurface && window.__photoDrop), 20000);
ok(await page.evaluate(() => !!(window.__photoStore && window.__photoRig && window.__photoProject && window.__photoItems && window.__photoPick && window.__photoSurface && window.__photoDrop)), '探针齐全 __photoStore/__photoRig/__photoProject/__photoItems/__photoPick/__photoSurface/__photoDrop');

// ---- 场景 1：框选/多选/表面 ----
console.log('== 场景 1 注入 ==');
await page.evaluate(() => {
  window.__photoStore.getState().importScene({
    app: 'fate-photo', version: 1, hideOverhead: false, postFx: true,
    camera: { pos: [5.6, 4.4, 7.8], yaw: 0.62, pitch: -0.34 },
    items: [
      { id: 'n1', kind: 'note', props: { value: 10 }, pos: [-1.2, 1.03, 0], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
      { id: 'n2', kind: 'note', props: { value: 5 }, pos: [0.9, 1.03, 0.5], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
      { id: 'slab', kind: 'note', props: { value: 2 }, pos: [2.2, 1.4, -1.2], rot: [0, 0, 0], scale: [3, 20, 3], seed: 0 },
      { id: 'c1', kind: 'char', props: { role: 'farmer' }, pos: [-2.6, 0, 2.0], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
    ],
  });
  window.__photoStore.getState().setMode('arrange');
});
let it = await poll(() => { const m = window.__photoItems(); return (m.n1 && m.n2 && m.slab && m.c1) ? m : null; }, 15000);
ok(!!it, '四物挂载并进注册表（__photoItems 有 n1/n2/slab/c1）');

// A. 框选纯函数
console.log('== A. 框选 __photoPick ==');
{
  const tiny = { x1: (it.n1.screenAABB.minX + it.n1.screenAABB.maxX) / 2 - 3, y1: (it.n1.screenAABB.minY + it.n1.screenAABB.maxY) / 2 - 3 };
  tiny.x2 = tiny.x1 + 6; tiny.y2 = tiny.y1 + 6;
  const expTiny = await expectedIn(tiny);
  const gotTiny = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), tiny);
  ok(gotTiny.includes('n1') && JSON.stringify(gotTiny) === JSON.stringify(expTiny), `AABB 内小矩形命中（相交即选中）：${JSON.stringify(gotTiny)}`, `期望 ${JSON.stringify(expTiny)}`);

  const rect = rectOfAABBs([it.n1.screenAABB, it.n2.screenAABB], 6);
  const exp = await expectedIn(rect);
  const got = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), rect);
  ok(got.includes('n1') && got.includes('n2') && JSON.stringify(got) === JSON.stringify(exp), `覆盖 n1+n2 矩形命中与 AABB 相交集一致：${JSON.stringify(got)}`, `期望 ${JSON.stringify(exp)}`);

  const corner = { x1: 4, y1: 96, x2: 44, y2: 136 }; // 顶栏下的左上角
  const expCorner = await expectedIn(corner);
  const gotCorner = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), corner);
  ok(JSON.stringify(gotCorner) === JSON.stringify(expCorner), `角落矩形与 AABB 相交集一致（通常为空）：${JSON.stringify(gotCorner)}`);

  const got2 = await page.evaluate((r) => window.__photoPick(r.x2, r.y2, r.x1, r.y1), rect);
  ok(JSON.stringify(got2) === JSON.stringify(got), '矩形任意对角顺序等价');

  // locked 物不进框选
  await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { locked: true }));
  const gotLocked = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), rect);
  ok(!gotLocked.includes('n2') && gotLocked.includes('n1'), `locked 物不进框选：${JSON.stringify(gotLocked)}`);
  await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { locked: false }));

  // hidden 物不渲染不进注册表 → 不进框选
  await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { hidden: true }));
  await poll(() => !window.__photoItems().n2, 5000);
  const gotHidden = await page.evaluate((r) => window.__photoPick(r.x1, r.y1, r.x2, r.y2), rect);
  ok(!gotHidden.includes('n2') && gotHidden.includes('n1'), `hidden 物不进框选：${JSON.stringify(gotHidden)}`);
  await page.evaluate(() => window.__photoStore.getState().setItemMeta('n2', { hidden: false }));
  await poll(() => !!window.__photoItems().n2, 5000);
}

// H. 单选 gizmo 回归（事件链直调）
console.log('== H. 单选 gizmo 回归 ==');
{
  await page.evaluate(() => window.__photoStore.getState().setSelection(['n1']));
  const c0 = await poll(() => { const c = window.__photoControls; return c?.object && c.object.children.length > 0 ? true : null; }, 8000);
  ok(!!c0, '单选挂 gizmo（object=物体本尊，有子网格）');
  const before = await store();
  await page.evaluate(() => {
    const c = window.__photoControls;
    c.dispatchEvent({ type: 'dragging-changed', value: true });
    c.object.position.x += 0.3; c.object.updateMatrixWorld(true);
    c.dispatchEvent({ type: 'objectChange' });
    c.dispatchEvent({ type: 'dragging-changed', value: false });
  });
  const n1a = await item('n1');
  const n1b = before.items.find(i => i.id === 'n1');
  ok(vNear(n1a.pos, [n1b.pos[0] + 0.3, n1b.pos[1], n1b.pos[2]]), `单选拖拽回写 store：${JSON.stringify(n1a.pos)}`);
  ok((await store()).past === before.past + 1, '单选整次拖拽=一步历史');
  await page.evaluate(() => window.__photoStore.getState().undo());
}

// B. 多选 pivot
console.log('== B. 多选 pivot 批量变换 ==');
{
  await page.evaluate(() => window.__photoStore.getState().setSelection(['n1', 'n2']));
  // pivot=空组（无子物）且位于选中集 Box3 质心
  const pv = await poll(() => {
    const c = window.__photoControls;
    return (c?.object && c.object.children.length === 0) ? [c.object.position.x, c.object.position.y, c.object.position.z] : null;
  }, 8000);
  it = await items();
  const uMin = [0, 1, 2].map(i => Math.min(it.n1.worldBox3.min[i], it.n2.worldBox3.min[i]));
  const uMax = [0, 1, 2].map(i => Math.max(it.n1.worldBox3.max[i], it.n2.worldBox3.max[i]));
  const centroid = [0, 1, 2].map(i => (uMin[i] + uMax[i]) / 2);
  ok(pv && vNear(pv, centroid, 1e-3), `pivot=选中集 Box3 质心：${JSON.stringify(pv)}`, `期望 ${JSON.stringify(centroid)}`);

  // B1 平移：两物等 delta（位置/旋转/缩放全量比对）
  const before = await store();
  await page.evaluate(() => {
    const c = window.__photoControls;
    c.dispatchEvent({ type: 'dragging-changed', value: true });
    c.object.position.x += 0.6; c.object.position.z += 0.4; c.object.updateMatrixWorld(true);
    c.dispatchEvent({ type: 'objectChange' });
    c.dispatchEvent({ type: 'dragging-changed', value: false });
  });
  let after = await store();
  const d = (id, f) => {
    const a = after.items.find(i => i.id === id)[f], b = before.items.find(i => i.id === id)[f];
    return a.map((x, i) => x - b[i]);
  };
  ok(vNear(d('n1', 'pos'), [0.6, 0, 0.4]) && vNear(d('n2', 'pos'), [0.6, 0, 0.4]), `平移两物等 delta [0.6,0,0.4]：n1=${JSON.stringify(d('n1', 'pos'))} n2=${JSON.stringify(d('n2', 'pos'))}`);
  ok(vNear(d('n1', 'rot'), [0, 0, 0]) && vNear(d('n1', 'scale'), [0, 0, 0]) && vNear(d('n2', 'rot'), [0, 0, 0]) && vNear(d('n2', 'scale'), [0, 0, 0]), '平移不动旋转/缩放分量');
  ok(after.past === before.past + 1, '多选整次拖拽=一步历史');
  ok(JSON.stringify(after.selection) === JSON.stringify(['n1', 'n2']), '拖拽后选择集不变');
  await page.evaluate(() => window.__photoStore.getState().undo());
  after = await store();
  ok(vNear(after.items.find(i => i.id === 'n1').pos, before.items.find(i => i.id === 'n1').pos) && JSON.stringify(after.selection) === JSON.stringify(['n1', 'n2']), '撤回复位且 selection 恢复');

  // B2 旋转：绕 pivot 90°（位置=绕质心旋转，朝向=四元数方向向量比对，禁比欧拉分量）
  await page.evaluate(() => window.__photoStore.getState().setSelection(['n1', 'n2']));
  const pv2 = await poll(() => {
    const c = window.__photoControls;
    return (c?.object && c.object.children.length === 0) ? [c.object.position.x, c.object.position.y, c.object.position.z] : null;
  }, 8000);
  const b2 = await store();
  await page.evaluate(() => {
    const c = window.__photoControls;
    c.dispatchEvent({ type: 'dragging-changed', value: true });
    c.object.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    c.object.updateMatrixWorld(true);
    c.dispatchEvent({ type: 'objectChange' });
    c.dispatchEvent({ type: 'dragging-changed', value: false });
  });
  const a2 = await store();
  for (const id of ['n1', 'n2']) {
    const p0 = b2.items.find(i => i.id === id).pos;
    const exp = rotYAround(p0, pv2, Math.PI / 2);
    const got = a2.items.find(i => i.id === id).pos;
    ok(vNear(got, exp, 1e-3), `旋转后 ${id} 绕 pivot 位置正确：${JSON.stringify(got.map(x => +x.toFixed(4)))}`, `期望 ${JSON.stringify(exp.map(x => +x.toFixed(4)))}`);
    const q = quatFromEulerXYZ(...a2.items.find(i => i.id === id).rot);
    const fwd = applyQuat(q, [1, 0, 0]);
    ok(vNear(fwd, [0, 0, -1], 1e-3), `旋转后 ${id} 朝向向量 +X→(0,0,-1)：${JSON.stringify(fwd.map(x => +x.toFixed(4)))}`);
  }
  await page.evaluate(() => window.__photoStore.getState().undo());

  // B3 缩放：限等比 + 绕 pivot 缩放位置
  await page.evaluate(() => { const s = window.__photoStore.getState(); s.setSelection(['n1', 'n2']); s.setGizmo('scale'); });
  const pv3 = await poll(() => {
    const c = window.__photoControls;
    return (c?.object && c.object.children.length === 0) ? [c.object.position.x, c.object.position.y, c.object.position.z] : null;
  }, 8000);
  const b3 = await store();
  await page.evaluate(() => {
    const c = window.__photoControls;
    c.dispatchEvent({ type: 'dragging-changed', value: true });
    c.object.scale.set(1.5, 1, 1);                       // 拖单轴 → 应被限成等比 1.5
    c.object.updateMatrixWorld(true);
    c.dispatchEvent({ type: 'objectChange' });
    c.dispatchEvent({ type: 'dragging-changed', value: false });
  });
  const a3 = await store();
  for (const id of ['n1', 'n2']) {
    const got = a3.items.find(i => i.id === id);
    ok(vNear(got.scale, [1.5, 1.5, 1.5], 1e-3), `缩放限等比 ${id} scale=[1.5,1.5,1.5]：${JSON.stringify(got.scale)}`);
    const p0 = b3.items.find(i => i.id === id).pos;
    const exp = p0.map((x, i) => pv3[i] + 1.5 * (x - pv3[i]));
    ok(vNear(got.pos, exp, 1e-3), `缩放绕 pivot 位置正确 ${id}`, `got ${JSON.stringify(got.pos)} 期望 ${JSON.stringify(exp)}`);
  }
  await page.evaluate(() => { const s = window.__photoStore.getState(); s.undo(); s.setGizmo('translate'); });
  await page.waitForTimeout(1200); // 等一帧渲染出线框再截
  await shot('p2-multi-outline'); // 双选线框（主金次灰白）+ pivot gizmo 证据
}

// C. 表面落点纯函数
console.log('== C. 表面落点 __photoSurface ==');
{
  it = await items();
  const topY = it.slab.worldBox3.max[1];
  const cx = (it.slab.worldBox3.min[0] + it.slab.worldBox3.max[0]) / 2;
  const cz = (it.slab.worldBox3.min[2] + it.slab.worldBox3.max[2]) / 2;
  const sp = await page.evaluate(([x, y, z]) => window.__photoProject(x, y, z), [cx, topY, cz]);
  await page.evaluate(() => window.__photoStore.getState().setSelection(['n1']));
  const hit = await page.evaluate(([x, y]) => window.__photoSurface(x, y), [sp.x, sp.y]);
  ok(hit && near(hit.point[1], topY, 0.01), `选中 n1 时射向 slab 顶心 → 命中 y≈slab 顶 ${topY.toFixed(3)}：${hit ? hit.point[1].toFixed(3) : 'null'}`);

  await page.evaluate(() => window.__photoStore.getState().setSelection(['slab']));
  const hit2 = await page.evaluate(([x, y]) => window.__photoSurface(x, y), [sp.x, sp.y]);
  ok(hit2 && hit2.point[1] < topY - 0.3, `选中 slab 后同一射线穿过它命中身后更低表面（自命中排除）：y=${hit2 ? hit2.point[1].toFixed(3) : 'null'}`);

  const tp = await page.evaluate(() => window.__photoProject(0, 1.0, 0));
  const hit3 = await page.evaluate(([x, y]) => window.__photoSurface(x, y, []), [tp.x, tp.y]);
  ok(hit3 && hit3.point[1] > 0.9 && hit3.point[1] < 1.15, `桌心表面命中 y≈桌面：${hit3 ? hit3.point[1].toFixed(3) : 'null'}`);
}

// D. 框选鼠标全链路（真实指针；几何已由探针硬断言——这里验事件流/overlay/Esc 链并取证据）
console.log('== D. 框选鼠标链路 + Esc ==');
{
  await page.evaluate(() => window.__photoStore.getState().setSelection([]));
  it = await items();
  const rect = rectOfAABBs([it.n1.screenAABB, it.n2.screenAABB], 14);
  const inAnyAABB = (x, y) => Object.values(it).some(v => x >= v.screenAABB.minX && x <= v.screenAABB.maxX && y >= v.screenAABB.minY && y <= v.screenAABB.maxY);
  // 起点=矩形左上外扩，避开物体 AABB（否则成表面拖拽）与顶栏（y>110）
  let sx = rect.x1 - 30, sy = Math.max(rect.y1 - 30, 110);
  if (inAnyAABB(sx, sy)) { sx = rect.x1 - 60; sy = Math.max(rect.y1 - 60, 110); }
  const dragRect = { x1: sx, y1: sy, x2: rect.x2, y2: rect.y2 };
  const expect = await expectedIn(dragRect);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + rect.x2) / 2, (sy + rect.y2) / 2, { steps: 4 });
  const mq = await poll(() => window.__photoStore.getState().marquee, 5000);
  ok(!!mq, '拖出 4px 后 marquee 矩形出现（store.marquee 非空）');
  const mqDom = await poll(() => !!document.querySelector('.ph-marquee'), 5000);
  ok(!!mqDom, 'HTML overlay .ph-marquee 已渲染');
  await shot('p2-marquee');
  await page.mouse.move(rect.x2, rect.y2, { steps: 4 });
  await page.mouse.up();
  const selAfter = await poll(() => { const s = window.__photoStore.getState(); return s.selection.length ? s.selection : null; }, 6000);
  ok(JSON.stringify(selAfter) === JSON.stringify(expect), `松手后选中=${JSON.stringify(selAfter)}`, `期望 ${JSON.stringify(expect)}`);
  ok(await page.evaluate(() => window.__photoStore.getState().marquee === null), '松手后 marquee 清除');

  // Ctrl+框选=加选：框住 slab，期望并集保序
  let cx0 = it.slab.screenAABB.minX - 25, cy0 = Math.max(it.slab.screenAABB.minY - 25, 110);
  if (inAnyAABB(cx0, cy0)) { cx0 = it.slab.screenAABB.minX - 55; cy0 = Math.max(it.slab.screenAABB.minY - 55, 110); }
  await page.keyboard.down('Control');
  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  await page.mouse.move(it.slab.screenAABB.maxX - 4, it.slab.screenAABB.maxY - 4, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  const selAdd = await poll(() => { const s = window.__photoStore.getState(); return s.selection.includes('slab') ? s.selection : null; }, 6000);
  ok(!!selAdd && expect.every(id => selAdd.includes(id)) && JSON.stringify(selAdd.slice(0, expect.length)) === JSON.stringify(expect), `Ctrl 框选加选并保留原序：${JSON.stringify(selAdd)}`);

  // Esc 优先级链：框选进行中=仅取消框选（选择不动）
  const selBefore = await page.evaluate(() => window.__photoStore.getState().selection);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 80, sy + 80, { steps: 4 });
  await poll(() => window.__photoStore.getState().marquee, 5000);
  await page.keyboard.press('Escape');
  const gone = await poll(() => window.__photoStore.getState().marquee === null, 5000);
  ok(!!gone, 'Esc 取消进行中的框选（marquee 清除）');
  await page.mouse.up();
  await page.waitForTimeout(600);
  const selAfterEsc = await page.evaluate(() => window.__photoStore.getState().selection);
  ok(JSON.stringify(selAfterEsc) === JSON.stringify(selBefore), `Esc 取消框选不改选择集：${JSON.stringify(selAfterEsc)}`);
  // 再按一次 Esc（无框选进行中）→ 清选
  await page.keyboard.press('Escape');
  const cleared = await poll(() => window.__photoStore.getState().selection.length === 0, 5000);
  ok(!!cleared, '无框选时 Esc=清选');
}

// F. X 网格吸附
console.log('== F. X 吸附 ==');
{
  await page.evaluate(() => window.__photoStore.getState().setSelection(['n1']));
  await poll(() => { const c = window.__photoControls; return c?.object && c.object.children.length > 0 ? true : null; }, 8000);
  await page.keyboard.press('x');
  const snapOn = await poll(() => {
    const c = window.__photoControls;
    return (window.__photoStore.getState().snap && c.translationSnap === 0.1 && c.scaleSnap === 0.1 && Math.abs(c.rotationSnap - Math.PI / 12) < 1e-6) ? true : null;
  }, 5000);
  ok(!!snapOn, 'X 开吸附 → TransformControls translationSnap=0.1 / rotationSnap=15° / scaleSnap=0.1');
  await page.keyboard.press('x');
  const snapOff = await poll(() => {
    const c = window.__photoControls;
    return (!window.__photoStore.getState().snap && c.translationSnap === null && c.rotationSnap === null && c.scaleSnap === null) ? true : null;
  }, 5000);
  ok(!!snapOff, '再按 X 关吸附 → snap 全 null');
}

// E. V 落底（场景 2）
console.log('== E. V 落底（一摞升序/互穿顶出/键盘路径） ==');
{
  await page.evaluate(() => {
    window.__photoStore.getState().importScene({
      app: 'fate-photo', version: 1, hideOverhead: false, postFx: true,
      camera: { pos: [5.6, 4.4, 7.8], yaw: 0.62, pitch: -0.34 },
      items: [
        { id: 'd1', kind: 'note', props: { value: 10 }, pos: [-1.0, 2.0, -0.2], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
        { id: 'd2', kind: 'note', props: { value: 5 }, pos: [-1.0, 2.8, -0.2], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
        { id: 'd3', kind: 'note', props: { value: 2 }, pos: [-1.0, 3.6, -0.2], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
        { id: 'd4', kind: 'note', props: { value: 1 }, pos: [0.6, 1.5, -0.2], rot: [0, 0, 0], scale: [1, 1, 1], seed: 0 },
      ],
    });
    window.__photoStore.getState().setMode('arrange');
  });
  it = await poll(() => { const m = window.__photoItems(); return (m.d1 && m.d2 && m.d3 && m.d4) ? m : null; }, 15000);
  ok(!!it, '落底场景四张钞挂载');

  // 量桌面高（射向堆底正下方桌面，显式排除全部四张）
  const tp = await page.evaluate(() => window.__photoProject(-1.0, 1.0, -0.2));
  const tHit = await page.evaluate(([x, y]) => window.__photoSurface(x, y, ['d1', 'd2', 'd3', 'd4']), [tp.x, tp.y]);
  ok(!!tHit, `堆底桌面高度测得 y=${tHit ? tHit.point[1].toFixed(4) : 'null'}`);
  const tableY = tHit.point[1];

  const before = await store();
  await page.evaluate(() => { window.__photoStore.getState().setSelection(['d1', 'd2', 'd3']); window.__photoDrop(); });
  it = await items();
  ok(near(it.d1.worldBox3.min[1], tableY, 0.01), `d1 落桌面：min.y=${it.d1.worldBox3.min[1].toFixed(4)}≈${tableY.toFixed(4)}`);
  ok(near(it.d2.worldBox3.min[1], it.d1.worldBox3.max[1], 0.005), `d2 摞在 d1 上：${it.d2.worldBox3.min[1].toFixed(4)}≈${it.d1.worldBox3.max[1].toFixed(4)}`);
  ok(near(it.d3.worldBox3.min[1], it.d2.worldBox3.max[1], 0.005), `d3 摞在 d2 上：${it.d3.worldBox3.min[1].toFixed(4)}≈${it.d2.worldBox3.max[1].toFixed(4)}`);
  const st1 = await store();
  const ys = ['d1', 'd2', 'd3'].map(id => st1.items.find(i => i.id === id).pos[1]);
  ok(ys[0] < ys[1] && ys[1] < ys[2], `一摞保序（升序逐落）：${JSON.stringify(ys.map(y => +y.toFixed(3)))}`);
  ok(st1.past === before.past + 1, '一次落底=一步历史');
  await page.evaluate(() => window.__photoStore.getState().undo());
  const st2 = await store();
  ok(near(st2.items.find(i => i.id === 'd1').pos[1], 2.0) && near(st2.items.find(i => i.id === 'd3').pos[1], 3.6), '落底可一步撤回');

  // 互穿上顶：d4 底面压进桌面 0.01 → V 后顶回桌面（钞厚 0.035，pos 在几何中心）
  await page.evaluate((y) => {
    const s = window.__photoStore.getState();
    s.setTransform('d4', { pos: [0.6, y, -0.2] });
    s.setSelection(['d4']);
    window.__photoDrop();
  }, tableY - 0.01 + 0.035 / 2);
  it = await items();
  ok(near(it.d4.worldBox3.min[1], tableY, 0.005), `互穿物 V 后向上顶出到桌面：min.y=${it.d4.worldBox3.min[1].toFixed(4)}`);

  // 键盘 V 路径：抬高 0.5 再按 V → 回桌面
  await page.evaluate((y) => { window.__vTableY = y; }, tableY);
  await page.evaluate(() => {
    const s = window.__photoStore.getState();
    const d4 = s.items.find(i => i.id === 'd4');
    s.setTransform('d4', { pos: [d4.pos[0], d4.pos[1] + 0.5, d4.pos[2]] });
  });
  await page.keyboard.press('v');
  const vOk = await poll(() => {
    const m = window.__photoItems();
    return m.d4 && Math.abs(m.d4.worldBox3.min[1] - window.__vTableY) < 0.005 ? true : null;
  }, 6000, 300);
  ok(!!vOk, '键盘 V 落底生效（d4 回桌面）');
  await page.evaluate(() => { window.__photoStore.getState().setSelection(['d1', 'd2', 'd3']); window.__photoDrop(); });
  await page.waitForTimeout(1200);
  await shot('p2-drop-stack');
}

ok(pageErrors.length === 0, '页面 0 JS 错误', pageErrors.slice(0, 3).join(' | '));

console.log(`\n== 结果: ${pass} PASS / ${fail} FAIL ==`);
await browser.close();
process.exit(fail ? 1 : 0);
