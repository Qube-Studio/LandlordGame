import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './assets/palette'; // 副作用:注入 --c-*/--t-*/--e-* CSS 变量(单一色源,docs/ART_BIBLE.md)
import './assets/texlib';  // 副作用:注入 --tex-* 共享材质变量(HUD 与 3D 同源纹理)
import './theme.css';
import './App.css';
import './pixel.css';
import './responsive.css'; // 最后加载：移动端 @media 覆盖
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
