// 程序生成的像素贴图（CanvasTexture）：Minecraft 人物脸 + 硬币正反面 + 桌面钞票（与 2D 同源）。
// 全部用 NearestFilter，保持硬像素边缘。
import * as THREE from 'three';
import { noteCanvas } from '../assets/pixelnote';

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
export function faceTexture(expression = 'idle', skin = '#e0ac69') {
  const key = `${expression}|${skin}`;
  if (FACE_CACHE.has(key)) return FACE_CACHE.get(key);
  const t = pixelTexture((ctx, s) => {
    const u = s / 16; // 每“像素格”
    const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x * u, y * u, w * u, h * u); };
    // 底色（肤色）
    px(0, 0, 16, 16, skin);
    // 头发（顶部 + 鬓角）
    const hair = '#3a2a18';
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
    // 嘴
    const mouth = '#7a4a36';
    if (expression === 'win') px(6, 11, 4, 2, mouth);
    else if (expression === 'lose') { px(6, 12, 4, 1, mouth); px(5, 11, 1, 1, mouth); px(10, 11, 1, 1, mouth); }
    else if (expression === 'ready') px(6, 11, 4, 1, mouth);
    else if (expression === 'bankrupt') { px(6, 12, 4, 2, '#4b4f57'); }
    else px(6, 11, 4, 1, mouth);
  });
  FACE_CACHE.set(key, t);
  return t;
}

// ---- 硬币正反面（64×64） ----
const COIN_CACHE = new Map();
export function coinFaceTexture(face = 'heads') {
  if (COIN_CACHE.has(face)) return COIN_CACHE.get(face);
  const t = pixelTexture((ctx, s) => {
    const heads = face === 'heads';
    ctx.fillStyle = heads ? '#e2c044' : '#cdb255';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
    // 内圈点纹
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); ctx.stroke();
    // 字
    ctx.fillStyle = heads ? '#5a4710' : '#3a5224';
    ctx.font = `bold ${Math.floor(s * 0.5)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(heads ? '王' : '禾', s / 2, s / 2 + 2);
  }, 64);
  return COIN_CACHE.set(face, t).get(face);
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
