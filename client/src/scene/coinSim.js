// 硬币物理（纯表现层）。见 docs/GAME_SPEC.md §3.4 抛硬币。
//
// 二代（真实物理版，替代一代「平面两段式+预烘焙池」）：
//   ① **真实尺寸**：Ø5cm×6mm（挑战币规格，只比真硬币略大；世界单位≈米），真实重力 9.81。
//   ② **完整 3D 刚体模拟**：四元数姿态 + 体系欧拉方程（陀螺项）+ 缘点碰撞（恢复系数随
//      速度衰减）+ 库仑摩擦 + 持续接触的滚动/钻孔耗散——落台后自然涌现「倾斜缘立→
//      进动颤摆→越摆越低」的真实硬币收势（非手工设计的摆动曲线）；1080Hz 子步积分，
//      90fps 采样成关键帧（位置+四元数），Coin.jsx 帧间 slerp 回放。
//   ③ **每掷实时模拟，无预烘焙池**：COIN_FLIP 开始时现场模拟一条全新轨迹（一次 ~几毫秒），
//      玩家永远不可能识别出重复——因为根本不存在重复。
//
// 公平观感（核心不变式）：结果由服务端权威 50/50 决定，动画只负责「看起来」公平——
//   1) 初始姿态/自旋全部盲抽（与结果无关）；
//   2) 若模拟的自然落面 ≠ 服务端结果 → **翻面重标记**（flipFaces）：每帧姿态右乘体系
//      绕直径 π 旋转——圆柱体几何对称，**空间轨迹分毫不变**，只是两个面的贴图互换。
//      动力学与结果标签解耦，过程不可能泄露结果；
//   3) 空中多圈翻转 + 弹跳混沌 → 落定前无法追踪朝面。
//
// 时长：首触 ~0.4-0.7s、弹跳 ~1s、缘摆颤动 1-2.5s → 落定(restAt) ~2.2-4.6s；
// DURATION 6.0 与服务端 config.timing.coinAnimMs（6000，须 ≥ 前者）不变。

export const COIN_R = 0.025;   // 半径（米）：Ø5cm，只比现实硬币略大
export const COIN_H = 0.003;   // 半厚（米）：总厚 6mm
export const COIN_SEGMENTS = 16; // 低面数 → 像素感圆形（faceted）

const FPS = 90;
const FDT = 1 / FPS;
const DURATION = 6.0;          // 单条动画时长（秒）⚠ 必须 ≤ config.timing.coinAnimMs
const SUB = 12;                // 每关键帧物理子步 → 1080Hz
const DT = FDT / SUB;
const G = 9.81;                // 真实重力
const IA = 0.5 * COIN_R * COIN_R;                                  // 绕对称轴（体 y），m=1
const ID = (3 * COIN_R * COIN_R + 4 * COIN_H * COIN_H) / 12;       // 绕直径
const MU = 0.45;               // 库仑摩擦系数
const ROLL_DAMP = 1.6;         // 持续接触的转动耗散（/s）——决定缘摆颤动持续多久
const SLIDE_DAMP = 2.0;        // 持续接触的平移耗散（/s）
const SPIN_DAMP = 2.6;         // 近平躺时绕竖轴钻孔摩擦（/s）
const E_SNAP = 0.0035;         // 收束能量阈（J，m=1）：接触中总机械能低于此 → 定格混合
const SNAP_MS = 160;           // 定格混合时长（把最后几度的颤动柔和放平，视觉无跳变）
const FENCE_X = 1.25, FENCE_Z = 0.9; // 软围栏（弹性回推,几乎不会触发；毡面半宽 2.95/1.95）

// ---------- 纯四元数/向量工具（无 THREE 依赖,保持本模块可在 node 单测） ----------
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qAxis = (x, y, z, ang) => { const s = Math.sin(ang / 2); return [x * s, y * s, z * s, Math.cos(ang / 2)]; };
const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qRot = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 世界冲量 ΔL=r×J → 体系 Δω = I⁻¹ R⁻¹ ΔL
function angImpulse(q, r, J) {
  const L = cross(r, J);
  const Lb = qRot(qInv(q), L);
  return [Lb[0] / ID, Lb[1] / IA, Lb[2] / ID];
}
// 沿方向 n、作用点 r 的等效逆质量 k = 1/m + n·((I_w⁻¹(r×n))×r)
function kEff(q, r, n) {
  const u = qRot(qInv(q), cross(r, n));
  const w = qRot(q, [u[0] / ID, u[1] / IA, u[2] / ID]);
  return 1 + dot(cross(w, r), n);
}

