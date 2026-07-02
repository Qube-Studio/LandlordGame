// 程序化纹理库(docs/ART_BIBLE.md §1.3):木纹/毛毡/织物/黄铜/羊皮纸/黑板 五基材 +
// 墙面/地板/圆毯/酒桶/桌毡/火焰 合成纹理。全部:
//   - mulberry32 种子 PRNG(同 key 永远同图,可缓存可复现)
//   - 按参数 key 缓存,永不逐帧重画
//   - NearestFilter 硬像素;每张最外圈压暗 25% 烘成描边(像素勾线,零几何成本)
// 消费方:3D 用 tex(kind, opts, rx, ry);HUD 用 injectTextures() 写好的 --tex-* CSS 变量。
import * as THREE from 'three';
import { P, shade } from './palette';

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CANVAS_CACHE = new Map();
const TEX_CACHE = new Map();

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// 逐像素明度噪声铺底(块状:block 像素一格,保持低保真颗粒)
function noiseFill(ctx, w, h, baseHex, amp, rnd, block = 1) {
  const [r, g, b] = hexRgb(baseHex);
  for (let y = 0; y < h; y += block) {
    for (let x = 0; x < w; x += block) {
      const f = 1 + (rnd() * 2 - 1) * amp;
      ctx.fillStyle = `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;
      ctx.fillRect(x, y, block, block);
    }
  }
}

// 最外圈压暗 25%(烘焙描边)
function edgeLine(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, h - 1, w, 1);
  ctx.fillRect(0, 0, 1, h); ctx.fillRect(w - 1, 0, 1, h);
}

// ---- 基材 ----

function drawWood(ctx, w, h, tone, plankW, rnd) {
  for (let px0 = 0; px0 < w; px0 += plankW) {
    const f = 1 + (rnd() * 2 - 1) * 0.06;            // 板间明度抖动 ±6%
    const [r, g, b] = hexRgb(tone);
    ctx.fillStyle = `rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`;
    ctx.fillRect(px0, 0, plankW, h);
    // 板内细颗粒
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < h; y += 2) if (rnd() < 0.3) ctx.fillRect(px0 + (rnd() * plankW | 0), y, 1, 2);
    // 蛇形木纹(1px 深色游走线)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    let gx = px0 + 1 + (rnd() * (plankW - 2) | 0);
    for (let y = 0; y < h; y++) {
      if (rnd() < 0.25) gx += rnd() < 0.5 ? -1 : 1;
      gx = Math.max(px0 + 1, Math.min(px0 + plankW - 2, gx));
      ctx.fillRect(gx, y, 1, 1);
    }
    // 疖疤点
    if (rnd() < 0.7) {
      const kx = px0 + 1 + (rnd() * (plankW - 3) | 0), ky = rnd() * h | 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(kx, ky, 2, 2); ctx.fillRect(kx + 1, ky + 1, 1, 1);
    }
    // 板缝
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px0 + plankW - 1, 0, 1, h);
  }
}

function drawFelt(ctx, w, h, color, rnd, block = 1) {
  noiseFill(ctx, w, h, color, 0.04, rnd, block);
  // 四角压暗 −12%(三层内缩描边近似 vignette)
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.12 - i * 0.035})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(i + 0.5, i + 0.5, w - 1 - i * 2, h - 1 - i * 2);
  }
}

function drawFabric(ctx, w, h, color, pattern, rnd) {
  // 2×2 织纹 ±5%(交错棋盘)
  const [r, g, b] = hexRgb(color);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const weave = ((x + y) / 2) % 2 === 0 ? 1 : -1;
      const f = 1 + weave * 0.05 + (rnd() * 2 - 1) * 0.02;
      ctx.fillStyle = `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  if (pattern === 'stripe') {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
  } else if (pattern === 'patch') {
    for (let i = 0; i < 2; i++) {
      const pw = 6 + (rnd() * 4 | 0), ph = 5 + (rnd() * 4 | 0);
      const px0 = rnd() * (w - pw) | 0, py0 = rnd() * (h - ph) | 0;
      ctx.fillStyle = shade(color, i === 0 ? -18 : 14);
      ctx.fillRect(px0, py0, pw, ph);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
    }
  } else if (pattern === 'damask') {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 2; y < h; y += 6) for (let x = (y / 6 % 2) * 3 + 2; x < w; x += 6) {
      ctx.fillRect(x, y, 1, 1); ctx.fillRect(x - 1, y + 1, 1, 1); ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x, y + 2, 1, 1);
    }
  }
}

