// 唯一权威的钞票视觉：用 canvas 画一张像素钞票，2D（手牌/飞行/协商）与 3D（桌面贴图）共用同一张，
// 保证手上与桌上的钞票完全一致。数字用自制点阵字体绘制。
import { glyphPoints, GLYPH_ADVANCE } from './pixelfont/glyphs';
import { DENOM_COLORS } from './palette';

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

function draw(ctx, { value = 1, faceDown = false, debt = false, locked = false }) {
  ctx.clearRect(0, 0, NW, NH);
  const theme = faceDown ? BACK : debt ? DEBT : (DENOM[value] || DENOM[1]);
  rect(ctx, 0, 0, NW, NH, theme.bg);
  // 外框
  rect(ctx, 0, 0, NW, 2, theme.ink); rect(ctx, 0, NH - 2, NW, 2, theme.ink);
  rect(ctx, 0, 0, 2, NH, theme.ink); rect(ctx, NW - 2, 0, 2, NH, theme.ink);
  // 内描边
  rect(ctx, 3, 3, NW - 6, 1, theme.accent); rect(ctx, 3, NH - 4, NW - 6, 1, theme.accent);
  rect(ctx, 3, 3, 1, NH - 6, theme.accent); rect(ctx, NW - 4, 3, 1, NH - 6, theme.accent);

  if (faceDown) {
    ctx.fillStyle = theme.accent;
    for (let y = 7; y < NH - 7; y += 4) for (let x = 7; x < NW - 7; x += 4) ctx.fillRect(x, y, 1, 1);
    rect(ctx, NW / 2 - 9, NH / 2 - 9, 18, 18, '#1a1d24');
    rect(ctx, NW / 2 - 9, NH / 2 - 9, 18, 2, '#b9892f');
    ctx.fillStyle = '#b9892f';
    ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('地', NW / 2, NH / 2 + 2);
    return;
  }

  const label = (debt ? '-' : '') + value;
  drawGlyphText(ctx, label, NW / 2, NH / 2 - 1, 3, theme.ink);           // 中央大数字
  drawGlyphText(ctx, String(value), 9, 10, 1, theme.ink);                // 左上角标
  drawGlyphText(ctx, String(value), NW - 9, NH - 10, 1, theme.ink);      // 右下角标
  drawGlyphText(ctx, debt ? 'DEBT' : 'YUAN', NW / 2, NH - 9, 1, theme.ink);

  if (locked) {
    rect(ctx, 0, 0, NW, NH, 'rgba(8,9,13,0.55)');
    const lx = NW / 2 - 6, ly = NH / 2 - 1;
    rect(ctx, lx, ly, 12, 9, '#cfd4dc');
    rect(ctx, lx + 3, ly - 5, 6, 5, '#cfd4dc'); rect(ctx, lx + 4, ly - 4, 4, 4, '#1a1d24');
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
