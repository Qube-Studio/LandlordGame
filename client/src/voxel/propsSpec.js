// props 素材批次共享规格(docs/VOXEL_PLAN.md 附录 C)——生成器(tools/voxgen.mjs)与
// 运行时消费者(VoxChandelier/voxlab VoxProps)的单一真源。纯常量,node/浏览器共用。
export const PROP_VOXEL_SIZE = 0.036; // 批次尺度:3.6cm 粗体素(最长件 9.0m/250 格 ≤ 256,全批单模型)

// 桌顶对齐:毡面顶层落在第 28 格(体素立方上表面=第 29 格),摆位时整体下移,
// 让可见桌顶回到世界 y=1.0(§5-2:cards.jsx 三处世界坐标不动,动模型)。
export const PROP_TABLE_Y = 1.0 - 29 * PROP_VOXEL_SIZE;

// 墙段:每段宽 168 格(6.048m,四段拼 24m 墙,端部与相邻段微互叠免缝),厚 6 格(0.216m);
// 下段=石墙裙 4m,上段=木板墙 6m(0~4 / 4~10 两层拼满 10m 内高)。
export const WALL_SEG = { w: 168, th: 6, lowerH: 112, upperH: 168 };

// 房梁段:长 222 格(7.992m,三段拼 24m),截面 12 格(0.432m,对齐现有 0.4 方梁)。
export const BEAM_SEG = { len: 222, cs: 12 };
