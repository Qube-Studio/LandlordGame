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

// ---- 7. MATL 材质块:写→读 roundtrip + 归一化 + 容错 ----
{
  const v = makeDense(2, 1, 2);
  v.data[0] = 1; v.data[1] = 2; v.data[2] = 3; v.data[3] = 4;
  const pal = new Uint8Array(1024);
  for (let i = 1; i <= 4; i++) setPaletteColor(pal, i, `#0${i}0${i}0${i}`);
  const mats = {
    2: { _type: '_emit', _emit: '0.5', _flux: '2' },        // emitK = 0.5×2^(2-1) = 1
    3: { _type: '_metal', _metal: '0.7', _rough: '0.35' },
    4: { _type: '_glass', _alpha: '0.7' },                   // alpha = 1-0.7 = 0.3
  };
  const { dense: v2, materials } = parseVox(writeVox(v, pal, { materials: mats }));
  ok(v2.data[0] === 1, 'MATL 不破坏几何');
  ok(materials[1] === null, '未标注索引 materials=null');
  ok(materials[2]?.type === '_emit' && Math.abs(materials[2].emitK - 1) < 1e-6, `emitK=_emit×2^(_flux-1)(${materials[2]?.emitK})`);
  ok(materials[3]?.metal === 0.7 && materials[3]?.rough === 0.35, '金属 _metal/_rough 归一化');
  ok(materials[4]?.type === '_glass' && Math.abs(materials[4].alpha - 0.3) < 1e-6, `玻璃 alpha=1-_alpha(${materials[4]?.alpha})`);
  // 未知 key 静默跳过
  const { materials: m2 } = parseVox(writeVox(v, pal, { materials: { 1: { _type: '_emit', _weird: 'x', _emit: '1' } } }));
  ok(m2[1]?.emitK === 1, '未知 MATL key 静默跳过');
  // 无 MATL 文件 → materials 全 null
  const { materials: m3 } = parseVox(writeVox(v, pal));
  ok(m3.every(m => m === null), '无 MATL 文件 materials 全 null');
  // 旧字段兼容:_weight 承载 emit
  const { materials: m4 } = parseVox(writeVox(v, pal, { materials: { 1: { _type: '_emit', _weight: '0.5' } } }));
  ok(Math.abs(m4[1].emitK - 0.5) < 1e-6, '旧字段 _weight 兼容');
}

// ---- 8. 材质分桶(P0-3):MATL 驱动三桶 + rm/emit 属性 + 玻璃可见性 ----
{
  const v = makeDense(3, 1, 1);
  v.data[0] = 1; v.data[1] = 2; v.data[2] = 3; // 实心 | 玻璃 | 发光
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 1, '#808080');
  setPaletteColor(pal, 2, '#cfe6ee');
  setPaletteColor(pal, 3, '#ff9a4a');
  const mats = {
    1: { _type: '_metal', _metal: '0.9', _rough: '0.3' },   // metal 应钳到 0.75
    2: { _type: '_glass', _alpha: '0.6' },
    3: { _type: '_emit', _emit: '2', _flux: '1' },
  };
  const { dense: v2, palette: pal2, materials } = parseVox(writeVox(v, pal, { materials: mats }));
  const { main, emissive, glass } = greedyMesh(v2, pal2, { materials });
  ok(main && emissive && glass, 'MATL 三桶各就位');
  // 玻璃可见性:实心与玻璃相邻的面不再被剔(实心 6 面全在:5 外露 + 1 朝玻璃)
  ok(main.count === 36, `实心朝玻璃的面保留(${main.count / 6} 面)`);
  // 玻璃自身:朝实心的面剔掉? 规则=邻居空 或 邻居玻璃且自己非玻璃→玻璃朝实心/发光的面隐藏
  ok(glass.count === 4 * 6, `玻璃朝实心/发光面隐藏(${glass.count / 6} 面)`);
  ok(Math.abs(glass.alpha - 0.4) < 1e-6, `玻璃桶均值 alpha(${glass.alpha})`);
  // rm 属性:metal 钳 0.75 → 191;rough 0.3 → 77
  ok(main.rm[0] === 77 && main.rm[1] === 191, `aRm 归一化+金属钳制(${main.rm[0]},${main.rm[1]})`);
  // emit 属性:emitK=2
  ok(emissive.emit[0] === 2, `aEmit=emitK(${emissive.emit[0]})`);
  // 无 MATL + hex 回退:并集路径
  const { main: m2, emissive: e2 } = greedyMesh(v2, pal2, { emissiveIndices: new Set([3]) });
  ok(e2 && e2.emit[0] === 1 && m2.rm[1] === 0, 'hex 回退:发光 emitK=1,无 MATL 默认 rough1/metal0');
  ok(m2.rm[0] === 255, '无 MATL 默认 rough=1(255)');
}

