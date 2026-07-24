// .vox → 4cm brick(占位+均色)。摆放物/体素吊灯进占位位图的中间表示:
// 1.5cm 体素直接进 4cm 位图会因非整倍率产生莫尔孔洞——brick 先按体素中心归格
// (4cm 格 ≈ 2.7 体素,任何被实体覆盖的格必有体素中心落入,桌游资产无亚格薄壁),
// 放置时对世界 AABB 内的位图格做「逆变换采样」(bake.js),旋转/缩放不产生孔洞。
// 纯函数零依赖,node 单测(tools/voxlighttest.mjs)。
import { DOMAIN } from './domain.js'; // 显式扩展名:node 单测(voxlighttest)直接 import,不走 Vite

/**
 * buildBrick(dense, palette, voxelSize, materials?) →
 *   { bx, by, bz, occ: Uint8Array, col: Uint8Array(×3), emi: Float32Array(×3)|null, voxelSize }
 * dense = vox.js 稠密体(three y-up);palette = 256×4 RGBA(sRGB 字节);
 * materials = parseVox 的归一化 MATL(materials[i].emitK>0 = 发光体素)。
 * brick 格边长 = DOMAIN.cell(4cm),按「体素中心落格 + 调色板均色」构建;
 * emi = 发光格的 线性色(0..1)×emitK 均值(P1-4 虚拟点光的能量来源)。
 */
// sRGB 字节 → 线性(0..1):emi 是光能量,必须在线性空间累加——直接 /255 只是归一化,
// gamma 编码值会让暖橙烛焰的虚拟灯偏白偏淡(饱和度减半;对抗审计确认项)
const srgbToLinear = (b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export function buildBrick(dense, palette, voxelSize = 0.015, materials = null) {
  const { sx, sy, sz, data } = dense;
  const k = voxelSize / DOMAIN.cell;
  const bx = Math.max(1, Math.ceil(sx * k));
  const by = Math.max(1, Math.ceil(sy * k));
  const bz = Math.max(1, Math.ceil(sz * k));
  const n = bx * by * bz;
  const occ = new Uint8Array(n);
  const sum = new Uint32Array(n * 3);
  const cnt = new Uint32Array(n);
  let emiSum = null, emiCnt = null;
  for (let z = 0; z < sz; z++) {
    const biz = Math.min(bz - 1, ((z + 0.5) * k) | 0);
    for (let y = 0; y < sy; y++) {
      const biy = Math.min(by - 1, ((y + 0.5) * k) | 0);
      for (let x = 0; x < sx; x++) {
        const ci = data[x + sx * (y + sy * z)];
        if (!ci) continue;
        const bix = Math.min(bx - 1, ((x + 0.5) * k) | 0);
        const bi = bix + bx * (biy + by * biz);
        occ[bi] = 1;
        const o = (ci - 1) * 4;
        sum[bi * 3] += palette[o]; sum[bi * 3 + 1] += palette[o + 1]; sum[bi * 3 + 2] += palette[o + 2];
        cnt[bi]++;
        const ek = materials?.[ci]?.emitK ?? 0;
        if (ek > 0) {
          if (!emiSum) { emiSum = new Float32Array(n * 3); emiCnt = new Uint32Array(n); }
          emiSum[bi * 3] += srgbToLinear(palette[o]) * ek;
          emiSum[bi * 3 + 1] += srgbToLinear(palette[o + 1]) * ek;
          emiSum[bi * 3 + 2] += srgbToLinear(palette[o + 2]) * ek;
          emiCnt[bi]++;
        }
      }
    }
  }
  const col = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    col[i * 3] = (sum[i * 3] / cnt[i]) | 0;
    col[i * 3 + 1] = (sum[i * 3 + 1] / cnt[i]) | 0;
    col[i * 3 + 2] = (sum[i * 3 + 2] / cnt[i]) | 0;
  }
  let emi = null;
  if (emiSum) {
    emi = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (!emiCnt[i]) continue;
      emi[i * 3] = emiSum[i * 3] / emiCnt[i];
      emi[i * 3 + 1] = emiSum[i * 3 + 1] / emiCnt[i];
      emi[i * 3 + 2] = emiSum[i * 3 + 2] / emiCnt[i];
    }
  }
  return { bx, by, bz, occ, col, emi, voxelSize };
}

// 采样:局部坐标(体素单位,即 VoxModel 内层 group 的局部空间)→ brick 格索引;空/越界 = -1
export function brickSample(brick, vx, vy, vz) {
  const k = brick.voxelSize / DOMAIN.cell;
  // Math.floor 而非 |0:|0 朝零截断,负局部坐标(格心略出模型边)会误落格 0
  const ix = Math.floor(vx * k), iy = Math.floor(vy * k), iz = Math.floor(vz * k);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= brick.bx || iy >= brick.by || iz >= brick.bz) return -1;
  const bi = ix + brick.bx * (iy + brick.by * iz);
  return brick.occ[bi] ? bi : -1;
}
