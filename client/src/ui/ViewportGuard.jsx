// 移动端视口守卫（仅触屏生效，桌面渲染 null）：
//   - 竖屏 → "请横屏"全屏覆盖层
//   - 支持处提供"全屏"按钮（requestFullscreen + 朝向锁定，尽力而为）
//   - iPhone Safari 无 Fullscreen API（且浏览器里删不掉地址栏，iOS 铁律）→ 一次性引导条：
//     「添加到主屏幕」从图标启动才是真全屏（standalone），横屏游玩时也会弹（旋转层只在竖屏）。
// 纯表现层，不读游戏状态、不碰逻辑。
import { useEffect, useState } from 'react';

// iOS 设备且当前不在 standalone（未从主屏图标启动）——只有这种情形地址栏删不掉、才提示。
const IOS_HINT_KEY = 'fate.iosHint';
function iosNeedsHint() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS = /iP(hone|od|ad)/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ 伪装成 Mac
  if (!isIOS) return false;
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches; // 已从主屏启动=真全屏,无需提示
  if (standalone) return false;
  try { return localStorage.getItem(IOS_HINT_KEY) !== '1'; } catch { return true; }
}

export default function ViewportGuard() {
  const [coarse, setCoarse] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [fs, setFs] = useState(false);
  const [iosHint, setIosHint] = useState(iosNeedsHint); // 惰性初始化：挂载时算一次（避免 effect 里同步 setState）

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

  // 引导条：点掉或 18s 后自走（都持久化，只弹一次；隐私模式 localStorage 失败静默）
  const dismissIosHint = () => {
    try { localStorage.setItem(IOS_HINT_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    setIosHint(false);
  };
  useEffect(() => {
    if (!iosHint) return undefined;
    const t = setTimeout(dismissIosHint, 18000);
    return () => clearTimeout(t);
  }, [iosHint]);

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
      {/* iOS Safari 一次性引导（横屏也弹；地址栏浏览器里删不掉，添加到主屏才是真全屏）。竖屏时旋转层已盖住，避重复。 */}
      {iosHint && !portrait && (
        <div className="ios-install-hint" role="status">
          <span className="ios-hint-text">
            想去掉顶部地址栏？点底部 <b>分享</b> → <b>添加到主屏幕</b>，从图标启动即全屏
          </span>
          <button className="ios-hint-x" onClick={dismissIosHint} aria-label="知道了">✕</button>
        </div>
      )}
    </>
  );
}
