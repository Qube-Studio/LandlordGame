// 程序化体素资产生成器(docs/VOXEL_PLAN.md P0「程序化打底」轨):
//   node client/tools/voxgen.mjs        → 生成全部资产到 client/src/assets/vox/
// 颜色一律取自 palette.js(单一真源);写出的 .vox 自带调色板,可直接进 MagicaVoxel 手工精修
// (手修后放回原路径即生效——运行时按颜色 hex 而非索引识别自发光,重排调色板不脆断)。
// 公共画笔/调色板/PRNG 在 voxkit.mjs;.vox 读写(含 MATL 材质、>256 多模型分块)在 src/voxel/vox.js。
//
// 素材批次(VOXEL_PLAN 附录 C):props/ 子目录存带 MATL 材质(反射/发光/透明)的正式素材。
// 批次尺度 PROP_S=0.036(粗体素,用户 2026-07-16 拍板:家具精度降下来,细节放进
// 纹理/材质/色彩而不是形状——木纹条纹/铜色点缀/蜡泪都是染色,不做亚格凸起)。
// 0.036 的由来:最长件 8.6 长桌含框 9.0m,9.0/0.036=250 ≤ 256——全批**单模型**,
// 旧的单模型解析器也能整只读出(3cm 时长桌 300 格仍会被切块)。
// 根目录 chandelier-deluxe.vox 是 voxlab 在用资产(1.5cm 老尺度),保持无材质字节不变。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDense, writeVox } from '../src/voxel/vox.js';
import { P, shade, PROP_COLORS } from '../src/assets/palette.js';
import { CHAND, TIERED } from '../src/voxel/chandelierSpec.js';
import { CROWN, WHEAT } from '../src/scene/coinArt.js';
import { PROP_VOXEL_SIZE as PROP_S, WALL_SEG, BEAM_SEG } from '../src/voxel/propsSpec.js';
import { MAT, makePalette, mulberry32, hash2, Painter, d8, hollow } from './voxkit.mjs';
import { charAssets } from './voxchars.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/vox');

// 木纹条纹:沿 along 方向 5 格一段的哈希条纹(细节进色彩不进形状)。0 本色 / 1 提亮 / 2 压暗
const streak = (along, across) => {
  const s = hash2(Math.floor(along / 5), across);
  return s > 0.86 ? 1 : s < 0.14 ? 2 : 0;
};

// ================= 豪华吊灯(legacy,1.5cm——voxlab 在用,输出与历史文件逐字节一致) =================
function genChandelierLegacy() {
  const S = CHAND.scale;
  const dense = makeDense(CHAND.grid.sx, CHAND.grid.sy, CHAND.grid.sz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
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
  const ember = reg(P.ember);          // 琥珀吊坠=自发光(运行时按此 hex 拆 emissive 子网格)

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

  return { dense, pal, mats };
}

// ================= 豪华吊灯(props,3cm 粗体素):形只留大形,细节全在色 =================
// 与 legacy 同一套世界几何(CHAND 规格),但亚 3cm 的凸起一律取消:铆钉/蜡泪=染色,
// 链环=方块链节交替双色,吊环=方框。木纹=竖向哈希条纹。
function genChandelierProps() {
  const S = PROP_S;
  const dense = makeDense(76, 66, 76);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const rnd = mulberry32(20260713);

  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  const woodHi = reg(P.wood300);
  const brass = reg(P.brass, MAT.metal({ metal: 0.8, rough: 0.3 }));
  const brassHi = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));
  const brassDim = reg(shade(P.brass, -18), MAT.metal({ metal: 0.75, rough: 0.4 }));
  const wax = reg(P.parchment);
  const waxDrip = reg(shade(P.parchment, -8));
  const wick = reg(P.wood900);
  const ember = reg(P.ember, MAT.emit({ emit: 0.9, flux: 2 }));

  const R = CHAND.rim.faceR, TH = CHAND.rim.th, Y0 = CHAND.rim.y0, H = CHAND.rim.h;
  const yTop = Y0 + H;

  // ---- 八角木轮圈:剖面色带 + 分段板色 + 竖向木纹条纹(全是色,零凸起) ----
  const sectorTone = Array.from({ length: 8 }, () => [wood, woodLit, woodDim][Math.floor(rnd() * 3)]);
  p.scan(-(R + 0.02), R + 0.02, Y0, yTop, -(R + 0.02), R + 0.02, (x, y, z) => {
    const d = d8(x, z);
    if (d > R || d < R - TH) return 0;
    const sector = Math.floor(((Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    const rimT = (y - Y0) / H;
    const edgeOut = d > R - S, edgeIn = d < R - TH + S;
    if (rimT > 0.8 && (edgeOut || edgeIn)) return woodHi;
    if (rimT < 0.18) return woodLine;
    if (rimT > 0.4 && rimT < 0.62 && edgeOut) return woodDark;      // 中腰凹槽=描色
    const g = hash2(Math.round(x / S), Math.round(z / S));           // 竖向木纹
    return g > 0.88 ? woodLit : g < 0.12 ? woodDim : sectorTone[sector];
  });
  // 底部黄铜箍带
  p.scan(-R, R, Y0 - 0.03, Y0, -R, R, (x, y, z) => {
    const d = d8(x, z);
    return d <= R - 0.015 && d >= R - TH + 0.015 ? brass : 0;
  });
  // 铆钉=染在轮圈表面的亮铜点(不再凸出)
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2;
    for (const f of [-0.28, 0, 0.28]) {
      const a = a0 + f * (Math.PI / 4);
      const dist = R / d8(Math.cos(a), Math.sin(a)) - 0.012;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      p.box(x - 0.016, x + 0.016, Y0 + H / 2 - 0.016, Y0 + H / 2 + 0.016, z - 0.016, z + 0.016, brassHi);
    }
  }

  // ---- 内圈黄铜环(顶层亮) + 四辐板 ----
  const IN = CHAND.inner;
  p.cylinderY(0, 0, IN.y0, IN.y0 + IN.h, IN.r + IN.band / 2, brass, IN.r - IN.band / 2);
  p.cylinderY(0, 0, IN.y0 + IN.h - S, IN.y0 + IN.h, IN.r + IN.band / 2, brassHi, IN.r - IN.band / 2);
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
        const st = streak(Math.round(along / S), k * 17);            // 沿辐板木纹
        return st === 1 ? woodHi : st === 2 ? woodLine : woodDark;
      },
    );
  }

  // ---- 蜡烛(外 8 + 内 4):托盘 + 蜡柱(蜡泪=角向色带) + 烛芯 ----
  const candle = (a, r, spec, baseY, k) => {
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    p.cylinderY(cx, cz, baseY, baseY + 0.03, spec.trayR, brass);
    const h = spec.h * (0.9 + rnd() * 0.2);
    p.scan(cx - spec.r - S, cx + spec.r + S, baseY + 0.03, baseY + 0.03 + h, cz - spec.r - S, cz + spec.r + S, (x, y, z) => {
      if (Math.hypot(x - cx, z - cz) > spec.r + 0.012) return 0;
      const da = Math.atan2(z - cz, x - cx);
      const drip = hash2(Math.floor((da + Math.PI) / 0.8), k * 13 + 7);
      return drip < 0.35 && y < baseY + 0.03 + h * 0.66 ? waxDrip : wax; // 蜡泪=染色竖带
    });
    p.box(cx - 0.012, cx + 0.012, baseY + 0.03 + h, baseY + 0.03 + h + 0.03, cz - 0.012, cz + 0.012, wick);
  };
  CHAND.outerCandles.forEach((a, k) => candle(a, CHAND.outerCandleR, CHAND.outerWax, yTop, k));
  CHAND.innerCandles.forEach((a, k) => candle(a, CHAND.innerCandleR, CHAND.innerWax, IN.y0 + IN.h, k + 8));

  // ---- 琥珀吊坠 ×8(自发光):短杆 + 铜帽 + 八面体宝石(稍放大保可读) ----
  for (const a of CHAND.gems) {
    const gx = Math.cos(a) * CHAND.gemR, gz = Math.sin(a) * CHAND.gemR;
    p.box(gx - 0.015, gx + 0.015, Y0 - 0.105, Y0, gz - 0.015, gz + 0.015, brassDim);
    p.cylinderY(gx, gz, Y0 - 0.14, Y0 - 0.105, 0.032, brass);
    p.octahedron(gx, Y0 - 0.21, gz, 0.075, ember);
  }

  // ---- 3 条链:方块链节交替双色(几何=直杆,链感来自色) ----
  for (const a of CHAND.chains) {
    const ax = Math.cos(a) * CHAND.chainAttachR, az = Math.sin(a) * CHAND.chainAttachR;
    p.box(ax - 0.06, ax + 0.06, yTop, yTop + 0.05, az - 0.06, az + 0.06, brass); // 轮面铜扣
    const from = { x: ax, y: yTop + 0.05, z: az };
    const to = { x: 0, y: CHAND.knotY - 0.06, z: 0 };
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const n = Math.max(2, Math.round(len / 0.07));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cx = from.x + (to.x - from.x) * t, cy = from.y + (to.y - from.y) * t, cz = from.z + (to.z - from.z) * t;
      p.box(cx - 0.04, cx + 0.04, cy - 0.04, cy + 0.04, cz - 0.04, cz + 0.04, i % 2 === 0 ? brass : brassDim); // ±0.04:链节间距 0.07,粗格下保连续
    }
  }

  // ---- 顶部铜冠 + 方框吊环 ----
  p.cylinderY(0, 0, CHAND.knotY - 0.06, CHAND.knotY + 0.02, 0.075, brass);
  p.cylinderY(0, 0, CHAND.knotY + 0.02, CHAND.knotY + 0.06, 0.052, brassHi);
  const hy = CHAND.knotY + 0.06;
  p.box(-0.015, 0.015, hy, hy + 0.15, -0.075, -0.045, brassHi);
  p.box(-0.015, 0.015, hy, hy + 0.15, 0.045, 0.075, brassHi);
  p.box(-0.015, 0.015, hy + 0.12, hy + 0.15, -0.045, 0.045, brassHi);

  return { dense, pal, mats };
}

