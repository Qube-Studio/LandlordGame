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

// 运行时火苗点(local,VoxModel bottom 锚点系):与生成器蜡烛几何同源
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
