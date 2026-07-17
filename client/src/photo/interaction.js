// 交互仲裁单例（selectionLock 同款：非组件导出单独成文，满足 fast-refresh 规则）。
// §2.1 的「唯一窗口捕获 pointerdown」分派器（Interactions.jsx）与坐标轴/物体组件之间的活值中转站——
// 窗口监听器只挂一次，进行中的手势状态经这里的 ref 语义读写，不进 React state。
import * as THREE from 'three';

// 当前挂载的 TransformControls（单选/多选互斥，最多同时存在一个）。
// 捕获阶段 pointerdown 靠 axis/dragging 判「按在坐标轴上」——drei 坐标轴射线不走 r3f 事件系统。
export const gizmoRef = { current: null };

export const interaction = {
  // 物体 r3f onPointerDown（冒泡阶段，晚于窗口捕获监听）写入的表面拖拽候选 id；
  // 每次捕获 pointerdown 先清空，pointermove 超阈值时按「gizmo→候选→框选」优先级分派。
  candidate: null,
  // 框选进行中（Esc 优先级链：框选进行中=仅取消框选 → 关右键菜单 → arrange 清选 → fly 不动）
  boxActive: false,
  // 框选控制器挂上的取消函数：取消了返回 true（没有进行中的框选返回 false）
  cancelBox: null,
  // Outliner 右键菜单挂上的关闭函数（Esc 链第二环）：关了返回 true（没开着返回 false）
  closeMenu: null,
};

// TransformControls 网格吸附参数（§2.1：X 键开关；多选时作用于 pivot，Blender 同款语义）
export const SNAP = { translation: 0.1, rotation: THREE.MathUtils.degToRad(15), scale: 0.1 };
