// 左轮手枪体素生成器(单动军用左轮造型;独立工具,不并入 voxgen 批次——按需单独出盘):
//   node client/tools/voxrevolver.mjs   → client/src/assets/vox/props/revolver.vox
// 尺度:1.5cm/格(VoxModel 默认 VOXEL_SIZE,VoxLab「+ 导入 .vox」直接可用)。
// 全长 36 格 ≈ 54cm,约真枪 1.7×——体素画风武器刻意放大一档才读得出轮廓,
// 摆放/持握时用缩放旋钮回调(细节进色彩:发蓝枪钢三档色阶 + 磨亮棱线,不做亚格凸起)。
// 材质(MATL,vRm 管线直接生效):枪钢 metal .85(基 rough .35/棱线磨亮 .22/阴影 .45)、
// 扳机护圈/握把垫片黄铜、膛口/弹巢孔深色哑钢、握把胡桃木无 MATL(默认糙面)。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDense, writeVox } from '../src/voxel/vox.js';
import { P, shade, PROP_COLORS } from '../src/assets/palette.js';
import { MAT, makePalette, hash2 } from './voxkit.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/vox/props/revolver.vox');

// 栅格:x=枪长(0 握把尾 → 35 枪口),y=上,z=厚(中面 z=4)
const SX = 36, SY = 24, SZ = 9;
const ZC = 4;
const dense = makeDense(SX, SY, SZ);
const { pal, reg, mats } = makePalette();
const put = (x, y, z, ci) => {
  if (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ) return;
  dense.data[x + SX * (y + SY * z)] = ci;
};

// ---- 调色板 + MATL ----
const steel = reg(PROP_COLORS.gunSteel, MAT.metal({ metal: 0.85, rough: 0.35 }));          // 发蓝枪钢本体
const steelHi = reg(shade(PROP_COLORS.gunSteel, 16), MAT.metal({ metal: 0.85, rough: 0.22 })); // 棱线磨亮(常摸处发蓝磨掉)
const steelDk = reg(shade(PROP_COLORS.gunSteel, -16), MAT.metal({ metal: 0.85, rough: 0.45 })); // 凹槽/背光阴影档
const bore = reg(shade(PROP_COLORS.gunSteel, -38), MAT.metal({ metal: 0.4, rough: 0.6 }));  // 膛口/弹巢孔深处
const brass = reg(P.brass, MAT.metal({ metal: 0.8, rough: 0.25 }));               // 扳机护圈/底把框
const brassHi = reg(P.brassHi, MAT.metal({ metal: 0.85, rough: 0.2 }));           // 握把垫片(медальон)/铰销
const wood = reg(PROP_COLORS?.drumBone ?? P.wood500);                             // 胡桃木握把(暖深棕)
const woodHi = reg(shade(PROP_COLORS?.drumBone ?? P.wood500, 12));
const woodDk = reg(shade(PROP_COLORS?.drumBone ?? P.wood500, -14));

// 枪钢微噪:±1 档色阶按位置哈希跳动(块状,不逐格闪),金属面有「锻打感」
const steelAt = (x, y, z) => {
  const h = hash2(Math.floor(x / 3) * 7 + Math.floor(y / 2), Math.floor(z / 2));
  return h > 0.88 ? steelHi : h < 0.1 ? steelDk : steel;
};

// ================= 弹巢(cylinder):x 12..18,轴心 (y13,z4),半径 3.4 =================
const CYL = { x0: 12, x1: 18, cy: 13, r: 3.4 };
for (let x = CYL.x0; x <= CYL.x1; x++) {
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      const dy = y - CYL.cy, dz = z - ZC;
      const rr = Math.hypot(dy, dz);
      if (rr > CYL.r) continue;
      // 六条纵向减重槽(flute):外皮 + 六等分角域 → 压暗档(细节进色彩)
      const ang = Math.atan2(dz, dy);
      const sector = ((ang / Math.PI) * 3 + 6.5) % 1;           // 六等分内相位
      const isFlute = rr > CYL.r - 1.1 && sector > 0.3 && sector < 0.7 && x > CYL.x0 && x < CYL.x1;
      put(x, y, z, isFlute ? steelDk : steelAt(x, y, z));
    }
  }
}
// 弹巢前/后端面:六个弹孔(环径 2.1,孔径 0.9)——前面看是六个深色圆点
for (const x of [CYL.x0, CYL.x1]) {
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const hy = Math.round(CYL.cy + Math.cos(a) * 2.1);
    const hz = Math.round(ZC + Math.sin(a) * 2.1);
    put(x, hy, hz, bore);
  }
  put(x, CYL.cy, ZC, brassHi);                                   // 中轴销
}

// ================= 机匣(frame):包住弹巢的前后壁 + 底梁 + 顶带 =================
// 后壁(recoil shield)x 9..11 圆盘略大于弹巢;前壁 x 19..20
for (let x = 9; x <= 11; x++) {
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      const rr = Math.hypot(y - CYL.cy, z - ZC);
      if (rr > 3.8) continue;
      // x11=贴弹巢面:外缘压暗一圈成「转轴缝」,侧视里弹巢圆轮廓才分得出来
      put(x, y, z, x === 11 && rr > 2.6 ? steelDk : steelAt(x, y, z));
    }
  }
}
for (let x = 19; x <= 20; x++) {
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      const rr = Math.hypot(y - CYL.cy, z - ZC);
      if (rr > 3.2) continue;
      put(x, y, z, x === 19 && rr > 2.2 ? steelDk : steelAt(x, y, z));
    }
  }
}
// 底梁(y 8..9,z 3..5)连通前后壁;顶带(top strap,y 17,z 3..5)+ 前后沿磨亮
for (let x = 9; x <= 20; x++) {
  for (const y of [8, 9]) for (let z = 3; z <= 5; z++) put(x, y, z, steelAt(x, y, z));
  for (let z = 3; z <= 5; z++) put(x, 17, z, z === ZC ? steelHi : steelAt(x, 17, z));
}
put(10, 18, ZC, steelDk);                                        // 照门缺口(rear sight)

