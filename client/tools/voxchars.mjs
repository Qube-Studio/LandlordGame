// 角色体素素材生成器(docs/VOXEL_PLAN.md P1「程序化打底」轨,附录 C 人物批次):
// 由 voxgen.mjs 统一出盘到 client/src/assets/vox/props/char/。
// 规格单一真源 = src/voxel/charSpec.js(骨架契约/栅格/荧幕凹槽/帽 lift);
// 皮肤视觉对齐 texlib#skinCanvas 的 16² 像素规格(织纹/手套/鞋/角色个性逐条翻译成体素色)。
// 荧幕(§2.3):头壳 +z 面挖凹槽,槽底=botScreen 体素(MATL 微发光,MagicaVoxel 里也亮);
// 运行时活贴片(6 表情+CRT 抖动)由 VoxPlayer 沉进槽内——单 vox 做不了动态荧幕,壳体素化+贴片保留。
// 投资人眼镜不体素化(半透明镜片,同理保留 headProps 网格)。
import { makeDense } from '../src/voxel/vox.js';
import { P, ROLE_CLOTH, PROP_COLORS, shade } from '../src/assets/palette.js';
import { CHAR_VOXEL_SIZE, CHAR_PARTS, CHAR_ROLES, SCREEN, HATS, HEAD_MAT } from '../src/voxel/charSpec.js';
import { MAT, makePalette, hash2, Painter, hollow } from './voxkit.mjs';

const S = CHAR_VOXEL_SIZE;

// 三调布料(base/±6%,对齐 texlib 织纹幅度);mat 可选——头壳三调走金属 MATL
const cloth3 = (reg, hex, mat) => [reg(hex, mat), reg(shade(hex, 6), mat), reg(shade(hex, -6), mat)];
// 2×2 格织纹(块状抖动保贪心合并;texlib 是 2×2 棋盘 ±5%)
const weave = (t3, x, y, z) => {
  const h = hash2(Math.floor(x / (2 * S)) * 7 + Math.floor(z / (2 * S)), Math.floor(y / (2 * S)));
  return h > 0.82 ? t3[1] : h < 0.18 ? t3[2] : t3[0];
};