// ================= 双层圆盘吊灯(2026-07-16 新款,规格=chandelierSpec.TIERED) =================
// 双层黄铜圆盘(车削环纹/抛光缘带/铆钉/外缘凸唇=金属质感全走色)+ 末地烛式自发光灯柱
// (ink 暖白,无火苗面片)+ 下盘底缘水晶吊坠(specGlass 玻璃 MATL)+ 铜冠斜撑两级悬吊。
// 中孔过币(§5-5);盘面细节只用环带/圆点,不撒逐体素噪点(逐体素噪点毁贪心合并,前车之鉴)。
function genChandelierTiered() {
  const S = PROP_S;
  const T = TIERED;
  const dense = makeDense(T.grid.sx, T.grid.sy, T.grid.sz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();

  const brass = reg(P.brass, MAT.metal({ metal: 0.8, rough: 0.3 }));
  const brassHi = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));
  const brassDim = reg(shade(P.brass, -18), MAT.metal({ metal: 0.75, rough: 0.4 }));
  const rodGlow = reg(P.ink, MAT.emit({ emit: 1, flux: 3 }));      // 末地烛柱(运行时按此 hex 拆 emissive)
  const crys = reg(PROP_COLORS.specGlass, MAT.glass({ alpha: 0.4 }));
  const crysHi = reg(shade(PROP_COLORS.specGlass, 15), MAT.glass({ alpha: 0.4 }));
  const crysDk = reg(shade(PROP_COLORS.specGlass, -22), MAT.glass({ alpha: 0.4 }));

  // ---- 圆盘(环形板 + 外缘凸唇):盘底压暗/外缘抛光带/内缘描暗/车削环纹 ----
  const plate = ({ rOut, rIn, y, th, lipH }) => {
    p.scan(-rOut, rOut, y, y + th, -rOut, rOut, (x, yy, z) => {
      const d = Math.hypot(x, z);
      if (d > rOut || d < rIn) return 0;
      if (yy < y + 0.03) return brassDim;
      if (d > rOut - 0.08) return brassHi;
      if (d < rIn + 0.06) return brassDim;
      if (((d - rIn) % 0.14) < 0.035) return brassDim;
      return brass;
    });
    p.scan(-rOut, rOut, y + th, y + th + lipH, -rOut, rOut, (x, yy, z) => {
      const d = Math.hypot(x, z);
      return d <= rOut && d >= rOut - 0.06 ? brassHi : 0;
    });
  };
  plate(T.lower);
  plate(T.upper);
  // 下盘铆钉一圈(表面染色,不凸起)
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
    const x = Math.cos(a) * 1.18, z = Math.sin(a) * 1.18;
    const yTopFace = T.lower.y + T.lower.th;
    p.box(x - 0.022, x + 0.022, yTopFace - 0.025, yTopFace, z - 0.022, z + 0.022, brassHi);
  }

  // ---- 末地烛灯柱:底座钮(brassDim) + 自发光柱 ----
  const endRod = (a, r, baseY) => {
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    p.box(cx - T.rod.knob, cx + T.rod.knob, baseY, baseY + T.rod.knobH, cz - T.rod.knob, cz + T.rod.knob, brassDim);
    p.cylinderY(cx, cz, baseY + T.rod.knobH, baseY + T.rod.knobH + T.rod.h, T.rod.r, rodGlow);
  };
  for (const a of T.rodsLower) endRod(a, T.rodLowerR, T.lower.y + T.lower.th);
  for (const a of T.rodsUpper) endRod(a, T.rodUpperR, T.upper.y + T.upper.th);

  // ---- 水晶吊坠:短链环(brassDim) + 八面体水晶(上半亮/下半暗的切面感) ----
  T.crystals.forEach((a, k) => {
    const cx = Math.cos(a) * T.crystalR, cz = Math.sin(a) * T.crystalR;
    p.box(cx - 0.015, cx + 0.015, 0.22, T.lower.y, cz - 0.015, cz + 0.015, brassDim);
    const r = k % 2 ? 0.05 : 0.068;
    const cy = 0.15;
    p.scan(cx - r, cx + r, cy - r, cy + r, cz - r, cz + r, (x, y, z) => {
      if (Math.abs(x - cx) + Math.abs(y - cy) + Math.abs(z - cz) > r) return 0;
      return y - cy > r * 0.25 ? crysHi : (cy - y > r * 0.25 ? crysDk : crys);
    });
  });

  // ---- 斜撑杆(铜冠→上盘 ×4,上盘→下盘 ×4;端头亮铜) ----
  const strut = (x0, y0, z0, x1, y1, z1) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(2, Math.round(len / 0.045));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
      p.box(x - 0.033, x + 0.033, y - 0.033, y + 0.033, z - 0.033, z + 0.033, i === 0 || i === n ? brassHi : brass);
    }
  };
  for (const a of T.strutsTop) {
    strut(Math.cos(a) * 0.10, 1.96, Math.sin(a) * 0.10, Math.cos(a) * 0.66, T.upper.y + T.upper.th, Math.sin(a) * 0.66);
  }
  for (const a of T.strutsMid) {
    strut(Math.cos(a) * 0.72, T.upper.y, Math.sin(a) * 0.72, Math.cos(a) * 1.10, T.lower.y + T.lower.th, Math.sin(a) * 1.10);
  }

  // ---- 铜冠 + 方框吊环(顶=TIERED.hoopTop,吊杆从这里接走) ----
  p.cylinderY(0, 0, 1.94, 2.02, 0.075, brass);
  p.cylinderY(0, 0, 2.02, T.knotY, 0.052, brassHi);
  p.box(-0.015, 0.015, T.knotY, T.hoopTop, -0.075, -0.045, brassHi);
  p.box(-0.015, 0.015, T.knotY, T.hoopTop, 0.045, 0.075, brassHi);
  p.box(-0.015, 0.015, T.hoopTop - 0.03, T.hoopTop, -0.045, 0.045, brassHi);

  hollow(dense);
  return { dense, pal, mats };
}

