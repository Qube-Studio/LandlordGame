// 唯一权威的钞票视觉：用 canvas 画一张像素钞票，2D（手牌/飞行/协商）与 3D（桌面贴图）共用同一张，
// 保证手上与桌上的钞票完全一致。数字用自制点阵字体绘制。
import { glyphPoints, GLYPH_ADVANCE } from './pixelfont/glyphs';
import { DENOM_COLORS, PROP_COLORS, shade } from './palette';

export const NOTE_ASPECT = 1.4; // 高/宽
const NW = 44, NH = 62;         // 低分辨率像素网格（放大显示=硬像素）

const DENOM = { 10: DENOM_COLORS[10], 5: DENOM_COLORS[5], 2: DENOM_COLORS[2], 1: DENOM_COLORS[1] };
const DEBT = DENOM_COLORS.DEBT;
const BACK = DENOM_COLORS.BACK;

function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function drawGlyphText(ctx, text, cx, cy, cell, color) {
  const cells = text.length * GLYPH_ADVANCE - 1;
  const x0 = Math.round(cx - (cells * cell) / 2);
  const y0 = Math.round(cy - (7 * cell) / 2);
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const pts = glyphPoints(text[i]);
    if (!pts) continue;
    const ox = x0 + i * GLYPH_ADVANCE * cell;
    for (const [px, py] of pts) ctx.fillRect(ox + px * cell, y0 + py * cell, cell, cell);
  }
}

// 面额水印(8×8 点阵,ART_BIBLE §1.6):10=城楼 5=麦穗 2=河纹 1=铜钱
const WATERMARKS = {
  10: ['00100100', '01111110', '01011010', '11111111', '10111101', '10100101', '10111101', '11111111'],
  5:  ['00011000', '00111100', '01011010', '00111100', '01011010', '00111100', '00011000', '00011000'],
  2:  ['00000000', '01100110', '10011001', '00000000', '01100110', '10011001', '00000000', '00000000'],
  1:  ['00111100', '01111110', '11100111', '11011011', '11011011', '11100111', '01111110', '00111100'],
};

function drawWatermark(ctx, value, color) {
  const bits = WATERMARKS[value] || WATERMARKS[1];
  const cell = 3;
  const x0 = Math.round(NW / 2 - 4 * cell), y0 = Math.round(NH / 2 - 4 * cell);
  ctx.fillStyle = color;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (bits[y][x] === '1') ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
  }
}

