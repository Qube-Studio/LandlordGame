// 2D 钞票组件：渲染 pixelnote 的同一张 canvas 图（与 3D 桌面贴图同源），保证一致。
import { noteDataUrl } from './pixelnote';

export function PixelMoneyNote({ value = 1, faceDown = false, locked = false, debt = false, width = 64 }) {
  const height = Math.round(width * 1.4);
  return (
    <img
      src={noteDataUrl({ value, faceDown, debt, locked })}
      width={width}
      height={height}
      alt=""
      draggable={false}
      className="pixel-note-img"
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  );
}
