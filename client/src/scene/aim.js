// 射线 ∩ 轴对齐盒（slab 法，返回最近距离 / Infinity）。
// 从 Scene3D 抽出的共享工具：单人走动准心（Scene3D.aimBodyTarget）与多人处决准心
// （ExecutionRig.classifyAim）共用——独立小模块避免 ExecutionRig ↔ Scene3D 循环引用。
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
