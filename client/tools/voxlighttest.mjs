// 烘焙光照数据域单测(P1-1):node client/tools/voxlighttest.mjs
// 只测纯函数(domain.js/brick.js);bake.js 依赖 three+DOM,验收走 VoxLab debug 档截图。
import {
  DOMAIN, createDomain, clearDomain, cellOf, worldOf, inDomain,
  stampCell, stampEmissive, getCell, finalizeDomain, countBits,
} from '../src/voxel/light/domain.js';
import { buildBrick, brickSample } from '../src/voxel/light/brick.js';
import { findEmissiveLights } from '../src/voxel/light/cluster.js';
import { makeDense, dIdx } from '../src/voxel/vox.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
const eq = (a, b, msg = '') => {
  if (a !== b) throw new Error(`${msg} 期望 ${b},实得 ${a}`);
};

console.log('voxlighttest — 域/brick');

t('域尺寸与内存预算(位图 13.1MB / 粗层 0.2MB / 反照率 6.5MB)', () => {
  const d = createDomain();
  eq(d.bits.length * 4, 20 * 256 * 640 * 4, '位图字节');
  eq(d.coarse.length, 80 * 32 * 80, '粗层格数');
  eq(d.albedo.length, 160 * 64 * 160 * 4, '反照率字节');
});

t('世界↔格 索引往返(格心误差 ≤ 半格)', () => {
  for (const [w, axis] of [[0, 0], [-12.8, 0], [12.79, 0], [1.0, 1], [-0.24, 1], [9.99, 2]]) {
    const i = cellOf(w, axis);
    const back = worldOf(i, axis);
    if (Math.abs(back - w) > DOMAIN.cell) throw new Error(`轴${axis} w=${w} → i=${i} → ${back}`);
  }
  eq(cellOf(DOMAIN.origin[0], 0), 0, '原点=格0');
  eq(cellOf(1.0, 1), Math.floor((1.0 + 0.24) / 0.04), '桌面高度格');
});

t('stampCell/getCell + 越界静默', () => {
  const d = createDomain();
  stampCell(d, 100, 50, 300, 200, 100, 50);
  eq(getCell(d, 100, 50, 300), 1, '已标格');
  eq(getCell(d, 101, 50, 300), 0, '邻格');
  eq(getCell(d, -1, 0, 0), 0, '越界读');
  stampCell(d, -5, 0, 0, 1, 2, 3);         // 越界写不炸
  stampCell(d, 640, 256, 640, 1, 2, 3);
  eq(countBits(d), 1, '总位数');
  eq(inDomain(639, 255, 639), true);
  eq(inDomain(640, 0, 0), false);
});

t('finalizeDomain 粗层:字节→粗格映射(词内 4 粗格)', () => {
  const d = createDomain();
  stampCell(d, 100, 50, 300, 0, 0, 0);      // 粗格 (12, 6, 37)
  stampCell(d, 39, 8, 8, 0, 0, 0);          // 粗格 (4, 1, 1) — 词0 的最高字节边界
  finalizeDomain(d);
  const ci = (x, y, z) => x + 80 * (y + 32 * z);
  eq(d.coarse[ci(12, 6, 37)], 1, '粗格A');
  eq(d.coarse[ci(4, 1, 1)], 1, '粗格B(字节3→粗x=4)');
  eq(d.coarse[ci(11, 6, 37)], 0, '邻粗格');
  let n = 0; for (const v of d.coarse) n += v;
  eq(n, 2, '粗格总数');
});

t('反照率:同格双 stamp 取平均;空格 alpha=0', () => {
  const d = createDomain();
  // (0,0,0) 与 (1,0,0) 同属反照率格 0(4³ 细格)
  stampCell(d, 0, 0, 0, 100, 0, 0);
  stampCell(d, 1, 0, 0, 200, 0, 0);
  finalizeDomain(d);
  eq(d.albedo[0], 150, '均值 R');
  eq(d.albedo[3], 255, '占位 alpha');
  eq(d.albedo[7], 0, '空格 alpha');
});

