// 交互模式开关：'3d' = 桌面直接操作（3D 手牌、拖拽下注、重力枪式协商分钱，当前默认）；
// '2d' = 旧版 2D HUD 操作（MoneyHand / NegotiationBoard），组件与逻辑保留不删——
// 未来移动端适配可能切回。URL 加 ?input=2d 可临时切回旧交互验证。
const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('input') : null;
export const INPUT_MODE = q === '2d' ? '2d' : '3d';
export const IS_3D_INPUT = INPUT_MODE === '3d';

// 触屏探测（移动端适配开关，与 2d/3d 输入模式正交——移动端也走 3D 交互）：
// coarse pointer = 手指；?touch=1 可在桌面强制模拟。命中时给 <html> 打 .touch 类供 CSS 分支。
const touchQ = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('touch') : null;
export const IS_TOUCH = typeof window !== 'undefined'
  && (touchQ === '1' || (touchQ !== '0' && window.matchMedia?.('(pointer: coarse)')?.matches));
if (IS_TOUCH && typeof document !== 'undefined') document.documentElement.classList.add('touch');
