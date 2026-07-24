// 枪口特效素材（§3.9）：程序化 canvas 单一真源（项目纹理惯例）。**真实感规范**（设计者钦定，
// 不走像素化）：一版单层径向渐变=结构单一的"光滑棉花糖"，假——真实烟/焰的关键是
// **fBM 噪声调制**：絮状内部密度 + 噪声扰动的不规则边缘 + 火焰的花瓣状轮廓。
// 128px/96px + LinearFilter（特效层豁免像素规范）；预生成变体池（每张独立噪声种子），每发随机取。
import * as THREE from 'three';

function linearTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// 2D 值噪声（平铺）：随机格点 + smoothstep 双线性插值；fbm = 三个八度叠加
function makeNoise2D(cells = 8) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = Math.random();
  const at = (xi, yi) => g[((yi % cells + cells) % cells) * cells + ((xi % cells + cells) % cells)];
  const ss = (u) => u * u * (3 - 2 * u);
  return (x, y) => { // x,y ∈ [0,1) 平铺采样
    const fx = x * cells, fy = y * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = ss(fx - x0), ty = ss(fy - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c2 = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c2 - a) * ty + (a - b - c2 + d) * tx * ty;
  };
}
function makeFbm() {
  const n1 = makeNoise2D(4), n2 = makeNoise2D(8), n3 = makeNoise2D(16);
  return (x, y) => n1(x, y) * 0.5 + n2(x, y) * 0.3 + n3(x, y) * 0.2;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (lo, hi, v) => { const t = clamp01((v - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

// 烟雾（128px）：径向衰减 × fBM 絮状密度，边缘半径被噪声扰动出不规则轮廓；暖灰、亮度絮状起伏。
export function makeSmokeTextures(n = 4, size = 128) {
  const out = [];
  for (let v = 0; v < n; v++) {
    const fbmA = makeFbm(), fbmB = makeFbm();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / size, ny = y / size;
        const dx = nx - 0.5, dy = ny - 0.5;
        const d = Math.hypot(dx, dy) * 2;               // 0 中心 → 1 内切圆
        const edge = fbmA(nx, ny);                       // 边缘扰动场
        const rad = d * (1.25 - 0.5 * edge);             // 噪声半径：轮廓不规则
        const fall = 1 - sstep(0.5, 1.0, rad);           // 软衰减
        if (fall <= 0) continue;
        const density = 0.45 + 0.55 * fbmB(nx * 1.7 % 1, ny * 1.7 % 1); // 内部絮状
        const a = clamp01(fall * density);
        const lum = 175 + 60 * fbmB(nx, ny);             // 暖灰亮度起伏
        const i4 = (y * size + x) * 4;
        img.data[i4] = lum;
        img.data[i4 + 1] = lum * 0.985;
        img.data[i4 + 2] = lum * 0.94;
        img.data[i4 + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    out.push(linearTex(c));
  }
  return out;
}

// 火光（96px）：花瓣状轮廓（角向 1D 噪声调制最大半径）+ 白热过曝核心 → 淡黄 → 橙 → 深橙红
// 色带渐变 + 外围火星点。additive billboard 用。
export function makeFlashTextures(n = 3, size = 96) {
  const out = [];
  for (let v = 0; v < n; v++) {
    // 角向噪声环（16 值，cos 平滑插值，平铺）
    const ring = Array.from({ length: 16 }, () => Math.random());
    const petal = (th) => {
      const f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * 16;
      const i0 = Math.floor(f) % 16, i1 = (i0 + 1) % 16;
      const t = (1 - Math.cos((f - Math.floor(f)) * Math.PI)) / 2;
      return ring[i0] + (ring[i1] - ring[i0]) * t;
    };
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x / size) - 0.5, dy = (y / size) - 0.5;
        const d = Math.hypot(dx, dy) * 2;
        const th = Math.atan2(dy, dx);
        const rmax = 0.34 + 0.5 * petal(th);             // 花瓣轮廓
        const t = d / rmax;
        if (t > 1 && d > 0.1) continue;
        const a = d <= 0.1 ? 1 : Math.pow(1 - t, 1.25);  // 核心过曝、向外衰减
        let r, g2, b;
        if (t < 0.16 || d <= 0.08) { r = 255; g2 = 255; b = 244; }        // 白热
        else if (t < 0.42) { r = 255; g2 = 232; b = 170; }                // 淡黄
        else if (t < 0.72) { r = 255; g2 = 164; b = 64; }                 // 橙
        else { r = 230; g2 = 110; b = 30; }                               // 深橙红
        const i4 = (y * size + x) * 4;
        img.data[i4] = r; img.data[i4 + 1] = g2; img.data[i4 + 2] = b;
        img.data[i4 + 3] = clamp01(a) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 外围火星点（过曝小高斯斑）
    for (let i = 0; i < 7; i++) {
      const a2 = Math.random() * Math.PI * 2;
      const rr = size * (0.3 + Math.random() * 0.16);
      const sx = size / 2 + Math.cos(a2) * rr, sy = size / 2 + Math.sin(a2) * rr;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 1.6 + Math.random() * 1.6);
      g.addColorStop(0, 'rgba(255,235,190,0.95)');
      g.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    out.push(linearTex(c));
  }
  return out;
}
