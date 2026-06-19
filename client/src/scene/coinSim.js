// 硬币动画池（纯表现层，确定性物理）。见 docs/GAME_SPEC.md §3.4 抛硬币。
//
// 思路（任务 1）：用带种子的确定性物理离线模拟「重力下落 + 衰减弹跳 + 收边落定」，
// 把**落定时翻转角的奇偶**作为该条动画的天然结果（正/反）。按种子递增批量模拟，分桶
// 直到正反各 POOL_SIZE 条，烘焙成关键帧并缓存。抛硬币阶段：服务端权威决定 coinResult，
// 客户端据此从对应池随机取一条已烘焙轨迹回放（见 Coin.jsx）。
//
// 公平观感（核心）：结果本就由服务端权威 50/50 决定，难点在于让动画「看起来」公平。
//   1) 起始朝面 50/50 随机 → 开局不暗示结果；
//   2) 高速自旋 → 滞空期间人眼无法追踪正反（糊影），落定前有悬念、像真随机；
//   3) 飞行参数对正反同分布、盲采后按落定面分桶 → 飞行过程不泄露结果；
//   4) 池子更大 + 回放期叠加偏航/镜像（见 pickFlip）→ 消除「在放固定录像」的观感。
//
// 物理（两段式，平面运动）：
//   ① 滞空翻飞（短）——抛点高度每回合不同 + 较快重力下落 + 少量小弹跳，尽快落台（即便抛得高滞空也短）；
//   ② 贴台翻滚/摇摆（长）——落台后边缘贴台，纯绕翻转轴在重力**平滑势** −sin(2rx)（平放稳定、立起
//      不稳，无任何角度跳变）下运动：能量大时翻滚过顶几下，再衰减成来回「翘起→拍平→翘起」的摆动，
//      约 10 次后躺平。因为势平滑，硬币是「倒下再继续动」而非立起来被瞬间放平；平面运动、无陀螺进动。
//      全程 floorY = tableTop + (R·|sinθ| + H·|cosθ|) 保证边缘不穿桌。
//
// 时长：绝大部分时间花在贴台摆动（落定 ~3–5.2s，约 8 次摆动；抛点高度每回合不同）。DURATION 与服务端
// config.timing.coinAnimMs 必须同步（后者 ≥ 前者，否则最长抛掷被提前打断）。

export const COIN_R = 0.26;       // 硬币半径（缩小，桌面上不再显大）
export const COIN_H = 0.04;       // 半厚
export const COIN_SEGMENTS = 16;  // 低面数 → 像素感圆形（faceted）
const FPS = 90;
const DT = 1 / FPS;
const DURATION = 6.0;             // 单条动画时长（秒）。落定 ~3–5.2s（抛点高度不一 + 长摆动收尾），末尾留静置；
                                  // ⚠ 必须 ≤ 服务端 config.timing.coinAnimMs（当前 6000），否则最长的抛掷会被提前打断。
const POOL_SIZE = 24;             // 每面各保留 24 条 → 不易看出重复（回放再叠加偏航/镜像）
const MAX_SEEDS = 4000;           // 分桶最多尝试的种子数（防御）
// 物理参数：抛点高度大范围随机（每回合不同高度）+ 较快重力（即便抛得高，滞空也短）+ 落台后较长的
// 「翻滚→摇摆」收尾——大部分时间花在硬币贴台摆动上（落定 ~3–5.2s，约 8 次摆动），而非滞空翻飞。
const G = 9;                     // 重力加速度（较快下落 → 即便抛得高，滞空也短）
const RESTITUTION = 0.35;         // 垂直弹跳恢复系数（小而少的弹跳）
const BOUNCE_SPIN_DAMP = 0.85;    // 每次落地弹跳后自旋保留比例（保留转动 → 落台后还能翻滚/摆动）
const ROCK_VY = 1.4;              // 垂直速度降到此值以下 → 早转入「贴台翻滚/摇摆」（缩短滞空）
const ROCK_G = 25;                // 摇摆/翻滚的重力回正系数（决定摆动频率）
const ROCK_VISC = 0.62;           // 摇摆黏性阻尼（每秒保留比例的底数）
const ROCK_SLAP = 0.75;           // 每次「某面拍台」（rx 过 kπ）的能量保留比例 → 摆幅逐次衰减

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