// ================= 赌桌(Scene3D#Table 同尺寸;§5-2 桌顶=1.0,§5-3 下注圈留贴花不烘) =================
// 世界几何与 Scene3D.jsx Table 严格对齐:毡板 w×d 顶面 y=1.0、木框 (w+.4)×.34 @0.61~0.95、
// 黄铜嵌线 0.06×0.03 @0.937~0.967(金属反射)、四腿 0.32² 0~0.70、双横撑。
// 3cm 尺度下 8.6 长桌也是单模型;板材分色/木纹/毡面斑驳全走色彩。
function genTable(w, d) {
  const S = PROP_S;
  const even = (n) => n + (n & 1);
  const halfX = w / 2 + 0.2, halfZ = d / 2 + 0.2;
  const dense = makeDense(even(Math.ceil((halfX * 2) / S) + 2), even(Math.ceil(1.0 / S) + 2), even(Math.ceil((halfZ * 2) / S) + 2));
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();

  const felt = reg(P.feltTable);
  const feltDark = reg(shade(P.feltTable, -12));
  const feltLight = reg(shade(P.feltTable, 7));
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodHi = reg(P.wood300);
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  const brass = reg(P.brass, MAT.metal({ metal: 0.8, rough: 0.3 }));
  const brassHi = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));

  // ---- 四腿(0~0.70,0.32 见方):踢脚描影 + 竖向木纹 ----
  for (const [lx, lz] of [[-(w / 2 - 0.1), -(d / 2 - 0.1)], [w / 2 - 0.1, -(d / 2 - 0.1)], [-(w / 2 - 0.1), d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]]) {
    p.scan(lx - 0.16, lx + 0.16, 0, 0.70, lz - 0.16, lz + 0.16, (x, y) => {
      if (y < 0.045) return woodLine;
      const st = streak(Math.round(y / S), Math.round((x + lz * 3) / S));
      return st === 1 ? woodDim : st === 2 ? woodLine : woodDark;
    });
  }
  // ---- 双横撑(y 0.17~0.27) ----
  for (const zz of [-(d / 2 - 0.1), d / 2 - 0.1]) p.box(-(w / 2 - 0.1), w / 2 - 0.1, 0.17, 0.27, zz - 0.07, zz + 0.07, woodDark);

  // ---- 木框(0.61~0.95):板材分色 + 沿长边木纹 + 顶缘倒角高光/中腰凹槽/底缘描影(全为色带) ----
  p.scan(-halfX, halfX, 0.61, 0.95, -halfZ, halfZ, (x, y, z) => {
    const t = (y - 0.61) / 0.34;
    const onOuter = Math.min(halfX - Math.abs(x), halfZ - Math.abs(z)) < S;
    if (t > 0.86 && onOuter) return woodHi;
    if (t < 0.14) return woodLine;
    if (t > 0.42 && t < 0.6 && onOuter) return woodDark;
    const plank = Math.floor((x + halfX) / 0.55);
    if (t > 0.92 && ((x + halfX) % 0.55) < S && plank > 0) return woodLine;   // 顶面板缝
    const base = [wood, woodLit, woodDim][Math.floor(hash2(plank, Math.sign(z)) * 3)];
    const st = streak(Math.round(x / S), Math.round(y / S) * 31 + Math.round(z / S)); // 沿 x 木纹
    return st === 1 ? woodLit : st === 2 ? woodDim : base;
  });

  // ---- 毡板(0.88~1.00,w×d,后画覆盖框内区):台面斑驳 + 内圈与侧沿压暗 ----
  p.scan(-w / 2, w / 2, 0.88, 1.0, -d / 2, d / 2, (x, y, z) => {
    const edge = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
    if (edge < S) return feltDark;                       // 侧沿(0.95~1.0 露在框上方)
    if (y > 0.99) {                                      // 台面层(仅最顶层)
      if (edge < 0.12) return feltDark;                  // 内圈描边
      const mo = hash2(Math.floor((x + halfX) / 0.09), Math.floor((z + halfZ) / 0.09));
      return mo < 0.08 ? feltLight : (mo > 0.92 ? feltDark : felt);
    }
    return felt;
  });

  // ---- 黄铜嵌线(0.937~0.967,金属反射,2 格宽 1+1 层):环毡一圈,顶层亮 ----
  const trim = (x0, x1, z0, z1) => p.scan(x0, x1, 0.937, 0.967, z0, z1, (x, y) => (y > 0.955 ? brassHi : brass));
  trim(-(w / 2 + 0.09), w / 2 + 0.09, -(d / 2 + 0.09), -(d / 2 + 0.03));
  trim(-(w / 2 + 0.09), w / 2 + 0.09, d / 2 + 0.03, d / 2 + 0.09);
  trim(-(w / 2 + 0.09), -(w / 2 + 0.03), -(d / 2 + 0.03), d / 2 + 0.03);
  trim(w / 2 + 0.03, w / 2 + 0.09, -(d / 2 + 0.03), d / 2 + 0.03);

  hollow(dense); // 毡板/框/腿都是实心大体,只留壳
  return { dense, pal, mats };
}