t('clearDomain 归零', () => {
  const d = createDomain();
  stampCell(d, 5, 5, 5, 9, 9, 9);
  finalizeDomain(d);
  clearDomain(d);
  eq(countBits(d), 0);
  eq(d.coarse[0] + d.albCnt[0] + d.albedo[3], 0);
});

t('buildBrick:8³ 角部实体 → 3³ brick 占位/均色正确', () => {
  const dense = makeDense(8, 8, 8);
  const palette = new Uint8Array(1024);
  palette[0] = 200; palette[1] = 40; palette[2] = 40; palette[3] = 255;   // 索引1 = 红
  for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    dense.data[dIdx(dense, x, y, z)] = 1;
  }
  const b = buildBrick(dense, palette, 0.015);
  eq(b.bx, 3, 'brick 尺寸=ceil(8×0.015/0.04)');
  // 体素(0..3)中心×0.375 → brick 格 0/1;格(0,0,0) 必占,远角 (2,2,2) 必空
  eq(b.occ[0], 1, '角部占位');
  eq(b.occ[2 + 3 * (2 + 3 * 2)], 0, '远角空');
  eq(b.col[0], 200, '均色 R');
  eq(b.col[1], 40, '均色 G');
});

t('brickSample:体素单位坐标命中/越界', () => {
  const dense = makeDense(8, 8, 8);
  const palette = new Uint8Array(1024).fill(128);
  dense.data[dIdx(dense, 0, 0, 0)] = 1;
  const b = buildBrick(dense, palette, 0.015);
  if (brickSample(b, 0.5, 0.5, 0.5) < 0) throw new Error('实体处应命中');
  eq(brickSample(b, 7.5, 7.5, 7.5), -1, '空格');
  eq(brickSample(b, -1, 0, 0), -1, '负越界');
  eq(brickSample(b, 999, 0, 0), -1, '正越界');
});

t('brick 混色平均(两索引同格)', () => {
  const dense = makeDense(2, 1, 1);
  const palette = new Uint8Array(1024);
  palette[0] = 100; palette[1] = 0; palette[2] = 0; palette[3] = 255;     // 1=暗红
  palette[4] = 200; palette[5] = 0; palette[6] = 0; palette[7] = 255;     // 2=亮红
  dense.data[0] = 1; dense.data[1] = 2;
  const b = buildBrick(dense, palette, 0.015);
  eq(b.bx, 1, '2 体素 ×1.5cm < 4cm = 1 格');
  eq(b.col[0], 150, '均色');
});

t('brick 发光通道:MATL emitK 进 emi,非发光体素不进', () => {
  const dense = makeDense(4, 4, 4);
  const palette = new Uint8Array(1024);
  palette[0] = 255; palette[1] = 128; palette[2] = 0; palette[3] = 255;   // 1=橙(发光)
  palette[4] = 100; palette[5] = 100; palette[6] = 100; palette[7] = 255; // 2=灰
  dense.data[dIdx(dense, 0, 0, 0)] = 1;
  dense.data[dIdx(dense, 1, 0, 0)] = 2;
  const materials = new Array(256).fill(null);
  materials[1] = { type: '_emit', emitK: 2, rough: 1, metal: 0, alpha: 1 };
  const b = buildBrick(dense, palette, 0.015, materials);
  if (!b.emi) throw new Error('emi 应存在');
  eq(Math.round(b.emi[0] * 100), 200, '发光 R = 1.0×emitK2');
  const b2 = buildBrick(dense, palette, 0.015, null);
  eq(b2.emi, null, '无 MATL 无 emi');
});