// 倾斜角 θ 下硬币最低点相对圆心的下沉量（碰撞下界，倾斜时边缘也不穿桌）。
// 平面翻转：只有翻转角 rx 造成倾斜，偏航（绕竖轴 yaw）不改变最低点 → 单参即可。
const lowestOffset = (rx) => COIN_R * Math.abs(Math.sin(rx)) + COIN_H * Math.abs(Math.cos(rx));

// 单次确定性模拟，烘焙整条轨迹。返回 { frames:[{p:[x,y,z], r:[rx,ry,rz]}], result, dt, durationMs }。
// 两段式平面物理：① 弹跳翻飞 → ② 贴台衰减摇摆 → 躺平冻结（见文件头注释）。
function simulate(seed, tableTop) {
  const rng = mulberry32(seed);
  const restBase = tableTop; // 圆心最低高度的桌面基准（下沉量在其之上）

  // 抛点高度大范围随机（每回合不同：桌面之上 1.5–3.3，起抛点更高）；弧顶限高保证不出画面（相机上界约 world-y 4.4）。
  const apex = 1.5 + rng() * 1.8;      // 抛掷弧顶（桌面之上高度，1.5–3.3）
  let y = restBase + COIN_H + apex;
  let vy = 0.2 + rng() * 0.5;            // 轻微上抛
  let x = 0, z = 0;
  let vx = (rng() - 0.5) * 1.5, vz = (rng() - 0.5) * 1.2; // 水平初速 → 落点散开、每次方向不同
  // 起始朝面 50/50 随机：开局不暗示结果（公平观感关键之一）。
  const startFace = rng() < 0.5 ? 0 : Math.PI;
  let rx = startFace + (rng() - 0.5) * 0.4; // 绕翻转轴（X）的初始小倾角
  // 自旋（绕翻转轴 X）：滞空成糊影，且落台后仍带转动 → 翻滚几下再摆动收尾（落定更长）。
  let omega = 4 + rng() * 15;
  if (rng() < 0.5) omega = -omega;

  const totalFrames = Math.round(DURATION * FPS);
  const frames = [];
  let mode = 'air';                      // 'air' 滞空翻飞 → 'rock' 贴台翻滚/摇摆 → 'rest' 躺平
  let restRx = 0, result = null, prevS = 0;

  for (let i = 0; i < totalFrames; i++) {
    if (mode === 'air') {
      // ① 空中：重力 + 自旋 + 触台垂直弹跳（边缘碰撞下界，倾斜不穿桌）
      vy -= G * DT;
      y += vy * DT;
      rx += omega * DT;
      const floorY = restBase + lowestOffset(rx);
      if (y <= floorY) {
        y = floorY;
        if (vy < 0) {
          vy = -vy * RESTITUTION;
          omega *= BOUNCE_SPIN_DAMP;     // 触台减速自旋 → 由糊影收向可辨
          vx *= 0.5; vz *= 0.5;
        }
        if (Math.abs(vy) < ROCK_VY) {    // 垂直能量基本耗尽 → 早转入「贴台翻滚/摇摆」收尾
          mode = 'rock';
          vy = 0;
          prevS = Math.sin(rx);
        }
      }
      x += vx * DT; z += vz * DT;
      vx *= Math.pow(0.5, DT); vz *= Math.pow(0.5, DT);
    } else if (mode === 'rock') {
      // ② 贴台翻滚/摇摆：边缘始终贴台（y=floor），纯绕翻转轴转动。重力回正用**平滑势** −sin(2·rx)：
      //    平放(kπ)稳定、立起((k+½)π)不稳，**任何角度都无跳变**——所以硬币是「倒下再继续动」，绝不
      //    会立起来被瞬间放平。能量大时翻滚过顶几下，再衰减成来回「翘起→拍平→翘起」的摆动，约 10 次
      //    后躺平。每当某面拍台（rx 越过 kπ，即 sin(rx) 变号）损失能量；平面运动（rz 恒 0，无进动）。
      omega += -ROCK_G * Math.sin(2 * rx) * DT;
      omega *= Math.pow(ROCK_VISC, DT);
      rx += omega * DT;
      y = restBase + lowestOffset(rx);   // 边缘贴台，倾斜不穿桌
      const s = Math.sin(rx);
      if ((prevS < 0) !== (s < 0)) omega *= ROCK_SLAP; // 某面拍台（越过平放朝面）→ 失能
      prevS = s;
      // 收敛只在「已贴近平放」时触发（|sin rx|<0.06，绝不在立起状态），故无可见的强行放平。
      if (Math.abs(omega) < 0.3 && Math.abs(s) < 0.06) {
        const k = Math.round(rx / Math.PI);
        restRx = k * Math.PI;
        result = ((((k % 2) + 2) % 2) === 0) ? 'heads' : 'tails'; // 偶=正(王朝上)，奇=反(禾朝上)
        rx = restRx;
        y = restBase + COIN_H;
        mode = 'rest';
      }
    } else {
      // ③ 已躺平：完全静止
      rx = restRx;
      y = restBase + COIN_H;
    }
    frames.push({ p: [x, y, z], r: [rx, 0, 0] }); // ry 偏航在回放期叠加；平面翻转 rz=0
  }

  // 兜底（DURATION 内未收敛，实测 0/2000 触发）：末帧取最近平放面，定结果与定格位姿。
  if (result == null) {
    const k = Math.round(rx / Math.PI);
    result = ((((k % 2) + 2) % 2) === 0) ? 'heads' : 'tails';
    const last = frames[frames.length - 1];
    last.p[1] = restBase + COIN_H;
    last.r[0] = k * Math.PI;
  }
  return { frames, result, dt: DT, durationMs: DURATION * 1000 };
}