// ---------- 每掷实时模拟 ----------
// 初始条件盲抽（与结果无关——公平不变式①）
function drawParams(rng = Math.random) {
  const azi = rng() * Math.PI * 2;         // 自旋轴方位（近水平）
  const tilt = (rng() - 0.5) * 0.4;        // 自旋轴离水平的倾角
  return {
    x0: (rng() - 0.5) * 0.6, z0: (rng() - 0.5) * 0.5,
    h0: 0.42 + rng() * 0.34,               // 起点高于桌面（米）
    vx: (rng() - 0.5) * 0.55, vy: 0.55 + rng() * 0.85, vz: (rng() - 0.5) * 0.45,
    wAxis: [Math.cos(azi) * Math.cos(tilt), Math.sin(tilt), Math.sin(azi) * Math.cos(tilt)],
    wMag: 19 + rng() * 15,                 // 主翻转自旋 rad/s（3~5.4 转/秒,60fps 渲染不频闪）
    wSpin: (rng() - 0.5) * 5,              // 绕自身轴的少量自旋（落台后带出旋转/侧滚）
    tilt0: (rng() - 0.5) * 0.7,            // 初始姿态小倾角
    tiltAxis: rng() * Math.PI * 2,
    yaw0: rng() * Math.PI * 2,
  };
}

