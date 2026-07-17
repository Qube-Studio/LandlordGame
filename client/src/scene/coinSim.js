// 硬币物理（纯表现层）。见 docs/GAME_SPEC.md §3.4 抛硬币。
//
// 二代·真实物理版（替代一代「平面两段式+预烘焙池」）：
//   ① **完整 3D 刚体引擎**：四元数姿态 + 体系欧拉方程（陀螺项）+ 缘点碰撞（恢复系数随
//      撞速衰减）+ 库仑摩擦 + 触台耗散——落台后的行为全部**动力学自然涌现**：
//      弹跳翻飞、贴缘滚弧、以及重点打磨的**陀螺式立转收势**（欧拉盘效应：立着转→
//      进动越来越快→越转越低→转着转着停下来）。1080Hz 子步积分，90fps 采样关键帧
//      （位置+四元数），Coin.jsx 帧间 slerp 回放。
//   ② **行为原型盲抽**（与结果无关）：立转型（强轴旋,落台后站住转陀螺）/ 滚缘型
//      （轴旋+横速,贴缘滚弧）/ 颤摆型（弱轴旋,经典弹跳-颤摆）按权重抽一种——
//      每掷的「戏路」不同，但都以立转/颤摆收干告终。
//   ③ **每掷实时模拟，无预烘焙池**：COIN_FLIP 开始时现场模拟（一次 ~10ms），
//      玩家永远不可能识别出重复——因为根本不存在重复。
//   ④ **滞空慢动作**（子弹时间）：抛掷弧顶前后一段慢放（表现层时间扭曲，warp 字段随
//      动画返回）——回放速率沿真实时间走「1 → 0.28 → 1」的**梯形**（线性缓坡缓入缓出）：
//      常速起抛、弧顶渐入子弹时间、落台前渐出回常速；镜头照常动、只有硬币慢放。
//
// 公平观感（核心不变式）：结果由服务端权威 50/50 决定，动画只负责「看起来」公平——
//   1) 原型/初始姿态/自旋全部盲抽（与结果无关）；重试窗只看落定时刻（同样与结果无关）；
//   2) 自然落面 ≠ 服务端结果 → **翻面重标记**（flipFaces）：每帧姿态右乘体系绕直径 π
//      ——圆柱几何对称，**空间轨迹分毫不变**，只是两面贴图互换。动力学与结果标签解耦；
//   3) 空中多圈翻转 + 弹跳混沌 → 落定前无法追踪朝面。
//
// 时长：滞空(含慢放) ~0.9-1.4s、落台戏(弹跳/滚/立转) 1.5-3.5s → 真实落定 ~2.4-4.8s；
// DURATION 6.0 与服务端 config.timing.coinAnimMs（6000，须 ≥ 前者）不变。

export const COIN_R = 0.055;   // 半径（米）：Ø11cm 台面主角道具（一版 Ø5cm 被反馈太小）
export const COIN_H = 0.006;   // 半厚（米）：总厚 12mm
export const COIN_SEGMENTS = 16; // 低面数 → 像素感圆形（faceted）

