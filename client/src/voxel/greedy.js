// 体素稠密体 → 网格(贪心合并 + 烘焙 AO,docs/VOXEL_PLAN.md P0)。纯函数零依赖,node 可单测。
// 输出非索引三角形数组(positions/normals/colors),单位 = 1 体素,调用方用 scale 换算世界尺寸。
// 顶点色:调色板 sRGB → 线性(three 顶点色按线性解释;不转的话体素件会比同 hex 的贴图件发灰)。
// AO:0fps 三邻居规则,烘进顶点色;合并掩码含 (色索引, 四角 AO) —— AO 不同的格子不合并,
// 保证大四边形内 AO 恒定、共享角一致。另按面朝向做轻微明暗分级(复刻 texlib 顶亮底暗的手感)。

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

/**
 * greedyMesh(dense, palette, opts) → { main, emissive|null, quadCount }
 *   dense: { sx, sy, sz, data }(vox.js makeDense 口径,y-up)
 *   palette: 256×4 Uint8Array(RGBA,索引 i 在 (i-1)*4)
 *   opts.emissiveIndices: Set<int> — 这些调色板索引拆到 emissive 子网格(材质由调用方定)
 *   opts.ao: bool(默认 true) / opts.faceShade: bool(默认 true)
 * main/emissive: { positions: Float32Array, normals: Float32Array, colors: Float32Array, count }
 */
