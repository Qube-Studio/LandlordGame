// 豪华体素吊灯——生成器(tools/voxgen.mjs)与运行时组件(VoxChandelier)的共享规格。
// 单一真源:烛位/火苗点/挂点在这里定一次,体素几何与运行时火苗面片永远对位
// (呼应桌面 spotOf 与毡面烘焙圆圈同源的既有手法)。数值单位=世界 unit(1u≈1m)。
export const VOXEL_SIZE = 0.015; // 与 VoxModel 缺省一致(docs/VOXEL_PLAN.md §1)

export const CHAND = {
  scale: VOXEL_SIZE,
  // 网格(体素数,three 轴向;XZ 居中)
  grid: { sx: 178, sy: 150, sz: 178 },
  mountY: 2.40,        // 世界挂点:轮面中心(local 0.40)≈世界 2.80,对齐现有吊灯
  // 八角木轮圈:d8(切比雪夫+对角)度量,faceR=面距
  rim: { faceR: 1.26, th: 0.18, y0: 0.30, h: 0.20 },
  // 内圈黄铜环 + 四根辐板(辐板沿 0/90/180/270°,中心留空——掷币抛物线过顶,VOXEL_PLAN §5)
  inner: { r: 0.62, y0: 0.38, h: 0.06, band: 0.055 },
  spokes: { from: 0.58, to: 1.12, halfW: 0.045, y0: 0.38, h: 0.08 },
  // 蜡烛:8 外(八角角位)+ 4 内(对角位)
  outerCandles: Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2 + Math.PI / 8),
  innerCandles: Array.from({ length: 4 }, (_, k) => (k / 4) * Math.PI * 2 + Math.PI / 4),
  outerCandleR: 1.22,
  innerCandleR: 0.62,
  outerWax: { r: 0.045, h: 0.21, trayR: 0.085 }, // 轮面 y .50 起
  innerWax: { r: 0.038, h: 0.15, trayR: 0.065 }, // 内环顶 y .44 起
  // 琥珀吊坠(自发光,ember):8 个,八角面中点下方
  gems: Array.from({ length: 8 }, (_, k) => (k / 4) * (Math.PI / 2) * 2 + 0), // 0/45/90...
  gemR: 1.17,
  // 链条:3 条 120° 均布,轮面 → 顶部铜冠
  chains: [0, 1, 2].map((i) => (i / 3) * Math.PI * 2 + Math.PI / 2),
  chainAttachR: 1.10,
  knotY: 2.08,         // 铜冠中心(local)
};

// ================= 双层圆盘吊灯(2026-07-16 新款,props 批次 3.6cm) =================
// 用户拍板:双层圆盘金属质感(不再是八角木轮)、灯=末地烛式自发光柱(无火苗面片)、
// 下盘底缘一圈小水晶吊坠。中孔过币(§5-5:上盘 rIn 0.50 / 下盘 0.62 ≥ 硬币半径 0.26)。
// 生成器 voxgen#genChandelierTiered 与运行时 VoxChandelier 共用本规格。数值=世界 unit,local 底锚。
export const TIERED = {
  grid: { sx: 74, sy: 66, sz: 74 },
  mountY: 2.40,                                    // 世界挂点(同旧款,吊装体系不变)
  knotY: 2.08,                                     // 铜冠中心(local;吊杆从 hoop 顶接走)
  hoopTop: 2.29,                                   // 吊环顶(VoxChandelier 吊杆起点)
  lower: { rOut: 1.30, rIn: 0.62, y: 0.30, th: 0.08, lipH: 0.06 },  // 下盘(含外缘凸唇)
  upper: { rOut: 0.80, rIn: 0.50, y: 1.10, th: 0.08, lipH: 0.06 },  // 上盘
  // 末地烛灯柱:底座钮 + 自发光柱(ink 色,运行时按 hex 拆 emissive 子网格)
  rod: { h: 0.42, r: 0.036, knob: 0.05, knobH: 0.06 },
  rodsLower: Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2 + Math.PI / 8),
  rodsUpper: Array.from({ length: 6 }, (_, k) => (k / 6) * Math.PI * 2),
  rodLowerR: 1.02,
  rodUpperR: 0.65,
  // 水晶吊坠(specGlass 玻璃):下盘底缘一圈,大小交替
  crystals: Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2),
  crystalR: 1.12,
  // 斜撑杆:铜冠→上盘 ×4,上盘→下盘 ×4(错开 45°)
  strutsTop: Array.from({ length: 4 }, (_, k) => (k / 4) * Math.PI * 2 + Math.PI / 4),
  strutsMid: Array.from({ length: 4 }, (_, k) => (k / 4) * Math.PI * 2),
};

// 运行时火苗点(local,VoxModel bottom 锚点系):与生成器蜡烛几何同源(旧款八角轮用;新款无火苗)
export function flamePoints() {
  const pts = [];
  for (const a of CHAND.outerCandles) {
    pts.push({ x: Math.cos(a) * CHAND.outerCandleR, y: 0.50 + 0.03 + CHAND.outerWax.h + 0.07, z: Math.sin(a) * CHAND.outerCandleR });
  }
  for (const a of CHAND.innerCandles) {
    pts.push({ x: Math.cos(a) * CHAND.innerCandleR, y: 0.44 + 0.03 + CHAND.innerWax.h + 0.06, z: Math.sin(a) * CHAND.innerCandleR });
  }
  return pts;
}
