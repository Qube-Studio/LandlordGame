// 移动端视口守卫（仅触屏生效，桌面渲染 null）：
//   - 竖屏 → "请横屏"全屏覆盖层
//   - 支持处提供"全屏"按钮（requestFullscreen + 朝向锁定，尽力而为）
//   - iPhone Safari 无 Fullscreen API → 提示"添加到主屏"获得全屏
// 纯表现层，不读游戏状态、不碰逻辑。
import { useEffect, useState } from 'react';

export default function ViewportGuard() {
  const [coarse, setCoarse] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const mqPortrait = window.matchMedia('(orientation: portrait)');
    const sync = () => {
      setCoarse(mqCoarse.matches);
      setPortrait(mqPortrait.matches);
      setFs(!!document.fullscreenElement);
    };
    sync();
    mqCoarse.addEventListener('change', sync);
    mqPortrait.addEventListener('change', sync);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      mqCoarse.removeEventListener('change', sync);
      mqPortrait.removeEventListener('change', sync);
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);

  if (!coarse) return null; // 桌面/鼠标设备完全不介入

  const canFullscreen = typeof document.documentElement.requestFullscreen === 'function';
  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      try { await window.screen?.orientation?.lock?.('landscape'); } catch { /* 多数浏览器仅全屏内允许锁定 */ }
    } catch { /* 用户拒绝或不支持 */ }
  };

  return (
    <>
      {!fs && canFullscreen && (
        <button className="fs-btn" onClick={enterFullscreen} title="进入全屏">⛶ 全屏</button>
      )}
      {portrait && (
        <div className="orient-overlay">
          <div className="orient-card">
            <div className="orient-icon">📱</div>
            <p>请横屏游玩</p>
            {!canFullscreen && <p className="orient-hint">iPhone 可「添加到主屏」获得全屏体验</p>}
          </div>
        </div>
      )}
    </>
  );
}
