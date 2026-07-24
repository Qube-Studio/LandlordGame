// 场景 → 占位位图/反照率体(P1-1)。运行时遍历 r3f 场景图,不改任何造景源文件:
// Box/Cylinder/Sphere/Cone/Plane 读 geometry.parameters 按世界矩阵「逆变换采样」精确 stamp
// (对世界 AABB 内每个 4cm 格,把格心逆变换回局部空间做解析判定——任意旋转无孔洞);
// 体素模型(VoxModel 在内层 group 打 userData.voxBake)走 brick 采样,不下潜其贪心网格。
// `spaceRoot` 可把整个烘焙域固定在酒馆局部坐标:主游戏为适配玩家座位会旋转整间房,
// 若仍在世界轴域烘焙,固定 ±12m 的解析墙与 25.6m 数据域都会错位/裁角。所有 stamp 的
// matrixWorld 在收集时左乘 spaceRoot.matrixWorld^-1,因此域、解析墙、灯位可继续使用 VoxLab
// 的 canonical 坐标；运行时材质采样由 patch.js 的同一 worldToBake 矩阵配对变换。
// 过滤规则(全部收口在此):
//   · userData.voxBakeSkip 子树(虚影/落点圈/debug 可视化)
//   · material.transparent(火焰面片/玻璃桶/ContactShadows)
//   · >5m 的 Plane = 房间壳(墙/地/顶不进位图——封闭壳会挡死一切;其遮蔽由烘焙 shader 解析平面项补)
//   · Circle/Ring = 平贴地面的毯/贴花(零厚度装饰,进位图只会污染地面 AO)
//   ⚠ 计划原文还有「castShadow===false 过滤」——实测本场景九成家具没设 castShadow,
//     照抄会把桌椅酒桶全滤没,故弃用(偏差已记 VOXEL_PLAN 附录 B)。
// 全量重建:数据量下 <100ms,v1 不做局部更新(接口留在 domain 的 stamp 粒度,将来要再切)。
import * as THREE from 'three';
import { DOMAIN, cellOf, worldOf, stampCell, stampEmissive, clearDomain, finalizeDomain, countBits } from './domain';
import { buildBrick, brickSample } from './brick';
import { loadVoxDense } from '../voxload';

// ---- brick 注册表(url → Promise<brick>;与 voxload 几何缓存平行) ----
const BRICKS = new Map();
function brickFor(url, voxelSize) {
  const key = `${url}|${voxelSize}`;
  if (BRICKS.has(key)) return BRICKS.get(key);
  const p = loadVoxDense(url).then(({ dense, palette, materials }) => buildBrick(dense, palette, voxelSize, materials));
  BRICKS.set(key, p);
  p.catch(() => BRICKS.delete(key));
  return p;
}

// ---- 材质均色(sRGB 字节):贴图画到 1×1 canvas 取均值(texlib 全是 canvas 纹理),乘材质色 ----
const TEX_AVG = new Map(); // texture.uuid → [r,g,b] | null
function avgOfTexture(map) {
  if (TEX_AVG.has(map.uuid)) return TEX_AVG.get(map.uuid);
  let out = null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(map.image, 0, 0, 1, 1);
    const px = ctx.getImageData(0, 0, 1, 1).data;
    out = [px[0], px[1], px[2]];
  } catch { /* ImageBitmap 跨域等,退回材质色 */ }
  TEX_AVG.set(map.uuid, out);
  return out;
}
const _col = new THREE.Color();
function colorOf(mat) {
  _col.copy(mat.color ?? { r: 1, g: 1, b: 1 }).convertLinearToSRGB();
  const tint = [_col.r * 255, _col.g * 255, _col.b * 255];
  const avg = mat.map?.image ? avgOfTexture(mat.map) : null;
  if (!avg) return [tint[0] | 0, tint[1] | 0, tint[2] | 0];
  return [(avg[0] * tint[0]) / 255 | 0, (avg[1] * tint[1]) / 255 | 0, (avg[2] * tint[2]) / 255 | 0];
}

// ---- 收集 stamp(手写递归——traverse 不能跳子树) ----
function bakeMatrixOf(matrixWorld, worldToBake) {
  const out = matrixWorld.clone();
  return worldToBake ? out.premultiply(worldToBake) : out;
}

