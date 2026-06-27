import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
