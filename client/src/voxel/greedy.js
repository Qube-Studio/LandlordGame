// 体素稠密体 → 网格(贪心合并 + 烘焙 AO + 材质分桶,docs/VOXEL_PLAN.md P0)。纯函数零依赖,node 可单测。
// 输出非索引三角形数组,单位 = 1 体素,调用方用 scale 换算世界尺寸。
// 顶点色:调色板 sRGB → 线性(three 顶点色按线性解释;不转的话体素件会比同 hex 的贴图件发灰)。
// AO:三邻居规则烘进顶点色;合并掩码含 (色索引, 四角 AO)——AO 不同的格子不合并。
// 材质分桶(P0-3):按 MATL 材质类拆三路网格——
//   main(diffuse+metal 合桶,粗糙/金属走第二套顶点属性 rm)/ emissive(发光强度走 emit 属性)/
//   glass(独立桶:透明材质开关塞不进顶点属性)。
// 玻璃可见性:面可见 = 邻居为空 或(邻居是玻璃且自己不是玻璃)——玻璃后的实心面不再被误剔。

const AO_LEVELS = [0.52, 0.72, 0.87, 1.0];           // 角遮蔽 0..3 级亮度
const FACE_SHADE = { px: 0.94, nx: 0.94, py: 1.05, ny: 0.82, pz: 0.98, nz: 0.9 };

