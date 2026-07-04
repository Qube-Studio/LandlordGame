// 交互模式开关：'3d' = 桌面直接操作（3D 手牌、拖拽下注、重力枪式协商分钱，当前默认）；
// '2d' = 旧版 2D HUD 操作（MoneyHand / NegotiationBoard），组件与逻辑保留不删——
// 未来移动端适配可能切回。URL 加 ?input=2d 可临时切回旧交互验证。
const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('input') : null;
export const INPUT_MODE = q === '2d' ? '2d' : '3d';
export const IS_3D_INPUT = INPUT_MODE === '3d';