// ================= 枪管:x 20..34,切角八边形 Ø5,轴心 (y15,z4)=对准弹巢最上膛位 =================
for (let x = 20; x <= 34; x++) {
  for (let y = 13; y <= 17; y++) {
    for (let z = 2; z <= 6; z++) {
      const dy = Math.abs(y - 15), dz = Math.abs(z - ZC);
      if (dy > 2 || dz > 2 || dy + dz > 3) continue;             // 5×5 去四角=八边形断面
      // 管顶棱线磨亮;膛口面(x34)整圈磨亮
      const ci = (y === 17 && z === ZC) || x === 34 ? steelHi : steelAt(x, y, z);
      put(x, y, z, ci);
    }
  }
}
put(34, 15, ZC, bore); put(33, 15, ZC, bore);                    // 膛口深孔(两格进深)
// 退壳杆护管(ejector housing):枪管右下侧细管,前端帽微亮
for (let x = 22; x <= 30; x++) put(x, 12, 5, x === 30 ? steelHi : steelDk);
// 准星(front sight):坐在管顶棱线上
put(31, 18, ZC, steelHi); put(31, 19, ZC, steelHi);

// ================= 击锤(hammer):机匣后上方,带后弯锤刺 =================
for (let y = 17; y <= 19; y++) for (let z = 3; z <= 5; z++) put(8, y, z, steelAt(8, y, z));
for (let z = 3; z <= 5; z++) { put(7, 19, z, steelAt(7, 19, z)); put(6, 20, z, steelDk); }
put(6, 20, ZC, steelHi); put(5, 20, ZC, steelDk);                // 锤刺防滑纹(色阶交替)

// ================= 扳机护圈(brass)+ 扳机 =================
for (let x = 11; x <= 17; x++) put(x, 4, ZC, brass);             // 护圈底
for (const y of [5, 6, 7]) { put(11, y, ZC, brass); put(17, y, ZC, brass); } // 护圈两柱
put(12, 5, ZC, brass); put(16, 5, ZC, brass);                    // 圈角圆润
put(14, 6, ZC, steelDk); put(14, 7, ZC, steelDk);                // 扳机
// 护圈厚度:中面外再各挂一层薄圈(z±1)
for (let x = 11; x <= 17; x++) { put(x, 4, ZC - 1, brass); put(x, 4, ZC + 1, brass); }

// ================= 握把(grip):从机匣后下方后倾下垂,胡桃木双侧板 + 黄铜垫片 =================
// 中轴随高度后移:y8 时 x≈8,y1 时 x≈4(斜握把);截面前后 3.5 格 × 厚 5 格(z 2..6)
for (let y = 1; y <= 8; y++) {
  const xc = 4.4 + (y - 1) * 0.52;
  const halfW = y <= 2 ? 2.4 : 1.9;                              // 底部微扩(鸟头把尾)
  for (let x = Math.round(xc - halfW); x <= Math.round(xc + halfW); x++) {
    for (let z = 2; z <= 6; z++) {
      const side = z === 2 || z === 6;
      const front = x >= Math.round(xc + halfW) - 0 && y >= 3;
      const back = x <= Math.round(xc - halfW) + 0;
      // 前后钢背带(strap)包边,两侧胡桃木板,木纹=沿 y 的条纹色阶
      let ci;
      if (front || back) ci = steelAt(x, y, z);
      else if (side) {
        const g = hash2(y, Math.floor(x / 2) + (z === 2 ? 9 : 0));
        ci = g > 0.8 ? woodHi : g < 0.18 ? woodDk : wood;
      } else ci = wood;
      put(x, y, z, ci);
    }
  }
}
// 底部黄铜底把框(butt plate)+ 两侧黄铜垫片(медальон 圆点)
for (let x = 2; x <= 7; x++) for (let z = 2; z <= 6; z++) {
  put(x, 0, z, brass);
  if (x === 2 || x === 7) put(x, 1, z, brass);                   // 底框沿边包一圈,中段留木
}
put(6, 5, 1, brassHi); put(6, 5, 7, brassHi);                    // 侧板垫片(略凸半格观感靠色阶)
// 机匣→握把过渡肩(x 8..9,y 6..8)钢
for (let x = 8; x <= 9; x++) for (let y = 6; y <= 8; y++) for (let z = 2; z <= 6; z++) put(x, y, z, steelAt(x, y, z));

// ================= 机匣侧面细节:铰销/螺钉(色点) =================
put(19, 13, 1, brassHi); put(19, 13, 7, brassHi);                // 弹巢轴前销(两侧)
put(10, 10, 2, steelHi); put(10, 10, 6, steelHi);                // 机匣螺钉
// 装弹门(loading gate,右侧后壁一块微亮)
put(10, 12, 6, steelHi); put(10, 13, 6, steelHi);

writeFileSync(OUT, Buffer.from(writeVox(dense, pal, { materials: mats })));
let n = 0; for (const v of dense.data) if (v) n++;
console.log(`✓ revolver.vox  ${SX}×${SY}×${SZ}  体素 ${n}  MATL ${Object.keys(mats).length} 条`);
