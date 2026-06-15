// 硬币动画池（纯表现层，确定性物理）。见 docs/GAME_SPEC.md §3.4 抛硬币。
//
// 思路（任务 1）：用带种子的确定性物理离线模拟「重力下落 + 衰减弹跳 + 收边落定」，
// 把**落定时翻转角的奇偶**作为该条动画的天然结果（正/反）。按种子递增批量模拟，分桶
// 直到正面 10 条、反面 10 条，烘焙成关键帧并缓存。抛硬币阶段：服务端权威决定 coinResult，
// 客户端据此从对应池随机取一条已烘焙轨迹回放（见 Coin.jsx）。
//
// 防穿模（任务 2）：每帧以 floorY = tableTop + (r·|sinθ| + h·|cosθ|) 为碰撞下界——
// 即便倾斜，硬币边缘也不会插进桌面；落定阶段沿边缘把翻转角倒向最近的平放朝面。

export const COIN_R = 0.40;       // 硬币半径（略缩小）
export const COIN_H = 0.06;       // 半厚
export const COIN_SEGMENTS = 16;  // 低面数 → 像素感圆形（faceted）
const FPS = 90;
const DT = 1 / FPS;
const DURATION = 2.4;             // 单条动画时长（秒）
const POOL_SIZE = 10;             // 每面各保留 10 条
const MAX_SEEDS = 2000;           // 分桶最多尝试的种子数（防御）

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// mulberry32：小巧确定性 PRNG，保证「同种子 → 同轨迹 → 同结果」。
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 倾斜角 θ 下硬币最低点相对圆心的下沉量（用于碰撞下界，倾斜时也不穿桌）。
const lowestOffset = (rx) => COIN_R * Math.abs(Math.sin(rx)) + COIN_H * Math.abs(Math.cos(rx));

// 单次确定性模拟，烘焙整条轨迹。返回 { frames:[{p:[x,y,z], r:[rx,ry,rz]}], result, dt, durationMs }。
function simulate(seed, tableTop) {
  const rng = mulberry32(seed);
  const restBase = tableTop; // 圆心最低高度的桌面基准（下沉量在其之上）

  let y = restBase + COIN_H + 3.0 + rng() * 0.6;
  let vy = rng() * 2.0;                  // 轻微上抛
  let x = 0, z = 0;
  let vx = (rng() - 0.5) * 0.8, vz = (rng() - 0.5) * 0.7; // 较小水平初速 → 落点近桌心
  let rx = rng() * 0.5;                  // 初始小倾角
  let ry = 0, rz;                        // rz 每帧在分支内赋值
  let spinVel = 15 + rng() * 12;         // 主自旋角速度
  if (rng() < 0.5) spinVel = -spinVel;
  let rySpin = (rng() - 0.5) * 4;        // 次轴自旋（视觉）

  const G = 24, restitution = 0.5;
  const settleDur = 0.42;                // 落定（倒平）时长
  const forceSettleAt = DURATION - settleDur; // 兜底：太晚还没静止就强制落定
  const totalFrames = Math.round(DURATION * FPS);

  const frames = [];
  let settleStart = null, rx0 = 0, targetRx = 0, landed = null, result = null;
  let t = 0;

  for (let i = 0; i < totalFrames; i++) {
    if (settleStart == null) {
      // 空中：重力 + 自旋 + 触桌弹跳（边缘碰撞下界，倾斜不穿桌）
      vy -= G * DT;
      y += vy * DT;
      rx += spinVel * DT;
      const floorY = restBase + lowestOffset(rx);
      let restedThisFrame = false;
      if (y <= floorY) {
        y = floorY;
        if (vy < 0) {
          vy = -vy * restitution;
          spinVel *= 0.62;               // 触桌大幅减速自旋
          vx *= 0.45; vz *= 0.45;
          if (Math.abs(vy) < 1.1) { vy = 0; restedThisFrame = true; } // 最后一跳→竖直静止
        }
      }
      x += vx * DT; z += vz * DT;
      vx *= Math.pow(0.18, DT); vz *= Math.pow(0.18, DT); // 强阻尼 → 落点靠近桌心
      ry += rySpin * DT; rySpin *= Math.pow(0.5, DT);
      rz = Math.sin(t * 20) * 0.05 * Math.min(1, Math.abs(spinVel) / 19);

      // 静止检测：落到桌面且竖直速度归零即进入落定——不再在桌面上继续整圈打转。
      if (restedThisFrame || t >= forceSettleAt) {
        settleStart = t;
        rx0 = rx;
        const k = Math.round(rx / Math.PI);
        targetRx = k * Math.PI;          // 最近的平放朝面
        landed = { x, z, ry, rz };
        result = ((((k % 2) + 2) % 2) === 0) ? 'heads' : 'tails'; // 偶=正(王朝上)，奇=反(禾朝上)
      }
    } else {
      // 落定：只把翻转角倒向最近平放面；x/z 保持落点不动（无漂移）；摆动归零；落定后完全静止。
      const p = Math.min(1, (t - settleStart) / settleDur);
      const e = easeOut(p);
      rx = rx0 + (targetRx - rx0) * e;
      ry = landed.ry;
      rz = landed.rz * (1 - e);
      x = landed.x;
      z = landed.z;
      y = restBase + lowestOffset(rx);   // 始终贴着碰撞下界 → 倒平时边缘不穿桌
    }
    frames.push({ p: [x, y, z], r: [rx, ry, rz] });
    t += DT;
  }

  // 兜底（理论上不会触发）：用末帧定结果。
  if (result == null) {
    const k = Math.round(rx / Math.PI);
    result = ((((k % 2) + 2) % 2) === 0) ? 'heads' : 'tails';
  }
  return { frames, result, dt: DT, durationMs: DURATION * 1000 };
}

let POOLS = null; // { heads:[anim...], tails:[anim...] }，惰性构建并缓存

function buildPools(tableTop) {
  const heads = [], tails = [];
  for (let seed = 1; seed <= MAX_SEEDS && (heads.length < POOL_SIZE || tails.length < POOL_SIZE); seed++) {
    const anim = simulate(seed, tableTop);
    const bucket = anim.result === 'heads' ? heads : tails;
    if (bucket.length < POOL_SIZE) bucket.push(anim);
  }
  // 极端兜底：某面不足则用另一面补齐（几乎不会发生）。
  while (heads.length < POOL_SIZE && tails.length) heads.push(tails[heads.length % tails.length]);
  while (tails.length < POOL_SIZE && heads.length) tails.push(heads[tails.length % heads.length]);
  return { heads, tails };
}

// 取一条匹配 result 的已烘焙动画（随机）。首次调用时构建动画池并缓存。
export function pickFlip(result, tableTop) {
  if (!POOLS) POOLS = buildPools(tableTop);
  const pool = POOLS[result] ?? POOLS.heads;
  return pool[Math.floor(Math.random() * pool.length)];
}