function drawBrass(ctx, w, h, patina, rnd) {
  const [r, g, b] = hexRgb(P.brass);
  for (let y = 0; y < h; y++) {           // 横向拉丝
    const f = 1 + (rnd() * 2 - 1) * 0.07;
    ctx.fillStyle = `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; // 顶部高光带
  ctx.fillRect(0, 1, w, 2);
  if (patina > 0) {
    ctx.fillStyle = 'rgba(78,122,94,0.5)';  // 边缘铜绿斑
    for (let i = 0; i < 10 * patina; i++) {
      const edge = rnd() < 0.5;
      const x = edge ? (rnd() < 0.5 ? rnd() * 4 : w - 1 - rnd() * 4) : rnd() * w;
      const y = edge ? rnd() * h : (rnd() < 0.5 ? rnd() * 4 : h - 1 - rnd() * 4);
      ctx.fillRect(x | 0, y | 0, 1 + (rnd() * 2 | 0), 1);
    }
  }
}

function drawParchment(ctx, w, h, rnd) {
  noiseFill(ctx, w, h, P.parchment, 0.03, rnd, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';       // 纤维划痕
  for (let i = 0; i < 30; i++) {
    const x = rnd() * w | 0, y = rnd() * h | 0, len = 3 + (rnd() * 9 | 0);
    if (rnd() < 0.5) ctx.fillRect(x, y, len, 1); else ctx.fillRect(x, y, 1, len);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.10)';       // 毛边
  for (let x = 0; x < w; x += 2) { if (rnd() < 0.5) ctx.fillRect(x, 0, 2, 1); if (rnd() < 0.5) ctx.fillRect(x, h - 1, 2, 1); }
  for (let y = 0; y < h; y += 2) { if (rnd() < 0.5) ctx.fillRect(0, y, 1, 2); if (rnd() < 0.5) ctx.fillRect(w - 1, y, 1, 2); }
}

function drawChalk(ctx, w, h, rnd) {
  noiseFill(ctx, w, h, P.chalkBoard, 0.03, rnd, 1);
  ctx.fillStyle = 'rgba(230,226,212,0.05)'; // 粉笔擦痕
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(rnd() * w | 0, rnd() * h | 0, 6 + (rnd() * 14 | 0), 2 + (rnd() * 3 | 0));
  }
}

// ---- 合成纹理 ----

function drawTavernWall(ctx, w, h, rnd) {
  const stoneTop = Math.floor(h * 2 / 3);  // 上 2/3 木板,下 1/3 石墙裙
  drawWood(ctx, w, stoneTop, P.wood500, 16, rnd);
  // 石墙裙:砌块 + 勾缝
  const stone = shade(P.wood900, 15);
  ctx.fillStyle = stone;
  ctx.fillRect(0, stoneTop, w, h - stoneTop);
  const rowH = 14;
  for (let y = stoneTop; y < h; y += rowH) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, y, w, 1);
    const off = ((y - stoneTop) / rowH % 2) * 14;
    for (let x = off; x < w; x += 28) ctx.fillRect(x, y, 1, rowH);
    // 石块明度抖动
    for (let x = off; x < w; x += 28) {
      const f = (rnd() * 2 - 1) * 0.1;
      ctx.fillStyle = f > 0 ? `rgba(255,255,255,${f * 0.6})` : `rgba(0,0,0,${-f})`;
      ctx.fillRect(x + 1, y + 1, 27, rowH - 1);
    }
  }
  // 裙板压顶线
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, stoneTop - 2, w, 2);
  // 烘焙造景剪影(比墙暗 30%,零几何):酒瓶架 / 画框 / 鹿角
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  // 酒瓶架(两层横板+瓶)
  const sx = 18, sy = 38;
  ctx.fillRect(sx, sy, 52, 3); ctx.fillRect(sx, sy + 26, 52, 3);
  for (let i = 0; i < 4; i++) {
    const bx = sx + 5 + i * 12;
    ctx.fillRect(bx, sy - 14, 6, 14); ctx.fillRect(bx + 2, sy - 20, 2, 6);
    if (i !== 2) { ctx.fillRect(bx + 1, sy + 12, 6, 14); ctx.fillRect(bx + 3, sy + 6, 2, 6); }
  }
  // 画框(框暗、画面微亮)
  ctx.fillRect(110, 34, 34, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(114, 38, 26, 18);
  // 鹿角(对称枝杈)
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  const ax = 196, ay = 52;
  ctx.fillRect(ax - 2, ay, 20, 3);
  for (const dir of [-1, 1]) {
    let bx = ax + 8 + dir * 8, by = ay;
    for (let i = 0; i < 4; i++) { ctx.fillRect(bx, by - i * 5 - 4, 2, 6); bx += dir * 4; }
  }
}

function drawPlankFloor(ctx, w, h, rnd) {
  // 横板条 + 错缝 + 钉点
  const rowH = 16;
  for (let y = 0; y < h; y += rowH) {
    const f = 1 + (rnd() * 2 - 1) * 0.07;
    const [r, g, b] = hexRgb(P.wood700);
    ctx.fillStyle = `rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`;
    ctx.fillRect(0, y, w, rowH);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + rowH - 1, w, 1);
    const off = (y / rowH % 2) * (w / 4) + (rnd() * 10 | 0);
    for (let x = off; x < w; x += w / 2) {
      ctx.fillRect(x | 0, y, 1, rowH);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect((x + 3) | 0, y + 3, 1, 1); ctx.fillRect((x + 3) | 0, y + rowH - 4, 1, 1); // 钉点
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
    }
    // 木纹划线
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 5; i++) ctx.fillRect(rnd() * w | 0, y + 2 + (rnd() * (rowH - 4) | 0), 4 + (rnd() * 10 | 0), 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
  }
}

function drawRug(ctx, w, h, rnd) {
  // 圆形织毯(贴 circleGeometry,四角被几何裁掉):同心环带 + 边穗
  drawFelt(ctx, w, h, shade(P.feltTable, -12), rnd, 2);
  const cx = w / 2, cy = h / 2;
  ctx.strokeStyle = 'rgba(202,160,78,0.35)';
  ctx.lineWidth = 2;
  for (const r of [w * 0.46, w * 0.34, w * 0.18]) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  // 边穗(圆周短须)
  ctx.strokeStyle = 'rgba(232,213,174,0.3)';
  ctx.lineWidth = 1;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 36) {
    const r0 = w * 0.47, r1 = w * 0.495;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
}

function drawBarrel(ctx, w, h, rnd) {
  drawWood(ctx, w, h, P.wood500, 8, rnd);
  // 两道铁箍
  for (const y of [h * 0.22 | 0, h * 0.74 | 0]) {
    ctx.fillStyle = shade(P.wood900, -20);
    ctx.fillRect(0, y, w, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, y + 1, w, 1);
  }
}

// 桌毡(512²):felt 基材 + 金描线下注区烘死在纹理里。
// spots = 各钱堆落点世界坐标 [{x,z}](对手 + 自己),与 Scene3D 的 MoneyStack 位置同源。
// 映射:u=(x/6.6+0.5)*512, v=(z/4.0+0.5)*512(若截图发现 z 镜像,翻转 FELT_FLIP_Z)。
const FELT_W = 512, FELT_H = 512;
const FELT_FLIP_Z = false;
function feltU(x) { return (x / 6.6 + 0.5) * FELT_W; }
function feltV(z) { return ((FELT_FLIP_Z ? -z : z) / 4.0 + 0.5) * FELT_H; }

function drawTableFelt(ctx, w, h, spots, rnd) {
  drawFelt(ctx, w, h, P.feltTable, rnd, 4);
  // 四周金色缝线边(双线内缩)
  ctx.strokeStyle = 'rgba(202,160,78,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.setLineDash([]);
  ctx.strokeRect(18, 18, w - 36, h - 36);
  // 中央硬币双环(世界半径 0.55/0.75)+ 环内王/禾对半暗纹
  const cx = feltU(0), cy = feltV(0);
  const rIn = 0.55 * (w / 6.6), rOut = 0.75 * (w / 6.6);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath(); ctx.arc(cx, cy, rIn, Math.PI / 2, Math.PI * 3 / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath(); ctx.arc(cx, cy, rIn, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(202,160,78,0.5)';
  ctx.setLineDash([6, 5]);
  for (const r of [rIn, rOut]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(cx | 0, (cy - rIn) | 0, 1, rIn * 2 | 0); // 对半分隔线
  // 每个钱堆落点一个虚线椭圆下注位(世界半轴 x=0.62 / z=0.50)
  const ex = 0.62 * (w / 6.6), ez = 0.50 * (h / 4.0);
  ctx.strokeStyle = 'rgba(202,160,78,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  for (const s of spots) {
    ctx.beginPath();
    ctx.ellipse(feltU(s.x), feltV(s.z), ex, ez, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// 火焰 3 帧(32×48,透明底):400ms material.map 引用轮换,永不重画
function drawFlame(ctx, w, h, frame) {
  const rnd = mulberry32(1000 + frame * 77);
  ctx.clearRect(0, 0, w, h);
  const layers = [
    { color: P.fire, sw: 1.0 },     // 外焰
    { color: P.ember, sw: 0.72 },   // 中焰
    { color: P.candle, sw: 0.42 },  // 焰心
  ];
  for (const { color, sw } of layers) {
    ctx.fillStyle = color;
    for (let y = 0; y < h - 4; y += 2) {
      const p = y / h;                                  // 0 顶 → 1 底
      const base = (1 - Math.pow(1 - p, 1.6)) * (w / 2) * sw;
      const wob = Math.sin(p * 9 + frame * 2.1) * 2.2 * (1 - p) + (rnd() * 2 - 1) * 1.4;
      const half = Math.max(0, base + wob * sw);
      if (half < 0.5) continue;
      ctx.fillRect(Math.round(w / 2 - half), h - 6 - y, Math.round(half * 2), 2);
    }
  }
  // 炭床
  ctx.fillStyle = shade(P.ember, -35);
  ctx.fillRect(2, h - 6, w - 4, 4);
  ctx.fillStyle = P.ember;
  for (let x = 3; x < w - 3; x += 3) if (rnd() < 0.5) ctx.fillRect(x, h - 5 + (rnd() * 2 | 0), 2, 1);
  // 零星火星
  ctx.fillStyle = P.candle;
  for (let i = 0; i < 3; i++) ctx.fillRect(4 + (rnd() * (w - 8) | 0), 6 + (rnd() * (h * 0.4) | 0), 1, 1);
}

// ---- 缓存/分发 ----

const SIZES = {
  wood: [128, 128], felt: [128, 128], fabric: [32, 32], brass: [64, 64],
  parchment: [128, 128], chalk: [64, 64], wall: [256, 256], floor: [128, 128],
  rug: [128, 128], barrel: [64, 128], tableFelt: [FELT_W, FELT_H], flame: [32, 48],
};

function canvasKey(kind, o = {}) {
  switch (kind) {
    case 'wood': return `wood|${o.tone ?? P.wood500}|${o.plankW ?? 8}`;
    case 'felt': return `felt|${o.color ?? P.feltTable}`;
    case 'fabric': return `fabric|${o.color ?? P.wood300}|${o.pattern ?? 'plain'}`;
    case 'brass': return `brass|${o.patina ?? 0}`;
    case 'tableFelt': return `tableFelt|${(o.spots ?? []).map(s => `${s.x.toFixed(2)},${s.z.toFixed(2)}`).join(';')}`;
    case 'flame': return `flame|${o.frame ?? 0}`;
    default: return kind; // parchment/chalk/wall/floor/rug/barrel 无参数
  }
}

export function canvasFor(kind, o = {}) {
  const key = canvasKey(kind, o);
  if (CANVAS_CACHE.has(key)) return CANVAS_CACHE.get(key);
  const [w, h] = SIZES[kind];
  const [c, ctx] = makeCanvas(w, h);
  // 种子由 key 派生:同 key 永远同图
  let seed = 7;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  const rnd = mulberry32(seed);
  switch (kind) {
    case 'wood': drawWood(ctx, w, h, o.tone ?? P.wood500, o.plankW ?? 8, rnd); break;
    case 'felt': drawFelt(ctx, w, h, o.color ?? P.feltTable, rnd); break;
    case 'fabric': drawFabric(ctx, w, h, o.color ?? P.wood300, o.pattern ?? 'plain', rnd); break;
    case 'brass': drawBrass(ctx, w, h, o.patina ?? 0, rnd); break;
    case 'parchment': drawParchment(ctx, w, h, rnd); break;
    case 'chalk': drawChalk(ctx, w, h, rnd); break;
    case 'wall': drawTavernWall(ctx, w, h, rnd); break;
    case 'floor': drawPlankFloor(ctx, w, h, rnd); break;
    case 'rug': drawRug(ctx, w, h, rnd); break;
    case 'barrel': drawBarrel(ctx, w, h, rnd); break;
    case 'tableFelt': drawTableFelt(ctx, w, h, o.spots ?? [], rnd); break;
    case 'flame': drawFlame(ctx, w, h, o.frame ?? 0); break;
    default: throw new Error(`texlib: unknown kind ${kind}`);
  }
  if (kind !== 'flame') edgeLine(ctx, w, h); // 透明火焰不描边
  CANVAS_CACHE.set(key, c);
  return c;
}

// 3D 纹理:按 (kind|opts|repeat) 缓存;repeat≠1 时启用平铺。
export function tex(kind, o = {}, rx = 1, ry = 1) {
  const key = `${canvasKey(kind, o)}|${rx}|${ry}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const t = new THREE.CanvasTexture(canvasFor(kind, o));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (rx !== 1 || ry !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
  }
  TEX_CACHE.set(key, t);
  return t;
}

// HUD 用低对比变体:基色打底 + 纹理按 strength 叠加(文字可读性优先)
function cssVariant(kind, o, baseHex, strength) {
  const src = canvasFor(kind, o);
  const [c, ctx] = makeCanvas(src.width, src.height);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = strength;
  ctx.drawImage(src, 0, 0);
  ctx.globalAlpha = 1;
  return c.toDataURL();
}

// 把共享材质写进 CSS 变量:HUD 面板与 3D 桌框字面同一张纹理(§1.1 第 4 路)
export function injectTextures() {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  style.setProperty('--tex-wood', `url(${cssVariant('wood', { tone: P.wood700 }, P.wood700, 0.25)})`);
  style.setProperty('--tex-parchment', `url(${canvasFor('parchment').toDataURL()})`);
  style.setProperty('--tex-chalk', `url(${canvasFor('chalk').toDataURL()})`);
}

injectTextures();
