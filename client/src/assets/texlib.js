// 程序化纹理库(docs/ART_BIBLE.md §1.3):木纹/毛毡/织物/黄铜/羊皮纸/黑板 五基材 +
// 墙面/地板/圆毯/酒桶/桌毡/火焰 合成纹理。全部:
//   - mulberry32 种子 PRNG(同 key 永远同图,可缓存可复现)
//   - 按参数 key 缓存,永不逐帧重画
//   - NearestFilter 硬像素;每张最外圈压暗 25% 烘成描边(像素勾线,零几何成本)
// 消费方:3D 用 tex(kind, opts, rx, ry);HUD 用 injectTextures() 写好的 --tex-* CSS 变量。
import * as THREE from 'three';
import { P, ROLE_CLOTH, shade } from './palette';

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
  // 无毛边/无描边:此纹理供 CSS 大面积平铺,任何边缘处理都会变成接缝格线
  noiseFill(ctx, w, h, P.parchment, 0.03, rnd, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';       // 纤维划痕
  for (let i = 0; i < 30; i++) {
    const x = rnd() * w | 0, y = rnd() * h | 0, len = 3 + (rnd() * 9 | 0);
    if (rnd() < 0.5) ctx.fillRect(x, y, len, 1); else ctx.fillRect(x, y, 1, len);
  }
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

// 世界系正圆 → 纹理系椭圆的纵横比补偿:纹理 512² 铺在 6.6×4.0 桌面上,
// x 向 512/6.6≈77.6 px/单位、z 向 512/4.0=128 px/单位,直接画圆会被拉成椭圆(玩家反馈⑦)。
const feltRU = (r) => r * (FELT_W / 6.6);
const feltRV = (r) => r * (FELT_H / 4.0);

function drawTableFelt(ctx, w, h, spots, rnd) {
  drawFelt(ctx, w, h, P.feltTable, rnd, 4);
  // 四周金色缝线边(双线内缩)
  ctx.strokeStyle = 'rgba(202,160,78,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.setLineDash([]);
  ctx.strokeRect(18, 18, w - 36, h - 36);
  // 中央硬币双环(世界半径 0.55/0.75 的正圆)+ 环内王/禾对半暗纹
  const cx = feltU(0), cy = feltV(0);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath(); ctx.ellipse(cx, cy, feltRU(0.55), feltRV(0.55), 0, Math.PI / 2, Math.PI * 3 / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath(); ctx.ellipse(cx, cy, feltRU(0.55), feltRV(0.55), 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(202,160,78,0.5)';
  ctx.setLineDash([6, 5]);
  for (const r of [0.55, 0.75]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, feltRU(r), feltRV(r), 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(cx | 0, (cy - feltRV(0.55)) | 0, 1, feltRV(0.55) * 2 | 0); // 对半分隔线
  // 每个钱堆落点一个虚线正圆下注位(世界半径 0.45,收进缝线边内不压线)
  ctx.strokeStyle = 'rgba(202,160,78,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  for (const s of spots) {
    ctx.beginPath();
    ctx.ellipse(feltU(s.x), feltV(s.z), feltRU(0.45), feltRV(0.45), 0, 0, Math.PI * 2);
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
    // 画布 y 向下:焰尖在顶部(窄)、焰基在底部炭床上方(宽)
    for (let y = 0; y < h - 6; y += 2) {
      const p = y / (h - 6);                            // 0 顶(尖) → 1 底(宽)
      const base = (1 - Math.pow(1 - p, 1.6)) * (w / 2) * sw;
      const wob = Math.sin((1 - p) * 9 + frame * 2.1) * 2.2 * (1 - p) + (rnd() * 2 - 1) * 1.4;
      const half = Math.max(0, base + wob * sw);
      if (half < 0.5) continue;
      ctx.fillRect(Math.round(w / 2 - half), y, Math.round(half * 2), 2);
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
  abacus: [32, 24],
};

// 投资人手持算盘(1 plane,珠纹烘死)
function drawAbacus(ctx, w, h, rnd) {
  ctx.fillStyle = P.wood500; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = P.wood900;
  ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, h - 2, w, 2);
  ctx.fillRect(0, 0, 2, h); ctx.fillRect(w - 2, 0, 2, h);
  ctx.fillRect(2, 8, w - 4, 1); // 梁
  for (let x = 5; x < w - 4; x += 5) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, 2, 1, h - 4);               // 杆
    ctx.fillStyle = P.brassHi;
    ctx.fillRect(x - 1, 3 + (rnd() * 3 | 0), 3, 2);   // 上珠
    ctx.fillStyle = shade(P.wood300, 25);
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 1, 10 + i * 4 + (rnd() < 0.5 ? 1 : 0), 3, 2); // 下珠
  }
}

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
    case 'abacus': drawAbacus(ctx, w, h, rnd); break;
    default: throw new Error(`texlib: unknown kind ${kind}`);
  }
  // 透明火焰不描边;羊皮纸/黑板供 CSS 大面积平铺,描边会变成接缝格线,也不烘
  if (!['flame', 'parchment', 'chalk'].includes(kind)) edgeLine(ctx, w, h);
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

