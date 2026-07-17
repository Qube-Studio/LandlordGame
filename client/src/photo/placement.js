// 表面放置 + V 落底的几何计算（§2.1）。做成可探针直调的模块函数（§2.2：合成鼠标拖 3D 有
// 失败先例，几何计算必须能被 __photoSurface 之类探针硬断言，鼠标全链路只作截图证据）。
import * as THREE from 'three';
import { itemRegistry, envRef } from './itemRegistry';
import { usePhotoStore, liveCamera } from './photoStore';
import { cardLocal, cardYaw, TABLE_TOP } from '../scene/cards';

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
    // 底面偏移取 obj.position（不取 store 的 item.pos[1]）：采样射线用的 box 来自 three 对象，
    // 同一帧里 store 刚被写、React 还没把新 pos 刷到 group 时两者会脱节，混用会算出离谱落点
    const newY = hitY + (obj.position.y - box.min.y);
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

// ---- 出生点（§2.1）：addItem 从视野中心向前射线落到支撑面；失败回落桌心+螺旋偏移 ----
// liveCamera 由 FlyRig 每帧发布（pos/yaw/pitch）；前向公式与 FlyRig 同源：
// fwd = (-sinYaw·cosPitch, sinPitch, -cosYaw·cosPitch)。不依赖 three 相机对象——
// 工具栏按钮在 DOM 侧点，拿不到 r3f 的 camera，位姿数据走这份单例。
let spiralN = 0;
export function spawnBase() {
  const cp = Math.cos(liveCamera.pitch), sp = Math.sin(liveCamera.pitch);
  const cy = Math.cos(liveCamera.yaw), sy = Math.sin(liveCamera.yaw);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(liveCamera.pos[0], liveCamera.pos[1], liveCamera.pos[2]),
    new THREE.Vector3(-sy * cp, sp, -cy * cp),
  );
  const hit = ray.intersectObjects(collectSurfaceMeshes(new Set()), false)[0];
  if (hit) return [hit.point.x, hit.point.y, hit.point.z];
  // 兜底（看向天空/场外）：桌心 + 每次 +0.15 螺旋偏移（防连点生成叠死在同一点）；
  // 半径 14 步一轮回，别越螺旋越滚出桌面
  spiralN++;
  const r = 0.15 * (((spiralN - 1) % 14) + 1), a = spiralN * 2.4; // 2.4rad≈黄金角，方向自然错开
  return [Math.cos(a) * r, TABLE_TOP, Math.sin(a) * r];
}

// 各类物体放上支撑面时的原点抬高（与 photoStore 旧 spawnPos 的桌面偏移同值）：钞票/硬币半厚+微浮，人物脚踩原点
const KIND_Y = { note: 0.03, coin: 0.04, char: 0 };
export function spawnPointFor(kind) {
  const b = spawnBase();
  return [b[0], b[1] + (KIND_Y[kind] ?? 0), b[2]];
}

// 一摞钱槽位（§2.1）：cardLocal/cardYaw 与游戏内钱堆**同源**——自然错位像素级同款。
// cardLocal 的 y 含 TABLE_TOP（游戏钱堆恒贴桌面），减掉换算成相对支撑面的偏移再贴到出生面。
export function buildMoneyStack(count, props = {}) {
  const n = Math.max(1, Math.min(40, Math.floor(count) || 1));
  const base = spawnBase();
  const notes = [];
  for (let i = 0; i < n; i++) {
    const [lx, ly, lz] = cardLocal(i);
    notes.push({
      props: { ...props },
      pos: [base[0] + lx, base[1] + (ly - TABLE_TOP), base[2] + lz],
      rot: [0, cardYaw(i), 0],
    });
  }
  return notes;
}

// ---- F 聚焦（§2.1）：选中集合并 world Box3 → focusReq；FlyRig 消费（退距反解视角）----
export function focusSelection() {
  const store = usePhotoStore.getState();
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  for (const id of store.selection) {
    const obj = itemRegistry.get(id);          // hidden 物不在注册表 → 不参与
    if (!obj) continue;
    one.setFromObject(obj);
    if (!one.isEmpty()) box.union(one);
  }
  if (box.isEmpty()) return false;             // 空选/全 hidden → 不动相机
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // 半径下限：聚焦单张薄钞不至于把相机怼进桌面
  store.requestFocus([sphere.center.x, sphere.center.y, sphere.center.z], Math.max(sphere.radius, 0.35));
  return true;
}

// 自动化探针（§2.2⑥，覆盖式写 window）：E2E 直调落底/出生点/钱堆槽位/聚焦做硬断言（键鼠路径只作证据）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__photoDrop = dropSelectedToFloor;
  window.__photoSpawn = spawnPointFor;
  window.__photoStack = buildMoneyStack;
  window.__photoFocus = focusSelection;
}
