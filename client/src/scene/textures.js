// 程序生成的像素贴图（CanvasTexture）：Minecraft 人物脸 + 硬币正反面 + 桌面钞票（与 2D 同源）。
// 全部用 NearestFilter，保持硬像素边缘。
import * as THREE from 'three';
import { noteCanvas } from '../assets/pixelnote';
import { P, PROP_COLORS, shade } from '../assets/palette';

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

// ---- 人物脸（16×16） ----
const FACE_CACHE = new Map();
export function faceTexture(expression = 'idle', skin = P.skin) {
  const key = `${expression}|${skin}`;
  if (FACE_CACHE.has(key)) return FACE_CACHE.get(key);
  const t = pixelTexture((ctx, s) => {
    const u = s / 16; // 每“像素格”
    const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x * u, y * u, w * u, h * u); };
    // 底色（肤色）
    px(0, 0, 16, 16, skin);
    // 头发（顶部 + 鬓角）—— 暖一档
    const hair = P.hair;
    px(0, 0, 16, 4, hair);
    px(0, 0, 2, 9, hair); px(14, 0, 2, 9, hair);
    // 眼睛
    const dark = '#21262e';
    const eyeY = 6;
    if (expression === 'bankrupt') {
      // ✕✕ 眼
      px(3, 5, 1, 1, dark); px(5, 7, 1, 1, dark); px(3, 7, 1, 1, dark); px(5, 5, 1, 1, dark); px(4, 6, 1, 1, dark);
      px(10, 5, 1, 1, dark); px(12, 7, 1, 1, dark); px(10, 7, 1, 1, dark); px(12, 5, 1, 1, dark); px(11, 6, 1, 1, dark);
    } else if (expression === 'win') {
      // ^ ^ 笑眼
      px(3, 6, 1, 1, dark); px(4, 5, 1, 1, dark); px(5, 6, 1, 1, dark);
      px(10, 6, 1, 1, dark); px(11, 5, 1, 1, dark); px(12, 6, 1, 1, dark);
    } else if (expression === 'bet') {
      // 眯眼（横线）
      px(3, eyeY, 3, 1, dark); px(10, eyeY, 3, 1, dark);
    } else {
      // 普通方眼（含白色高光）
      px(3, eyeY, 2, 2, '#ffffff'); px(4, eyeY, 1, 2, dark);
      px(11, eyeY, 2, 2, '#ffffff'); px(11, eyeY, 1, 2, dark);
    }
    // 眉/腮
    if (expression === 'lose') { px(3, 5, 3, 1, hair); px(10, 5, 3, 1, hair); }
    // 腮红（暖光酒馆的人情味；破产/沮丧不画）
    if (!['bankrupt', 'lose'].includes(expression)) { px(2, 9, 2, 1, '#e09478'); px(12, 9, 2, 1, '#e09478'); }
    // 嘴
    const mouth = '#7a4a36';
    if (expression === 'win') px(6, 11, 4, 2, mouth);
    else if (expression === 'lose') { px(6, 12, 4, 1, mouth); px(5, 11, 1, 1, mouth); px(10, 11, 1, 1, mouth); }
    else if (expression === 'ready') px(6, 11, 4, 1, mouth);
    else if (expression === 'bet') { px(6, 11, 4, 1, mouth); px(9, 10, 1, 1, mouth); } // 赌徒坏笑：右嘴角上扬
    else if (expression === 'bankrupt') { px(6, 12, 4, 2, '#4b4f57'); }
    else px(6, 11, 4, 1, mouth);
  });
  FACE_CACHE.set(key, t);
  return t;
}

// ---- 硬币正反面（128²,ART_BIBLE §1.6:浮雕 + 32 刻齿 + 点阵字符双绘,弃字体渲染） ----
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
    // 圆周 32 刻齿(珠点)
    ctx.fillStyle = dark;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ctx.fillRect(Math.round(c + Math.cos(a) * (c - 8)) - 1, Math.round(c + Math.sin(a) * (c - 8)) - 1, 3, 3);
    }
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
    // 顶部小皇冠浮雕(仅王面):高光在上、暗影在下
    if (heads) {
      const cw = 5;
      const crown = [[2, 2, 8, 2], [2, 0, 2, 2], [5, 0, 2, 2], [8, 0, 2, 2]];
      const cx0 = c - 6 * cw, cy0 = 16;
      ctx.fillStyle = dark;
      for (const [x, y, w2, h2] of crown) ctx.fillRect(cx0 + x * cw + 2, cy0 + y * cw + 2, w2 * cw, h2 * cw);
      ctx.fillStyle = lite;
      for (const [x, y, w2, h2] of crown) ctx.fillRect(cx0 + x * cw, cy0 + y * cw, w2 * cw, h2 * cw);
    } else {
      // 禾面:底部麦穗束
      ctx.fillStyle = shade(base, -35);
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(c + i * 8 - 1, s - 30 + Math.abs(i) * 3, 2, 12 - Math.abs(i) * 3);
        ctx.fillRect(c + i * 8 - 3, s - 32 + Math.abs(i) * 3, 6, 3);
      }
    }
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
