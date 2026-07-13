// 程序化体素资产生成器(docs/VOXEL_PLAN.md P0「程序化打底」轨):
//   node client/tools/voxgen.mjs        → 生成全部资产到 client/src/assets/vox/
// 颜色一律取自 palette.js(单一真源);写出的 .vox 自带调色板,可直接进 MagicaVoxel 手工精修
// (手修后放回原路径即生效——运行时按颜色 hex 而非索引识别自发光,重排调色板不脆断)。
// 首个资产:豪华体素吊灯(chandelier-deluxe.vox)。几何规格共享自 src/voxel/chandelierSpec.js。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDense, writeVox, setPaletteColor } from '../src/voxel/vox.js';
import { P, shade } from '../src/assets/palette.js';
import { CHAND } from '../src/voxel/chandelierSpec.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/vox');

// ---- 调色板注册(索引从 1 递增;同 hex 去重) ----
function makePalette() {
  const pal = new Uint8Array(1024);
  const byHex = new Map();
  let next = 1;
  const reg = (hex) => {
    const h = hex.toLowerCase();
    if (byHex.has(h)) return byHex.get(h);
    if (next > 255) throw new Error('调色板满 255');
    setPaletteColor(pal, next, h);
    byHex.set(h, next);
    return next++;
  };
  return { pal, reg };
}

