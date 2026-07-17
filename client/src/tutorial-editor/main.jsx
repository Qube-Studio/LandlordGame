// 教程编辑器 2.0 入口（独立 HTML 入口 tutorial-editor.html，非 Vite 构建入口——同 photo/preview 先例，
// 生产构建自动排除 + import.meta.env.DEV 守卫双保险）。
// import 序写死（EDITOR_OVERHAUL §1.1，缺一不可）：pixel.css 消费 palette/texlib 以 JS 副作用注入的
// --c-*/--tex-* 变量与 theme.css 变量——photo 页靠场景组件传染带入属侥幸，这里必须显式引。
// editor.css 排最后：要覆盖 pixel.css 的 body 级全局样式（扫描线背景/user-select:none）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/palette';
import '../assets/texlib';
import '../theme.css';
import '../App.css';
import '../pixel.css';
import './editor.css';
import TutorialEditor from './TutorialEditor';

const root = createRoot(document.getElementById('root'));
if (!import.meta.env.DEV) {
  root.render(<div style={{ color: '#b8a585', padding: 40, fontFamily: 'monospace' }}>教程编辑器仅在本地开发环境可用（npm run tutorial:new）。</div>);
} else {
  root.render(
    <StrictMode>
      <TutorialEditor />
    </StrictMode>,
  );
}