function draw(ctx, { value = 1, faceDown = false, debt = false, locked = false }) {
  ctx.clearRect(0, 0, NW, NH);
  const theme = faceDown ? BACK : debt ? DEBT : (DENOM[value] || DENOM[1]);
  rect(ctx, 0, 0, NW, NH, theme.bg);
  // 纸张噪声(±5% 细颗粒,确定性伪随机——同参数永远同图,缓存友好)
  let s = value * 131 + (faceDown ? 7 : 0) + (debt ? 13 : 0) + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 2; y < NH - 2; y += 2) for (let x = 2; x < NW - 2; x += 2) {
    if (rnd() < 0.26) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, 2, 2);
    }
  }
  // 外框
  rect(ctx, 0, 0, NW, 2, theme.ink); rect(ctx, 0, NH - 2, NW, 2, theme.ink);
  rect(ctx, 0, 0, 2, NH, theme.ink); rect(ctx, NW - 2, 0, 2, NH, theme.ink);

  if (debt && !faceDown) {
    // 债务牌:锁链纹边(环环相扣的段+销)
    ctx.fillStyle = theme.accent;
    for (let x = 4; x < NW - 6; x += 5) { ctx.fillRect(x, 3, 3, 2); ctx.fillRect(x + 3, 4, 2, 1); ctx.fillRect(x, NH - 5, 3, 2); ctx.fillRect(x + 3, NH - 5, 2, 1); }
    for (let y = 4; y < NH - 6; y += 5) { ctx.fillRect(3, y, 2, 3); ctx.fillRect(4, y + 3, 1, 2); ctx.fillRect(NW - 5, y, 2, 3); ctx.fillRect(NW - 5, y + 3, 1, 2); }
  } else {
    // 扭索波纹内描边(2px 相位交替) + 四角花角
    ctx.fillStyle = theme.accent;
    for (let x = 4; x < NW - 4; x++) {
      const o = (x >> 1) % 2;
      ctx.fillRect(x, 3 + o, 1, 1); ctx.fillRect(x, NH - 5 + (1 - o), 1, 1);
    }
    for (let y = 4; y < NH - 4; y++) {
      const o = (y >> 1) % 2;
      ctx.fillRect(3 + o, y, 1, 1); ctx.fillRect(NW - 5 + (1 - o), y, 1, 1);
    }
    for (const [cx, cy] of [[3, 3], [NW - 6, 3], [3, NH - 6], [NW - 6, NH - 6]]) {
      ctx.fillRect(cx, cy, 3, 3); ctx.fillStyle = theme.bg; ctx.fillRect(cx + 1, cy + 1, 1, 1); ctx.fillStyle = theme.accent;
    }
  }

  if (faceDown) {
    // 背面:菱点底纹 + 火漆印章(压纹 + 点阵「王」),弃字体渲染
    ctx.fillStyle = theme.accent;
    for (let y = 7; y < NH - 7; y += 4) for (let x = 7 + ((y / 4) % 2) * 2; x < NW - 7; x += 4) ctx.fillRect(x, y, 1, 1);
    const cx = NW / 2, cy = NH / 2;
    ctx.fillStyle = shade(PROP_COLORS.wax, -25);
    ctx.beginPath(); ctx.arc(cx + 1, cy + 1, 10, 0, Math.PI * 2); ctx.fill();   // 压痕暗边
    ctx.fillStyle = PROP_COLORS.wax;
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shade(PROP_COLORS.wax, 28); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 7.5, 0, Math.PI * 2); ctx.stroke();        // 内压环
    ctx.fillStyle = shade(PROP_COLORS.wax, 55);                                  // 「王」印文
    rect(ctx, cx - 4, cy - 5, 8, 2, ctx.fillStyle);
    rect(ctx, cx - 3, cy - 1, 6, 2, ctx.fillStyle);
    rect(ctx, cx - 4, cy + 3, 8, 2, ctx.fillStyle);
    rect(ctx, cx - 1, cy - 5, 2, 10, ctx.fillStyle);
    return;
  }

  // 中央大数字:凸版三层(右下暗影 → 左上高光 → 主体)
  const label = (debt ? '-' : '') + value;
  drawWatermark(ctx, value, debt ? shade(theme.bg, -8) : shade(theme.bg, 8)); // 水印垫底
  drawGlyphText(ctx, label, NW / 2 + 1, NH / 2, 3, shade(theme.ink, -35));
  drawGlyphText(ctx, label, NW / 2 - 1, NH / 2 - 2, 3, theme.accent);
  drawGlyphText(ctx, label, NW / 2, NH / 2 - 1, 3, theme.ink);
  drawGlyphText(ctx, String(value), 9, 10, 1, theme.ink);                // 左上角标
  drawGlyphText(ctx, String(value), NW - 9, NH - 10, 1, theme.ink);      // 右下角标
  drawGlyphText(ctx, debt ? 'DEBT' : 'YUAN', NW / 2, NH - 9, 1, theme.ink);
  // 序列号行(确定性,每面额一号)
  drawGlyphText(ctx, `NO${String((value * 7919) % 10000).padStart(4, '0')}`, NW / 2, NH - 16, 1, shade(theme.ink, 25));

  if (locked) {
    rect(ctx, 0, 0, NW, NH, 'rgba(8,9,13,0.55)');
    const lx = NW / 2 - 6, ly = NH / 2 - 1;
    rect(ctx, lx, ly, 12, 9, PROP_COLORS.hatBand);                        // 黄铜锁体
    rect(ctx, lx + 1, ly + 1, 10, 1, shade(PROP_COLORS.hatBand, 30));     // 锁体高光
    rect(ctx, lx + 3, ly - 5, 6, 5, PROP_COLORS.hatBand); rect(ctx, lx + 4, ly - 4, 4, 4, '#1a1d24');
    rect(ctx, lx + 5, ly + 3, 2, 3, '#1a1d24');
  }
}

const CANVAS_CACHE = new Map();
const URL_CACHE = new Map();
const keyOf = (o) => `${o.value || 1}|${o.faceDown ? 1 : 0}|${o.debt ? 1 : 0}|${o.locked ? 1 : 0}`;

export function noteCanvas(o) {
  const k = keyOf(o);
  if (CANVAS_CACHE.has(k)) return CANVAS_CACHE.get(k);
  const c = document.createElement('canvas');
  c.width = NW; c.height = NH;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, o);
  CANVAS_CACHE.set(k, c);
  return c;
}

export function noteDataUrl(o) {
  const k = keyOf(o);
  if (URL_CACHE.has(k)) return URL_CACHE.get(k);
  const u = noteCanvas(o).toDataURL();
  URL_CACHE.set(k, u);
  return u;
}