// ================= 靠背椅(Scene3D#Chair 同尺寸) =================
// 坐面 0.52²@0.42~0.50、四腿 0.08²、靠背绕 x 后仰 0.1rad(枢轴 0,0.42,-0.235):
// 立柱 ±0.22 + 三横板;板缝/木纹/柱顶高光=色带,黄铜圆钉=染在横板表面的亮铜点(金属反射)。
function genChair() {
  const S = PROP_S;
  const dense = makeDense(16, 40, 24);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();

  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodHi = reg(P.wood300);
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  const brassHi = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));

  // ---- 坐面(0.42~0.50):三条板分色 + 板缝线 + 顶缘高光 + 沿 x 木纹 ----
  p.scan(-0.26, 0.26, 0.42, 0.50, -0.26, 0.26, (x, y, z) => {
    if (y > 0.47) {
      const plank = Math.floor((z + 0.26) / 0.18);
      if (plank > 0 && ((z + 0.26) % 0.18) < S) return woodLine;
      if (Math.min(0.26 - Math.abs(x), 0.26 - Math.abs(z)) < S) return woodHi;
      const st = streak(Math.round(x / S), plank * 7);
      return st === 1 ? woodLit : st === 2 ? woodDim : [wood, woodLit, woodDim][plank % 3];
    }
    return y < 0.435 ? woodLine : wood;
  });
  // ---- 四腿(0~0.42) ----
  for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    p.scan(lx - 0.04, lx + 0.04, 0, 0.42, lz - 0.04, lz + 0.04, (x, y) => (y < 0.045 ? woodLine : woodDark));
  }
  // ---- 靠背(后仰 0.1rad):世界点逆旋回局部系测试立柱/横板 ----
  const c = Math.cos(0.1), s = Math.sin(0.1);
  p.scan(-0.27, 0.27, 0.40, 1.42, -0.40, -0.12, (x, y, z) => {
    const ry = y - 0.42, rz = z + 0.235;
    const ly = ry * c - rz * s, lz = ry * s + rz * c;
    if (Math.abs(Math.abs(x) - 0.22) <= 0.04 && ly >= 0 && ly <= 0.98 && Math.abs(lz) <= 0.035) {
      if (ly > 0.94) return woodHi;                       // 柱顶高光
      const st = streak(Math.round(ly / S), Math.round(x / S) * 3);
      return st === 1 ? woodLit : st === 2 ? woodDim : wood;
    }
    for (const [hy, tone] of [[0.34, wood], [0.62, woodLit], [0.9, wood]]) {
      if (Math.abs(x) <= 0.25 && Math.abs(ly - hy) <= 0.06 && Math.abs(lz) <= 0.025) {
        if (ly - hy > 0.045) return woodHi;
        if (hy - ly > 0.045) return woodLine;
        const st = streak(Math.round(x / S), Math.round(hy * 100));
        return st === 1 ? woodLit : st === 2 ? woodDim : tone;
      }
    }
    return 0;
  });
  // ---- 黄铜圆钉:染在横板前脸表面的亮铜体素(不凸起;局部→世界同一旋转) ----
  for (const hy of [0.34, 0.62, 0.9]) {
    for (const px of [-0.22, 0.22]) {
      const lz0 = 0.02;
      const wy = 0.42 + hy * c + lz0 * s;
      const wz = -0.235 - hy * s + lz0 * c;
      p.box(px - 0.016, px + 0.016, wy - 0.016, wy + 0.016, wz - 0.016, wz + 0.016, brassHi);
    }
  }

  hollow(dense);
  return { dense, pal, mats };
}

