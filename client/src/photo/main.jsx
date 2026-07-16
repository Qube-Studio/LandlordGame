// 拍照棚入口（独立 HTML 入口 photo.html，非 Vite 构建入口——同 preview/gallery/voxlab 先例，
// 生产构建自动排除，且仅本地开发环境 import.meta.env.DEV 可打开，双保险）。
// 复用真身游戏资产（scene/ 的房间/桌/方块人/钞票牌/硬币）做取景摆拍：自由飞行相机、
// 一键机位、截图/隐藏 UI 热键，任意摆放并精确移动/缩放/三维旋转钞票·人物·硬币。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import '../App.css';
import '../pixel.css';
import './photo.css';
import PhotoStudio from './PhotoStudio';

const root = createRoot(document.getElementById('root'));
if (!import.meta.env.DEV) {
  root.render(<div style={{ color: '#b8a585', padding: 40, fontFamily: 'monospace' }}>拍照棚仅在本地开发环境可用（npm run dev）。</div>);
} else {
  root.render(
    <StrictMode>
      <PhotoStudio />
    </StrictMode>,
  );
}
