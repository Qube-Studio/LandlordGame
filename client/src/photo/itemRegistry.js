// 物体常挂注册表（selectionLock 同款单例文件：非组件导出单独成文，满足 fast-refresh 规则）。
// 常挂范式：Item 组件挂载即登记 id→Object3D、卸载即注销——TransformControls 取物 / 框选命中 /
// 表面放置一律从这里拿「已有的 Object3D」（硬约束①：object= 已有对象，禁 children 包裹），
// 不查 React 树、不 traverse 场景图。hidden 物不渲染 → 天然不在表里
// （three Raycaster 不检查 visible，靠"物理不存在"剔除是硬约束③的实现方式）。
export const itemRegistry = new Map();

// 订阅（useSyncExternalStore 用）：登记/注销即通知——组件里"从注册表取物"必须走订阅，
// 否则新增物与入选同一次提交时，取物早于登记会拿空（React 对外部 Map 无感知）。
const listeners = new Set();
let version = 0;
const emit = () => { version++; for (const fn of listeners) fn(); };
export function subscribeRegistry(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// 版本号快照（useSyncExternalStore 的 getSnapshot 必须可缓存——按 id 数组取物每次返回新数组会死循环；
// 多选 pivot/选框这类"关心任意登记变化"的组件订阅版本号，再自行从 Map 取物）。
export const getRegistryVersion = () => version;

export function registerItem(id, obj) {
  if (!obj) return;
  itemRegistry.set(id, obj);
  emit();
}

// 注销校验对象身份：StrictMode 假卸载/id 快速换挂时，旧 cleanup 不许误删新登记
export function unregisterItem(id, obj) {
  if (itemRegistry.get(id) !== obj) return;
  itemRegistry.delete(id);
  emit();
}

// 造景根 group 单例（StudioScene 的 Environment 发布）：
// 表面放置（P②）拖拽开始 traverse 它收集环境 mesh（含祖先 visible 过滤——藏顶横梁 visible=false）。
export const envRef = { current: null };