// 确定性 PRNG(禁 Math.random,资产可复现)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 体素画笔(y-up 世界单位口径;内部换算体素格) ----
class Painter {
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
const d8 = (x, z) => Math.max(Math.abs(x), Math.abs(z), (Math.abs(x) + Math.abs(z)) / Math.SQRT2);

// ================= 豪华吊灯 =================
function genChandelierDeluxe() {
  const S = CHAND.scale;
  const dense = makeDense(CHAND.grid.sx, CHAND.grid.sy, CHAND.grid.sz);
  const p = new Painter(dense, S);
  const { pal, reg } = makePalette();
  const rnd = mulberry32(20260713);

  // 颜色(全部派生自 palette.js)
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  const woodHi = reg(P.wood300);
  const brass = reg(P.brass);
  const brassHi = reg(P.brassHi);
  const brassDim = reg(shade(P.brass, -18));
  const wax = reg(P.parchment);
  const waxDrip = reg(shade(P.parchment, -8));
  const wick = reg(P.wood900);
  const ember = reg(P.ember);          // 琥珀吊坠=自发光

  // MATL 材质标注(P0-2):生成资产与 MagicaVoxel 手修资产走同一条运行时路径——
  // 发光/金属由 MATL 承载(hex 匹配仅作旧文件回退),手修时改材质面板即生效。
  const materials = {
    [ember]: { _type: '_emit', _emit: '1', _flux: '1' },
    [brass]: { _type: '_metal', _metal: '0.7', _rough: '0.35' },
    [brassHi]: { _type: '_metal', _metal: '0.7', _rough: '0.25' },
    [brassDim]: { _type: '_metal', _metal: '0.7', _rough: '0.45' },
  };

  const R = CHAND.rim.faceR, TH = CHAND.rim.th, Y0 = CHAND.rim.y0, H = CHAND.rim.h;
  const yTop = Y0 + H;

  // ---- 八角木轮圈:雕花剖面(顶缘高光倒角/中腰凹槽/底缘描影) + 分段板色抖动 ----
  const sectorTone = Array.from({ length: 8 }, () => [wood, woodLit, woodDim][Math.floor(rnd() * 3)]);
  p.scan(-(R + 0.02), R + 0.02, Y0, yTop, -(R + 0.02), R + 0.02, (x, y, z) => {
    const d = d8(x, z);
    if (d > R || d < R - TH) return 0;
    const sector = Math.floor(((Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    const rimT = (y - Y0) / H;              // 0 底 1 顶
    const edgeOut = d > R - 0.03, edgeIn = d < R - TH + 0.03;
    if (rimT > 0.85 && (edgeOut || edgeIn)) return woodHi;        // 顶缘倒角高光
    if (rimT < 0.15) return woodLine;                             // 底缘描影
    if (rimT > 0.4 && rimT < 0.6 && edgeOut) return woodDark;     // 中腰凹槽线
    return sectorTone[sector];
  });
  // 底部黄铜箍带
  p.scan(-R, R, Y0 - 0.03, Y0, -R, R, (x, y, z) => {
    const d = d8(x, z);
    return d <= R - 0.015 && d >= R - TH + 0.015 ? brass : 0;
  });
  // 外缘铆钉(brassHi,每边 3 颗)
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2;
    for (const f of [-0.28, 0, 0.28]) {
      const a = a0 + f * (Math.PI / 4);
      const dist = R / d8(Math.cos(a), Math.sin(a)) + 0.008;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      p.box(x - 0.012, x + 0.012, Y0 + H / 2 - 0.012, Y0 + H / 2 + 0.012, z - 0.012, z + 0.012, brassHi);
    }
  }

  // ---- 内圈黄铜环 + 四辐板(中心留空:掷币通道) ----
  const IN = CHAND.inner;
  p.cylinderY(0, 0, IN.y0, IN.y0 + IN.h, IN.r + IN.band / 2, brass, IN.r - IN.band / 2);
  p.cylinderY(0, 0, IN.y0 + IN.h - 0.015, IN.y0 + IN.h, IN.r + IN.band / 2, brassHi, IN.r - IN.band / 2); // 环顶高光
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const ux = Math.cos(a), uz = Math.sin(a);
    p.scan(
      Math.min(ux * CHAND.spokes.from, ux * CHAND.spokes.to) - 0.06, Math.max(ux * CHAND.spokes.from, ux * CHAND.spokes.to) + 0.06,
      CHAND.spokes.y0, CHAND.spokes.y0 + CHAND.spokes.h,
      Math.min(uz * CHAND.spokes.from, uz * CHAND.spokes.to) - 0.06, Math.max(uz * CHAND.spokes.from, uz * CHAND.spokes.to) + 0.06,
      (x, y, z) => {
        const along = x * ux + z * uz;
        const across = Math.abs(-x * uz + z * ux);
        if (along < CHAND.spokes.from || along > CHAND.spokes.to || across > CHAND.spokes.halfW) return 0;
        const t = (y - CHAND.spokes.y0) / CHAND.spokes.h;
        return t > 0.7 ? woodHi : (t < 0.2 ? woodLine : woodDark);
      },
    );
  }

  // ---- 蜡烛(外 8 + 内 4):黄铜托盘 + 蜡柱 + 蜡泪 + 烛芯 ----
  const candle = (a, r, spec, baseY) => {
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    p.cylinderY(cx, cz, baseY, baseY + 0.03, spec.trayR, brass);
    p.cylinderY(cx, cz, baseY + 0.025, baseY + 0.03, spec.trayR, brassHi, spec.trayR - 0.02); // 盘缘高光
    const h = spec.h * (0.9 + rnd() * 0.2);   // 蜡柱高度微差(烧损感)
    p.cylinderY(cx, cz, baseY + 0.03, baseY + 0.03 + h, spec.r, wax);
    // 蜡泪:2~3 条沿盘边下淌
    const drips = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < drips; i++) {
      const da = rnd() * Math.PI * 2;
      const dx = cx + Math.cos(da) * spec.r * 0.9, dz = cz + Math.sin(da) * spec.r * 0.9;
      p.box(dx - 0.012, dx + 0.012, baseY + 0.03 + h * 0.4, baseY + 0.03 + h * (0.75 + rnd() * 0.2), dz - 0.012, dz + 0.012, waxDrip);
    }
    p.box(cx - 0.008, cx + 0.008, baseY + 0.03 + h, baseY + 0.03 + h + 0.02, cz - 0.008, cz + 0.008, wick);
  };
  for (const a of CHAND.outerCandles) candle(a, CHAND.outerCandleR, CHAND.outerWax, yTop);
  for (const a of CHAND.innerCandles) candle(a, CHAND.innerCandleR, CHAND.innerWax, IN.y0 + IN.h);

  // ---- 琥珀吊坠 ×8(自发光):双环短链 + 铜帽 + 八面体宝石 ----
  for (const a of CHAND.gems) {
    const gx = Math.cos(a) * CHAND.gemR, gz = Math.sin(a) * CHAND.gemR;
    p.torus({ x: gx, y: Y0 - 0.035, z: gz }, { x: Math.cos(a + Math.PI / 2), y: 0, z: Math.sin(a + Math.PI / 2) }, 0.028, 0.011, brassDim);
    p.torus({ x: gx, y: Y0 - 0.085, z: gz }, { x: Math.cos(a), y: 0, z: Math.sin(a) }, 0.028, 0.011, brassDim);
    p.cylinderY(gx, gz, Y0 - 0.135, Y0 - 0.105, 0.028, brass);
    p.octahedron(gx, Y0 - 0.20, gz, 0.062, ember);
    p.cylinderY(gx, gz, Y0 - 0.15, Y0 - 0.135, 0.014, brassHi); // 帽顶亮点
  }

  // ---- 3 条真链环链条:轮面 → 铜冠(链环逐个交替朝向) ----
  for (const a of CHAND.chains) {
    const ax = Math.cos(a) * CHAND.chainAttachR, az = Math.sin(a) * CHAND.chainAttachR;
    // 轮面铜扣
    p.box(ax - 0.05, ax + 0.05, yTop, yTop + 0.04, az - 0.05, az + 0.05, brass);
    const from = { x: ax, y: yTop + 0.05, z: az };
    const to = { x: 0, y: CHAND.knotY - 0.06, z: 0 };
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const n = Math.max(2, Math.round(len / 0.075));       // 链环间距 ~0.075
    const dir = { x: (to.x - from.x) / len, y: (to.y - from.y) / len, z: (to.z - from.z) / len };
    // 两个与链向垂直的基向量:水平向 + 叉积向,链环交替用
    const hx = -Math.sin(a), hz = Math.cos(a);
    const c2 = {
      x: dir.y * hz - dir.z * 0 - 0, // dir × h(h=(hx,0,hz))
      y: dir.z * hx - dir.x * hz,
      z: dir.x * 0 - dir.y * hx,
    };
    const c2l = Math.hypot(c2.x, c2.y, c2.z) || 1;
    c2.x /= c2l; c2.y /= c2l; c2.z /= c2l;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const c = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
      const normal = i % 2 === 0 ? { x: hx, y: 0, z: hz } : c2;
      p.torus(c, normal, 0.030, 0.012, i % 2 === 0 ? brass : brassDim);
    }
  }