const srgbToLinear = (u) => {
  const c = u / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

// dir ∈ 0..5:+x -x +y -y +z -z;d=主轴,u/v=面内轴
const DIRS = [
  { axis: 0, sign: 1, u: 2, v: 1, shade: FACE_SHADE.px },
  { axis: 0, sign: -1, u: 2, v: 1, shade: FACE_SHADE.nx },
  { axis: 1, sign: 1, u: 0, v: 2, shade: FACE_SHADE.py },
  { axis: 1, sign: -1, u: 0, v: 2, shade: FACE_SHADE.ny },
  { axis: 2, sign: 1, u: 0, v: 1, shade: FACE_SHADE.pz },
  { axis: 2, sign: -1, u: 0, v: 1, shade: FACE_SHADE.nz },
];

const CLS_MAIN = 0, CLS_EMIT = 1, CLS_GLASS = 2;

/**
 * greedyMesh(dense, palette, opts) → { main, emissive, glass, quadCount }
 *   dense: { sx, sy, sz, data }(vox.js makeDense 口径,y-up)
 *   palette: 256×4 Uint8Array(RGBA,索引 i 在 (i-1)*4)
 *   opts.materials: Array(256) — vox.js parseVox 的归一化 MATL 记录(可 null)
 *   opts.emissiveIndices: Set<int> — hex 匹配回退路径:这些索引并入发光桶(无 MATL 的旧资产)
 *   opts.ao / opts.faceShade: bool(默认 true)
 * 各桶: { positions, normals, colors, rm: Uint8Array×2(normalized rough,metal), emit: Float32Array, count }
 * glass 桶额外: alpha(桶内平均不透明度)、rough(平均粗糙度)。
 */
export function greedyMesh(dense, palette, opts = {}) {
  const { sx, sy, sz, data } = dense;
  const dims = [sx, sy, sz];
  const ao = opts.ao !== false;
  const faceShade = opts.faceShade !== false;

  // ---- 逐索引材质表(MATL 优先;hex 回退并入发光桶,emitK 缺省 1;默认 rough1/metal0) ----
  const cls = new Uint8Array(256);
  const roughT = new Float32Array(256).fill(1);
  const metalT = new Float32Array(256);
  const emitT = new Float32Array(256);
  const alphaT = new Float32Array(256).fill(1);
  for (let i = 1; i < 256; i++) {
    const m = opts.materials?.[i] ?? null;
    if (m) {
      roughT[i] = m.rough;
      metalT[i] = Math.min(0.75, m.metal); // 无 envMap 场景纯金属发黑,钳 ≤0.75
      if (m.type === '_emit') { cls[i] = CLS_EMIT; emitT[i] = m.emitK; }
      else if (m.type === '_glass') { cls[i] = CLS_GLASS; alphaT[i] = m.alpha; }
    }
    if (!m && opts.emissiveIndices?.has(i)) { cls[i] = CLS_EMIT; emitT[i] = 1; }
  }

  const get = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    return data[x + sx * (y + sy * z)];
  };

  const buckets = {
    [CLS_MAIN]: { pos: [], nor: [], col: [], rm: [], emit: [] },
    [CLS_EMIT]: { pos: [], nor: [], col: [], rm: [], emit: [] },
    [CLS_GLASS]: { pos: [], nor: [], col: [], rm: [], emit: [], alphaSum: 0, roughSum: 0, n: 0 },
  };
  let quadCount = 0;

  // 调色板 → 线性 RGB 缓存
  const lin = new Float32Array(256 * 3);
  for (let i = 1; i < 256; i++) {
    const o = (i - 1) * 4;
    lin[i * 3] = srgbToLinear(palette[o]);
    lin[i * 3 + 1] = srgbToLinear(palette[o + 1]);
    lin[i * 3 + 2] = srgbToLinear(palette[o + 2]);
  }

  const q = [0, 0, 0];
  const xyz = [0, 0, 0];
  for (const dir of DIRS) {
    const { axis: d, sign, u, v, shade } = dir;
    q[0] = q[1] = q[2] = 0; q[d] = sign;
    const du = dims[u], dv = dims[v];
    const maskKey = new Int32Array(du * dv);
    const maskAo = new Uint8Array(du * dv * 4);

    for (let slice = 0; slice < dims[d]; slice++) {
      maskKey.fill(0);
      for (let iv = 0; iv < dv; iv++) {
        for (let iu = 0; iu < du; iu++) {
          xyz[d] = slice; xyz[u] = iu; xyz[v] = iv;
          const ci = get(xyz[0], xyz[1], xyz[2]);
          if (!ci) continue;
          xyz[d] = slice + sign;
          const nb = get(xyz[0], xyz[1], xyz[2]);
          // 面可见 = 邻居空 或(邻居玻璃且自己非玻璃)
          if (nb && !(cls[nb] === CLS_GLASS && cls[ci] !== CLS_GLASS)) continue;
          let a0 = 3, a1 = 3, a2 = 3, a3 = 3;
          if (ao) {
            const occ = (ou, ov) => {
              xyz[d] = slice + sign; xyz[u] = iu + ou; xyz[v] = iv + ov;
              return get(xyz[0], xyz[1], xyz[2]) ? 1 : 0;
            };
            const sU0 = occ(-1, 0), sU1 = occ(1, 0), sV0 = occ(0, -1), sV1 = occ(0, 1);
            const c00 = occ(-1, -1), c10 = occ(1, -1), c01 = occ(-1, 1), c11 = occ(1, 1);
            const corner = (s1, s2, c) => (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
            a0 = corner(sU0, sV0, c00);
            a1 = corner(sU1, sV0, c10);
            a2 = corner(sU1, sV1, c11);
            a3 = corner(sU0, sV1, c01);
          }
          const m = iu + du * iv;
          maskKey[m] = ci | (a0 << 8) | (a1 << 10) | (a2 << 12) | (a3 << 14) | (1 << 30);
          const mo = m * 4;
          maskAo[mo] = a0; maskAo[mo + 1] = a1; maskAo[mo + 2] = a2; maskAo[mo + 3] = a3;
        }
      }
      for (let iv = 0; iv < dv; iv++) {
        for (let iu = 0; iu < du;) {
          const m = iu + du * iv;
          const key = maskKey[m];
          if (!key) { iu++; continue; }
          let w = 1;
          while (iu + w < du && maskKey[m + w] === key) w++;
          let h = 1;
          outer: while (iv + h < dv) {
            for (let k = 0; k < w; k++) {
              if (maskKey[iu + k + du * (iv + h)] !== key) break outer;
            }
            h++;
          }
          const ci = key & 0xff;
          const mo = m * 4;
          const a = [maskAo[mo], maskAo[mo + 1], maskAo[mo + 2], maskAo[mo + 3]];
          const bucket = buckets[cls[ci]];
          emitQuad(bucket, d, sign, u, v, slice, iu, iv, w, h, q,
            lin[ci * 3], lin[ci * 3 + 1], lin[ci * 3 + 2],
            faceShade ? shade : 1, a,
            roughT[ci], metalT[ci], emitT[ci]);
          if (cls[ci] === CLS_GLASS) {
            bucket.alphaSum += alphaT[ci] * w * h;
            bucket.roughSum += roughT[ci] * w * h;
            bucket.n += w * h;
          }
          quadCount++;
          for (let dy = 0; dy < h; dy++) {
            maskKey.fill(0, iu + du * (iv + dy), iu + w + du * (iv + dy));
          }
          iu += w;
        }
      }
    }
  }

  const pack = (b) => b.pos.length
    ? {
      positions: new Float32Array(b.pos),
      normals: new Float32Array(b.nor),
      colors: new Float32Array(b.col),
      rm: new Uint8Array(b.rm),
      emit: new Float32Array(b.emit),
      count: b.pos.length / 3,
    }
    : null;
  const glass = pack(buckets[CLS_GLASS]);
  if (glass) {
    glass.alpha = buckets[CLS_GLASS].alphaSum / buckets[CLS_GLASS].n;
    glass.rough = buckets[CLS_GLASS].roughSum / buckets[CLS_GLASS].n;
  }
  return { main: pack(buckets[CLS_MAIN]), emissive: pack(buckets[CLS_EMIT]), glass, quadCount };
}

// 发一个合并四边形(两个三角):AO 决定对角线走向;绕序保证法线朝外;rm/emit 每顶点常量。
function emitQuad(out, d, sign, u, v, slice, iu, iv, w, h, q, r, g, b, shade, a, rough, metal, emitK) {
  const base = [0, 0, 0];
  base[d] = slice + (sign > 0 ? 1 : 0);
  base[u] = iu; base[v] = iv;
  const corner = (ou, ov) => {
    const p = [0, 0, 0];
    p[d] = base[d]; p[u] = iu + ou; p[v] = iv + ov;
    return p;
  };
  const p0 = corner(0, 0), p1 = corner(w, 0), p2 = corner(w, h), p3 = corner(0, h);
  const nx = q[0], ny = q[1], nz = q[2];
  const shadeOf = (lvl) => AO_LEVELS[lvl] * shade;
  const cols = a.map((lvl) => [r * shadeOf(lvl), g * shadeOf(lvl), b * shadeOf(lvl)]);
  const flipWinding = ((u + 1) % 3 === v ? 1 : -1) * sign < 0;
  const flipDiag = a[0] + a[2] > a[1] + a[3];
  const quad = flipDiag
    ? [p1, p2, p3, p3, p0, p1]
    : [p0, p1, p2, p2, p3, p0];
  const quadCol = flipDiag
    ? [cols[1], cols[2], cols[3], cols[3], cols[0], cols[1]]
    : [cols[0], cols[1], cols[2], cols[2], cols[3], cols[0]];
  const order = flipWinding ? [2, 1, 0, 5, 4, 3] : [0, 1, 2, 3, 4, 5];
  const r8 = Math.round(rough * 255), m8 = Math.round(metal * 255);
  for (const k of order) {
    out.pos.push(quad[k][0], quad[k][1], quad[k][2]);
    out.nor.push(nx, ny, nz);
    out.col.push(quadCol[k][0], quadCol[k][1], quadCol[k][2]);
    out.rm.push(r8, m8);
    out.emit.push(emitK);
  }
}