let POOLS = null; // { heads:[anim...], tails:[anim...] }，惰性构建并缓存
let lastRest = null; // 最近一次回放的落定变换 {x,z,ry}；供 rest 模式无缝衔接，避免归位到桌心的跳变。

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

// 取一条匹配 result 的已烘焙动画（随机），叠加回放期「偏航 yaw + 水平镜像 mirror」——
// 二者均不改变朝上的面，却让同一条轨迹每次看起来都不同 → 消除「在放固定录像」的观感。
// 重要：保持纯函数（无副作用）！落定变换改由 flip 组件在「已提交渲染」里发布（见 Coin.jsx），
// 避免 React StrictMode 双调用 useMemo 时 lastRest 与实际回放的轨迹错位 → 衔接错位/归位跳变。
export function pickFlip(result, tableTop) {
  if (!POOLS) POOLS = buildPools(tableTop);
  const pool = POOLS[result] ?? POOLS.heads;
  const anim = pool[Math.floor(Math.random() * pool.length)];
  const yaw = Math.random() * Math.PI * 2;
  const mirror = Math.random() < 0.5 ? -1 : 1;
  return { ...anim, yaw, mirror };
}

// 某条回放动画的落定变换（末帧位姿，含偏航/镜像）——供 rest 模式无缝衔接。
export function restTransform(anim) {
  const last = anim.frames[anim.frames.length - 1];
  return { x: last.p[0] * anim.mirror, z: last.p[2], ry: last.r[1] + anim.yaw };
}

// rest 模式读取最近一次 flip 发布的落定变换，使「静置硬币」恰好出现在 flip 落定处（无跳变归位）。
export function setCoinRest(t) { lastRest = t; }
export function getCoinRest() { return lastRest; }
