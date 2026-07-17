// 角色体素规格(docs/VOXEL_PLAN.md P1 / 附录 C 人物批次)——生成器(tools/voxchars.mjs)与
// 运行时(voxlab/VoxPlayer)的单一真源。纯常量,node/浏览器共用。
//
// 骨架 v2(2026-07-17 用户拍板:加肘/膝二级关节 + 肢体比例微真人化——**有意偏离** box 版
// MinecraftPlayer 的 §5-1 契约;P1 并回主游戏时以 v2 为准,box 版骨架仅作 ?art=box 回退):
//   一级枢轴:髋 ±0.13/y0.78 · 肩 ±0.39/y1.44 · 头心 y1.715
//   二级枢轴:肘=肩下 0.33 · 膝=髋下 0.40(挂在一级组内,随摆臂/抬腿联动)
//   比例:腿加长(0.70→0.78)、躯干收窄拉长(0.585×0.66)、手末端落髋线(y0.72)、小腿带前伸脚;
//   总高 ≈1.99 与 box 版持平,头 0.555³ 不动(机器头=角色身份)。
// 角色=高精度体素(§0 决策 1,用户拍板),尺度 0.015 —— 与家具 props 的 0.036 刻意不同档。
export const CHAR_VOXEL_SIZE = 0.015;

// 关节枢轴(three 世界系,root 局部)。肘/膝静息微弯给「活人感」,走摆时由 VoxPlayer 联动。
export const PIVOTS = {
  hipX: 0.13, hipY: 0.78,
  shoulderX: 0.39, shoulderY: 1.44,
  headY: 1.715,
  elbowY: -0.33,                        // 肩局部系:肘枢轴(前臂 0.39 → 手末端 y0.72=髋线)
  kneeY: -0.39,                         // 髋局部系:膝枢轴(小腿 0.39 → 脚底恰 y0;大腿过膝 1 格遮缝)
  elbowRest: -0.12,                     // 静息微弯(负=前屈)
  kneeRest: 0.06,                       // 静息微弯(正=后屈)
  // 坐姿:大腿近水平前伸 + 膝弯小腿垂下(凳面 ~0.50;脚离地属实——小腿 0.38 < 凳高)
  seatedBaseY: -0.18, seatedLegRot: -1.4, seatedKnee: 1.15,
};

// 部件体素栅格(名义盒尺寸 / 0.015 取整;渲染尺寸=grid×S,与名义盒差 ≤ 半格)
// 部件 .vox 一律「局部底锚」创作:内容从 y=0 起,XZ 居中 —— VoxPlayer 按 mount 挂进枢轴组:
//   上臂/大腿 mount [0, -H, 0](顶端=一级枢轴;内容比枢轴距长 1 格,过关节遮弯折缝)
//   前臂/小腿 mount 挂进二级枢轴组 [0, -H, 0](小腿另有 z +0.015 对轴,见 legLower 注)
//   身 mount root [0, hipY, 0] · 头 mount [0, -H/2, 0](头心=枢轴)
export const CHAR_PARTS = {
  head: { grid: [37, 37, 37] },       // 0.555³
  body: { grid: [39, 44, 19] },       // 0.585×0.66×0.285(v2 收窄拉长)
  armUpper: { grid: [13, 23, 15] },   // 0.195×0.345×0.225(过肘 1 格)
  armLower: { grid: [13, 26, 14] },   // 0.195×0.39×0.21(前臂略细,含手套手)
  legUpper: { grid: [16, 27, 16] },   // 0.24×0.405×0.24(过膝 1 格)
  legLower: { grid: [15, 26, 17] },   // 0.225×0.39×0.255(小腿略细;鞋带前伸脚 2 格,
                                      //   小腿轴心在栅格 z -0.015 → mount z +0.015 与大腿对轴)
};

// 机器头壳材质(2026-07-17 用户:头改金属)——生成器 MATL 与运行时材质共用这一处旋钮。
// ⚠ metal 勿拉到 1:场景无环境贴图(envMap),金属无漫反射、只靠环境反射 → 满金属度=近乎全黑。
// 0.65 保住暗酒馆里的可读性,又能吃到吊灯点光(头正下方)与主平行光的高光。
// rough 0.38:flatShading 下每个体素面是平的,太光滑会让面片「爆闪」,刷纹级粗糙更稳。
export const HEAD_MAT = { metal: 0.65, rough: 0.38 };

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

// 素材文件名约定(props/char/ 子目录;头壳全角色共用一份;左右肢共用同一份)
export const charVoxUrl = {
  head: () => 'char/head.vox',
  body: (role) => `char/body-${role}.vox`,
  armUpper: (role) => `char/arm-up-${role}.vox`,
  armLower: (role) => `char/arm-lo-${role}.vox`,
  legUpper: (role) => `char/leg-up-${role}.vox`,
  legLower: (role) => `char/leg-lo-${role}.vox`,
  hat: (role) => `char/hat-${role}.vox`,
};
