// 程序生成的像素贴图（CanvasTexture）：Minecraft 人物脸 + 硬币正反面 + 桌面钞票（与 2D 同源）。
// 全部用 NearestFilter，保持硬像素边缘。
import * as THREE from 'three';
import { noteCanvas } from '../assets/pixelnote';
import { PROP_COLORS, shade } from '../assets/palette';
import { TICKET_GRID, TICKET_COLS, TICKET_ROWS, ticketCellColor } from '../assets/ticketArt';
import { CROWN, WHEAT } from './coinArt';

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

// 王冠/麦穗压铸图案点阵已抽到 scene/coinArt.js(纯数据单一真源,tools/voxgen 体素硬币共用)。

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