t('发光聚类:两簇分离/质心/排除半径/按能量排序', () => {
  const d = createDomain();
  // 簇A:世界 (2,1,2) 附近 2×2 发光格(16cm 格),亮度高
  const c = (w) => Math.floor((w - DOMAIN.origin[0]) / DOMAIN.albCell); // 对称域,三轴同式
  const ax = c(2), ay2 = Math.floor((1 - DOMAIN.origin[1]) / DOMAIN.albCell), az = c(2);
  // stampEmissive 按 4cm 细格坐标写 → ×4
  for (const dx of [0, 1]) stampEmissive(d, (ax + dx) * 4, ay2 * 4, az * 4, 4, 2, 0);
  // 簇B:世界 (-5,1,-5),弱
  const bx2 = c(-5), bz2 = c(-5);
  stampEmissive(d, bx2 * 4, ay2 * 4, bz2 * 4, 1, 1, 1);
  finalizeDomain(d);
  const ls = findEmissiveLights(d, { maxLights: 2 });
  eq(ls.length, 2, '两簇');
  if (Math.abs(ls[0].pos[0] - 2) > 0.5 || Math.abs(ls[0].pos[1] - 1) > 0.5) {
    throw new Error(`簇A质心偏移: ${ls[0].pos}`);
  }
  if (ls[0].power <= ls[1].power) throw new Error('应按能量降序');
  // 排除:真实灯在 (2,1,2) → 只剩簇B
  const ls2 = findEmissiveLights(d, { exclude: [[2, 1, 2]], maxLights: 2 });
  eq(ls2.length, 1, '排除后剩一簇');
  if (Math.abs(ls2[0].pos[0] + 5) > 0.5) throw new Error(`剩的该是簇B: ${ls2[0].pos}`);
});

t('发光聚类:E.3 灯槽扩容——7 簇取 top6 按能量降序', () => {
  const d = createDomain();
  const c = (w) => Math.floor((w - DOMAIN.origin[0]) / DOMAIN.albCell);
  const ay2 = Math.floor((1 - DOMAIN.origin[1]) / DOMAIN.albCell);
  // 7 簇一字排开(彼此 >16cm×2 不连通),能量 7..1 递减(格数区分)
  const xs = [-9, -6, -3, 0, 3, 6, 9];
  xs.forEach((wx, k) => {
    for (let n = 0; n < 7 - k; n++) stampEmissive(d, (c(wx) + n) * 4, ay2 * 4, c(wx) * 4, 1, 2, 0);
  });
  finalizeDomain(d);
  const ls = findEmissiveLights(d, { maxLights: 6 });
  eq(ls.length, 6, 'top6');
  for (let k = 1; k < 6; k++) {
    if (ls[k - 1].power < ls[k].power) throw new Error('应按能量降序');
  }
  // 能量最低的簇(1 格,世界 x=9)应被挤出
  if (ls.some((l) => Math.abs(l.pos[0] - 9) < 0.5)) throw new Error('最弱簇应被挤出 top6');
});

t('发光聚类:近簇并灯(E.5)——同灯具双圈并一盏,远簇不并', () => {
  const d = createDomain();
  const c = (w) => Math.floor((w - DOMAIN.origin[0]) / DOMAIN.albCell);
  const yAt = (w) => Math.floor((w - DOMAIN.origin[1]) / DOMAIN.albCell);
  // 一件双层吊灯:两圈发光相距 0.64m(4 alb 格)< mergeR 1.3 → 应并成一盏
  stampEmissive(d, c(2) * 4, yAt(2.0) * 4, c(2) * 4, 2, 2, 0);
  stampEmissive(d, c(2) * 4, yAt(2.64) * 4, c(2) * 4, 1, 1, 0);
  // 另一件远灯(5m 外)不并
  stampEmissive(d, c(-4) * 4, yAt(2.0) * 4, c(-4) * 4, 1, 1, 1);
  finalizeDomain(d);
  const ls = findEmissiveLights(d, { maxLights: 6 });
  eq(ls.length, 2, '三簇并成两盏');
  // 并后能量=两圈之和,质心落在两圈之间
  const main = ls[0];
  if (main.power <= 2.0) throw new Error(`并灯能量应为两圈之和: ${main.power}`);
  if (main.pos[1] < 2.0 || main.pos[1] > 2.64) throw new Error(`质心应在两圈之间: y=${main.pos[1]}`);
});

console.log(`\n${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
