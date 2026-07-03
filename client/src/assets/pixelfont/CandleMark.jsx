// 货币蜡烛标记：与 PixelText 的 ¥ 字形同一份点阵(CANDLE_ROWS),用于中文散文行里内联货币符
// (PixelText 是不换行的 flex 段，不便塞进句子中间；这里渲染成一枚随文字基线对齐的小 SVG)。
// 颜色默认继承 currentColor —— 落在 danger 行就是红蜡烛、ok 行就是绿蜡烛，与句子语气一致。
import { CANDLE_ROWS } from './glyphs';

const RECTS = [];
CANDLE_ROWS.forEach((row, y) => {
  for (let x = 0; x < row.length; x++) if (row[x] === '1') RECTS.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />);
});

export default function CandleMark({ size = 12, color = 'currentColor', title }) {
  const w = (5 / 7) * size;
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 5 7"
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'inline-block', verticalAlign: '-0.12em', fill: color, flexShrink: 0 }}
    >
      {RECTS}
    </svg>
  );
}