function simulate(prm, tableTop) {
  const tableY = tableTop;
  const p = [prm.x0, tableY + prm.h0, prm.z0];
  const v = [prm.vx, prm.vy, prm.vz];
  let q = qNorm(qMul(qAxis(0, 1, 0, prm.yaw0), qAxis(Math.cos(prm.tiltAxis), 0, Math.sin(prm.tiltAxis), prm.tilt0)));
  // 世界自旋 → 体系
  const wWorld = [prm.wAxis[0] * prm.wMag, prm.wAxis[1] * prm.wMag, prm.wAxis[2] * prm.wMag];
  const wb = qRot(qInv(q), wWorld);
  wb[1] += prm.wSpin;

  const totalFrames = Math.round(DURATION * FPS);
  const frames = [];
  let snapT = null, snapFrom = null, restRy = 0, result = null, restAt = DURATION;

  for (let i = 0; i < totalFrames; i++) {
    const t = i * FDT;
    if (snapT == null) {
      for (let s = 0; s < SUB; s++) {
        // 体系欧拉方程（自由段陀螺项；对称轴=体 y）
        const dwx = ((IA - ID) / ID) * wb[1] * wb[2];
        const dwz = ((ID - IA) / ID) * wb[0] * wb[1];
        wb[0] += dwx * DT; wb[2] += dwz * DT;
        // 平动 + 姿态积分
        v[1] -= G * DT;
        p[0] += v[0] * DT; p[1] += v[1] * DT; p[2] += v[2] * DT;
        const wmag = Math.hypot(wb[0], wb[1], wb[2]);
        if (wmag > 1e-9) q = qNorm(qMul(q, qAxis(wb[0] / wmag, wb[1] / wmag, wb[2] / wmag, wmag * DT)));

        // ---- 接触：最低点（缘点或面心）----
        const a = qRot(q, [0, 1, 0]);
        const ay = a[1];
        const sinT = Math.sqrt(Math.max(0, 1 - ay * ay));
        let r; // 接触点相对 COM 的世界偏移
        if (sinT < 1e-4) {
          r = [0, -COIN_H * Math.sign(ay || 1), 0]; // 完全平躺：面心支撑
        } else {
          const d = [a[0] * ay / sinT, -sinT, a[2] * ay / sinT]; // 盘面内最陡下方向
          const s2 = ay > 0 ? -1 : 1;                            // 较低的那圈缘
          r = [a[0] * COIN_H * s2 + d[0] * COIN_R, ay * COIN_H * s2 + d[1] * COIN_R, a[2] * COIN_H * s2 + d[2] * COIN_R];
        }
        const pen = tableY - (p[1] + r[1]);
        if (pen > 0) {
          p[1] += pen; // 位置投影出台面
          const ww = qRot(q, wb);
          const vc = [v[0] + ww[1] * r[2] - ww[2] * r[1], v[1] + ww[2] * r[0] - ww[0] * r[2], v[2] + ww[0] * r[1] - ww[1] * r[0]];
          const vn = vc[1];
          if (vn < 0) {
            // 接触冲量（弹跳与持续接触统一解）：恢复系数随撞速衰减到 0（慢接触=完全非弹）。
            // 关键：冲量经 kEff/angImpulse 带完整转动耦合——缘点支撑力矩由此自然产生,
            // 倾斜的硬币才会「绕缘倒下」而不是悬在斜角上（一版 bug：清零 v_y 无力矩,永不倒平）。
            const e = vn < -0.6 ? 0.5 : vn < -0.15 ? 0.3 : 0;
            const n = [0, 1, 0];
            const jn = Math.max(0, -(1 + e) * vn / kEff(q, r, n));
            v[1] += jn;
            const dwb = angImpulse(q, r, [0, jn, 0]);
            wb[0] += dwb[0]; wb[1] += dwb[1]; wb[2] += dwb[2];
            // 摩擦（接触点切向,库仑钳制）
            const ww2 = qRot(q, wb);
            const vc2 = [v[0] + ww2[1] * r[2] - ww2[2] * r[1], v[1] + ww2[2] * r[0] - ww2[0] * r[2], v[2] + ww2[0] * r[1] - ww2[1] * r[0]];
            const vt = [vc2[0], 0, vc2[2]];
            const vtm = Math.hypot(vt[0], vt[2]);
            if (vtm > 1e-5) {
              const th = [-vt[0] / vtm, 0, -vt[2] / vtm];
              const jt = Math.min(MU * jn, vtm / kEff(q, r, th));
              v[0] += th[0] * jt; v[2] += th[2] * jt;
              const dwb2 = angImpulse(q, r, [th[0] * jt, 0, th[2] * jt]);
              wb[0] += dwb2[0]; wb[1] += dwb2[1]; wb[2] += dwb2[2];
            }
          }
          // 触台期恒有的耗散：滚动/平移阻尼 + 近平躺钻孔摩擦——缘摆颤动逐渐收干
          const kd = 1 - ROLL_DAMP * DT;
          wb[0] *= kd; wb[2] *= kd;
          if (Math.abs(ay) > 0.94) wb[1] *= 1 - SPIN_DAMP * DT;
          v[0] *= 1 - SLIDE_DAMP * DT; v[2] *= 1 - SLIDE_DAMP * DT;
          // 收束判定：接触中总机械能（平动+转动+高于平躺的势能）足够小 → 定格混合
          const ke = 0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
            + 0.5 * (ID * (wb[0] * wb[0] + wb[2] * wb[2]) + IA * wb[1] * wb[1]);
          const pe = G * Math.max(0, p[1] - (tableY + COIN_H));
          if (ke + pe < E_SNAP && Math.abs(ay) > 0.9) {
            snapT = t + (s + 1) * DT;
            snapFrom = { p: [...p], q: [...q] };
            result = ay > 0 ? 'heads' : 'tails';
            const e1 = qRot(q, [1, 0, 0]);
            restRy = result === 'heads' ? Math.atan2(-e1[2], e1[0]) : Math.atan2(e1[2], e1[0]);
            break;
          }
        }
        // 软围栏（极小概率触发的弹性回推,保证不滚出毡面）
        if (Math.abs(p[0]) > FENCE_X) v[0] -= (p[0] - Math.sign(p[0]) * FENCE_X) * 30 * DT;
        if (Math.abs(p[2]) > FENCE_Z) v[2] -= (p[2] - Math.sign(p[2]) * FENCE_Z) * 30 * DT;
      }
      // 硬上限：极端不收敛时强制进入定格（实测几乎不触发）
      if (snapT == null && t > 5.0) {
        const a = qRot(q, [0, 1, 0]);
        snapT = t;
        snapFrom = { p: [...p], q: [...q] };
        result = a[1] > 0 ? 'heads' : 'tails';
        const e1 = qRot(q, [1, 0, 0]);
        restRy = result === 'heads' ? Math.atan2(-e1[2], e1[0]) : Math.atan2(e1[2], e1[0]);
      }
    }

    if (snapT != null && t >= snapT) {
      // 定格混合：把最后几度的余摆柔和放平（SNAP_MS 内 slerp 到精确平躺,无跳变）。
      // 高度不走直线插值——按混合姿态的支撑高度走（缘沿贴桌「滚」到面贴桌,绝不掘进桌面）
      const u = Math.min(1, (t - snapT) / (SNAP_MS / 1000));
      const k = u * u * (3 - 2 * u);
      const qFlat = result === 'heads'
        ? qAxis(0, 1, 0, restRy)
        : qMul(qAxis(1, 0, 0, Math.PI), qAxis(0, 1, 0, restRy));
      const qb = slerpArr(snapFrom.q, qFlat, k);
      const ab = qRot(qb, [0, 1, 0]);
      const sinB = Math.sqrt(Math.max(0, 1 - ab[1] * ab[1]));
      frames.push({
        p: [snapFrom.p[0], tableY + COIN_R * sinB + COIN_H * Math.abs(ab[1]), snapFrom.p[2]],
        q: qb,
      });
      if (restAt === DURATION) restAt = snapT;
    } else {
      frames.push({ p: [...p], q: [...q] });
    }
  }
  return { frames, result, dt: FDT, durationMs: DURATION * 1000, restAt, restRy, restX: snapFrom ? snapFrom.p[0] : p[0], restZ: snapFrom ? snapFrom.p[2] : p[2] };
}