// ================= 墙段·下(石墙裙 6×4m,厚 0.216;酒馆现有烘焙墙的石裙材质做成真石材) =================
// 错缝砌块 0.8×0.4 + 勾缝 + 逐块色调抖动 + 石面麻点 + 压顶亮带——全为色,零凸起。
// 图案与厚度方向无关(两面同纹),摆放不分正反;四段拼一面墙(propsSpec.WALL_SEG)。
function genWallLower() {
  const S = PROP_S;
  const dense = makeDense(WALL_SEG.w, WALL_SEG.lowerH, WALL_SEG.th);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const stone = reg(P.stone500);
  const stoneDark = reg(P.stone700);
  const stoneLit = reg(P.stone300);
  const mortar = reg(shade(P.stone700, -35));
  const capLine = reg(P.wood900);
  const half = (WALL_SEG.w * S) / 2;
  p.scan(-half, half, 0, WALL_SEG.lowerH * S, -0.11, 0.11, (x, y) => {
    if (y > 3.95) return stoneLit;                       // 压顶石(亮带)
    if (y > 3.87) return capLine;                        // 压顶下阴影线
    if (y < 0.05) return mortar;                         // 底缘
    const row = Math.floor(y / 0.4);
    const u = x + half + (row % 2) * 0.4;                // 错缝
    if ((y % 0.4) < S || (u % 0.8) < S) return mortar;   // 勾缝
    // 石面麻点:3×3 体素块状(⚠勿改回逐体素——4% 孤点把每块砖面剁成 20+ 片,
    // 贪心合并崩掉,16 段墙 10 万四边形,真机实测掉帧;块状后 ~6 倍合并率,观感更"石斑")
    if (hash2(Math.floor(x / (S * 3)), Math.floor(y / (S * 3))) > 0.97) return stoneDark;
    const t = hash2(Math.floor(u / 0.8) * 7 + 1, row * 13);
    return t < 0.22 ? stoneDark : t > 0.78 ? stoneLit : stone;
  });
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 墙段·上(木板墙 6×6m):竖板分色 + 板缝 + 节疤 + 深色木筋柱 =================
function genWallUpper() {
  const S = PROP_S;
  const dense = makeDense(WALL_SEG.w, WALL_SEG.upperH, WALL_SEG.th);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodLine = reg(P.wood900);
  const timber = reg(P.beam);
  const timberLit = reg(shade(P.beam, 30));
  const half = (WALL_SEG.w * S) / 2;
  p.scan(-half, half, 0, WALL_SEG.upperH * S, -0.11, 0.11, (x, y) => {
    if (y > 5.9) return timber;                          // 顶檐带
    if (y < 0.06) return timber;                         // 底带(压住与墙裙的接线)
    for (const px of [-3.02, -1.01, 1.01, 3.02]) {       // 深色木筋柱(段缝也被边柱盖住)
      if (Math.abs(x - px) < 0.08) {
        return streak(Math.round(y / S), Math.round(px * 10)) === 1 ? timberLit : timber;
      }
    }
    const u = x + half;
    const plank = Math.floor(u / 0.42);
    if ((u % 0.42) < S) return woodLine;                 // 板缝
    if (hash2(Math.round(x / S) * 3 + 1, Math.round(y / (2 * S))) > 0.995) return woodLine; // 节疤
    const base = [wood, woodLit, woodDim][Math.floor(hash2(plank, 5) * 3)];
    const st = streak(Math.round(y / S), plank * 11);    // 竖板木纹沿 y
    return st === 1 ? woodLit : st === 2 ? woodDim : base;
  });
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 房梁段(7.992×0.432×0.432,三段拼 24m):木纹 + 棱线描影 + 端部铁箍/铜螺栓 =================
function genBeam() {
  const S = PROP_S;
  const dense = makeDense(BEAM_SEG.len, BEAM_SEG.cs, BEAM_SEG.cs);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const beam = reg(P.beam);
  const beamLit = reg(shade(P.beam, 30));
  const beamDim = reg(shade(P.beam, -30));
  const strap = reg(P.stone700);
  const bolt = reg(shade(P.brass, -18), MAT.metal({ metal: 0.75, rough: 0.4 }));
  const HALF = (BEAM_SEG.len * S) / 2;
  p.scan(-HALF, HALF, 0, BEAM_SEG.cs * S, -0.22, 0.22, (x, y, z) => {
    const fromEnd = HALF - Math.abs(x);
    if (fromEnd > 0.18 && fromEnd < 0.33) return strap;                 // 铁箍带(接缝落在箍上)
    if (Math.abs(z) > 0.17 && (y < 0.03 || y > 0.37)) return beamDim;   // 四条棱线描影
    const st = streak(Math.round(x / S), Math.round(y / S) * 5 + Math.round(z / S));
    return st === 1 ? beamLit : st === 2 ? beamDim : beam;
  });
  // 铁箍上的铜螺栓(两端两侧 + 底面各一颗,金属反射;染在表面)
  for (const ex of [-(HALF - 0.255), HALF - 0.255]) {
    for (const sz of [-1, 1]) p.box(ex - 0.02, ex + 0.02, 0.19, 0.25, sz * 0.16, sz * 0.23, bolt);
    p.box(ex - 0.02, ex + 0.02, 0, 0.04, -0.02, 0.03, bolt);
  }
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 小物件批次(Scene3D Barrels/Decor/Fireplace 同尺寸体素化) =================
// 自发光面片(火苗/月光窗/菜单板/铜币牌)按 §2.2 保留,不进体素;这里只做实体件。

// 酒桶(圆柱微鼓腰 r0.50~0.57,h1.5):桶板角向分色 + 板缝 + 三道铁箍(金属) + 桶盖圈线
function genBarrel() {
  const S = PROP_S;
  const dense = makeDense(34, 42, 34);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodLine = reg(P.wood900);
  const lid = reg(P.wood300);
  const hoop = reg(P.stone700, MAT.metal({ metal: 0.5, rough: 0.5 }));
  p.scan(-0.6, 0.6, 0, 1.5, -0.6, 0.6, (x, y, z) => {
    const r = 0.50 + 0.07 * Math.sin(Math.PI * Math.min(1, Math.max(0, y / 1.5)));
    const d = Math.hypot(x, z);
    if (d > r) return 0;
    for (const hy of [0.18, 0.75, 1.32]) if (Math.abs(y - hy) < 0.05 && d > r - 0.06) return hoop;
    if (y > 1.45 || y < 0.045) {                            // 桶盖/桶底:圈线 + 拼板
      if (d > r - 0.06) return woodLine;
      return ((x + 0.6) % 0.15) < S ? woodLine : [lid, wood][Math.floor((x + 0.6) / 0.15) % 2];
    }
    const a = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
    const stave = Math.floor(a * 12) % 12;
    if ((a * 12) % 1 < 0.1) return woodLine;                // 桶板缝
    const base = [wood, woodLit, woodDim][Math.floor(hash2(stave, 9) * 3)];
    const st = streak(Math.round(y / S), stave * 3);
    return st === 1 ? woodLit : st === 2 ? woodDim : base;
  });
  hollow(dense);
  return { dense, pal, mats };
}

// 板条箱(0.8³ 基准,实例按比例缩放到 0.7~0.9):角柱/框缘提亮 + 横板条分色 + 板缝
function genCrate() {
  const S = PROP_S;
  const dense = makeDense(24, 24, 24);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const crate = reg(P.wood300);
  const crateLit = reg(shade(P.wood300, 12));
  const crateDim = reg(shade(P.wood300, -14));
  const line = reg(P.wood900);
  p.scan(-0.4, 0.4, 0, 0.8, -0.4, 0.4, (x, y, z) => {
    const ex = 0.4 - Math.abs(x), ez = 0.4 - Math.abs(z);
    const edgeY = Math.min(y, 0.8 - y);
    if ((ex < 0.07 && ez < 0.07) || (edgeY < 0.07 && (ex < 0.07 || ez < 0.07))) return crateLit; // 角柱/框缘
    if ((y % 0.19) < S && y > 0.05 && y < 0.75) return line;                                     // 板缝
    const plank = Math.floor(y / 0.19);
    const st = streak(Math.round((x + z) / S), plank * 5);
    if (st === 2) return crateDim;
    return [crate, crateLit, crateDim][Math.floor(hash2(plank, Math.sign(x) * 2 + Math.sign(z)) * 3)];
  });
  hollow(dense);
  return { dense, pal, mats };
}

// 壁炉(Scene3D#Fireplace 同尺寸):石拱砌块 + 炉台木梁 + 陶杯/蜡烛 + 交叉圆木 + 自发光炭床。
// 火焰/烛焰=运行时面片(§2.2);炭床 ember 色(运行时按 hex 拆 emissive 子网格 + MATL 发光)。
function genFireplace() {
  const S = PROP_S;
  const dense = makeDense(88, 64, 64);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const stone = reg(P.stone500);
  const stoneDark = reg(P.stone700);
  const stoneLit = reg(P.stone300);
  const mortar = reg(shade(P.stone700, -35));
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodHi = reg(P.wood300);
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  const soot = reg(shade(P.wood900, -40));
  const clay = reg(P.wood300);
  const wax = reg(P.parchment);
  const emberC = reg(P.ember, MAT.emit({ emit: 0.9, flux: 2 }));

  // 石材质感(柱/楣共用):砌块勾缝 + 逐块色调
  const stoneAt = (x, y, seed) => {
    const row = Math.floor(y / 0.28);
    const u = x + 2 + (row % 2) * 0.3;
    if ((y % 0.28) < S || (u % 0.6) < S) return mortar;
    const t = hash2(Math.floor(u / 0.6) * 5 + seed, row * 11);
    return t < 0.25 ? stoneDark : t > 0.78 ? stoneLit : stone;
  };
  for (const px of [-1.05, 1.05]) p.scan(px - 0.25, px + 0.25, 0, 1.6, -0.25, 0.25, (x, y) => stoneAt(x, y, px > 0 ? 3 : 7)); // 双柱
  p.scan(-1.3, 1.3, 1.54, 1.9, -0.25, 0.25, (x, y) => (Math.abs(x) < 0.14 ? stoneLit : stoneAt(x, y, 5)));  // 拱楣(拱心石提亮)
  for (const px of [-0.62, 0.62]) p.box(px - 0.18, px + 0.18, 1.35, 1.55, -0.23, 0.23, stoneDark);          // 拱角垫块
  p.scan(-1.45, 1.45, 0, 0.1, -0.25, 0.85, (x, y, z) =>                                                     // 炉底石台
    (hash2(Math.round(x / (3 * S)), Math.round(z / (3 * S))) > 0.7 ? stoneDark : stone));
  p.scan(-0.8, 0.8, 0, 1.6, -0.22, 0.02, (x, y) => (y > 1.0 ? soot : woodLine));                            // 炉膛(上部熏黑)
  // 炉台木梁
  p.scan(-1.55, 1.55, 1.9, 2.06, -0.22, 0.34, (x, y, z) => {
    if (y > 2.03) { const st = streak(Math.round(x / S), 2); return st === 1 ? woodHi : st === 2 ? woodDim : wood; }
    if (y < 1.93) return woodLine;
    const st = streak(Math.round(x / S), Math.round(z / S) + 7);
    return st === 1 ? woodLit : st === 2 ? woodDim : wood;
  });
  p.cylinderY(-0.9, 0.06, 2.06, 2.24, 0.075, clay);         // 陶杯
  p.cylinderY(0.85, 0.06, 2.06, 2.24, 0.042, wax);          // 蜡烛(火苗面片=运行时)
  p.box(0.837, 0.863, 2.24, 2.27, 0.047, 0.073, woodLine);  // 烛芯
  // 交叉圆木(水平圆柱,端面年轮提亮)
  const logPaint = (cy, cz, yaw, len, r) => {
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    p.scan(-0.62, 0.62, cy - r - 0.02, cy + r + 0.02, cz - 0.62, cz + 0.62, (x, y, z) => {
      const dy = y - cy, dz0 = z - cz;
      const along = x * ax + dz0 * az;
      if (Math.abs(along) > len / 2) return 0;
      if (Math.hypot(x - along * ax, dy, dz0 - along * az) > r) return 0;
      if (Math.abs(along) > len / 2 - 0.05) return woodHi;
      return streak(Math.round(along / S), 4) === 2 ? woodLine : woodDark;
    });
  };
  logPaint(0.16, 0.08, 0.35, 1.0, 0.09);
  logPaint(0.30, 0.0, -0.4, 0.95, 0.08);
  // 炭床(火苗面片脚下,稀疏自发光块)
  p.scan(-0.45, 0.45, 0.08, 0.16, -0.12, 0.3, (x, y, z) =>
    (hash2(Math.round(x / S), Math.round(z / S)) > 0.45 ? emberC : 0));
  hollow(dense);
  return { dense, pal, mats };
}

// 酒瓶(玻璃透明材质;绿/棕两色变体):鼓身+收肩+细颈,受光棱/背光棱=染色
function genBottle(hex) {
  const S = PROP_S;
  const dense = makeDense(6, 13, 6);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const glass = reg(hex, MAT.glass({ alpha: 0.45 }));
  const glassHi = reg(shade(hex, 30), MAT.glass({ alpha: 0.45 }));
  const glassDk = reg(shade(hex, -25), MAT.glass({ alpha: 0.45 }));
  p.scan(-0.1, 0.1, 0, 0.44, -0.1, 0.1, (x, y, z) => {
    const r = y < 0.26 ? 0.08 : (y < 0.33 ? 0.08 - (y - 0.26) * 0.67 : 0.033);
    if (Math.hypot(x, z) > r) return 0;
    if (x > 0.03 && z > 0.03) return glassHi;
    if (x < -0.03 && z < -0.03) return glassDk;
    return glass;
  });
  return { dense, pal, mats };
}

// 陶杯(带柄):杯口压暗读出开口
function genMug() {
  const S = PROP_S;
  const dense = makeDense(10, 5, 6);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const clay = reg(P.wood300);
  const clayDim = reg(shade(P.wood300, -18));
  const dark = reg(P.wood900);
  p.scan(-0.11, 0.16, 0, 0.16, -0.11, 0.11, (x, y, z) => {
    const d = Math.hypot(x, z);
    if (d <= 0.09) {
      if (y > 0.12 && d < 0.05) return dark;
      return y < 0.03 ? clayDim : clay;
    }
    if (x > 0.08 && x < 0.16 && Math.abs(z) < 0.03 && y > 0.03 && y < 0.13) return clayDim; // 杯柄
    return 0;
  });
  return { dense, pal, mats };
}

// 双层搁板(2.0×0.8,板 y0/0.72 抬 0.04 对齐消费侧):两端竖挡板 + 板面木纹
function genShelf() {
  const S = PROP_S;
  const dense = makeDense(58, 24, 10);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood700);
  const woodLit = reg(shade(P.wood700, 16));
  const woodDim = reg(shade(P.wood700, -18));
  for (const px of [-0.97, 0.97]) {
    p.scan(px - 0.045, px + 0.045, 0, 0.80, -0.17, 0.17, (x, y) =>
      (streak(Math.round(y / S), 3) === 2 ? woodDim : wood));
  }
  for (const by of [0, 0.72]) {
    p.scan(-1.0, 1.0, by, by + 0.08, -0.17, 0.17, (x, y) => {
      if (y > by + 0.05) return streak(Math.round(x / S), Math.round(by * 10)) === 1 ? woodLit : wood;
      return woodDim;
    });
  }
  hollow(dense);
  return { dense, pal, mats };
}

// 门边长凳(座面居中,消费侧回移 z):板面分色 + 四腿
function genBench() {
  const S = PROP_S;
  const dense = makeDense(50, 16, 14);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  p.scan(-0.85, 0.85, 0.43, 0.53, -0.225, 0.225, (x, y, z) => {
    if (y > 0.49) {
      if ((z + 0.225) % 0.15 < S && z > -0.2) return woodLine;
      const st = streak(Math.round(x / S), Math.floor((z + 0.225) / 0.15) * 7);
      return st === 1 ? woodLit : st === 2 ? woodDim : wood;
    }
    return woodDim;
  });
  for (const [lx, lz] of [[-0.7, -0.15], [0.7, -0.15], [-0.7, 0.15], [0.7, 0.15]]) {
    p.scan(lx - 0.045, lx + 0.045, 0, 0.43, lz - 0.045, lz + 0.045, (x, y) => (y < 0.04 ? woodLine : woodDark));
  }
  hollow(dense);
  return { dense, pal, mats };
}

// 酒馆大门(框+竖板门扇+铁铰链+铜把手):把手=金属反射
function genDoor() {
  const S = PROP_S;
  const dense = makeDense(50, 92, 8);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const frame = reg(P.wood700);
  const frameDim = reg(shade(P.wood700, -18));
  const leaf = reg(shade(P.wood700, 8));
  const leafDim = reg(shade(P.wood700, -8));
  const woodLine = reg(P.wood900);
  const handle = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));
  for (const px of [-0.78, 0.78]) {
    p.scan(px - 0.09, px + 0.09, 0, 3.1, -0.12, 0.12, (x, y) =>
      (streak(Math.round(y / S), Math.round(px * 5)) === 2 ? frameDim : frame));
  }
  p.scan(-0.89, 0.89, 3.03, 3.25, -0.12, 0.12, (x) =>
    (streak(Math.round(x / S), 8) === 2 ? frameDim : frame));   // 门楣
  p.scan(-0.7, 0.7, 0.02, 2.98, -0.03, 0.07, (x, y) => {        // 门扇竖板
    const u = x + 0.7;
    if ((u % 0.28) < S && u > 0.05) return woodLine;
    const st = streak(Math.round(y / S), Math.floor(u / 0.28) * 9);
    return st === 2 ? leafDim : leaf;
  });
  for (const hy of [0.7, 2.3]) p.box(-0.67, -0.33, hy - 0.05, hy + 0.05, -0.085, -0.02, woodLine); // 铰链
  p.box(0.455, 0.545, 1.35, 1.55, -0.11, -0.04, handle);        // 铜把手
  hollow(dense);
  return { dense, pal, mats };
}