// ---- 9. MATL 原始字典(matlRaw,工具口径):写→读恒等(值统一为字符串) ----
{
  const v = makeDense(2, 2, 2);
  v.data.fill(0);
  v.data[0] = 1; v.data[1] = 2; v.data[2] = 3;
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 1, '#b98a3f');
  setPaletteColor(pal, 2, '#ff9a4a');
  setPaletteColor(pal, 3, '#cfe6ee');
  const materials = {
    1: { _type: '_metal', _metal: 0.8, _weight: 0.8, _rough: 0.3, _spec: 0.6, _ior: 1.3 },
    2: { _type: '_emit', _emit: 0.9, _flux: 2, _ldr: 0 },
    3: { _type: '_glass', _alpha: 0.35, _trans: 0.35, _rough: 0.08, _ior: 1.4 },
  };
  const { dense: v2, matlRaw: m2 } = parseVox(writeVox(v, pal, { materials }));
  ok(Object.keys(m2).length === 3, 'MATL 三种材质都读回');
  ok(m2[1]._type === '_metal' && m2[1]._rough === '0.3', '金属材质字典恒等');
  ok(m2[2]._type === '_emit' && m2[2]._flux === '2', '发光材质字典恒等');
  ok(m2[3]._type === '_glass' && m2[3]._alpha === '0.35', '玻璃材质字典恒等');
  ok(v2.data[0] === 1 && v2.data[1] === 2, 'MATL 不影响体素读回');
}

// ---- 10. 多模型分块(>256):写场景图再读,逐体素恒等 ----
{
  const v = makeDense(300, 20, 270); // x/z 超 256 → 2×2 块;全偶数,枢轴无歧义
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < v.data.length; i++) v.data[i] = rnd() < 0.02 ? 1 + Math.floor(rnd() * 254) : 0;
  // 四角各钉一个哨兵,保证没有块因全空被丢(尺寸不缩水)
  v.data[dIdx(v, 0, 0, 0)] = 9;
  v.data[dIdx(v, 299, 0, 0)] = 9;
  v.data[dIdx(v, 0, 19, 269)] = 9;
  v.data[dIdx(v, 299, 19, 269)] = 9;
  const pal = new Uint8Array(1024);
  for (let i = 1; i <= 255; i++) setPaletteColor(pal, i, `#${(i * 65793 & 0xffffff).toString(16).padStart(6, '0')}`);
  const buf = writeVox(v, pal);
  // 文件里应有 4 个 SIZE 块(2×2 分块)与场景图——按块结构游走统计(裸扫字节会被 XYZI 随机数据撞出假匹配)
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const tagCount = (t) => {
    let n = 0, q = 8;
    while (q + 12 <= u8.length) {
      const id = String.fromCharCode(u8[q], u8[q + 1], u8[q + 2], u8[q + 3]);
      const content = dv.getInt32(q + 4, true);
      if (id === t) n++;
      q += 12 + (id === 'MAIN' ? 0 : content);
    }
    return n;
  };
  ok(tagCount('SIZE') === 4, `超 256 切成 4 块(实际 ${tagCount('SIZE')})`);
  ok(tagCount('nSHP') === 4 && tagCount('nGRP') === 1, '场景图 nGRP/nSHP 齐全');
  const { dense: v2 } = parseVox(buf);
  ok(v2.sx === 300 && v2.sy === 20 && v2.sz === 270, `多模型 roundtrip 尺寸恒等(实际 ${v2.sx}×${v2.sy}×${v2.sz})`);
  let same = true;
  for (let i = 0; i < v.data.length; i++) if (v.data[i] !== v2.data[i]) { same = false; break; }
  ok(same, '多模型 roundtrip 体素逐格恒等');
}

// ---- 11. 掏空减重:实心块内部清空,外表面网格面积不变 ----
{
  const { hollow } = await import('./voxkit.mjs');
  const mk = () => {
    const v = makeDense(8, 6, 7);
    v.data.fill(2);
    return v;
  };
  const pal = new Uint8Array(1024);
  setPaletteColor(pal, 2, '#6b3428');
  const area = (v) => {
    const { main } = greedyMesh(v, pal, { ao: false, faceShade: false });
    let a = 0;
    const p = main.positions;
    for (let t = 0; t < main.count; t += 3) {
      const o = t * 3;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
      const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      a += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
    }
    return a;
  };
  const solid = mk(), shelled = mk();
  const removed = hollow(shelled);
  ok(removed === 6 * 4 * 5, `内部体素全清(${removed} = 6×4×5)`);
  let surfaceIntact = true;
  for (let z = 0; z < 7; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
    const onSurface = x === 0 || y === 0 || z === 0 || x === 7 || y === 5 || z === 6;
    if (onSurface && !shelled.data[dIdx(shelled, x, y, z)]) { surfaceIntact = false; }
  }
  ok(surfaceIntact, '外壳一格不少');
  // 掏空后外表面积恒等(内壁密闭空腔会多面,但外表面积那部分不变——总面积=外+内腔 6 面)
  const a0 = area(solid), a1 = area(shelled);
  ok(Math.abs(a1 - (a0 + 2 * (6 * 4 + 6 * 5 + 4 * 5))) < 1e-6, `掏空后面积=外表面+内腔六壁(${a0}→${a1})`);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
