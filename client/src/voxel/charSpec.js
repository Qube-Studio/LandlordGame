// 角色体素规格(docs/VOXEL_PLAN.md P1 / 附录 C 人物批次)——生成器(tools/voxchars.mjs)与
// 运行时(voxlab/VoxPlayer)的单一真源。纯常量,node/浏览器共用。
//
// 骨架契约(§5-1,与 scene/MinecraftPlayer.jsx 逐值一致,轴心不可动否则动画全废):
//   髋 ±0.14/y0.7 · 肩 ±0.41/y1.4 · 头 y1.675 · 坐姿 legRot=-1.5/baseY=-0.16
//   部件盒:头 0.55³ / 身 0.6×0.7×0.3 / 臂 0.22×0.7×0.26 / 腿 0.26×0.7×0.26
// 角色=高精度体素(§0 决策 1,用户拍板),尺度 0.015 —— 与家具 props 的 0.036 刻意不同档。
export const CHAR_VOXEL_SIZE = 0.015;

// 关节枢轴(three 世界系,root 局部)
export const PIVOTS = {
  hipX: 0.14, hipY: 0.7,
  shoulderX: 0.41, shoulderY: 1.4,
  headY: 1.675,
  seatedBaseY: -0.16, seatedLegRot: -1.5,
};

// 部件体素栅格(名义盒尺寸 / 0.015 取整;渲染尺寸=grid×S,与名义盒差 ≤ 半格)
// 部件 .vox 一律「局部底锚」创作:内容从 y=0 起,XZ 居中 —— VoxPlayer 按 mount 挂进枢轴组:
//   腿/臂 mount [0, -H, 0](顶端=枢轴,绕顶端铰链) · 身 mount root [0, 0.7, 0] · 头 mount [0, -H/2, 0](头心=枢轴)
export const CHAR_PARTS = {
  head: { grid: [37, 37, 37] },   // 0.555³
  body: { grid: [40, 47, 20] },   // 0.60×0.705×0.30
  arm:  { grid: [15, 47, 17] },   // 0.225×0.705×0.255(左右臂同一份,皮肤本就对称)
  leg:  { grid: [17, 47, 17] },   // 0.255×0.705×0.255
};

// 荧幕凹槽(§2.3:荧幕=活的自发光贴片,体素头壳挖凹槽承接,避免 z-fighting):
//   头 +z 面居中挖 0.42² 开口、深 2 格;槽底=botScreen 体素(MATL 微发光,MagicaVoxel 里也是亮屏);
//   运行时贴片(整面 0.555²,texlib#screenFace 双帧)沉进槽内,四周被体素壳缘遮住,只露荧幕区。
export const SCREEN = {
  // 开口 27 格=0.405:37 格奇数面上唯一能严格居中的宽度(偶数格开口必偏心半格,审查已证);
  // 比 32² 脸的 24px 荧幕区(0.4125)窄 3.75mm/边,壳缘对称压住屏边,颜文字区(±0.13)不受影响。
  opening: 27 * CHAR_VOXEL_SIZE,
  depth: 2,                             // 凹槽深(格)
  plateZ: (37 / 2) * CHAR_VOXEL_SIZE - 2 * CHAR_VOXEL_SIZE + 0.002, // 贴片 z(槽底前 2mm,与各体素面均不共面)
};

// 头戴道具(头局部系,头心=原点;.vox 底锚创作,lift=内容底在头局部系的 y)
// investor 眼镜不体素化:半透明镜片(透过镜片见荧幕眼)是运行时材质活,保留 headProps 网格(同荧幕贴片道理)。
export const HATS = {
  landlord:   { lift: 0.275 },  // 皇冠:冠圈底=头顶面
  capitalist: { lift: 0.300 },  // 礼帽:帽檐底
  farmer:     { lift: 0.270 },  // 草帽:宽檐底
  glutton:    { lift: 0.275 },  // 厨师帽:帽圈底
  prosecutor: { lift: 0.275 },  // 制帽:帽墙底
};

// 全角色清单(与 labStore.LAB_ROLES 一致;none=无帽平民)
export const CHAR_ROLES = ['landlord', 'capitalist', 'farmer', 'investor', 'glutton', 'prosecutor', 'none'];

// 素材文件名约定(props/char/ 子目录;头壳全角色共用一份)
export const charVoxUrl = {
  head: () => 'char/head.vox',
  body: (role) => `char/body-${role}.vox`,
  arm: (role) => `char/arm-${role}.vox`,
  leg: (role) => `char/leg-${role}.vox`,
  hat: (role) => `char/hat-${role}.vox`,
};