// 飞镖盘(面朝 +z,消费侧转向墙):木底盘缘 + 同心环色 + 八扇区线 + 铜靶心(金属)
function genDartboard() {
  const S = PROP_S;
  const dense = makeDense(34, 34, 4);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const rim = reg(P.wood500);
  const line = reg(P.wood900);
  const red = reg(P.danger);
  const cream = reg(shade(P.parchment, -12));
  const green = reg(P.ok);
  const bull = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));
  p.scan(-0.58, 0.58, 0, 1.16, -0.08, 0.08, (x, y) => {
    const dy = y - 0.56;
    const d = Math.hypot(x, dy);
    if (d > 0.56) return 0;
    if (d > 0.47) return rim;
    const a = ((Math.atan2(dy, x) + Math.PI) / (Math.PI / 4)) % 1;
    if (a < 0.06 && d > 0.08) return line;
    if (d < 0.05) return bull;
    if (d < 0.13) return red;
    if (d < 0.24) return cream;
    if (d < 0.33) return green;
    if (d < 0.42) return cream;
    return red;
  });
  return { dense, pal, mats };
}

// 墙面烛台(木托 -z 朝墙,底部为锚;蜡烛顶 0.41,火苗面片=运行时):托臂 + 蜡柱 + 烛芯
function genSconce() {
  const S = PROP_S;
  const dense = makeDense(6, 15, 10);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood700);
  const woodDim = reg(shade(P.wood700, -18));
  const wax = reg(P.parchment);
  const wick = reg(P.wood900);
  p.scan(-0.05, 0.05, 0, 0.34, -0.14, -0.02, (x, y) => (y < 0.03 || y > 0.31 ? woodDim : wood)); // 背板
  p.box(-0.04, 0.04, 0.18, 0.24, -0.06, 0.03, wood);                                             // 托臂
  p.cylinderY(0, 0, 0.21, 0.41, 0.042, wax);                                                     // 蜡柱
  p.box(-0.012, 0.012, 0.41, 0.44, -0.012, 0.012, wick);
  return { dense, pal, mats };
}

