// 像素键帽（UI 阶段五⑤）：桌面浮字里的按键提示，替代 [␣]/[R]/[F] 文本形式。
// 空格 = 半透明黑长条键帽、中置 ␣ 字形（位图字体里的 11 列宽体）；字母键 = 同款小方帽。
// 与 PixelText 同级的文字原子，颜色跟随所在行（浮字金行→金字键帽）。
import PixelText from './PixelText';

export default function KeyCap({ k = 'space', size = 2, color = 'var(--ink)' }) {
  const space = k === 'space';
  return (
    <span className={`keycap-px ${space ? 'long' : ''}`}>
      <PixelText size={size} color={color}>{space ? '␣' : String(k).toUpperCase()}</PixelText>
    </span>
  );
}