const FPS = 90;
const FDT = 1 / FPS;
const DURATION = 6.0;          // 单条动画时长（秒,模拟时间）⚠ 必须 ≤ config.timing.coinAnimMs
const SUB = 12;                // 每关键帧物理子步 → 1080Hz
const DT = FDT / SUB;
const G = 9.81;                // 真实重力
const IA = 0.5 * COIN_R * COIN_R;                                  // 绕对称轴（体 y），m=1
const ID = (3 * COIN_R * COIN_R + 4 * COIN_H * COIN_H) / 12;       // 绕直径
const MU = 0.45;               // 库仑摩擦系数
const ROLL_DAMP = 0.45;        // 触台转动耗散基线（/s）——实际随倾角塑形:站立轻、贴平重（见接触分支）
const SLIDE_DAMP = 1.1;        // 触台平移耗散（/s）
const SPIN_DAMP = 1.8;         // 近平躺时绕竖轴钻孔摩擦（/s）
const E_SNAP = 0.004;          // 收束能量阈（J,m=1）：接触中总机械能低于此 → 定格混合
const SNAP_MS = 160;           // 定格混合时长（把最后一丝颤动柔和放平，视觉无跳变）
const FENCE_X = 1.25, FENCE_Z = 0.9; // 软围栏（弹性回推,几乎不触发；毡面半宽 2.95/1.95）
const SLOWMO_RATE = 0.28;      // 滞空慢动作谷值倍率（梯形平台段）
const SLOWMO_MAX = 0.6;        // 平台段最长（模拟秒）→ 平台额外真实时长 ≤ 0.6·(1/0.28−1) ≈ 1.54s
const SLOWMO_RAMP = 0.11;      // 缓入/缓出坡各自的模拟时长（窗口紧时按窗宽 30% 压缩）

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
// 行为原型 + 初始条件盲抽（全部与结果无关——公平不变式①）
function drawParams(rng = Math.random) {
  const a = rng();
  // 立转型(40%)：近立姿低抛 + 绕竖轴强自旋——像用手把硬币转起来:陀螺效应稳住站立,
  //   摩擦抽能→倾角渐降→进动加速→「转着转着停下来」（用户点名的主戏,欧拉盘收势）
  // 滚缘型(25%)：翻滚抛掷 + 强轴旋 + 横速——落台后贴缘滚弧再入立转/颤摆
  // 颤摆型(35%)：经典抛掷翻滚——弹跳数次后低倾角颤摆收干
  const arch = a < 0.4 ? 'spinner' : a < 0.65 ? 'roller' : 'tumbler';
  const sgn = rng() < 0.5 ? -1 : 1;
  const azi = rng() * Math.PI * 2;         // 翻转自旋轴方位（近水平）
  const tilt = (rng() - 0.5) * 0.4;
  if (arch === 'spinner') {
    const omega = sgn * (15 + rng() * 11);   // 绕世界竖轴的主自旋（站立旋转的角动量）
    // 旋转飞刀式抛掷（v3;贴桌放转的 v2 没有滞空/慢动作,被反馈缺抛起动画）：
    // 立着、绕竖轴自旋地抛出一道弧线——滞空像旋转门一样转着飞（角动量沿竖轴,姿态稳定）,
    // 慢动作照常在弧顶触发;落缘时「咬毡」（近立+强旋的接触恢复系数压低,见接触分支）,
    // 无缝接进站立旋转——落地状态恰好是扶正器想要的状态。
    return {
      arch,
      x0: (rng() - 0.5) * 0.6, z0: (rng() - 0.5) * 0.5,
      h0: 0.45 + rng() * 0.2,
      vx: (rng() - 0.5) * 0.3, vy: 1.35 + rng() * 0.5, vz: (rng() - 0.5) * 0.22,
      // 扰动噪声必须极小：±0.8rad/s 在 ~0.5s 滞空里只漂 ~23°（优雅的缓慢进动）——
      // 曾用 ±3,滞空漂 60° 落地早就不立了,咬毡闸门都进不去
      wWorld: [(rng() - 0.5) * 1.6, omega, (rng() - 0.5) * 1.6],
      // wSpin 对立姿硬币是「前滚」分量,会把 ω 拉离竖轴、张大滞空章动锥——落地时若正处
      // 章动歪相位(|ay|~0.4)会被接触踢翻,故必须极小;倾角偏置同理收窄
      wSpin: sgn * (0.4 + rng() * 1.0),
      tilt0: sgn * (Math.PI / 2 - 0.03 - rng() * 0.05), // 近立姿(差 2°~4.5° 到全立)
      tiltAxis: rng() * Math.PI * 2,
      yaw0: rng() * Math.PI * 2,
    };
  }
  const wMag = arch === 'roller' ? 15 + rng() * 10 : 19 + rng() * 14;
  return {
    arch,
    x0: (rng() - 0.5) * 0.6, z0: (rng() - 0.5) * 0.5,
    h0: 0.58 + rng() * 0.34,               // 抛掷起点高于桌面（米）
    vx: (rng() - 0.5) * (arch === 'roller' ? 0.85 : 0.5),
    vy: 1.3 + rng() * 0.8,
    vz: (rng() - 0.5) * (arch === 'roller' ? 0.7 : 0.45),
    wWorld: [Math.cos(azi) * Math.cos(tilt) * wMag, Math.sin(tilt) * wMag, Math.sin(azi) * Math.cos(tilt) * wMag],
    wSpin: arch === 'roller' ? sgn * (12 + rng() * 10) : (rng() - 0.5) * 6,
    tilt0: (rng() - 0.5) * 0.7,
    tiltAxis: rng() * Math.PI * 2,
    yaw0: rng() * Math.PI * 2,
  };
}