// 角落小圆桌(顶 r0.75 @0.86,柱+圆底座):台面年轮色环 + 边缘描暗
function genTableRound() {
  const S = PROP_S;
  const dense = makeDense(44, 26, 44);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood500);
  const woodLit = reg(shade(P.wood500, 10));
  const woodDim = reg(shade(P.wood500, -10));
  const woodDark = reg(P.wood700);
  const woodLine = reg(P.wood900);
  p.cylinderY(0, 0, 0, 0.07, 0.34, woodDark);          // 底座
  p.cylinderY(0, 0, 0.07, 0.82, 0.12, woodDark);       // 柱
  p.scan(-0.76, 0.76, 0.82, 0.90, -0.76, 0.76, (x, y, z) => {
    const d = Math.hypot(x, z);
    if (d > 0.75) return 0;
    if (d > 0.69) return woodLine;                     // 边缘
    if (y < 0.86) return woodDim;                      // 台面侧
    if ((d / 0.11) % 1 < 0.22) return woodDim;         // 年轮
    return hash2(Math.floor(d / 0.11), 3) > 0.5 ? woodLit : wood;
  });
  hollow(dense);
  return { dense, pal, mats };
}

// 衣帽钩排(轨条 y0.2 为锚,三只下斜挂钩;消费侧 y=2.1-0.2 挂墙)
function genCoatrack() {
  const S = PROP_S;
  const dense = makeDense(50, 10, 10);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const wood = reg(P.wood700);
  const woodDim = reg(shade(P.wood700, -18));
  const dark = reg(P.wood900);
  p.scan(-0.85, 0.85, 0.15, 0.25, -0.08, 0, (x) =>
    (streak(Math.round(x / S), 6) === 2 ? woodDim : wood));      // 轨条
  for (const px of [-0.6, 0, 0.6]) {
    for (let i = 0; i < 3; i++) {                                // 挂钩:三段下斜台阶
      p.box(px - 0.035, px + 0.035, 0.16 - i * 0.05, 0.22 - i * 0.05, -0.08 - i * 0.05, -0.02 - i * 0.05, dark);
    }
  }
  return { dense, pal, mats };
}