// ================= 身体(0.60×0.705×0.30):衬衫织纹 + 前/后脸角色个性(16² 皮肤像素规格直翻) =================
function genBody(role) {
  const [gx, gy, gz] = CHAR_PARTS.body.grid;
  const dense = makeDense(gx, gy, gz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const cloth = ROLE_CLOTH[role];
  const shirt = cloth3(reg, cloth.shirt);
  const BW = gx * S, BH = gy * S, BD = gz * S;
  p.scan(-BW / 2, BW / 2, 0, BH, -BD / 2, BD / 2, (x, y, z) => weave(shirt, x, y, z));
  // 16² 皮肤像素矩形 → 前/后脸最外层(px 向右,py 向下)
  const front = (px, py, w, h, ci) =>
    p.box(-BW / 2 + (px / 16) * BW, -BW / 2 + ((px + w) / 16) * BW, BH - ((py + h) / 16) * BH, BH - (py / 16) * BH, BD / 2 - 1.6 * S, BD / 2, ci);
  const back = (px, py, w, h, ci) =>
    p.box(-BW / 2 + (px / 16) * BW, -BW / 2 + ((px + w) / 16) * BW, BH - ((py + h) / 16) * BH, BH - (py / 16) * BH, -BD / 2, -BD / 2 + 1.6 * S, ci);

  if (role === 'landlord') {
    const gold = reg(P.brassHi, MAT.metal({ metal: 0.8, rough: 0.25 }));
    for (let py = 0; py < 12; py++) {
      for (let px = 0; px < 16; px++) {
        if ((px % 4 === 0 && py % 4 === 2) || (px % 4 === 2 && py % 4 === 0)) front(px, py, 1, 1, gold); // 锦缎菱格点阵
      }
    }
    front(0, 12, 16, 3, reg(shade(cloth.pants, -20)));   // 腰带
    front(7, 12, 2, 3, reg(shade(P.ok, -15)));           // 玉佩
  } else if (role === 'capitalist') {
    const pin = reg(shade(cloth.shirt, 18));
    for (let px = 1; px < 16; px += 3) front(px, 0, 1, 12, pin);            // 竖细条纹
    const white = reg(PROP_COLORS.chefWhite);
    front(5, 0, 6, 1, white); front(6, 1, 4, 1, white); front(7, 2, 2, 1, white); // 白 V 领三层收窄
    front(7, 3, 2, 7, reg(PROP_COLORS.hatBrim));         // 领带
    const chain = reg(PROP_COLORS.hatBand, MAT.metal({ metal: 0.8, rough: 0.25 }));
    front(3, 9, 1, 1, chain); front(4, 10, 1, 1, chain); front(5, 11, 1, 1, chain); // 怀表链斜点
    front(2, 8, 2, 2, chain);                            // 怀表
  } else if (role === 'farmer') {
    front(2, 3, 5, 4, reg(shade(cloth.shirt, -18)));     // 深补丁
    front(2, 3, 5, 1, reg(shade(cloth.shirt, -32)));
    front(10, 8, 4, 3, reg(shade(cloth.shirt, 16)));     // 浅补丁
    front(10, 8, 4, 1, reg(shade(cloth.shirt, -10)));
    for (let px = 0; px < 16; px += 3) front(px, 13, 2, 2, reg(P.wood300)); // 草绳腰带
  } else if (role === 'investor') {
    const vest = reg(shade(cloth.shirt, -22));
    front(0, 0, 3, 16, vest); front(13, 0, 3, 16, vest); // 马甲对襟
    front(6, 0, 4, 10, reg(PROP_COLORS.chefWhite));      // 衬衫
    front(7, 1, 2, 8, reg(shade(cloth.pants, -25)));     // 领带
    front(3, 7, 1, 3, reg(PROP_COLORS.chefWhite2));      // 胸袋钢笔杆
    front(3, 6, 1, 1, reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }))); // 笔帽
  } else if (role === 'prosecutor') {
    const lapel = reg(shade(cloth.shirt, -25));
    front(0, 0, 2, 16, lapel); front(14, 0, 2, 16, lapel); // 制服对襟
    front(6, 0, 4, 2, reg(PROP_COLORS.chefWhite));         // 白衬领
    const gold = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.15 }));
    front(7, 4, 2, 2, gold); front(7, 8, 2, 2, gold); front(7, 12, 2, 2, gold); // 金纽扣列
    front(2, 2, 3, 3, reg(shade(P.brassHi, -8), MAT.metal({ metal: 0.7, rough: 0.3 }))); // 检徽金底
    front(3, 3, 1, 1, reg(P.wax));                         // 检徽红芯
  } else if (role === 'glutton') {
    const apron = reg(shade(P.parchment, -8));
    front(3, 3, 10, 13, apron);                            // 围裙
    front(3, 3, 10, 1, reg(shade(P.parchment, -30)));      // 围裙顶边
    const sauce = reg(P.wax);
    front(5, 7, 1, 1, sauce); front(9, 6, 2, 1, sauce); front(7, 11, 1, 2, sauce); front(11, 12, 1, 1, sauce); // 酱渍
    back(4, 4, 8, 1, apron); back(7, 5, 2, 3, apron);      // 背面系带
  }
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 上臂(0.195×0.345×0.225):袖织纹(骨架 v2:止于肘,过肘 1 格遮弯折缝) =================
// 左右臂共用一份(皮肤本就对称)。
function genArmUpper(role) {
  const [gx, gy, gz] = CHAR_PARTS.armUpper.grid;
  const dense = makeDense(gx, gy, gz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const sleeve = cloth3(reg, ROLE_CLOTH[role].sleeve);
  const AW = gx * S, AH = gy * S, AD = gz * S;
  p.scan(-AW / 2, AW / 2, 0, AH, -AD / 2, AD / 2, (x, y, z) => weave(sleeve, x, y, z));
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 前臂(0.195×0.39×0.21,略细):袖织纹 + 腕缝亮线 + 黑手套(掌心微亮) =================
// investor 袖套移到前臂顶(肘部),glutton 卷袖白条纹同理——特征跟着前臂走,弯肘时不断裂。
function genArmLower(role) {
  const [gx, gy, gz] = CHAR_PARTS.armLower.grid;
  const dense = makeDense(gx, gy, gz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const cloth = ROLE_CLOTH[role];
  const sleeve = cloth3(reg, cloth.sleeve);
  const glove = reg(P.botGlove);
  const gloveLit = reg(shade(P.botGlove, 25));
  const gloveSeam = reg(shade(P.botGlove, 55));
  const cuff = role === 'investor' ? reg(shade(cloth.sleeve, -25)) : 0;
  const cuffTop = role === 'investor' ? reg(shade(cloth.sleeve, -40)) : 0;
  const rollWhite = role === 'glutton' ? reg(PROP_COLORS.chefWhite) : 0;
  const AW = gx * S, AH = gy * S, AD = gz * S;
  p.scan(-AW / 2, AW / 2, 0, AH, -AD / 2, AD / 2, (x, y, z) => {
    if (y < 0.105) {                             // 手套(底 7 行)
      if (y < S && Math.abs(x) < 0.045 && Math.abs(z) < 0.045) return gloveLit; // 掌心
      return glove;
    }
    if (y < 0.12) return gloveSeam;              // 腕口亮缝(1 行)
    if (role === 'investor' && y > AH - 0.075) return y > AH - 0.03 ? cuffTop : cuff; // 肘部袖套(顶 5 行,顶 2 行更深)
    if (role === 'glutton' && ((y > 0.285 && y < 0.315) || (y > 0.33 && y < 0.36))) {
      return rollWhite;                          // 卷袖白条纹 ×2
    }
    return weave(sleeve, x, y, z);
  });
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 大腿(0.24×0.405×0.24):裤织纹(止于膝,过膝 1 格遮弯折缝) =================
function genLegUpper(role) {
  const [gx, gy, gz] = CHAR_PARTS.legUpper.grid;
  const dense = makeDense(gx, gy, gz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const pants = cloth3(reg, ROLE_CLOTH[role].pants);
  const LW = gx * S, LH = gy * S, LD = gz * S;
  p.scan(-LW / 2, LW / 2, 0, LH, -LD / 2, LD / 2, (x, y, z) => weave(pants, x, y, z));
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 小腿(0.225×0.39,略细;鞋带前伸脚 2 格):裤织纹 + 鞋 + farmer 前脸泥点 =================
// 栅格 z 17 格:小腿柱只占后 15 格(轴心在栅格 z -0.015,VoxPlayer mount z+0.015 与大腿对轴),
// 鞋(底 3 行)吃满 17 格 → 脚尖朝 +z 前伸——微真人比例的「脚」。
function genLegLower(role) {
  const [gx, gy, gz] = CHAR_PARTS.legLower.grid;
  const dense = makeDense(gx, gy, gz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  const cloth = ROLE_CLOTH[role];
  const pants = cloth3(reg, cloth.pants);
  const shoe = reg(P.wood900);
  const shoeLit = reg(shade(P.wood900, 60));
  const mud = role === 'farmer' ? reg(P.wood300) : 0;
  const LW = gx * S, LH = gy * S, HD = (gz * S) / 2; // z ∈ [-HD, +HD),小腿柱后缘 -HD
  p.scan(-LW / 2, LW / 2, 0, LH, -HD, HD, (x, y, z) => {
    if (y < 0.045) {                             // 鞋(底 3 行,含前伸脚尖)
      return y > 0.03 && z > HD - 2.2 * S ? shoeLit : shoe;  // 鞋头亮一线
    }
    if (z > HD - 2.4 * S) return 0;              // 鞋以上收回 2 格(小腿柱不含脚尖)
    if (mud && z > HD - 3.6 * S && y < 0.12 && hash2(Math.round(x / S) * 5, Math.round(y / S)) > 0.6) {
      return mud;                                // farmer 小腿前脸泥点
    }
    return weave(pants, x, y, z);
  });
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 机器头壳(0.555³,全角色共用):面板缝/螺栓/散热槽/侧耳盘/下巴格栅 + 荧幕凹槽 =================
// 细节对齐 texlib#drawHeadFace 的 16² 规格与 screenFace 的 32² 前脸;荧幕区=挖 2 格凹槽,
// 槽底 botScreen(MATL 微发光)+ 屏顶一线反光;运行时活贴片沉进槽内(charSpec.SCREEN.plateZ)。
function genHead() {
  const [gx, gy, gz] = CHAR_PARTS.head.grid;
  const dense = makeDense(gx, gy, gz);
  const p = new Painter(dense, S);
  const { pal, reg, mats } = makePalette();
  // 机器头=金属(2026-07-17 用户):壳体刷纹金属、螺栓抛光钢、缝/凹槽略糙(藏污的凹处)。
  // 运行时(dev 光栅)整头只吃一档 metalness(HEAD_MAT,VoxPlayer 传入);这里的逐色 MATL 是
  // 给 MagicaVoxel 与 voxel 分支的 aRm 逐体素材质用的——两边同一套意图,细分留在文件里。
  const shell = cloth3(reg, P.botShell, MAT.metal(HEAD_MAT));  // 机壳(±6% 块噪,对齐 noiseFill)
  const seam = reg(shade(P.botShell, -26), MAT.metal({ metal: 0.5, rough: 0.55 }));
  const bolt = reg(shade(P.botShell, -42), MAT.metal({ metal: 0.85, rough: 0.25 }));
  const botDark = reg(shade(P.botShell, -14), MAT.metal(HEAD_MAT));
  const deep = reg(shade(P.botShell, -52), MAT.metal({ metal: 0.5, rough: 0.6 }));
  const screen = reg(P.botScreen, MAT.emit({ emit: 0.35, flux: 1 }));
  const screenHi = reg(shade(P.botScreen, 90), MAT.emit({ emit: 0.35, flux: 1 }));
  const HH = gy * S, half = HH / 2;
  const skin = HH / 16;                          // 16² 皮肤一像素的世界宽
  const u16 = (v) => Math.floor((v + half) / skin);          // 世界 → 16 格横坐标(居中轴)
  const v16 = (y) => Math.floor((HH - y) / skin);            // 世界 y → 16 行(自顶向下)
  p.scan(-half, half, 0, HH, -half, half, (x, y, z) => {
    // ---- 荧幕凹槽(+z 面):前 2 层挖空,第 3 层=屏 ----
    // 开口判定用体素中心(scan 回调给的是最小角坐标,+S/2 归中):27 格开口在 37 格面上严格居中
    const inOpen = Math.abs(x + S / 2) < SCREEN.opening / 2 - 0.1 * S
      && Math.abs(y + S / 2 - half) < SCREEN.opening / 2 - 0.1 * S;
    if (inOpen && z > half - (SCREEN.depth + 0.2) * S) return 0;
    if (inOpen && z > half - (SCREEN.depth + 1.2) * S) {
      return y - half > SCREEN.opening / 2 - 1.2 * S ? screenHi : screen;  // 屏顶一线反光
    }
    // ---- 顶面:3 道散热槽(px 3/7/11,宽 2,py6..9) ----
    if (y > HH - 1.2 * S) {
      const u = u16(x), v = u16(z);
      if ((u === 3 || u === 4 || u === 7 || u === 8 || u === 11 || u === 12) && v >= 6 && v < 10) return seam;
      return weave(shell, x, y, z);
    }
    // ---- 底面:整面压暗 + 中央颈口(px4..11,py6..9) ----
    if (y < 1.2 * S) {
      const u = u16(x), v = u16(z);
      return u >= 4 && u < 12 && v >= 6 && v < 10 ? seam : botDark;
    }
    // ---- 背面:横缝(py8) + 四角螺栓 + 检修口 ----
    if (z < -half + 1.2 * S) {
      const u = u16(x), v = v16(y);
      if ((u === 2 || u === 3) && (v === 2 || v === 3)) return bolt;
      if ((u === 12 || u === 13) && (v === 2 || v === 3)) return bolt;
      if ((u === 2 || u === 3) && (v === 11 || v === 12)) return bolt;
      if ((u === 12 || u === 13) && (v === 11 || v === 12)) return bolt;
      if (u === 7 && v === 4) return deep;                       // 检修口内嵌
      if (u >= 6 && u < 10 && v >= 3 && v < 6) return seam;      // 检修口
      if (v === 8) return seam;                                  // 面板横缝
      return weave(shell, x, y, z);
    }
    // ---- 侧面:横缝(py8) + 侧耳圆盘(px6..9,py6..9,中心螺栓) ----
    if (Math.abs(x) > half - 1.2 * S) {
      const u = u16(z), v = v16(y);
      if ((u === 7 || u === 8) && (v === 7 || v === 8)) return bolt;
      if (u >= 6 && u < 10 && v >= 6 && v < 10) return botDark;  // 耳盘(-18 档,近似用 -14)
      if (v === 8) return seam;
      return weave(shell, x, y, z);
    }
    // ---- 前面(凹槽外的壳缘):下巴格栅(32² 的 px13..18,py30) ----
    if (z > half - 1.2 * S) {
      const u32 = Math.floor((x + half) / (HH / 32)), v32 = Math.floor((HH - y) / (HH / 32));
      if (u32 >= 13 && u32 < 19 && v32 >= 30 && v32 < 32) return seam;
      return weave(shell, x, y, z);
    }
    return weave(shell, x, y, z);
  });
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 头戴道具(头局部系底锚创作;lift 见 charSpec.HATS;金件=金属 MATL,运行时另加 glow) ================
function genHat(role) {
  const { pal, reg, mats } = makePalette();
  let dense;
  const paint = (g, fn) => { dense = makeDense(...g); fn(new Painter(dense, S)); };
  if (role === 'landlord') {
    // 皇冠:冠圈 0.5×0.1 + 四角尖 0.16 + 中心尖 0.22 + 正面红宝石
    const gold = reg(PROP_COLORS.crown, MAT.metal({ metal: 0.85, rough: 0.2 }));
    const goldDim = reg(shade(PROP_COLORS.crown, -14), MAT.metal({ metal: 0.85, rough: 0.3 }));
    const ruby = reg(PROP_COLORS.ruby, MAT.glass({ alpha: 0.6, rough: 0.15 }));
    paint([38, 22, 38], (p) => {
      p.scan(-0.25, 0.25, 0, 0.1, -0.25, 0.25, (x, y) => (y < 0.02 ? goldDim : gold));
      for (const [sx, sz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
        p.box(sx - 0.05, sx + 0.05, 0.09, 0.25, sz - 0.05, sz + 0.05, gold);
      }
      p.box(-0.05, 0.05, 0.09, 0.31, -0.05, 0.05, gold);
      p.box(-0.05, 0.05, 0.02, 0.12, 0.24, 0.28, ruby);
    });
  } else if (role === 'capitalist') {
    // 礼帽:帽檐 0.6 + 金带 0.42 + 帽筒 0.4×0.28
    const brim = reg(PROP_COLORS.hatBrim);
    const band = reg(PROP_COLORS.hatBand, MAT.metal({ metal: 0.8, rough: 0.25 }));
    const top = reg(PROP_COLORS.hatTop);
    const topLit = reg(shade(PROP_COLORS.hatTop, 14));
    paint([42, 24, 42], (p) => {
      p.box(-0.3, 0.3, 0, 0.05, -0.3, 0.3, brim);
      p.scan(-0.21, 0.21, 0.05, 0.12, -0.21, 0.21, () => band);
      p.scan(-0.2, 0.2, 0.12, 0.345, -0.2, 0.2, (x, y, z) =>
        (weave([top, topLit, top], x, y, z)));
    });
  } else if (role === 'farmer') {
    // 草帽:宽檐 0.74 + 矮顶 0.4×0.18,草编=双色织纹
    const straw = cloth3(reg, PROP_COLORS.straw);
    const straw2 = reg(PROP_COLORS.straw2);
    paint([50, 16, 50], (p) => {
      p.scan(-0.37, 0.37, 0, 0.05, -0.37, 0.37, (x, y, z) =>
        (hash2(Math.floor(x / (2 * S)), Math.floor(z / (2 * S))) > 0.5 ? straw2 : weave(straw, x, y, z)));
      p.scan(-0.2, 0.2, 0.05, 0.23, -0.2, 0.2, (x, y, z) =>
        (hash2(Math.floor(y / (2 * S)) * 3, Math.floor((x + z) / (2 * S))) > 0.5 ? straw2 : straw[0]));
    });
  } else if (role === 'glutton') {
    // 厨师帽:帽圈 0.46 + 帽鼓 0.5×0.22(双白块纹)
    const white = reg(PROP_COLORS.chefWhite);
    const white2 = reg(PROP_COLORS.chefWhite2);
    paint([36, 22, 36], (p) => {
      p.box(-0.23, 0.23, 0, 0.1, -0.23, 0.23, white);
      p.scan(-0.25, 0.25, 0.1, 0.32, -0.25, 0.25, (x, y, z) =>
        (hash2(Math.floor(x / (3 * S)) * 5 + Math.floor(z / (3 * S)), Math.floor(y / (3 * S))) > 0.45 ? white2 : white));
    });
  } else if (role === 'prosecutor') {
    // 检察制帽:帽墙 0.46×0.12 + 宽平顶 0.56×0.07 + 正面金徽
    const navy = reg(PROP_COLORS.procNavy);
    const navy2 = reg(PROP_COLORS.procNavy2);
    const gold = reg(PROP_COLORS.crown, MAT.metal({ metal: 0.85, rough: 0.2 }));
    paint([40, 14, 40], (p) => {
      p.box(-0.23, 0.23, 0, 0.12, -0.23, 0.23, navy);
      p.box(-0.28, 0.28, 0.12, 0.19, -0.28, 0.28, navy2);
      p.box(-0.05, 0.05, 0.03, 0.13, 0.2, 0.26, gold);
    });
  }
  hollow(dense);
  return { dense, pal, mats };
}

// ================= 出盘清单(voxgen.mjs 消费) =================
export const charAssets = [
  ['props/char/head.vox', genHead],
  ...CHAR_ROLES.flatMap((role) => [
    [`props/char/body-${role}.vox`, () => genBody(role)],
    [`props/char/arm-up-${role}.vox`, () => genArmUpper(role)],
    [`props/char/arm-lo-${role}.vox`, () => genArmLower(role)],
    [`props/char/leg-up-${role}.vox`, () => genLegUpper(role)],
    [`props/char/leg-lo-${role}.vox`, () => genLegLower(role)],
  ]),
  ...Object.keys(HATS).map((role) => [`props/char/hat-${role}.vox`, () => genHat(role)]),
];