function collect(o, out, stats, worldToBake) {
  if (!o.visible || o.userData?.voxBakeSkip) return;
  const vb = o.userData?.voxBake;
  if (vb) {
    stats.vox++;
    out.push({ kind: 'vox', url: vb.url, voxelSize: vb.voxelSize ?? 0.015, matrixWorld: bakeMatrixOf(o.matrixWorld, worldToBake) });
    return; // 贪心网格不下潜,brick 才是占位权威
  }
  if (o.isMesh) collectMesh(o, out, stats, worldToBake);
  for (const c of o.children) collect(c, out, stats, worldToBake);
}

function collectMesh(o, out, stats, worldToBake) {
  const mat = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!mat || mat.transparent) { stats.skipTransparent++; return; }
  const g = o.geometry;
  const P = g.parameters ?? {};
  const s = { kind: 'prim', matrixWorld: bakeMatrixOf(o.matrixWorld, worldToBake), rgb: colorOf(mat) };
  switch (g.type) {
    case 'BoxGeometry':
      s.shape = 'box'; s.half = [P.width / 2, P.height / 2, P.depth / 2];
      break;
    case 'PlaneGeometry':
      if (Math.max(P.width, P.height) > 5) { stats.skipShell++; return; }
      s.shape = 'box'; s.half = [P.width / 2, P.height / 2, 0.001];
      break;
    case 'CircleGeometry':
    case 'RingGeometry':
      stats.skipFlat++; return;
    case 'CylinderGeometry':
      s.shape = 'cyl'; s.rTop = P.radiusTop; s.rBot = P.radiusBottom; s.hh = P.height / 2;
      s.half = [Math.max(P.radiusTop, P.radiusBottom), P.height / 2, Math.max(P.radiusTop, P.radiusBottom)];
      break;
    case 'ConeGeometry':
      s.shape = 'cyl'; s.rTop = 0; s.rBot = P.radius; s.hh = P.height / 2;
      s.half = [P.radius, P.height / 2, P.radius];
      break;
    case 'SphereGeometry':
      s.shape = 'sphere'; s.r = P.radius; s.half = [P.radius, P.radius, P.radius];
      break;
    default: {
      // 未知几何:局部包围盒当保守 box(桌游场景里只剩零星装饰)
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) { stats.skipOther++; return; }
      const bb = g.boundingBox;
      s.shape = 'box';
      s.center = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
      s.half = [(bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2, (bb.max.z - bb.min.z) / 2];
    }
  }
  stats.prims++;
  out.push(s);
}

// ---- 光栅化:世界 AABB 内逐格「格心 → 局部」解析判定 ----
const _inv = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _sc = new THREE.Vector3();
// 局部半余量:半格(2cm)按世界→局部缩放换算——薄件(3cm 黄铜嵌线/纸片 plane)至少占进一格
function localMargins(matrixWorld) {
  _sc.setFromMatrixScale(matrixWorld);
  const h = DOMAIN.cell * 0.5;
  return [h / (_sc.x || 1), h / (_sc.y || 1), h / (_sc.z || 1)];
}
// 局部 AABB(含余量)→ 世界 AABB → 域格范围;回调逐格(局部坐标已备好)
function eachCellInLocalBox(matrixWorld, lo, hi, fn) {
  _inv.copy(matrixWorld).invert();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]).applyMatrix4(matrixWorld);
    minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x);
    minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    minZ = Math.min(minZ, _v.z); maxZ = Math.max(maxZ, _v.z);
  }
  const x0 = Math.max(0, cellOf(minX, 0)), x1 = Math.min(DOMAIN.nx - 1, cellOf(maxX, 0));
  const y0 = Math.max(0, cellOf(minY, 1)), y1 = Math.min(DOMAIN.ny - 1, cellOf(maxY, 1));
  const z0 = Math.max(0, cellOf(minZ, 2)), z1 = Math.min(DOMAIN.nz - 1, cellOf(maxZ, 2));
  for (let iz = z0; iz <= z1; iz++) {
    const wz = worldOf(iz, 2);
    for (let iy = y0; iy <= y1; iy++) {
      const wy = worldOf(iy, 1);
      for (let ix = x0; ix <= x1; ix++) {
        _v.set(worldOf(ix, 0), wy, wz).applyMatrix4(_inv);
        fn(ix, iy, iz, _v);
      }
    }
  }
}

