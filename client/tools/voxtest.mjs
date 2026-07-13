// 体素核心库单测(node 直跑):node client/tools/voxtest.mjs
// 覆盖:.vox 写→读 roundtrip 恒等 / 调色板保真 / 贪心合并面数与法线 / AO 角遮蔽 / 自发光拆分 / 水密封闭。
import { makeDense, dIdx, writeVox, parseVox, setPaletteColor, getPaletteHex } from '../src/voxel/vox.js';
import { greedyMesh } from '../src/voxel/greedy.js';

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

// ---- 1. roundtrip:随机体写盘再读,逐体素恒等 ----
{
  const v = makeDense(9, 17, 5);
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < v.data.length; i++) v.data[i] = rnd() < 0.3 ? 1 + Math.floor(rnd() * 254) : 0;
  const pal = new Uint8Array(1024);
  for (let i = 1; i <= 255; i++) setPaletteColor(pal, i, `#${(i * 65793 & 0xffffff).toString(16).padStart(6, '0')}`);
  const buf = writeVox(v, pal);
  const { dense: v2, palette: pal2 } = parseVox(buf);
  ok(v2.sx === 9 && v2.sy === 17 && v2.sz === 5, 'roundtrip 尺寸恒等');
  let same = true;
  for (let i = 0; i < v.data.length; i++) if (v.data[i] !== v2.data[i]) { same = false; break; }
  ok(same, 'roundtrip 体素逐格恒等');
  let palSame = true;
  for (let i = 0; i < 1024; i++) if (pal[i] !== pal2[i]) { palSame = false; break; }
  ok(palSame, 'roundtrip 调色板恒等');
  ok(getPaletteHex(pal2, 7) === `#${(7 * 65793 & 0xffffff).toString(16).padStart(6, '0')}`, '调色板 hex 读取');
}

// ---- 2. 单体素立方体:6 面 12 三角,法线成对朝外,顶点全在 [0,1]³ ----
{
  const v = makeDense(1, 1, 1);
  v.data[0] = 1;
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 1, '#ff0000');
  const { main, emissive, quadCount } = greedyMesh(v, pal);
  ok(quadCount === 6, '单体素 6 个面');
  ok(main.count === 36, '单体素 36 顶点(12 三角)');
  ok(emissive === null, '无自发光索引 → emissive 空');
  // 法线校验:每面法线均指向体外(几何中心 0.5,0.5,0.5 → 顶点与法线同侧)
  let outward = true;
  for (let t = 0; t < main.count; t += 3) {
    // 三角面法线(叉积)与存储法线同向,且与「面心-体心」同向
    const p = main.positions, o = t * 3;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const nx = main.normals[o], ny = main.normals[o + 1], nz = main.normals[o + 2];
    if (cx * nx + cy * ny + cz * nz <= 0) { outward = false; break; }
    const fx = (p[o] + p[o + 3] + p[o + 6]) / 3 - 0.5, fy = (p[o + 1] + p[o + 4] + p[o + 7]) / 3 - 0.5, fz = (p[o + 2] + p[o + 5] + p[o + 8]) / 3 - 0.5;
    if (fx * nx + fy * ny + fz * nz <= 0) { outward = false; break; }
  }
  ok(outward, '绕序=CCW 朝外,法线与几何一致');
}

// ---- 3. 贪心合并:4×1×4 平板顶面合成 1 个四边形 ----
{
  const v = makeDense(4, 1, 4);
  v.data.fill(1);
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 1, '#00ff00');
  const { quadCount } = greedyMesh(v, pal, { ao: false });
  // 平板:顶1 底1 + 四侧各1 = 6
  ok(quadCount === 6, `4×4 平板合并成 6 面(实际 ${quadCount})`);
}

// ---- 4. AO:平板中央立一柱,柱脚四周顶面角变暗 ----
{
  const v = makeDense(5, 3, 5);
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) v.data[dIdx(v, x, 0, z)] = 1;
  v.data[dIdx(v, 2, 1, 2)] = 1;
  v.data[dIdx(v, 2, 2, 2)] = 1;
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 1, '#ffffff');
  const { main } = greedyMesh(v, pal);
  // 顶面(y=1 平面,法线 +y)顶点里,柱脚相邻角应比远角暗
  let minC = 1, maxC = 0;
  for (let t = 0; t < main.count; t++) {
    if (main.normals[t * 3 + 1] !== 1) continue;
    if (main.positions[t * 3 + 1] !== 1) continue; // 只看地板顶面
    const c = main.colors[t * 3];
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  ok(minC < maxC * 0.95, `AO 生效:柱脚角变暗(min ${minC.toFixed(3)} < max ${maxC.toFixed(3)})`);
}

// ---- 5. 自发光拆分 ----
{
  const v = makeDense(2, 1, 1);
  v.data[0] = 1; v.data[1] = 2;
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 1, '#808080');
  setPaletteColor(pal, 2, '#ff9a4a');
  const { main, emissive } = greedyMesh(v, pal, { emissiveIndices: new Set([2]) });
  ok(main && emissive, '自发光索引拆出子网格');
  ok(main.count > 0 && emissive.count > 0, '两路都有三角');
  // 两个相邻异色体素:共享面双向剔除 → 暴露 10 面 × 6 顶点 = 60
  ok(main.count + emissive.count === 60, `拆分后总面数守恒(${main.count}+${emissive.count}=60)`);
}

// ---- 6. 水密:实心球壳的面数 = 暴露面数(逐面数出来对账) ----
{
  const v = makeDense(12, 12, 12);
  const R = 5.2;
  for (let z = 0; z < 12; z++) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    if (Math.hypot(x - 5.5, y - 5.5, z - 5.5) <= R) v.data[dIdx(v, x, y, z)] = 3;
  }
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 3, '#4e3826');
  // 数暴露面(逐格逐方向)
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= 12 || y >= 12 || z >= 12) ? 0 : v.data[dIdx(v, x, y, z)];
  let faces = 0;
  for (let z = 0; z < 12; z++) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    if (!get(x, y, z)) continue;
    if (!get(x + 1, y, z)) faces++;
    if (!get(x - 1, y, z)) faces++;
    if (!get(x, y + 1, z)) faces++;
    if (!get(x, y - 1, z)) faces++;
    if (!get(x, y, z + 1)) faces++;
    if (!get(x, y, z - 1)) faces++;
  }
  const { main } = greedyMesh(v, pal, { ao: false, faceShade: false });
  // 无 AO 时贪心合并把共面同色面合成矩形——三角数 ≤ 2×暴露面,顶点覆盖面积=暴露面积。
  // 面积对账:所有三角面积之和 == 暴露面数(每面 1×1)
  let area = 0;
  const p = main.positions;
  for (let t = 0; t < main.count; t += 3) {
    const o = t * 3;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    area += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
  }
  ok(Math.abs(area - faces) < 1e-6, `面积对账:网格面积 ${area} == 暴露面 ${faces}`);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
