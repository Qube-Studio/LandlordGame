// 桌面「参考分辨率舞台」的变换真源（纯模块，无 React）。
// AppStage 组件每次布局后写入当前 scale/offset；跟随指针、或需在舞台(参考)空间定位的浮层，
// 据此把视觉 client 坐标换算回舞台空间。触屏/无舞台时 active=false，clientToStage 原样透传。
//
// 舞台把 W×H 的参考画面等比缩放（letterbox）填入视口：
//   W/H = **有效**参考尺寸 = REF/uiScale（「界面大小」档位，见 AppStage/settingsStore），
//   scale = min(vw/W, vh/H)，居中，多出的边留黑。
// 视觉 client 坐标 →（减居中偏移、除缩放）→ 参考空间坐标。
export const REF_W = 1920;
export const REF_H = 1080;

export const STAGE = { active: false, scale: 1, offsetX: 0, offsetY: 0, W: REF_W, H: REF_H };

export function setStage(s) { Object.assign(STAGE, s); }

// 视觉 client 坐标 → 舞台(参考)空间。舞台未激活时恒等（触屏/预览无舞台）。
export function clientToStage(x, y) {
  if (!STAGE.active) return { x, y };
  return { x: (x - STAGE.offsetX) / STAGE.scale, y: (y - STAGE.offsetY) / STAGE.scale };
}