function rasterizePrim(d, s) {
  const m = localMargins(s.matrixWorld);
  const c = s.center ?? [0, 0, 0];
  const hx = s.half[0] + m[0], hy = s.half[1] + m[1], hz = s.half[2] + m[2];
  const lo = [c[0] - hx, c[1] - hy, c[2] - hz], hi = [c[0] + hx, c[1] + hy, c[2] + hz];
  const [r, g, b] = s.rgb;
  eachCellInLocalBox(s.matrixWorld, lo, hi, (ix, iy, iz, v) => {
    const lx = v.x - c[0], ly = v.y - c[1], lz = v.z - c[2];
    if (Math.abs(lx) > hx || Math.abs(ly) > hy || Math.abs(lz) > hz) return;
    if (s.shape === 'cyl') {
      const t = Math.min(1, Math.max(0, (ly + s.hh) / (2 * s.hh || 1)));
      const rr = s.rBot + (s.rTop - s.rBot) * t + (m[0] + m[2]) / 2;
      if (lx * lx + lz * lz > rr * rr) return;
    } else if (s.shape === 'sphere') {
      const rr = s.r + (m[0] + m[1] + m[2]) / 3;
      if (lx * lx + ly * ly + lz * lz > rr * rr) return;
    }
    stampCell(d, ix, iy, iz, r, g, b);
  });
}

function rasterizeVox(d, s) {
  if (!s.brick) return;
  const b = s.brick;
  // 内层 group 的局部空间 = 体素单位;brick 网格范围换回体素单位作 AABB
  const k = b.voxelSize / DOMAIN.cell;
  const lo = [0, 0, 0], hi = [b.bx / k, b.by / k, b.bz / k];
  eachCellInLocalBox(s.matrixWorld, lo, hi, (ix, iy, iz, v) => {
    const bi = brickSample(b, v.x, v.y, v.z);
    if (bi < 0) return;
    stampCell(d, ix, iy, iz, b.col[bi * 3], b.col[bi * 3 + 1], b.col[bi * 3 + 2]);
    // MATL 发光体素 → 发光体(P1-4 虚拟点光聚类的能量源)
    if (b.emi) {
      const r = b.emi[bi * 3], g = b.emi[bi * 3 + 1], bb = b.emi[bi * 3 + 2];
      if (r + g + bb > 0) stampEmissive(d, ix, iy, iz, r, g, bb);
    }
  });
}

/**
 * 全量烘焙:场景遍历收集 stamp → 等 brick 就绪 → 清域重放 → 收口。
 * opts.spaceRoot:可选 Object3D/ref.current。提供时 root 下的所有几何先转进该对象的局部坐标；
 * 宿主应把同一个 spaceRoot 传给 VoxelLight,保证 patch.js 的运行时采样处于同一坐标系。
 * 返回统计(探针/HUD 用)。并发调用安全:各自 clearDomain,后完成者为准。
 */
export async function bakeAll(domain, root, opts = {}) {
  const t0 = performance.now();
  const refValue = opts.spaceRoot?.current ?? opts.spaceRoot ?? null;
  // updateWorldMatrix(true, true) 会先更新祖先；仅 updateMatrixWorld(true) 在 root 是旋转组时
  // 可能沿用上一帧父矩阵，导致切座/冷挂载的首拍落进旧坐标。
  root.updateWorldMatrix?.(true, true);
  refValue?.updateWorldMatrix?.(true, false);
  const worldToBake = refValue ? refValue.matrixWorld.clone().invert() : null;
  const stats = { prims: 0, vox: 0, skipTransparent: 0, skipShell: 0, skipFlat: 0, skipOther: 0 };
  const stamps = [];
  collect(root, stamps, stats, worldToBake);
  await Promise.all(stamps.filter(s => s.kind === 'vox').map(s =>
    brickFor(s.url, s.voxelSize).then(b => { s.brick = b; }).catch(() => { s.brick = null; }),
  ));
  clearDomain(domain);
  for (const s of stamps) (s.kind === 'vox' ? rasterizeVox : rasterizePrim)(domain, s);
  finalizeDomain(domain);
  return { ...stats, cells: countBits(domain), ms: Math.round(performance.now() - t0), localSpace: !!refValue };
}
