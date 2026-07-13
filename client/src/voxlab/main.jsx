// VoxLab 体素画风隔离验证区入口(docs/VOXEL_PLAN.md 附录 A)。
// 与主项目隔离:独立 HTML 入口(voxlab.html,非 Vite 构建入口,同 preview/gallery 先例,
// 生产构建自动排除),且仅本地开发环境(import.meta.env.DEV)可打开——双保险。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import '../App.css';
import '../pixel.css';
import './voxlab.css';
import VoxLab from './VoxLab';

const root = createRoot(document.getElementById('root'));
if (!import.meta.env.DEV) {
  root.render(<div style={{ color: '#b8a585', padding: 40, fontFamily: 'monospace' }}>VoxLab 仅在本地开发环境可用(npm run dev)。</div>);
} else {
  root.render(
    <StrictMode>
      <VoxLab />
    </StrictMode>,
  );
}
