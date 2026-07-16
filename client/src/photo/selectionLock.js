// 取消选择的一次性抑制闸（共享 ref，单独成文件满足 fast-refresh 规则：组件文件只导出组件）。
// 按在坐标轴上/拖拽中置真 → Canvas.onPointerMissed 跳过取消选择。
// （drei TransformControls 的坐标轴射线不走 r3f 事件系统，点轴会被判成“空点”——同 carry.js 捕获阶段铁律。）
export const selectionLock = { current: false };
