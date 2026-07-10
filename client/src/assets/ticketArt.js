// 对质票券像素画单一真源（§8.8）：2D HUD（UiLayer#PixelTicket 的 SVG）与 3D（scene/textures.js#ticketTexture
// 的 canvas 贴图 + scene/Tickets3D.jsx 的锯齿挤出几何）共用这张网格与逐格配色，保证三处形状/纹理一致。
// 造型 = 素面邮票：左右**粗锯齿**（2 格宽 × 2 格深、齿距 2 格——细密版被打回）+ 暗金边框 + 带纸纹的纸面。
// 字符含义：B=边框(暗金) F=纸面(金,带纹理) S=锯齿齿尖(纸色) 空格=镂空。
export const TICKET_COLS = 28;
export const TICKET_ROWS = 18;
export const TOOTH_DEPTH = 2; // 齿深（格）——锯齿几何与网格同一判据

// 某行是否出齿：2 行齿 + 2 行凹交替（首尾都是齿，18 行 → 每边 5 颗粗齿）。
export const ticketRowWide = (row) => Math.floor(row / 2) % 2 === 0;

export const TICKET_GRID = Array.from({ length: TICKET_ROWS }, (_, y) => {
  let s = '';
  for (let x = 0; x < TICKET_COLS; x++) {
    if (x < TOOTH_DEPTH || x >= TICKET_COLS - TOOTH_DEPTH) { s += ticketRowWide(y) ? 'S' : ' '; continue; } // 齿区
    const border = y === 0 || y === TICKET_ROWS - 1 || x === TOOTH_DEPTH || x === TICKET_COLS - 1 - TOOTH_DEPTH;
    s += border ? 'B' : 'F';
  }
  return s;
});

export const TICKET_INK = '#6f5518';         // 边框暗金
export const TICKET_PAPER = '#e8c25a';       // 纸面金（=--px-gold）
const PAPER_LIGHT = '#f2d47e';               // 纸纹亮斑 / 内圈受光斜面
const PAPER_DARK = '#d4ad46';                // 纸纹暗斑 / 内圈背光斜面
const PAPER_DEEP = '#c39c3c';                // 更深的稀疏脏点

// 逐格配色（确定性，无随机）：边框=暗金；齿尖=纸色略暗（与边框衔接）；
// 纸面=内圈斜面（上/左受光、下/右背光）+ 杂色纸纹（哈希撒点）。贴图与 2D 实心票都走这里。
export function ticketCellColor(ch, x, y) {
  if (ch === 'B') return TICKET_INK;
  if (ch === 'S') return PAPER_DARK;
  // 纸面内圈斜面（紧贴边框一圈）：上/左亮、下/右暗（下/右优先——重叠角落取暗）
  const x0 = TOOTH_DEPTH + 1, x1 = TICKET_COLS - 2 - TOOTH_DEPTH; // 纸面左右界
  if (y === TICKET_ROWS - 2 || x === x1) return PAPER_DARK;
  if (y === 1 || x === x0) return PAPER_LIGHT;
  // 纸纹：哈希撒点（约 12% 暗斑、8% 亮斑、4% 深脏点）
  const h = (x * 31 + y * 17 + ((x * y) % 7)) % 100;
  if (h < 4) return PAPER_DEEP;
  if (h < 16) return PAPER_DARK;
  if (h > 91) return PAPER_LIGHT;
  return TICKET_PAPER;
}