// ================= 硬币(0.015 细档,手部道具尺寸):银质本体 + 正反阴纹彩标 =================
// 用户规格(2026-07-17):本体=正常硬币色(coinSilver 银/镍,**不是金币**)、材质真实、
// 正反两面阴纹地主/农民标且标可彩色。图案点阵与 coinFaceTexture 同源(scene/coinArt.js);
// 阴纹=场面层挖 1 格、露出下层彩珐琅(地主=火漆红王冠+玻璃红宝石,农民=阵营绿麦穗);
// 银本体冷中性 → 红/绿彩标对比更跳。边=reeded 直齿双色 + 顶/底凸缘圈;缘环刻线/内圈描环。
// 仅素材(§4:游戏内硬币不体素化——coinSim 连续旋转约束不变,这是素材库/MagicaVoxel 件)。
function genCoin() {
  const S = 0.015;
  const R = 17.5 * S;                    // 直径 0.525 ≈ 游戏 COIN_R 0.26×2
  const dense = makeDense(36, 6, 36);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const base = PROP_COLORS.coinSilver;   // 银/镍本体(银币反射强,metal 高)
  const silver = reg(base, MAT.metal({ metal: 0.9, rough: 0.24 }));
  const silverLit = reg(shade(base, 12), MAT.metal({ metal: 0.9, rough: 0.15 }));
  const silverDim = reg(shade(base, -20), MAT.metal({ metal: 0.85, rough: 0.32 }));
  const silverDeep = reg(shade(base, -34), MAT.metal({ metal: 0.85, rough: 0.4 }));
  const waxE = [reg(P.wax), reg(shade(P.wax, 25)), reg(shade(P.wax, -20))];          // 王冠珐琅三调
  const grassE = [reg(P.grass), reg(shade(P.grass, 20)), reg(shade(P.grass, -22))];  // 麦穗珐琅三调
  const ruby = reg(PROP_COLORS.ruby, MAT.glass({ alpha: 0.6, rough: 0.15 }));
  const rubyHi = reg(shade(PROP_COLORS.ruby, 20), MAT.glass({ alpha: 0.6, rough: 0.1 }));

  const CELL = 2 * S;                    // 1 图案格 = 2 体素(35 体素面 ≈ 贴图 128px/6px 格同比例)
  const inCells = (cells, cx, cy) => cells.some(([x, y, w = 1, h = 1]) => cx >= x && cx < x + w && cy >= y && cy < y + h);
  // 面内偏移 → 图案格 → 珐琅色(0=不在图案内)
  const glyph = (m, dx, dy) => {
    const cx = Math.floor(dx / CELL + m.ox), cy = Math.floor(dy / CELL + m.oy);
    if (!inCells(m.main, cx, cy)) return 0;
    if (m.gem && inCells(m.gem, cx, cy)) return inCells(m.gemHi, cx, cy) ? rubyHi : ruby;
    const e = m === CROWN ? waxE : grassE;
    return inCells(m.hi, cx, cy) ? e[1] : inCells(m.sh, cx, cy) ? e[2] : e[0];
  };

  p.scan(-R - S, R + S, 0, 6 * S, -R - S, R + S, (x, y, z) => {
    const px = x + S / 2, pz = z + S / 2;          // 体素中心
    const d = Math.hypot(px, pz);
    if (d > R) return 0;
    // 侧壁 reeded 直齿(48 条双色竖纹,全高)
    if (d > R - 1.2 * S) {
      const stripe = Math.floor(((Math.atan2(pz, px) + Math.PI) / (Math.PI * 2)) * 48);
      return stripe % 2 === 0 ? silverLit : silverDim;
    }
    const iy = Math.round(y / S);
    // 顶/底凸缘圈(其余挖空——场面比缘低一格,真实硬币立边)
    if (iy === 5 || iy === 0) return d > R - 2.6 * S ? (iy === 5 ? silverLit : silver) : 0;
    // 场面层(iy4=王冠面,iy1=麦穗面):阴纹挖空 + 缘环刻线 + 内圈描环 + 细块噪
    if (iy === 4 || iy === 1) {
      // 底面画布 y 取 -pz:翻面查看(绕 x 翻转)时图案立正
      if (glyph(iy === 4 ? CROWN : WHEAT, px, iy === 4 ? pz : -pz)) return 0;
      if (d > R - 3.4 * S) return silverDeep;               // 缘环刻线(对齐贴图外描边)
      if (Math.abs(d - 14 * S) < 0.6 * S) return silverDim; // 内圈描环
      const h = hash2(Math.floor(px / (2 * S)) * 3, Math.floor(pz / (2 * S)));
      return h > 0.85 ? silverLit : h < 0.15 ? silverDim : silver;
    }
    // 芯层(iy3 承王冠彩 / iy2 承麦穗彩):阴纹洞露出的珐琅体素,其余银
    const m2 = iy === 3 ? CROWN : WHEAT;
    return glyph(m2, px, iy === 3 ? pz : -pz) || silver;
  });
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 出盘 =================
mkdirSync(join(OUT_DIR, 'props'), { recursive: true });
mkdirSync(join(OUT_DIR, 'props/char'), { recursive: true });
const assets = [
  ['chandelier-deluxe.vox', genChandelierLegacy],        // voxlab 在用(1.5cm),字节保持不变
  ['props/chandelier-deluxe.vox', genChandelierProps],   // 素材批次(八角木轮旧款,留库可比对)
  ['props/chandelier-tiered.vox', genChandelierTiered],  // 双层圆盘新款(2026-07-16,VoxChandelier 在用)
  ['props/table.vox', () => genTable(6.0, 4.0)],
  ['props/table-long.vox', () => genTable(8.6, 4.0)],
  ['props/chair.vox', genChair],
  ['props/wall-lower.vox', genWallLower],
  ['props/wall-upper.vox', genWallUpper],
  ['props/beam.vox', genBeam],
  ['props/barrel.vox', genBarrel],
  ['props/crate.vox', genCrate],
  ['props/fireplace.vox', genFireplace],
  ['props/bottle-green.vox', () => genBottle(P.glassGreen)],
  ['props/bottle-brown.vox', () => genBottle(P.glassBrown)],
  ['props/mug.vox', genMug],
  ['props/shelf.vox', genShelf],
  ['props/bench.vox', genBench],
  ['props/door.vox', genDoor],
  ['props/dartboard.vox', genDartboard],
  ['props/sconce.vox', genSconce],
  ['props/table-round.vox', genTableRound],
  ['props/coatrack.vox', genCoatrack],
  ['props/coin.vox', genCoin],
  ...charAssets,   // 人物批次(tools/voxchars.mjs:头壳/身臂腿×7 角色/帽×5)
];
for (const [name, gen] of assets) {
  const { dense, pal, mats } = gen();
  let count = 0;
  for (let i = 0; i < dense.data.length; i++) if (dense.data[i]) count++;
  const matCount = Object.keys(mats).length;
  const buf = writeVox(dense, pal, matCount ? { materials: mats } : undefined);
  writeFileSync(join(OUT_DIR, name), Buffer.from(buf));
  console.log(`✓ ${name}: ${dense.sx}×${dense.sy}×${dense.sz} 格,${count.toLocaleString()} 实心体素,${(buf.byteLength / 1024).toFixed(1)} KB${matCount ? `,${matCount} 个 MATL 材质` : ''}`);
}