// 数组四元数 slerp（定格混合用；夹角小,nlerp 亦可,这里用标准 slerp 保精度）
function slerpArr(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb2 = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb2, a[1] * wa + bb[1] * wb2, a[2] * wa + bb[2] * wb2, a[3] * wa + bb[3] * wb2];
}

// 翻面重标记（公平不变式②）：圆柱几何对称——每帧姿态右乘「绕体 x 轴 π」,空间轨迹
// 分毫不变、两面贴图互换 → 结果标签翻转。restRy 相应取负（qy(θ)⊗qx(π) = qx(π)⊗qy(−θ)）。
function flipFaces(anim) {
  const QX = [1, 0, 0, 0];
  for (const f of anim.frames) f.q = qMul(f.q, QX);
  anim.result = anim.result === 'heads' ? 'tails' : 'heads';
  anim.restRy = -anim.restRy;
  return anim;
}

// 取一条匹配服务端 result 的轨迹：现场实时模拟（无池、无重复）。
// 自然落面 ≠ 目标 → 翻面重标记（动力学不变,只换贴图标签——过程不泄露结果）。
// 重试窗（只看时长,与结果无关——不破坏公平不变式）：落定太快没戏剧性、太慢顶到硬上限
// 都重抽初始条件；期望 ~1.4 次命中,上限兜底取末条。
export function pickFlip(result, tableTop) {
  let anim = null;
  for (let i = 0; i < 6; i++) {
    anim = simulate(drawParams(), tableTop);
    if (anim.restAt >= 2.0 && anim.restAt <= 4.6) break;
  }
  if (anim.result !== result) flipFaces(anim);
  return anim;
}

// 某条动画的落定变换——供 rest 硬币无缝衔接。
export function restTransform(anim) {
  return { x: anim.restX, z: anim.restZ, ry: anim.restRy };
}

// rest 模式读取最近一次 flip 发布的落定变换，使「静置硬币」恰好出现在 flip 落定处（无跳变归位）。
let lastRest = null;
export function setCoinRest(t) { lastRest = t; }
export function getCoinRest() { return lastRest; }

// 掷币分镜相机（CineRig）的实时通道：flip 硬币每帧发布世界坐标位姿与时间轴，
// 相机导演据此跟拍/预知落定时刻；卸载时清空（null = 无飞行中的硬币）。
let flightLive = null; // { x, y, z, t, restAt }
export function setCoinFlightLive(v) { flightLive = v; }
export function getCoinFlightLive() { return flightLive; }

// 硬币金光脉冲点火通道：rest 硬币不再挂载即播，改由分镜揭示镜（CineRig）
// 请求一次性点火——躺平的硬币「接住」末镜的光闪一下。
let pulsePending = false;
export function requestCoinPulse() { pulsePending = true; }
export function consumeCoinPulse() { const p = pulsePending; pulsePending = false; return p; }

// 供 node 物理单测直取（不进打包路径的额外导出）
export const _internals = { simulate, drawParams, flipFaces, qRot, qMul, qAxis, qInv, FPS, DURATION };
