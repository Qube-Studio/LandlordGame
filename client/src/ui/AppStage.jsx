// 参考分辨率舞台（仅桌面）：把整个 App 钉在 1920×1080 的参考画面上，等比缩放（letterbox）
// 填入视口——**视野与 UI 尺寸不再随窗口大小或网页缩放改变**（GAME_SPEC §4.6）。
//   · 窗口变宽/变高：舞台整体等比缩放，相机宽高比恒为 16:9 → 视野框选恒定；UI 与场景同步缩放、相对比例不变。
//   · 网页缩放(Ctrl±)：缩放改变 innerWidth/innerHeight(CSS px)，scale 随之反向补偿 → 屏上尺寸恒定。
//   · 非 16:9 视口：上下或左右留黑边（body 深色背景透出）。
//   · 「界面大小」档位（settingsStore.uiScale）：把**有效参考分辨率**缩为 1920/uiScale ——
//     舞台缩放倍率反向变大 → 整个画面（UI+场景）等比放大 uiScale 倍，仍恰好铺满 16:9 区、
//     零裁切零额外黑边；3D 视野框选不变（画布仍满舞台、仍 16:9）。
// 触屏（移动端）不套舞台——移动端做过大量竖/横屏自适应，强套 16:9 会挤出巨大黑边（见 responsive.css）。
//
// 内部 position:fixed 的子层（.game-screen/.toast/.modal-mask/ViewportGuard）会以本舞台（有 transform）
// 为包含块 → 自动落在参考画面内、随舞台缩放，无需逐一改。跟随指针的浮层用 clientToStage 换算坐标。
import { useLayoutEffect, useState } from 'react';
import { IS_TOUCH } from '../game/inputMode';
import { useSettingsStore } from '../store/settingsStore';
import { REF_W, REF_H, setStage, STAGE, clientToStage } from './stageTransform';

function compute(uiScale) {
  if (typeof window === 'undefined') return { scale: 1, offsetX: 0, offsetY: 0, w: REF_W, h: REF_H };
  const w = Math.round(REF_W / uiScale), h = Math.round(REF_H / uiScale);
  const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
  return { scale, offsetX: (window.innerWidth - w * scale) / 2, offsetY: (window.innerHeight - h * scale) / 2, w, h };
}

export default function AppStage({ children }) {
  const uiScale = useSettingsStore(s => s.uiScale);
  const [box, setBox] = useState(() => compute(uiScale));

  // useLayoutEffect：STAGE 单例须在子组件读它（adaptiveDpr/环视归一）之前就位；uiScale 档位切换同步重算。
  useLayoutEffect(() => {
    if (IS_TOUCH) return undefined;
    const sync = () => {
      const b = compute(useSettingsStore.getState().uiScale);
      setBox(b);
      setStage({ active: true, scale: b.scale, offsetX: b.offsetX, offsetY: b.offsetY, W: b.w, H: b.h });
    };
    sync(); // 挂载/档位变更即写入 STAGE
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__stage = { STAGE, clientToStage }; // E2E 探针
    window.addEventListener('resize', sync);                 // 窗口缩放 + 桌面浏览器 Ctrl± 均触发 resize
    window.visualViewport?.addEventListener('resize', sync); // 捏合缩放/移动端可视视口
    return () => {
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      setStage({ active: false, scale: 1, offsetX: 0, offsetY: 0, W: REF_W, H: REF_H });
    };
  }, [uiScale]);

  if (IS_TOUCH) return children; // 触屏：原样透传，走全屏自适应

  return (
    <div className="app-stage-viewport">
      <div
        className="app-stage"
        id="app-stage"
        style={{
          width: box.w,
          height: box.h,
          transform: `translate(${box.offsetX}px, ${box.offsetY}px) scale(${box.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
