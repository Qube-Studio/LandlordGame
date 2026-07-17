// 框选命中判定（§2.1，纯函数——探针 __photoPick 与 Interactions.jsx 的框选收尾共用同一实现）。
// 为什么不用 __photoItems 的 screenAABB：那是无裁剪的直投影探针，身后/贴脸的角点经透视除法
// 会翻转出假 AABB；框选必须先在相机空间做近平面裁剪（视空间 z≥-near 的角点丢弃，全丢则跳过）。
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _view = new THREE.Matrix4();

// rect = {x1,y1,x2,y2}（屏幕 px，任意对角顺序）；viewport = {width,height}；
// items = store 物体数组（顺序即返回顺序，末位=主选语义交给调用方）；registry = itemRegistry。
// 命中 = 非 hidden（不在注册表）非 locked 物的 world Box3 八角投影 AABB 与矩形**相交**
// （Blender 语义：穿透遮挡照选；点选仍取最近命中，走 r3f onClick）。
export function pickIdsInRect(rect, camera, viewport, items, registry) {
  const xmin = Math.min(rect.x1, rect.x2), xmax = Math.max(rect.x1, rect.x2);
  const ymin = Math.min(rect.y1, rect.y2), ymax = Math.max(rect.y1, rect.y2);
  // 不依赖渲染循环刷新过的 matrixWorldInverse——框选收尾可能落在两帧之间
  camera.updateMatrixWorld();
  _view.copy(camera.matrixWorld).invert();
  const out = [];
  for (const it of items) {
    if (it.locked) continue;                 // 锁定：可见但点选/框选/拖拽全跳过
    const obj = registry.get(it.id);         // hidden 物不渲染不进注册表 → 天然剔除
    if (!obj) continue;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, alive = 0;
    for (let i = 0; i < 8; i++) {
      _v.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).applyMatrix4(_view);
      if (_v.z >= -camera.near) continue;    // 近平面裁剪
      _v.applyMatrix4(camera.projectionMatrix);
      const sx = (_v.x * 0.5 + 0.5) * viewport.width;
      const sy = (-_v.y * 0.5 + 0.5) * viewport.height;
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      alive++;
    }
    if (!alive) continue;
    if (maxX >= xmin && minX <= xmax && maxY >= ymin && minY <= ymax) out.push(it.id);
  }
  return out;
}
