// 程序生成的像素贴图（CanvasTexture）：Minecraft 人物脸 + 硬币正反面 + 桌面钞票（与 2D 同源）。
// 全部用 NearestFilter，保持硬像素边缘。
import * as THREE from 'three';
import { noteCanvas } from '../assets/pixelnote';
import { PROP_COLORS, shade } from '../assets/palette';

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

// (人物脸已并入 assets/texlib.js#skinCanvas 的 head/front,此处不再重复实现)

// ---- 硬币正反面（128²,ART_BIBLE §1.6:浮雕 + 点阵字符双绘,弃字体渲染） ----
// 王(heads):三横一竖;禾(tails):撇 + 横 + 竖 + 两捺。均以 4px 格手绘,带 +1px 暗底浮雕。
const COIN_CACHE = new Map();
export function coinFaceTexture(face = 'heads') {
  if (COIN_CACHE.has(face)) return COIN_CACHE.get(face);
  const t = pixelTexture((ctx, s) => {
    const heads = face === 'heads';
    const base = heads ? PROP_COLORS.coinGold : PROP_COLORS.coinTails;
    const dark = shade(base, -55);
    const lite = shade(base, 22);
    const c = s / 2;
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    // 边缘环 + 内圈描边
    ctx.strokeStyle = shade(base, -30); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(c, c, c - 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = shade(base, -18); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c, c, c - 13, 0, Math.PI * 2); ctx.stroke();
    // 字符:4px 格点阵,先 +1 格暗底再主体(压铸浮雕感),左上 1px 高光
    const cell = 4;
    const glyph = heads
      ? [ // 王 16×18 格
        [2, 2, 12, 2], [7, 4, 2, 4], [4, 8, 8, 2], [7, 10, 2, 4], [2, 14, 12, 2],
      ]
      : [ // 禾:撇/横/竖/两捺(格块化)
        [8, 1, 4, 2], [5, 3, 4, 2], [2, 5, 12, 2], [7, 7, 2, 8],
        [5, 9, 2, 2], [3, 11, 2, 2], [9, 9, 2, 2], [11, 11, 2, 2],
      ];
    const ox = c - 8 * cell, oy = c - (heads ? 9 : 8.5) * cell; // 字符区左上角(16 格宽居中)
    ctx.fillStyle = dark;
    for (const [x, y, w2, h2] of glyph) ctx.fillRect(ox + x * cell + 3, oy + y * cell + 3, w2 * cell, h2 * cell);
    ctx.fillStyle = shade(base, -62);
    for (const [x, y, w2, h2] of glyph) ctx.fillRect(ox + x * cell, oy + y * cell, w2 * cell, h2 * cell);
    ctx.fillStyle = lite;
    for (const [x, y, w2] of glyph) ctx.fillRect(ox + x * cell - 1, oy + y * cell - 1, Math.min(w2 * cell, 3), 2);
    // (刻齿/皇冠/麦穗浮雕按玩家反馈移除:大字符 + 双环已足够,保持币面干净)
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
