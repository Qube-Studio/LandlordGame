// 表面放置 + V 落底的几何计算（§2.1）。做成可探针直调的模块函数（§2.2：合成鼠标拖 3D 有
// 失败先例，几何计算必须能被 __photoSurface 之类探针硬断言，鼠标全链路只作截图证据）。
import * as THREE from 'three';
import { itemRegistry, envRef } from './itemRegistry';
import { usePhotoStore } from './photoStore';

// 可见性感知收集：跳过 visible=false 的整棵子树。three Raycaster **不检查 visible**（硬约束③）——
// 藏顶的横梁（visible=false）必须物理剔除，否则拖拽会把物体贴到看不见的梁上。
function collectVisibleMeshes(root, out) {
  if (!root || root.visible === false) return;
  if (root.isMesh) out.push(root);
  for (const c of root.children) collectVisibleMeshes(c, out);
}

// 表面候选集：可见环境 mesh（envRef 造景根）+ 非排除物（正常传全部选中物——防自命中上浮）。
// 拖拽开始收集一次，期间只 intersectObjects 复用这份数组。
export function collectSurfaceMeshes(excludeIds) {
  const out = [];
  collectVisibleMeshes(envRef.current, out);
  for (const it of usePhotoStore.getState().items) {
    if (excludeIds.has(it.id)) continue;
    const obj = itemRegistry.get(it.id);   // hidden 物不在注册表 → 天然剔除
    if (obj) collectVisibleMeshes(obj, out);
  }
  return out;
}

// 屏幕点 → 表面命中（相机射线与候选集求交，取最近；无命中返回 null）
export function surfaceHitAt(clientX, clientY, camera, meshes, raycaster, el) {
  const r = el.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;
  const ny = -((clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  return raycaster.intersectObjects(meshes, false)[0] ?? null;
}

const _origin = new THREE.Vector3();

// V 落底（§2.1）：排除全部选中物后，从 (x, box.min.y+0.02, z) 向下射线，底面中心+4 底角
// 5 点采样取最高命中 y；命中面高于 min.y（已轻微互穿）时同一公式自然向上顶出。
// 多选按 min.y **升序逐个落，落完即把该物加回候选集**——后落的能摞在先落的上面（成摞保序）。
export function dropSelectedToFloor() {
  const store = usePhotoStore.getState();
  const order = store.selection
    .map((id) => {
      const obj = itemRegistry.get(id);
      return obj ? { id, obj, box: new THREE.Box3().setFromObject(obj) } : null;
    })
    .filter((e) => e && !e.box.isEmpty())
    .sort((a, b) => a.box.min.y - b.box.min.y);
  if (!order.length) return;
  const meshes = collectSurfaceMeshes(new Set(order.map((e) => e.id)));
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const patches = {};
  for (const { id, obj, box } of order) {
    const item = store.items.find((it) => it.id === id);
    if (!item) continue;
    const y0 = box.min.y + 0.02;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    let hitY = null;
    for (const [sx, sz] of [[cx, cz], [box.min.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.min.z], [box.max.x, box.max.z]]) {
      ray.set(_origin.set(sx, y0, sz), down);
      const h = ray.intersectObjects(meshes, false)[0];
      if (h && (hitY === null || h.point.y > hitY)) hitY = h.point.y;
    }
    if (hitY === null) continue;               // 悬在场外（没有任何支撑面）→ 不动
    const newY = hitY + (item.pos[1] - box.min.y);
    patches[id] = { pos: [item.pos[0], newY, item.pos[2]] };
    // 就地更新对象矩阵再把它的 mesh 加回候选集：下一个（更高的）物体才能落在它上面
    // （物体直挂场景根，世界 y = 本地 y；改的是 three 对象不是 store，历史快照不受影响）
    obj.position.y = newY;
    obj.updateMatrixWorld(true);
    collectVisibleMeshes(obj, meshes);
  }
  if (!Object.keys(patches).length) return;    // 全员悬空无支撑 → 不动也不压空历史
  store.pushHistory();   // 一次落底 = 一步撤回（applyTransforms 从不压历史）
  store.applyTransforms(patches, true);
}

// 自动化探针（§2.2⑥，覆盖式写 window）：E2E 直调落底做硬断言（V 键路径只作证据）
if (import.meta.env.DEV && typeof window !== 'undefined') window.__photoDrop = dropSelectedToFloor;
