// 程序生成的像素贴图（CanvasTexture）：Minecraft 人物脸 + 硬币正反面 + 桌面钞票（与 2D 同源）。
// 全部用 NearestFilter，保持硬像素边缘。
import * as THREE from 'three';
import { noteCanvas } from '../assets/pixelnote';
import { PROP_COLORS, shade } from '../assets/palette';
import { TICKET_GRID, TICKET_COLS, TICKET_ROWS, ticketCellColor } from '../assets/ticketArt';

function pixelTexture(draw, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 对质票券贴图（§8.8）：像素画走 assets/ticketArt.js 单一真源（与 2D PixelTicket / 3D 锯齿几何同网格）。
// 邮票造型：左右锯齿 + 暗金边 + 信封翻盖 V。缓存单例，NearestFilter 保持硬边。
// 注意：Tickets3D 的挤出几何 UV 是网格原始坐标（0..cols, 0..rows），由几何侧设置 repeat/offset 换算。
let _ticketTex = null;
export function ticketTexture() {
  if (_ticketTex) return _ticketTex;
  const cell = 8;
  const c = document.createElement('canvas');
  c.width = TICKET_COLS * cell; c.height = TICKET_ROWS * cell;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  TICKET_GRID.forEach((line, y) => {
    for (let x = 0; x < TICKET_COLS; x++) {
      const ch = line[x];
      if (ch === ' ') continue;
      ctx.fillStyle = ticketCellColor(ch, x, y); // 逐格配色：边框/齿尖/斜面/纸纹（单一真源）
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  _ticketTex = tex;
  return tex;
}

// (人物脸已并入 assets/texlib.js#skinCanvas 的 head/front,此处不再重复实现)

// ---- 硬币正反面（128²,玩家反馈②:弃「王/禾」文字浮雕,改像素图案:王冠(heads)/麦穗(tails)） ----
// 16×16 逻辑格 ×6 放大居中绘制;压铸三色 = 主色 coinGold + 右下 1 格暗影(shade -25)+ 左上 1 格高光(shade +20)。
// 暗影为「底色系投影」(+1,+1 格,落在图案外);高光/暗部为图案内手排格,避免偏移层糊进格缝。
// 双环在图案之后描,保证投影极角永远压不出环外;构图留白充足,宁简勿繁。
const COIN_CACHE = new Map();

// 格块填充工具:cells = [x, y, w=1, h=1][],(dx,dy) 为投影偏移(单位:格)
function fillCells(ctx, cells, color, ox, oy, cell, dx = 0, dy = 0) {
  ctx.fillStyle = color;
  for (const [x, y, w = 1, h = 1] of cells) ctx.fillRect(ox + (x + dx) * cell, oy + (y + dy) * cell, w * cell, h * cell);
}

// 王冠(heads/地主):三尖冠 + 冠带 + 中央宝石,12 格宽 × 9 格高(16 格坐标系)。
// 金面上的同色浮雕看不出轮廓 → 冠体用 shade(+10)「抛光受光面」整体提亮(压铸凸起比底板更亮)。
const CROWN = {
  lift: 10, // 主体相对底色的抛光提亮
  main: [
    [2, 3, 2, 3], [7, 3, 2, 3], [12, 3, 2, 3], // 三尖(3 格高)
    [2, 6, 3, 1], [6, 6, 4, 1], [11, 6, 3, 1], // 尖底加宽,留 1 格谷
    [2, 7, 12, 3],                             // 冠身
    [2, 10, 12, 1], [3, 11, 10, 1],            // 冠带(底边内收 1 格)
  ],
  hi: [ // 左上受光:每尖顶行 + 左缘格,冠身/冠带左缘
    [2, 3, 2, 1], [2, 4, 1, 2], [7, 3, 2, 1], [7, 4, 1, 2], [12, 3, 2, 1], [12, 4, 1, 2],
    [2, 7, 1, 3], [2, 10, 1, 1],
  ],
  sh: [ // 冠身/冠带分界刻线
    [2, 9, 12, 1],
  ],
  gem: [[7, 9, 2, 2]], gemHi: [[7, 9, 1, 1]], // 中央红宝石(压住刻线) + 左上高光
  ox: 8, oy: 7.5, // 居中锚(格):图案占 2..13 列 / 3..11 行
};

// 麦穗(tails/农民):顶粒 + 居中麦秆 + 3 对麦粒(与秆留 1 格缝)+ 底部两片小叶,15 格坐标系 × 13 格高
const WHEAT = {
  main: [
    [7, 0, 1, 2],                 // 顶粒
    [7, 2, 1, 11],                // 麦秆(贯穿到底)
    [4, 2, 2, 2], [9, 2, 2, 2],   // 麦粒对 ×3(纵向间隔 1 格)
    [4, 5, 2, 2], [9, 5, 2, 2],
    [4, 8, 2, 2], [9, 8, 2, 2],
    [6, 10, 1, 1], [5, 11, 1, 1], // 左叶(贴秆斜向外)
    [8, 10, 1, 1], [9, 11, 1, 1], // 右叶
  ],
  hi: [ // 每颗麦粒左上角 + 顶粒首格
    [7, 0, 1, 1], [4, 2, 1, 1], [9, 2, 1, 1], [4, 5, 1, 1], [9, 5, 1, 1], [4, 8, 1, 1], [9, 8, 1, 1],
  ],
  sh: [ // 每颗麦粒右下角 + 秆底格
    [5, 3, 1, 1], [10, 3, 1, 1], [5, 6, 1, 1], [10, 6, 1, 1], [5, 9, 1, 1], [10, 9, 1, 1], [7, 12, 1, 1],
  ],
  ox: 7.5, oy: 6.5, // 居中锚(格):图案占 4..10 列 / 0..12 行
};

export function coinFaceTexture(face = 'heads') {
  if (COIN_CACHE.has(face)) return COIN_CACHE.get(face);
  const t = pixelTexture((ctx, s) => {
    const heads = face === 'heads';
    const base = heads ? PROP_COLORS.coinGold : PROP_COLORS.coinTails;
    const c = s / 2;
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    // 压铸图案:底色系投影(+1,+1) → 金色主体 → 内部高光/暗部(金面王冠 = 同色浮雕,蓝面麦穗 = 金色图案)
    const cell = 6;
    const main = PROP_COLORS.coinGold;
    const m = heads ? CROWN : WHEAT;
    const ox = c - m.ox * cell, oy = c - m.oy * cell;
    fillCells(ctx, m.main, shade(base, -25), ox, oy, cell, 1, 1);
    fillCells(ctx, m.main, shade(main, m.lift || 0), ox, oy, cell);
    fillCells(ctx, m.hi, shade(main, 20), ox, oy, cell);
    fillCells(ctx, m.sh, shade(main, -25), ox, oy, cell);
    if (heads) {
      fillCells(ctx, CROWN.gem, PROP_COLORS.ruby, ox, oy, cell);
      fillCells(ctx, CROWN.gemHi, shade(PROP_COLORS.ruby, 20), ox, oy, cell);
    }
    // 边缘环 + 内圈描边(保留;后绘,兜底盖住投影极角)
    ctx.strokeStyle = shade(base, -30); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(c, c, c - 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = shade(base, -18); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c, c, c - 13, 0, Math.PI * 2); ctx.stroke();
  }, 128);
  return COIN_CACHE.set(face, t).get(face);
}

// 硬币侧壁 reeded 直齿纹(64×8,绕圆周平铺)
let COIN_EDGE = null;
export function coinEdgeTexture() {
  if (COIN_EDGE) return COIN_EDGE;
  COIN_EDGE = pixelTexture((ctx) => {
    for (let x = 0; x < 64; x += 4) {
      ctx.fillStyle = shade(PROP_COLORS.coinGold, -18);
      ctx.fillRect(x, 0, 4, 8);
      ctx.fillStyle = shade(PROP_COLORS.coinGold, 14);
      ctx.fillRect(x, 0, 2, 8);
    }
  }, 64);
  // pixelTexture 是方形画布;侧壁纹理用重复包裹增密
  COIN_EDGE.wrapS = THREE.RepeatWrapping;
  COIN_EDGE.repeat.set(6, 1);
  return COIN_EDGE;
}

// ---- 桌面钞票贴图（复用 2D 同一张 canvas） ----
const NOTE_CACHE = new Map();
export function noteTexture(opts) {
  const key = `${opts.value || 1}|${opts.faceDown ? 1 : 0}|${opts.debt ? 1 : 0}`;
  if (NOTE_CACHE.has(key)) return NOTE_CACHE.get(key);
  const t = new THREE.CanvasTexture(noteCanvas(opts));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  NOTE_CACHE.set(key, t);
  return t;
}
