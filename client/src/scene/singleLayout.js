// 单人长桌布局常量(§9.6 交互 v2)——Scene3D(游戏场景)与 voxlab(体素隔离验证区)共享。
// 从 Scene3D.jsx 抽出:react-refresh 规则要求组件文件只导出组件,布局常量在此单独成源。
// 桌 X 拉长(毡面 8.6×4.0),玩家队 4 个固定槽位沿 +z 长边一字排开(槽位=组队期所选,players[].seat),
// Boss 独坐 -z 对面。场景不按「我的座位」旋转(rot=0)——全局走动视角下房间是恒定的。
export const SINGLE_TABLE = { w: 8.6, d: 4.0 };
export const SINGLE_TEAM_SEATS = [-2.85, -0.95, 0.95, 2.85].map((x) => ({ x, z: 2.65 }));
export const SINGLE_BOSS_SEAT = { x: 0, z: -2.65 };
// 下注圈:队侧沿长边一排(x 内收 0.8),Boss 圈在对侧中线。圈 r=0.42,到中央双环(0.6)/缝线(z≈1.86)间距≥0.18。
export const singleSpotOf = (seat) => (seat.z < 0 ? { x: 0, z: -1.22 } : { x: seat.x * 0.8, z: 1.22 });
