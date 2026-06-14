// 像素文本渲染器：把字符串拆成「ASCII 连续段」与「非 ASCII（中文）字符」。
// ASCII 段用自制 5×7 点阵字体渲染为一张 crispEdges 的 SVG；中文回退到像素中文字体类 .pixel-cjk。
// size = 单个像素点的边长(px)。字高固定 7 个像素点 = 7*size。

import { GLYPH_ADVANCE, GLYPH_H, glyphPoints, hasGlyph } from './glyphs';

// 把 ASCII 段渲染成一张 SVG（每个点亮像素一个 rect）
function AsciiRun({ run, size, color }) {
  const cells = run.length * GLYPH_ADVANCE - 1; // 去掉末尾字间距
  const w = cells * size;
  const h = GLYPH_H * size;
  const rects = [];
  for (let i = 0; i < run.length; i++) {
    const pts = glyphPoints(run[i]);
    if (!pts) continue;
    const ox = i * GLYPH_ADVANCE;
    for (const [px, py] of pts) {
      rects.push(<rect key={`${i}-${px}-${py}`} x={ox + px} y={py} width={1.02} height={1.02} />);
    }
  }
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${cells} ${GLYPH_H}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', fill: color, flexShrink: 0 }}
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}

export default function PixelText({
  children,
  size = 3,
  color = 'currentColor',
  className = '',
  style,
  title,
  as: Tag = 'span',
}) {
  const text = String(children ?? '');
  const h = GLYPH_H * size;

  // 分段：连续 ASCII 合成一段；非 ASCII 单独成块
  const parts = [];
  let buf = '';
  const flush = () => { if (buf) { parts.push({ ascii: true, text: buf }); buf = ''; } };
  for (const ch of text) {
    if (hasGlyph(ch)) buf += ch;
    else { flush(); parts.push({ ascii: false, text: ch }); }
  }
  flush();

  return (
    <Tag
      className={`pixel-text ${className}`}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        gap: `${size}px`,
        lineHeight: 0,
        color,
        ...style,
      }}
      aria-label={text}
    >
      {parts.map((p, i) =>
        p.ascii ? (
          <AsciiRun key={i} run={p.text} size={size} color={color} />
        ) : (
          <span
            key={i}
            className="pixel-cjk"
            style={{ fontSize: `${h * 1.02}px`, lineHeight: `${h}px`, height: `${h}px`, display: 'inline-block' }}
          >
            {p.text}
          </span>
        )
      )}
    </Tag>
  );
}
