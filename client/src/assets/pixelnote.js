// 唯一权威的钞票视觉：用 canvas 画一张像素钞票，2D（手牌/飞行/协商）与 3D（桌面贴图）共用同一张，
// 保证手上与桌上的钞票完全一致。数字用自制点阵字体绘制。
import { glyphPoints, GLYPH_ADVANCE, CANDLE_ROWS } from './pixelfont/glyphs';
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

// 蜡烛点阵(= 货币符 ¥ 同一份 CANDLE_ROWS,5×7):水印与背面火漆章共用,单一真源。
// 货币=蜡烛后,钞票的身份母题就是这枚蜡烛——不再用旧朝代的城楼/麦穗/河纹/铜钱。
function drawCandleGlyph(ctx, cx, cy, cell, color) {
  const x0 = Math.round(cx - (5 * cell) / 2);
  const y0 = Math.round(cy - (CANDLE_ROWS.length * cell) / 2);
  ctx.fillStyle = color;
  for (let y = 0; y < CANDLE_ROWS.length; y++) {
    const row = CANDLE_ROWS[y];
    for (let x = 0; x < row.length; x++) if (row[x] === '1') ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
  }
}

// 底部烛焰计数条(照素材版式):N 个焰点落在黄铜横轨上,N=面额(>5 折两行,10=两行5)。
// 正常牌=暗焰身 + 亮焰尖(accent);债务牌=熄灭的暗桩(无亮尖),与红底/锁链/负数一同读作「债」。
function drawTally(ctx, value, theme, debt) {
  const railY = NH - 9, rowH = 4, gap = 5;
  const rows = value > 5 ? 2 : 1;
  const perRow = Math.ceil(value / rows);
  for (let r = 0; r < rows; r++) {
    const n = r === rows - 1 ? value - perRow * r : perRow;
    const rowW = n * gap - (gap - 3);
    const sx = Math.round(NW / 2 - rowW / 2);
    const py = railY - (rows - r) * rowH - 1;
    for (let i = 0; i < n; i++) {
      const px = sx + i * gap;
      ctx.fillStyle = debt ? shade(theme.bg, -28) : theme.ink;
      ctx.fillRect(px, py + 1, 3, 3);                                   // 焰身
      if (!debt) { ctx.fillStyle = theme.accent; ctx.fillRect(px + 1, py, 1, 1); } // 亮焰尖
    }
  }
  ctx.fillStyle = theme.accent;                                        // 黄铜横轨 + 两端封头
  ctx.fillRect(10, railY, NW - 20, 1);
  ctx.fillRect(10, railY - 1, 1, 3);
  ctx.fillRect(NW - 11, railY - 1, 1, 3);
}

function draw(ctx, { value = 1, faceDown = false, debt = false, locked = false }) {
  ctx.clearRect(0, 0, NW, NH);
  const theme = faceDown ? BACK : debt ? DEBT : (DENOM[value] || DENOM[1]);
  rect(ctx, 0, 0, NW, NH, theme.bg);
  // 纸张噪声(轻,确定性伪随机——同参数永远同图,缓存友好;密度压低保持版面干净)
  let s = value * 131 + (faceDown ? 7 : 0) + (debt ? 13 : 0) + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 2; y < NH - 2; y += 2) for (let x = 2; x < NW - 2; x += 2) {
    if (rnd() < 0.10) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.035)';
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
    drawCandleGlyph(ctx, cx, cy, 2, shade(PROP_COLORS.wax, 55));                  // 蜡烛印文(货币=蜡烛)
    return;
  }

  // 中央大数字:凸版两层(右下暗影 → 主体)。蜡烛水印极淡垫底(货币=蜡烛),框住数字不抢戏。
  const label = (debt ? '-' : '') + value;
  drawCandleGlyph(ctx, NW / 2, NH / 2, 4, debt ? shade(theme.bg, -8) : shade(theme.bg, 8)); // 蜡烛水印
  drawGlyphText(ctx, label, NW / 2 + 1, NH / 2, 3, shade(theme.ink, -35));
  drawGlyphText(ctx, label, NW / 2, NH / 2 - 1, 3, theme.ink);
  drawGlyphText(ctx, '¥' + value, 15, 10, 1, theme.ink);            // 左上角标:蜡烛符(¥)+ 面额
  drawTally(ctx, value, theme, debt);                                   // 底部烛焰计数条(N 焰=面额)

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