  // ---- 顶部铜冠(挂点):锥台 + 高光箍 + 竖吊环 ----
  p.cylinderY(0, 0, CHAND.knotY - 0.06, CHAND.knotY + 0.02, 0.075, brass);
  p.cylinderY(0, 0, CHAND.knotY + 0.02, CHAND.knotY + 0.06, 0.052, brass);
  p.cylinderY(0, 0, CHAND.knotY - 0.005, CHAND.knotY + 0.02, 0.082, brassHi); // 冠腰高光箍
  p.torus({ x: 0, y: CHAND.knotY + 0.10, z: 0 }, { x: 1, y: 0, z: 0 }, 0.045, 0.014, brassHi); // 吊环(竖向)

  return { dense, pal, materials };
}

// ================= 出盘 =================
mkdirSync(OUT_DIR, { recursive: true });
const assets = [
  ['chandelier-deluxe.vox', genChandelierDeluxe],
];
for (const [name, gen] of assets) {
  const { dense, pal, materials } = gen();
  let count = 0;
  for (let i = 0; i < dense.data.length; i++) if (dense.data[i]) count++;
  const buf = writeVox(dense, pal, materials);
  writeFileSync(join(OUT_DIR, name), Buffer.from(buf));
  console.log(`✓ ${name}: ${dense.sx}×${dense.sy}×${dense.sz} 格,${count.toLocaleString()} 实心体素,${(buf.byteLength / 1024).toFixed(1)} KB`);
}