function simulate(prm, tableTop) {
  const tableY = tableTop;
  const p = [prm.x0, tableY + prm.h0, prm.z0];
  const v = [prm.vx, prm.vy, prm.vz];
  let q = qNorm(qMul(qAxis(0, 1, 0, prm.yaw0), qAxis(Math.cos(prm.tiltAxis), 0, Math.sin(prm.tiltAxis), prm.tilt0)));
  const wb = qRot(qInv(q), prm.wWorld);
  wb[1] += prm.wSpin;

  const totalFrames = Math.round(DURATION * FPS);
  const frames = [];
  let snapT = null, snapFrom = null, restRy = 0, result = null, restAt = DURATION;
  let tApex = 0, firstHit = null, prevVy = v[1];

  for (let i = 0; i < totalFrames; i++) {
    const t = i * FDT;
    if (snapT == null) {
      for (let s = 0; s < SUB; s++) {
        const tNow = t + (s + 1) * DT;
        // 体系欧拉方程（自由段陀螺项；对称轴=体 y）
        const dwx = ((IA - ID) / ID) * wb[1] * wb[2];
        const dwz = ((ID - IA) / ID) * wb[0] * wb[1];
        wb[0] += dwx * DT; wb[2] += dwz * DT;
        // 平动 + 姿态积分
        v[1] -= G * DT;
        if (prevVy > 0 && v[1] <= 0 && firstHit == null) tApex = tNow; // 弧顶（慢动作窗锚点）
        prevVy = v[1];
        p[0] += v[0] * DT; p[1] += v[1] * DT; p[2] += v[2] * DT;
        const wmag = Math.hypot(wb[0], wb[1], wb[2]);
        if (wmag > 1e-9) q = qNorm(qMul(q, qAxis(wb[0] / wmag, wb[1] / wmag, wb[2] / wmag, wmag * DT)));

        // ---- 接触：最低点（缘点或面心）----
        const a = qRot(q, [0, 1, 0]);
        const ay = a[1];
        const sinT = Math.sqrt(Math.max(0, 1 - ay * ay));
        let r;
        if (sinT < 1e-4) {
          r = [0, -COIN_H * Math.sign(ay || 1), 0]; // 完全平躺：面心支撑
        } else {
          const d = [a[0] * ay / sinT, -sinT, a[2] * ay / sinT]; // 盘面内最陡下方向
          const s2 = ay > 0 ? -1 : 1;                            // 较低的那圈缘
          r = [a[0] * COIN_H * s2 + d[0] * COIN_R, ay * COIN_H * s2 + d[1] * COIN_R, a[2] * COIN_H * s2 + d[2] * COIN_R];
        }
        const pen = tableY - (p[1] + r[1]);
        if (pen > 0) {
          if (firstHit == null) firstHit = tNow;
          p[1] += pen; // 位置投影出台面
          const ww = qRot(q, wb);
          const vc = [v[0] + ww[1] * r[2] - ww[2] * r[1], v[1] + ww[2] * r[0] - ww[0] * r[2], v[2] + ww[0] * r[1] - ww[1] * r[0]];
          const vn = vc[1];
          if (vn < 0) {
            // 接触冲量（弹跳与持续接触统一解）：恢复系数随撞速衰减到 0（慢接触=完全非弹）。
            // 关键：冲量经 kEff/angImpulse 带完整转动耦合——缘点支撑力矩由此自然产生：
            // 倾斜的硬币绕缘倒下、立转的硬币被扶着进动（陀螺效应）,而不是悬在斜角上。
            // 「咬毡」：近立姿+强竖轴自旋的缘接触几乎不弹（旋转的缘沿咬进毡绒）——
            // 旋转飞刀式抛掷落地即接进站立旋转,不被弹跳的腾空窗口掀翻。
            const wwv = qRot(q, wb)[1];
            const bite = sinT > 0.85 && Math.abs(wwv) > 7;
            const e = bite ? 0.08 : vn < -1.2 ? 0.5 : vn < -0.3 ? 0.3 : 0;
            const n = [0, 1, 0];
            const jn = Math.max(0, -(1 + e) * vn / kEff(q, r, n));
            v[1] += jn;
            const dwb = angImpulse(q, r, [0, jn, 0]);
            wb[0] += dwb[0]; wb[1] += dwb[1]; wb[2] += dwb[2];
            // 摩擦（接触点切向,库仑钳制）——滚缘不打滑、立转缓慢泄能都由它给出
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
            // 咬毡吸震：旋转飞刀落地的大冲击会经转动耦合踢出倾倒角速度（扶正抽不赢一次性
            // 大冲量）——咬毡状态下的强冲击接触当场吸掉横向角速度的大半（缘沿咬进毡绒），
            // 竖轴自旋保留 → 落地无缝接进站立旋转
            if (bite && vn < -0.5) {
              const ww4 = qRot(q, wb);
              ww4[0] *= 0.25; ww4[2] *= 0.25;
              const nb4 = qRot(qInv(q), ww4);
              wb[0] = nb4[0]; wb[1] = nb4[1]; wb[2] = nb4[2];
            }
          }
          // 触台期恒有的耗散——随倾角塑形：站立/大倾角时轻（立转与滚缘的戏演够），
          // 贴平后加重（低倾角颤摆别拖过硬上限）；进动率随倾角变小自然升高=「越转越快贴下去」
          const kd = 1 - (ROLL_DAMP + 2.4 * ay * ay) * DT;
          wb[0] *= kd; wb[2] *= kd;
          if (Math.abs(ay) > 0.94) wb[1] *= 1 - SPIN_DAMP * DT;
          v[0] *= 1 - SLIDE_DAMP * DT; v[2] *= 1 - SLIDE_DAMP * DT;
          // 收束判定：接触中总机械能（平动+转动+高于平躺的势能）足够小 → 定格混合
          const ke = 0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
            + 0.5 * (ID * (wb[0] * wb[0] + wb[2] * wb[2]) + IA * wb[1] * wb[1]);
          const pe = G * Math.max(0, p[1] - (tableY + COIN_H));
          if (ke + pe < E_SNAP && Math.abs(ay) > 0.9) {
            snapT = tNow;
            snapFrom = { p: [...p], q: [...q] };
            result = ay > 0 ? 'heads' : 'tails';
            const e1 = qRot(q, [1, 0, 0]);
            restRy = result === 'heads' ? Math.atan2(-e1[2], e1[0]) : Math.atan2(e1[2], e1[0]);
            break;
          }
        }
        // 立转扶正+泄能（表现级陀螺增强）：物理上 Ø11cm 硬币要 ~120rad/s 才站得住,
        // 但那个转速在 90fps 采样下频闪——把临界折算到 6rad/s：竖轴自旋超阈时抽掉
        // 倾倒分量（扶正,站着转）并缓慢泄掉自旋（「转着转着…」）；跌破阈值即撒手,
        // 倾倒-进动-越转越低-躺平全部交还真实动力学（「…停下来」,欧拉盘收势）。
        // 挂在接触块外、贴桌 2cm 内即生效——立转的微弹跳腾空瞬间也在扶,不给扰动开窗。
        if (sinT > 0.7 && p[1] - tableY < COIN_R + 0.02) {
          const ww3 = qRot(q, wb);
          const sv = Math.abs(ww3[1]);
          const horiz = Math.hypot(a[0], a[2]);
          if (sv > 6) {
            // ① 抽倾倒角速度 + 缓泄自旋（转着转着…）
            const k = Math.min(1, (sv - 6) / 8) * 4.5 * DT;
            ww3[0] *= 1 - k; ww3[2] *= 1 - k;
            ww3[1] *= 1 - 0.8 * DT;
            const nb = qRot(qInv(q), ww3);
            wb[0] = nb[0]; wb[1] = nb[1]; wb[2] = nb[2];
            // ② 姿态直接回正（λ=8/s×倾角,与①联立后站立是稳定平衡——重力失稳率 ~14/s²
            //    单靠抽角速度压不住）：把对称轴往水平面拧回一点,世界系左乘
            if (horiz > 1e-4 && Math.abs(ay) > 1e-4) {
              const axx = cross(a, [a[0] / horiz, 0, a[2] / horiz]);
              const axl = Math.hypot(axx[0], axx[1], axx[2]);
              if (axl > 1e-6) {
                const ang = Math.min(0.5, 8 * Math.abs(ay)) * DT;
                q = qNorm(qMul(qAxis(axx[0] / axl, axx[1] / axl, axx[2] / axl, ang), q));
              }
            }
          } else if (sinT > 0.9 && Math.abs(ay) < 0.12 && horiz > 1e-4) {
            // ③ 倾倒种子：自旋跌破阈值后,完美竖直是亚稳态（重力矩∝倾角≈0,会立到天荒地老）
            //    ——主动缓慢拧出一点倾角,重力的自加速倾倒随即接管（「…停下来」的起点）。
            //    方向沿现有倾斜走（近零时由 yaw 决定）,仍是盲参的确定性函数,公平性不破。
            const axx = cross(a, [a[0] / horiz, 0, a[2] / horiz]);
            const axl = Math.hypot(axx[0], axx[1], axx[2]);
            if (axl > 1e-6) q = qNorm(qMul(qAxis(-axx[0] / axl, -axx[1] / axl, -axx[2] / axl, 0.9 * DT), q));
          }
        }
        // 软围栏（极小概率触发的弹性回推,保证不滚出毡面）
        if (Math.abs(p[0]) > FENCE_X) v[0] -= (p[0] - Math.sign(p[0]) * FENCE_X) * 30 * DT;
        if (Math.abs(p[2]) > FENCE_Z) v[2] -= (p[2] - Math.sign(p[2]) * FENCE_Z) * 30 * DT;
      }
      // 硬上限：极端不收敛时强制进入定格（实测极少触发）
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
      // 定格混合：把最后一丝余摆柔和放平（SNAP_MS 内 slerp 到精确平躺,无跳变）。
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

  // 滞空慢动作窗（表现层时间扭曲,回放期由 Coin.jsx 应用）：**常速进、常速出**——
  // 回放速率沿真实时间走「1 → RATE → 1」的梯形（线性缓坡）:常速起抛一拍、弧顶前渐入
  // 子弹时间、平台段慢放、首触前渐出回到常速落台。sim=∫rate·dt 为分段二次,warpTime
  // 有闭式解（连续且端点速率恰为 1,无跳变）。真实时间轴上 restAt/firstHit 后移 extra。
  const wA = Math.max(0.12, tApex - 0.05);
  const wB = (firstHit ?? 1) - 0.05;
  const span = wB - wA;
  let warp = null;
  if (span >= 0.15) {
    const sRamp = Math.min(SLOWMO_RAMP, span * 0.3);          // 缓坡（模拟秒,两侧各一）
    const sMid = Math.min(SLOWMO_MAX, span - 2 * sRamp);      // 平台（模拟秒;截短则窗尾照常速）
    const rRamp = 2 * sRamp / (1 + SLOWMO_RATE);              // 线性速率坡:sim=R·(1+rate)/2
    const rMid = sMid / SLOWMO_RATE;
    const extra = (2 * rRamp + rMid) - (2 * sRamp + sMid);    // 慢放净增的真实时长
    warp = { a: wA, b: wB, rate: SLOWMO_RATE, extra, sRamp, sMid, rRamp, rMid };
  }
  const extra = warp ? warp.extra : 0;
  return {
    frames, result, dt: FDT, durationMs: DURATION * 1000,
    restAt: restAt + extra,             // 真实时间轴的落定时刻（含慢放延伸;分镜/相机用这个）
    simRestAt: restAt,
    warp,
    hitAt: (firstHit ?? 1) + extra,     // 真实时间轴的首触时刻（分镜切镜锚点）
    restRy, restX: snapFrom ? snapFrom.p[0] : p[0], restZ: snapFrom ? snapFrom.p[2] : p[2],
    arch: prm.arch,
  };
}

// 数组四元数 slerp（定格混合用）
function slerpArr(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb2 = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb2, a[1] * wa + bb[1] * wb2, a[2] * wa + bb[2] * wb2, a[3] * wa + bb[3] * wb2];
}

// 真实时间 → 模拟时间（滞空慢动作的时间扭曲;无 warp 时恒等）。
// 梯形速率的分段积分（缓坡内 sim 是二次函数）：处处连续、单调,两端速率恰为 1
// ——慢动作渐入渐出,开头结尾都是常速（不再是硬切进/出慢放）。
export function warpTime(anim, tReal) {
  const w = anim.warp;
  if (!w) return tReal;
  if (tReal < w.a) return tReal;
  let u = tReal - w.a;
  // 缓入坡：rate 1→r 线性,sim = u − (1−r)·u²/(2R)
  if (u < w.rRamp) return w.a + u - (1 - w.rate) * u * u / (2 * w.rRamp);
  let s = w.a + w.sRamp;
  u -= w.rRamp;
  // 平台段：恒 r
  if (u < w.rMid) return s + u * w.rate;
  s += w.sMid;
  u -= w.rMid;
  // 缓出坡：rate r→1 线性,sim = r·u + (1−r)·u²/(2R)
  if (u < w.rRamp) return s + w.rate * u + (1 - w.rate) * u * u / (2 * w.rRamp);
  return tReal - w.extra;
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
// 重试窗（只看真实落定时刻,与结果无关）：太快没戏、太慢顶上限都重抽；期望 ~1.4 次命中。
export function pickFlip(result, tableTop) {
  let anim = null;
  for (let i = 0; i < 6; i++) {
    anim = simulate(drawParams(), tableTop);
    if (anim.restAt >= 2.4 && anim.restAt <= 4.8) break;
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

// 掷币分镜相机（CineRig）的实时通道：flip 硬币每帧发布世界坐标位姿与真实时间轴
// （t/restAt/hitAt 均为真实时间,含慢放延伸）；卸载时清空（null = 无飞行中的硬币）。
let flightLive = null; // { x, y, z, t, restAt, hitAt }
export function setCoinFlightLive(v) { flightLive = v; }
export function getCoinFlightLive() { return flightLive; }

// 硬币金光脉冲点火通道：rest 硬币不再挂载即播，改由分镜揭示镜（CineRig）
// 请求一次性点火——躺平的硬币「接住」末镜的光闪一下。
let pulsePending = false;
export function requestCoinPulse() { pulsePending = true; }
export function consumeCoinPulse() { const p = pulsePending; pulsePending = false; return p; }

// 供 node 物理单测直取（不进打包路径的额外导出）
export const _internals = { simulate, drawParams, flipFaces, qRot, qMul, qAxis, qInv, FPS, DURATION };
