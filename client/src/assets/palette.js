// 全局美术单一真源(docs/ART_BIBLE.md §1.1):原语色 → 语义色 → 工具派生。
// 三路消费:① CSS 变量(import 副作用 injectPalette 写 --c-* / --t-* / --e-*,
// theme.css/pixel.css 的旧变量降级为别名);② three 材质(import { P });③ canvas 纹理(import { P })。
// 全仓禁裸 hex——新增颜色一律先进这里(canvas 内 rgba() 阴影除外)。

export const P = {
  // 木(容器与场景骨架)
  wood900: '#1a100a', // 最深木/描边/HUD外框
  wood700: '#2e1d11', // 面板底/桌腿暗部
  wood500: '#4e3826', // 橡木框/门板中间调
  wood300: '#7a5a3e', // 受光木/按钮
  beam:    '#241708', // 房梁
  // 黄铜
  brass:   '#b98a3f',
  brassHi: '#e8c25a', // 全局金(替代旧 --px-gold/--gold)
  // 羊皮纸/黑板
  parchment: '#e8d5ae',
  parchInk:  '#3a2a18',
  chalkBoard: '#2a2d28',
  chalkInk:   '#e6e2d4',
  // 光色
  candle:   '#ffd28a', // 吊灯
  key:      '#ffc87d', // 主平行光
  fire:     '#ff8848', // 炉火
  ember:    '#ff9a4a', // 炭床 emissive/警示脉冲
  coolFill: '#5f78a8', // 冷补光
  sceneAmbient: '#4a3828', // 环境光
  sceneBg:  '#1a120b',
  sceneFog: '#2c1c10',
  // 赌桌
  feltTable: '#6b3428', // 桌毡暗酒红
  feltLine:  '#caa04e', // 毡面金描线(α0.5 使用)
  // 人物
  skin: '#e8b878',
  hair: '#4a3420',
  // 文字/功能色
  ink:    '#f6ecd8',
  inkDim: '#b8a585',
  danger: '#e36262',
  ok:     '#8fc77a',
  grass:  '#a0c468', // 农民阵营 UI 点缀(rail-dot/聊天名)
};

// 语义层(引用原语,不新造值)
P.surface = P.wood700;
P.accent = P.brassHi;
P.gold = P.brassHi;
P.panelLine = P.wood900;

// 角色布料(shirt/pants/sleeve)——MinecraftPlayer 与皮肤纹理共用
export const ROLE_CLOTH = {
  landlord:   { shirt: '#caa24a', pants: '#5a4424', sleeve: '#b8902f' },
  capitalist: { shirt: '#6e4a92', pants: '#3a2a4e', sleeve: '#5e3f80' },
  farmer:     { shirt: '#7a9a4e', pants: '#4a5230', sleeve: '#6c8a44' },
  investor:   { shirt: '#3f8a82', pants: '#2c4a48', sleeve: '#368079' },
  glutton:    { shirt: '#9a6a3a', pants: '#5a3e26', sleeve: '#8a5e32' },
  none:       { shirt: '#8a7a64', pants: '#54483a', sleeve: '#7a6a54' },
};

// 面额(bg/ink/accent)——pixelnote(2D+3D 钞票)唯一色源
export const DENOM_COLORS = {
  10:   { bg: '#caa84e', ink: '#403211', accent: '#ecd78d' },
  5:    { bg: '#6fa87e', ink: '#1d3726', accent: '#abd7b9' },
  2:    { bg: '#5f93b5', ink: '#152e3d', accent: '#abd1e6' },
  1:    { bg: '#b8a07a', ink: '#382e1b', accent: '#decba8' },
  DEBT: { bg: '#c45048', ink: '#360f0b', accent: '#eaa39d' },
  BACK: { bg: '#23262f', ink: '#7d8696', accent: '#363b46' },
};

// ---- 工具派生:bevel/阴影/暗边一律用 shade/alpha 派生,不另设 token ----
export function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = 1 + pct / 100;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = c(n >> 16), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// 动效 token(§1.9)——同时以 --t-*/--e-* 注入 CSS
export const MOTION = {
  tFast: 120,   // ms 退场/微反馈
  tUi: 240,     // ms 一切 UI 入场
  tEmph: 500,   // ms 强调 pop/结算跳字
  tFlight: 720, // ms 3D 飞牌(=现值)
  eEnter: 'cubic-bezier(0.2, 0.85, 0.25, 1)',
  ePop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  ePixel: 'steps(2)',
};

// CSS 别名所需的派生档位(集中派生,别名侧零计算)
const DERIVED = {
  bgDeep: shade(P.wood900, -45),   // 最深 app 背景(旧 --bg-0)
  wood800: shade(P.wood700, -35),  // 旧 --px-dark / body 渐变顶
  wood950: shade(P.wood900, -30),  // 旧 --px-darker
  brassDim: shade(P.brass, -18),   // 旧 --gold-dim
  inkFaint: shade(P.inkDim, -45),  // 旧 --ink-faint
};

const kebab = (k) => k.replace(/([A-Z])/g, '-$1').replace(/([a-z])(\d)/g, '$1-$2').toLowerCase();

export function injectPalette() {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  for (const [k, v] of Object.entries(P)) style.setProperty(`--c-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(DERIVED)) style.setProperty(`--c-${kebab(k)}`, v);
  style.setProperty('--t-fast', `${MOTION.tFast}ms`);
  style.setProperty('--t-ui', `${MOTION.tUi}ms`);
  style.setProperty('--t-emph', `${MOTION.tEmph}ms`);
  style.setProperty('--t-flight', `${MOTION.tFlight}ms`);
  style.setProperty('--e-enter', MOTION.eEnter);
  style.setProperty('--e-pop', MOTION.ePop);
  style.setProperty('--e-pixel', MOTION.ePixel);
}

// import 即生效:main/preview/gallery 任何入口只要(间接)引到本模块,CSS 变量就位。
injectPalette();
