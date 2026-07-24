// 准心/运镜共享数学（无 THREE 依赖的纯函数）：射线∩盒、座位世界坐标、看向角、角度插值/钳制。
// 独立小模块避免 ExecutionRig/ExecCineRig ↔ Scene3D 循环引用。

// 座位局部坐标 → 世界（场景旋转组 rotation=[0,rot,0] 之外的相机要世界系）
export function seatWorld(s, rot) {
  const cr = Math.cos(rot), sr = Math.sin(rot);
  return { x: s.x * cr + s.z * sr, z: -s.x * sr + s.z * cr };
}

// 相机点 → 目标点的 yaw/pitch（相机前向 -z、YXZ 序约定，同 SingleRig/ExecutionRig）
export function aimAngles(cam, tx, ty, tz) {
  const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / len))) };
}

// 最短弧角度插值（跨 ±π 缝不绕远路）
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// 把角度钳到 center±range 的锥内（最短弧意义下；处决窗软锁的宽松兜底）
export function clampAngle(v, center, range) {
  let d = v - center;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return center + Math.max(-range, Math.min(range, d));
}

// 最短弧角度差 v−center ∈ (−π, π]（软锁偏移量计算）
export function angDiff(v, center) {
  let d = v - center;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 平滑阶跃（缓入缓出转场曲线；u 自动钳 [0,1]）
export function smootherstep(u) {
  const t = Math.min(1, Math.max(0, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 软边界增益（处决窗软锁 §3.9）：输入朝锥外时衰减灵敏度，朝回中心全速——不硬拦鼠标。
// 曲线（三版定稿）：**锥内大部分行程都是减速区**——仅锥心 10% 全速，其后灵敏度沿
// smootherstep 全程平滑下降（中点约半速、贴边归零）；两端导数为 0，起始与贴边都无顿挫。
// （一版 1−t² 前半几乎不减后段跳水=突兀；二版死区 75% 被反馈方向反了。）
export function softGain(offset, delta, range) {
  if (delta === 0 || Math.sign(delta) !== Math.sign(offset || delta)) return 1;
  const t = Math.min(1, Math.abs(offset) / range);
  if (t < 0.1) return 1;
  const u = (t - 0.1) / 0.9;
  return 1 - u * u * u * (u * (u * 6 - 15) + 10);
}

// 射线 ∩ 轴对齐盒（slab 法，返回最近距离 / Infinity）。
// 从 Scene3D 抽出的共享工具：单人走动准心（Scene3D.aimBodyTarget）与多人处决准心
// （ExecutionRig.classifyAim）共用。
export function rayHitsBox(origin, dir, cx, cz, y0, y1, hx, hz) {
  let tmin = 0, tmax = 30;
  const axes = [
    [origin.x, dir.x, cx - hx, cx + hx],
    [origin.y, dir.y, y0, y1],
    [origin.z, dir.z, cz - hz, cz + hz],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let t0 = (lo - o) / d, t1 = (hi - o) / d;
    if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}
