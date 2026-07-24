// 烘焙混合光照 v1 · 数据域(docs/VOXEL_PLAN.md 附录 B / plans bug-swift-unicorn P1-1)。
// 纯 typed-array、零依赖——node 单测(tools/voxlighttest.mjs)与浏览器共用。
// 三块数据(全为「烘焙时」结构,运行时只有光照体积常驻;体积在 baker.js/P1-2 引入):
//   占位位图  4cm  640×256×640,1-bit 压进 Uint32(x 向 20 词)≈13.1MB —— 光线求交
//   粗层      32cm  80×32×80 Uint8 ≈0.2MB —— 两级 DDA 的跳空层(细层 8³ 有占位=1)
//   反照率体  16cm 160×64×160 RGBA8 ≈6.5MB —— 弹射用均色(stamp 累加取平均)
// 域原点/尺寸盖全房间(墙 ±12,天花 y10)+ 地下 6 格垫层(y 从 -0.24 起)。
export const DOMAIN = {
  origin: [-12.8, -0.24, -12.8],
  cell: 0.04,
  nx: 640, ny: 256, nz: 640,
  wordsX: 20,            // 640 / 32
  cnx: 80, cny: 32, cnz: 80,     // 粗层 = 细層 8³
  albCell: 0.16,
  anx: 160, any: 64, anz: 160,   // 反照率 = 细层 4³
};

export function createDomain() {
  const { wordsX, ny, nz, cnx, cny, cnz, anx, any: ay, anz } = DOMAIN;
  const albN = anx * ay * anz;
  return {
    bits: new Uint32Array(wordsX * ny * nz),
    coarse: new Uint8Array(cnx * cny * cnz),
    // 反照率累加器(烘焙期临时,finalize 后可弃):同格多次 stamp 取平均
    albSum: new Uint32Array(albN * 3),
    albCnt: new Uint32Array(albN),
    albedo: new Uint8Array(albN * 4),
    // 发光体(P1-4,16cm 同反照率网格):rgb = 线性色(0..1)×emitK 的格内累加均值。
    // 用途:发光体素聚类成虚拟点光(素材发光照亮环境)——不是渲染贴图,精度 float 保留 emitK>1
    emiSum: new Float32Array(albN * 3),
    emiCnt: new Uint32Array(albN),
    emi: new Float32Array(albN * 3),
  };
}

export function clearDomain(d) {
  d.bits.fill(0); d.coarse.fill(0);
  d.albSum.fill(0); d.albCnt.fill(0); d.albedo.fill(0);
  d.emiSum.fill(0); d.emiCnt.fill(0); d.emi.fill(0);
}

// 发光累加(独立于占位 stamp:发光格必然也 stampCell 过;r/g/b = 线性色×emitK,可 >1)
export function stampEmissive(d, ix, iy, iz, r, g, b) {
  if (!inDomain(ix, iy, iz)) return;
  const ai = (ix >> 2) + DOMAIN.anx * ((iy >> 2) + DOMAIN.any * (iz >> 2));
  d.emiSum[ai * 3] += r; d.emiSum[ai * 3 + 1] += g; d.emiSum[ai * 3 + 2] += b;
  d.emiCnt[ai]++;
}

// 世界坐标 → 细格索引(单轴);越界返回 -1 由调用方裁剪
export const cellOf = (w, axis) => Math.floor((w - DOMAIN.origin[axis]) / DOMAIN.cell);
// 细格中心的世界坐标
export const worldOf = (i, axis) => DOMAIN.origin[axis] + (i + 0.5) * DOMAIN.cell;

export const inDomain = (ix, iy, iz) =>
  ix >= 0 && iy >= 0 && iz >= 0 && ix < DOMAIN.nx && iy < DOMAIN.ny && iz < DOMAIN.nz;

// 标记一个细格 + 反照率累加(r/g/b ∈ 0..255,sRGB 字节)。越界静默忽略。
export function stampCell(d, ix, iy, iz, r, g, b) {
  if (!inDomain(ix, iy, iz)) return;
  const wi = (ix >> 5) + DOMAIN.wordsX * (iy + DOMAIN.ny * iz);
  d.bits[wi] |= 1 << (ix & 31);
  const ai = (ix >> 2) + DOMAIN.anx * ((iy >> 2) + DOMAIN.any * (iz >> 2));
  d.albSum[ai * 3] += r; d.albSum[ai * 3 + 1] += g; d.albSum[ai * 3 + 2] += b;
  d.albCnt[ai]++;
}

export function getCell(d, ix, iy, iz) {
  if (!inDomain(ix, iy, iz)) return 0;
  const wi = (ix >> 5) + DOMAIN.wordsX * (iy + DOMAIN.ny * iz);
  return (d.bits[wi] >>> (ix & 31)) & 1;
}

// 细层写完后收口:粗层(词按字节扫——1 字节=8 细格=粗层 1 格 x 跨度)+ 反照率平均
export function finalizeDomain(d) {
  const { wordsX, ny, nz, cnx, cny, anx, any: ay, anz } = DOMAIN;
  d.coarse.fill(0);
  for (let iz = 0; iz < nz; iz++) {
    const cz = iz >> 3;
    for (let iy = 0; iy < ny; iy++) {
      const cy = iy >> 3;
      const rowBase = wordsX * (iy + ny * iz);
      const coarseBase = cnx * (cy + cny * cz);
      for (let wx = 0; wx < wordsX; wx++) {
        const w = d.bits[rowBase + wx];
        if (!w) continue;
        if (w & 0x000000ff) d.coarse[coarseBase + wx * 4] = 1;
        if (w & 0x0000ff00) d.coarse[coarseBase + wx * 4 + 1] = 1;
        if (w & 0x00ff0000) d.coarse[coarseBase + wx * 4 + 2] = 1;
        if (w & 0xff000000) d.coarse[coarseBase + wx * 4 + 3] = 1;
      }
    }
  }
  const albN = anx * ay * anz;
  for (let i = 0; i < albN; i++) {
    const n = d.albCnt[i];
    if (!n) { d.albedo[i * 4 + 3] = 0; continue; }
    d.albedo[i * 4] = (d.albSum[i * 3] / n) | 0;
    d.albedo[i * 4 + 1] = (d.albSum[i * 3 + 1] / n) | 0;
    d.albedo[i * 4 + 2] = (d.albSum[i * 3 + 2] / n) | 0;
    d.albedo[i * 4 + 3] = 255;
  }
  for (let i = 0; i < albN; i++) {
    const n = d.emiCnt[i];
    if (!n) continue;
    d.emi[i * 3] = d.emiSum[i * 3] / n;
    d.emi[i * 3 + 1] = d.emiSum[i * 3 + 1] / n;
    d.emi[i * 3 + 2] = d.emiSum[i * 3 + 2] / n;
  }
}

// 占位统计(验收/探针用)
export function countBits(d) {
  let n = 0;
  for (let i = 0; i < d.bits.length; i++) {
    let w = d.bits[i];
    while (w) { n += w & 1; w >>>= 1; }
  }
  return n;
}