// ============================================================
// 角色全身皮肤(ART_BIBLE §1.5):每个身体 box 的每个面一张 16×16,按四元组缓存。
// 通用:织纹 ±5%、顶面+8%/底面−10% AO、最外圈压暗 25%(烘焙描边);
// 角色个性烘在布料里;破产在 canvas 内烘灰(保留织纹层次)。
// ============================================================

const SKIN_CACHE = new Map();

// 16 格画笔
function px16(ctx) {
  return (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
}

// 表情(原 textures.js#faceTexture 的分支逻辑并入 head/front)
function drawExpression(px, expression) {
  const dark = '#21262e';
  const eyeY = 6;
  if (expression === 'bankrupt') {
    px(3, 5, 1, 1, dark); px(5, 7, 1, 1, dark); px(3, 7, 1, 1, dark); px(5, 5, 1, 1, dark); px(4, 6, 1, 1, dark);
    px(10, 5, 1, 1, dark); px(12, 7, 1, 1, dark); px(10, 7, 1, 1, dark); px(12, 5, 1, 1, dark); px(11, 6, 1, 1, dark);
  } else if (expression === 'win') {
    px(3, 6, 1, 1, dark); px(4, 5, 1, 1, dark); px(5, 6, 1, 1, dark);
    px(10, 6, 1, 1, dark); px(11, 5, 1, 1, dark); px(12, 6, 1, 1, dark);
  } else if (expression === 'bet') {
    px(3, eyeY, 3, 1, dark); px(10, eyeY, 3, 1, dark);
  } else {
    px(3, eyeY, 2, 2, '#ffffff'); px(4, eyeY, 1, 2, dark);
    px(11, eyeY, 2, 2, '#ffffff'); px(11, eyeY, 1, 2, dark);
  }
  if (expression === 'lose') { px(3, 5, 3, 1, P.hair); px(10, 5, 3, 1, P.hair); }
  if (!['bankrupt', 'lose'].includes(expression)) { px(2, 9, 2, 1, '#e09478'); px(12, 9, 2, 1, '#e09478'); }
  const mouth = '#7a4a36';
  if (expression === 'win') px(6, 11, 4, 2, mouth);
  else if (expression === 'lose') { px(6, 12, 4, 1, mouth); px(5, 13, 1, 1, mouth); px(10, 13, 1, 1, mouth); } // 嘴角下垂=丧气脸

  else if (expression === 'ready') px(6, 11, 4, 1, mouth);
  else if (expression === 'bet') { px(6, 11, 4, 1, mouth); px(9, 10, 1, 1, mouth); } // 赌徒坏笑
  else if (expression === 'bankrupt') px(6, 12, 4, 2, '#4b4f57');
  else px(6, 11, 4, 1, mouth);
}

// 头部各面:发/耳/颈影
function drawHeadFace(ctx, px, face, expression, rnd) {
  noiseFill(ctx, 16, 16, P.skin, 0.03, rnd, 2);
  if (face === 'top') { px(0, 0, 16, 16, P.hair); px(3, 3, 4, 3, shade(P.hair, 12)); }
  else if (face === 'bottom') px(0, 0, 16, 16, shade(P.skin, -14));
  else if (face === 'front') {
    px(0, 0, 16, 4, P.hair);
    px(0, 0, 2, 9, P.hair); px(14, 0, 2, 9, P.hair);
    drawExpression(px, expression);
  } else if (face === 'back') {
    px(0, 0, 16, 10, P.hair);
    for (let x = 0; x < 16; x += 3) px(x, 10, 2, 1 + (x % 2), P.hair); // 发脚参差
  } else {
    // 左/右侧:发带 + 耳朵
    px(0, 0, 16, 5, P.hair);
    px(0, 0, 3, 9, P.hair); px(13, 0, 3, 9, P.hair);
    px(7, 7, 3, 4, shade(P.skin, -8)); px(8, 8, 1, 2, shade(P.skin, -18)); // 耳
  }
}

// 身体正面的角色个性(布料即人设)
function drawBodyFront(px, role, cloth) {
  if (role === 'landlord') {
    for (let y = 2; y < 12; y += 4) for (let x = (y / 4 % 2) * 2 + 1; x < 15; x += 4) { // 金锦缎菱格
      px(x, y, 1, 1, P.brassHi); px(x - 1, y + 1, 1, 1, P.brassHi); px(x + 1, y + 1, 1, 1, P.brassHi); px(x, y + 2, 1, 1, P.brassHi);
    }
    px(0, 12, 16, 3, shade(cloth.pants, -20));       // 深色腰带
    px(7, 12, 2, 3, shade(P.ok, -15));               // 玉佩
  } else if (role === 'capitalist') {
    for (let x = 2; x < 16; x += 3) px(x, 0, 1, 16, shade(cloth.shirt, 18)); // 细条纹
    px(5, 0, 6, 2, '#f0ede4'); px(6, 2, 4, 2, '#f0ede4'); px(7, 4, 2, 1, '#f0ede4'); // 白 V 领
    px(7, 2, 2, 8, '#1c1a20');                        // 领带
    px(3, 8, 1, 1, P.brassHi); px(4, 9, 1, 1, P.brassHi); px(5, 10, 1, 1, P.brassHi); px(6, 10, 1, 1, P.brassHi); // 怀表链
    px(2, 8, 2, 2, shade(P.brassHi, -10));            // 怀表
  } else if (role === 'farmer') {
    px(2, 3, 5, 4, shade(cloth.shirt, -18)); px(2, 3, 5, 1, shade(cloth.shirt, -35)); // 补丁1
    px(10, 8, 4, 3, shade(cloth.shirt, 16)); px(10, 8, 1, 3, shade(cloth.shirt, -25)); // 补丁2
    for (let x = 0; x < 16; x += 3) px(x, 13, 2, 2, P.wood300); // 草绳腰带
  } else if (role === 'investor') {
    px(0, 0, 3, 16, shade(cloth.shirt, -22)); px(13, 0, 3, 16, shade(cloth.shirt, -22)); // 马甲对襟
    px(6, 0, 4, 3, '#f0ede4'); px(7, 3, 2, 2, '#f0ede4');  // 衬衫
    px(7, 2, 2, 7, shade(cloth.pants, -25));           // 领带
    px(11, 3, 1, 4, '#f0ede4'); px(11, 2, 1, 1, P.brassHi); // 胸袋钢笔
  } else if (role === 'glutton') {
    px(3, 3, 10, 13, shade(P.parchment, -8));          // 围裙
    px(3, 3, 10, 1, shade(P.parchment, -30));
    px(5, 6, 2, 2, P.wax); px(9, 9, 1, 2, P.wax); px(7, 12, 2, 1, P.wax); px(11, 5, 1, 1, P.wax); // 酱渍飞溅
  }
}

// 每面 16² 皮肤画布:part∈head/body/arm/leg,face∈front/back/left/right/top/bottom
export function skinCanvas({ role = 'none', part, face, expression = 'idle', bankrupt = false }) {
  const key = `${role}|${part}|${face}|${part === 'head' ? expression : ''}|${bankrupt ? 1 : 0}`;
  if (SKIN_CACHE.has(key)) return SKIN_CACHE.get(key);
  const [c, ctx] = makeCanvas(16, 16);
  let seed = 5;
  for (let i = 0; i < key.length; i++) seed = (seed * 33 + key.charCodeAt(i)) | 0;
  const rnd = mulberry32(seed);
  const px = px16(ctx);
  const cloth = ROLE_CLOTH[role] ?? ROLE_CLOTH.none;

  if (part === 'head') {
    drawHeadFace(ctx, px, face, expression, rnd);
  } else {
    const base = part === 'body' ? cloth.shirt : part === 'arm' ? cloth.sleeve : cloth.pants;
    // 织纹底(2×2 交错 ±5%)
    const [r, g, b] = hexRgb(base);
    for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) {
      const f = 1 + (((x + y) / 2) % 2 === 0 ? 0.05 : -0.05) + (rnd() * 2 - 1) * 0.02;
      ctx.fillStyle = `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;
      ctx.fillRect(x, y, 2, 2);
    }
    if (part === 'body' && face === 'front') drawBodyFront(px, role, cloth);
    if (part === 'body' && face === 'back' && role === 'glutton') { // 围裙系带
      px(4, 4, 8, 1, shade(P.parchment, -8)); px(7, 5, 2, 3, shade(P.parchment, -8));
    }
    if (part === 'arm') {
      if (face !== 'top') px(0, 13, 16, 3, P.skin);   // 手
      if (face === 'bottom') px(0, 0, 16, 16, P.skin);
      if (role === 'glutton' && face !== 'bottom') { px(0, 9, 16, 1, '#f0ede4'); px(0, 11, 16, 1, '#f0ede4'); } // 条纹卷袖
      if (role === 'investor' && face !== 'bottom') { px(0, 8, 16, 4, shade(cloth.sleeve, -25)); px(0, 8, 16, 1, shade(cloth.sleeve, -40)); } // 袖套
    }
    if (part === 'leg') {
      if (face !== 'top' && face !== 'bottom') px(0, 14, 16, 2, P.wood900); // 鞋
      if (face === 'bottom') px(0, 0, 16, 16, P.wood900);
      if (role === 'farmer' && face === 'front') { px(3, 11, 1, 1, P.wood300); px(9, 12, 2, 1, P.wood300); px(13, 11, 1, 1, P.wood300); } // 泥点
    }
  }

  // 顶面受光/底面 AO
  if (face === 'top') { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, 0, 16, 16); }
  if (face === 'bottom') { ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(0, 0, 16, 16); }
  edgeLine(ctx, 16, 16);

  // 破产:canvas 内烘灰(保层次) + 衣料裂纹
  if (bankrupt) {
    const img = ctx.getImageData(0, 0, 16, 16);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      d[i] = l * 0.52; d[i + 1] = l * 0.52; d[i + 2] = l * 0.56;
    }
    ctx.putImageData(img, 0, 0);
    if (part !== 'head') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(3, 2, 1, 5); ctx.fillRect(4, 7, 1, 3); ctx.fillRect(11, 5, 1, 6);
    }
  }
  SKIN_CACHE.set(key, c);
  return c;
}

// 皮肤 THREE 纹理(与 skinCanvas 同 key 缓存)
const SKIN_TEX_CACHE = new Map();
export function skinTex(o) {
  const key = `${o.role}|${o.part}|${o.face}|${o.part === 'head' ? (o.expression ?? 'idle') : ''}|${o.bankrupt ? 1 : 0}`;
  if (SKIN_TEX_CACHE.has(key)) return SKIN_TEX_CACHE.get(key);
  const t = new THREE.CanvasTexture(skinCanvas(o));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  SKIN_TEX_CACHE.set(key, t);
  return t;
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
