// 体素生成公共层(node 工具侧,从 voxgen.mjs 抽出;docs/VOXEL_PLAN.md「程序化打底」轨):
// 调色板注册(可挂 MATL 材质)/材质预设/确定性 PRNG/世界坐标画笔/掏空减重。浏览器不引用本文件。
import { setPaletteColor } from '../src/voxel/vox.js';

// ---- MATL 材质预设(MagicaVoxel 字典;值由 vox.js 写盘时统一转字符串) ----
// metal=反射(黄铜/铜件) emit=发光(琥珀/炭床) glass=透明(镜片/瓶器)。不挂材质=默认 _diffuse。
export const MAT = {
  metal: ({ metal = 0.8, rough = 0.25 } = {}) => ({ _type: '_metal', _metal: metal, _weight: metal, _rough: rough, _spec: 0.6, _ior: 1.3 }),
  emit: ({ emit = 0.8, flux = 2 } = {}) => ({ _type: '_emit', _emit: emit, _flux: flux, _ldr: 0 }),
  glass: ({ alpha = 0.35, rough = 0.08, ior = 1.4 } = {}) => ({ _type: '_glass', _alpha: alpha, _trans: alpha, _rough: rough, _ior: ior }),
};

// ---- 调色板注册(索引从 1 递增;同 hex 去重;第二参可挂材质,同 hex 材质冲突即抛) ----
export function makePalette() {
  const pal = new Uint8Array(1024);
  const byHex = new Map();
  const mats = {};
  let next = 1;
  const reg = (hex, mat) => {
    const h = hex.toLowerCase();
    let idx = byHex.get(h);
    if (idx == null) {
      if (next > 255) throw new Error('调色板满 255');
      setPaletteColor(pal, next, h);
      byHex.set(h, next);
      idx = next++;
    }
    if (mat) {
      if (mats[idx] && JSON.stringify(mats[idx]) !== JSON.stringify(mat)) throw new Error(`材质冲突: ${h}`);
      mats[idx] = mat;
    }
    return idx;
  };
  return { pal, reg, mats };
}

// 确定性 PRNG(禁 Math.random,资产可复现)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 位置哈希(与扫描顺序/rnd 流无关的确定性噪声——毡面斑驳/板材分色用)
export function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---- 体素画笔(y-up 世界单位口径;内部换算体素格) ----
export class Painter {
  constructor(dense, scale) {
    this.v = dense;
    this.s = scale;
    this.cx = dense.sx / 2;
    this.cz = dense.sz / 2;
  }
  // 世界坐标 → 体素格
  gx(x) { return Math.round(this.cx + x / this.s); }
  gy(y) { return Math.round(y / this.s); }
  gz(z) { return Math.round(this.cz + z / this.s); }
  set(ix, iy, iz, ci) {
    const { sx, sy, sz, data } = this.v;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return;
    data[ix + sx * (iy + sy * iz)] = ci;
  }
  // 扫描世界包围盒,谓词 f(x,y,z 世界坐标) 返回色索引或 0
  scan(x0, x1, y0, y1, z0, z1, f) {
    const ix0 = Math.max(0, this.gx(x0)), ix1 = Math.min(this.v.sx - 1, this.gx(x1));
    const iy0 = Math.max(0, this.gy(y0)), iy1 = Math.min(this.v.sy - 1, this.gy(y1));
    const iz0 = Math.max(0, this.gz(z0)), iz1 = Math.min(this.v.sz - 1, this.gz(z1));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = (ix - this.cx) * this.s, y = iy * this.s, z = (iz - this.cz) * this.s;
          const ci = f(x, y, z);
          if (ci) this.set(ix, iy, iz, ci);
        }
      }
    }
  }
  cylinderY(cx, cz, y0, y1, r, ci, rIn = 0) {
    this.scan(cx - r, cx + r, y0, y1, cz - r, cz + r, (x, y, z) => {
      const d = Math.hypot(x - cx, z - cz);
      return d <= r && d >= rIn ? ci : 0;
    });
  }
  box(x0, x1, y0, y1, z0, z1, ci) {
    this.scan(x0, x1, y0, y1, z0, z1, () => ci);
  }
  sphere(cx, cy, cz, r, ci) {
    this.scan(cx - r, cx + r, cy - r, cy + r, cz - r, cz + r, (x, y, z) =>
      Math.hypot(x - cx, y - cy, z - cz) <= r ? ci : 0);
  }
  // 八面体宝石(曼哈顿距离)
  octahedron(cx, cy, cz, r, ci) {
    this.scan(cx - r, cx + r, cy - r, cy + r, cz - r, cz + r, (x, y, z) =>
      Math.abs(x - cx) + Math.abs(y - cy) + Math.abs(z - cz) <= r ? ci : 0);
  }
  // 任意朝向圆环(链环):圆心 c,环面法线 n(单位),环半径 R,管半径 r
  torus(c, n, R, r, ci) {
    const ext = R + r;
    this.scan(c.x - ext, c.x + ext, c.y - ext, c.y + ext, c.z - ext, c.z + ext, (x, y, z) => {
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const dn = dx * n.x + dy * n.y + dz * n.z;          // 法向分量
      const px = dx - dn * n.x, py = dy - dn * n.y, pz = dz - dn * n.z; // 环面内投影
      const dRing = Math.hypot(Math.hypot(px, py, pz) - R, dn);
      return dRing <= r ? ci : 0;
    });
  }
}

// 八角度量(faceR=面距):max(|x|,|z|,(|x|+|z|)/√2)
export const d8 = (x, z) => Math.max(Math.abs(x), Math.abs(z), (Math.abs(x) + Math.abs(z)) / Math.SQRT2);

// 掏空减重:六邻居全实心的内部体素清零(桌板/框这类实心大体 XYZI 直降一个量级)。
// 外表面不受影响(被删体素本就被面剔除);密闭空腔的内壁经贪心合并只多几个大四边形,可忽略。
export function hollow(dense) {
  const { sx, sy, sz, data } = dense;
  const src = data.slice();
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) ? 0 : src[x + sx * (y + sy * z)];
  let removed = 0;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (!at(x, y, z)) continue;
        if (at(x + 1, y, z) && at(x - 1, y, z) && at(x, y + 1, z) && at(x, y - 1, z) && at(x, y, z + 1) && at(x, y, z - 1)) {
          data[x + sx * (y + sy * z)] = 0;
          removed++;
        }
      }
    }
  }
  return removed;
}