export function greedyMesh(dense, palette, opts = {}) {
  const { sx, sy, sz, data } = dense;
  const dims = [sx, sy, sz];
  const ao = opts.ao !== false;
  const faceShade = opts.faceShade !== false;
  const emiSet = opts.emissiveIndices ?? null;

  const get = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    return data[x + sx * (y + sy * z)];
  };

  // 两路输出桶(main / emissive)
  const buckets = { main: { pos: [], nor: [], col: [] }, emissive: { pos: [], nor: [], col: [] } };
  let quadCount = 0;

  // 调色板 → 线性 RGB 缓存
  const lin = new Float32Array(256 * 3);
  for (let i = 1; i < 256; i++) {
    const o = (i - 1) * 4;
    lin[i * 3] = srgbToLinear(palette[o]);
    lin[i * 3 + 1] = srgbToLinear(palette[o + 1]);
    lin[i * 3 + 2] = srgbToLinear(palette[o + 2]);
  }

  const q = [0, 0, 0];   // 面主轴步进向量
  const xyz = [0, 0, 0]; // 当前格坐标
  for (const dir of DIRS) {
    const { axis: d, sign, u, v, shade } = dir;
    q[0] = q[1] = q[2] = 0; q[d] = sign;
    const du = dims[u], dv = dims[v];
    // mask[iu + du*iv] = 0(无面) 或 {ci, ao0..ao3} 的打包 key + 记录
    const maskKey = new Int32Array(du * dv);
    const maskAo = new Uint8Array(du * dv * 4);

    for (let slice = 0; slice < dims[d]; slice++) {
      // ---- 构建这一层的面掩码 ----
      maskKey.fill(0);
      for (let iv = 0; iv < dv; iv++) {
        for (let iu = 0; iu < du; iu++) {
          xyz[d] = slice; xyz[u] = iu; xyz[v] = iv;
          const ci = get(xyz[0], xyz[1], xyz[2]);
          if (!ci) continue;
          xyz[d] = slice + sign;
          if (get(xyz[0], xyz[1], xyz[2])) continue; // 邻居实心,面被遮
          // 四角 AO:面外一层(slice+sign)取 side1/side2/corner 占位
          let a0 = 3, a1 = 3, a2 = 3, a3 = 3;
          if (ao) {
            const occ = (ou, ov) => {
              xyz[d] = slice + sign; xyz[u] = iu + ou; xyz[v] = iv + ov;
              return get(xyz[0], xyz[1], xyz[2]) ? 1 : 0;
            };
            const sU0 = occ(-1, 0), sU1 = occ(1, 0), sV0 = occ(0, -1), sV1 = occ(0, 1);
            const c00 = occ(-1, -1), c10 = occ(1, -1), c01 = occ(-1, 1), c11 = occ(1, 1);
            const corner = (s1, s2, c) => (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
            a0 = corner(sU0, sV0, c00); // (iu, iv) 角
            a1 = corner(sU1, sV0, c10); // (iu+1, iv)
            a2 = corner(sU1, sV1, c11); // (iu+1, iv+1)
            a3 = corner(sU0, sV1, c01); // (iu, iv+1)
          }
          const m = iu + du * iv;
          maskKey[m] = ci | (a0 << 8) | (a1 << 10) | (a2 << 12) | (a3 << 14) | (1 << 30);
          const mo = m * 4;
          maskAo[mo] = a0; maskAo[mo + 1] = a1; maskAo[mo + 2] = a2; maskAo[mo + 3] = a3;
        }
      }
      // ---- 贪心矩形合并 ----
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
          // 发四边形
          const ci = key & 0xff;
          const mo = m * 4;
          const a = [maskAo[mo], maskAo[mo + 1], maskAo[mo + 2], maskAo[mo + 3]];
          emitQuad(buckets, emiSet?.has(ci) ? 'emissive' : 'main',
            d, sign, u, v, slice, iu, iv, w, h, q,
            lin[ci * 3], lin[ci * 3 + 1], lin[ci * 3 + 2],
            faceShade ? shade : 1, a);
          quadCount++;
          // 清掩码
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
      count: b.pos.length / 3,
    }
    : null;
  return { main: pack(buckets.main), emissive: pack(buckets.emissive), quadCount };
}

// 发一个合并四边形(两个三角):AO 决定对角线走向(防插值伪影);绕序保证法线朝外。
function emitQuad(buckets, which, d, sign, u, v, slice, iu, iv, w, h, q, r, g, b, shade, a) {
  const out = buckets[which];
  const base = [0, 0, 0];
  base[d] = slice + (sign > 0 ? 1 : 0); // 面所在平面
  base[u] = iu; base[v] = iv;
  // 四角(面内 u/v 序):p0=(0,0) p1=(w,0) p2=(w,h) p3=(0,h)
  const corner = (ou, ov) => {
    const p = [0, 0, 0];
    p[d] = base[d]; p[u] = iu + ou; p[v] = iv + ov;
    return p;
  };
  const p0 = corner(0, 0), p1 = corner(w, 0), p2 = corner(w, h), p3 = corner(0, h);
  const nx = q[0], ny = q[1], nz = q[2];
  const shadeOf = (lvl) => AO_LEVELS[lvl] * shade;
  const cols = a.map((lvl) => [r * shadeOf(lvl), g * shadeOf(lvl), b * shadeOf(lvl)]);
  // 绕序:u×v 叉积是否与法线同向决定三角顶点顺序
  const flipWinding = ((u + 1) % 3 === v ? 1 : -1) * sign < 0;
  // AO 对角线翻转:a0+a2 与 a1+a3 差异大时换对角线,插值更均匀
  const flipDiag = a[0] + a[2] > a[1] + a[3];
  const quad = flipDiag
    ? [p1, p2, p3, p3, p0, p1]
    : [p0, p1, p2, p2, p3, p0];
  const quadCol = flipDiag
    ? [cols[1], cols[2], cols[3], cols[3], cols[0], cols[1]]
    : [cols[0], cols[1], cols[2], cols[2], cols[3], cols[0]];
  const order = flipWinding ? [2, 1, 0, 5, 4, 3] : [0, 1, 2, 3, 4, 5];
  for (const k of order) {
    out.pos.push(quad[k][0], quad[k][1], quad[k][2]);
    out.nor.push(nx, ny, nz);
    out.col.push(quadCol[k][0], quadCol[k][1], quadCol[k][2]);
  }
}
