// 全部可调参数集中于此（见 docs/GAME_SPEC.md §6）。
// 任何规则数值都禁止散落在其他文件里硬编码；房间创建时可用 overrides 覆盖。

export const DEFAULT_CONFIG = {
  // --- 初始资金（地主按农民总资金动态：见 getInitialBalance） ---
  // farmer：每个农民的初始资金；landlordFundMultiplier：地主初始资金 = 农民总资金 × 该倍数（向下取整）。
  initialBalance: { farmer: 8 },
  landlordFundMultiplier: 1.2,

  // --- 最小出资额 ---
  minStake: { farmer: 1, landlordPerFarmer: 1 },

  // --- 结算 ---
  landlordWinMultiplier: 1.5, // 地主胜的目标 = floor(下注 × 该倍数)；同时决定缺口补偿额
  surplusLandlordShare: 0.5,  // pot 超出目标的部分，地主再拿的比例
  rounding: 'floor',          // 'floor' | 'ceil' —— 比例计算的取整方式
  debtAllocation: 'inverseBet',   // 'inverseBet' | 'equal' | 'proportionalBet'
  farmerSplit: 'equal',           // 农民胜时分 pot 的方式（当前仅 'equal'）
  surplusTieBreak: 'highestBet',  // 最大余数法并列时余数单位归属：'highestBet' | 'lowestBet'
  bankruptcyThreshold: 0,         // balance ≤ 此值即破产

  // --- 地主资金目标（见 logic/landlordGoal.js 与 docs/TUNING.md） ---
  // 每过若干回合地主必须达到一个资金目标，否则在该回合 FINALIZE（押注后资金分配完成时）
  // 扣除 max(minPenalty, floor(余额 × penaltyRate)) 作为惩罚（资金沉没，可触发破产）。
  // 检查点由 schedule 显式给出：每项 {interval, multiplier} = 「再过 interval 回合，
  // 目标 = floor(地主初始资金 × multiplier)」。累计回合 2→4→7→10→15…，最后一项之后按其
  // interval/multiplier 重复（维持最高目标）。
  landlordGoal: {
    enabled: true,
    schedule: [
      { interval: 2, multiplier: 0.6 },
      { interval: 2, multiplier: 1.0 },
      { interval: 3, multiplier: 1.5 },
      { interval: 3, multiplier: 1.8 },
      { interval: 5, multiplier: 2.0 },
    ],
    penaltyRate: 0.2,         // 未达标时扣除的资金比例（向下取整）
    minPenalty: 2,            // 未达标时至少扣除的资金
  },

  // --- 人数 ---
  minFarmers: 1,
  maxFarmers: 4,

  // --- 阶段时长（ms；0 = 不自动推进） ---
  timing: {
    revealAnimMs: 2200,       // 揭牌动画（动画后等待全员确认）
    coinAnimMs: 6000,         // 硬币动画后自动进入系统结算（须 ≥ 客户端 coinSim DURATION 6.0s，否则最长抛掷被打断）
    settleViewMs: 5200,       // 系统结算展示后自动进入协商（须容纳桌面聚拢→分堆→派送演出，§3.8）
    finalizeMs: 2600,         // 全员拿取完成后进入下一回合讨论的收尾间隔
    negotiateTimeoutMs: 120000, // 协商超时按当前方案生效（0 = 不超时）
    takeTimeoutMs: 45000,     // FINALIZE 拿取超时：到点未拿的自动入账（0 = 不超时，AFK 会卡场）
    takeAutoDelayMs: 2600,    // 进入拿取阶段后，代离线玩家自动拿取的延迟（让观众看完演出）
    reflipDecisionMs: 8000,   // 竞技暴食者重掷决策窗（§8.4）；超时无人重掷则进入结算（0 = 立即跳过）
    endedToLobbyMs: 8000,     // 终局演出驻留时长：ENDED 到点自动回大厅重开流程（0 = 不自动回，等房主手动「再来一局」）
  },

  // --- 连接 ---
  reconnectGraceSec: 0,       // 断线保座时长；0 = 永不超时（永久保座，离线由 autoActForOffline 兜底）。>0 则超时降级观战
  autoActForOffline: true,    // 离线玩家自动准备/确认，避免卡住流程
  heartbeatSec: 30,

  // --- 聊天/语音 ---
  channels: ['public', 'farmer', 'spectator'], // spectator：观战者专属频道，仅观战者可读写（防上帝视角泄密）
  voiceEnabled: false,        // 语音联机预留开关

  // --- 竞技模式（角色技能系统，见 docs/GAME_SPEC.md §8） ---
  // 仅 mode==='competitive' 生效；roomConfig() 会把这里的 landlordFundMultiplier / landlordGoal
  // 覆盖到顶层（让既有 landlordGoal.js、settleRound 直接用竞技数值），其余角色专属参数按需直接读取。
  competitive: {
    landlordFundMultiplier: 1.5,                        // 地主初始 = ⌊农民总资金 × 1.5⌋
    initialBalance: { farmer: 9, investor: 8, glutton: 6 }, // 农民阵营按角色的初始资金
    // 资本家：个人资金=押注钱包（本金必归还、不决定破产）；资金池=血条（承接盈亏、被税、耗尽即破产）。
    capitalist: { personalPerFarmer: 4, poolPerFarmer: 10, minStake: 1, taxRate: 0.10, taxMin: 2 },
    // 基础农民工资（m=活跃农民总数）：interval=max(minInterval, baseInterval−(m−1)·reduce)，amount=base+(m−1)·bonus。
    wage:    { baseInterval: 5, minInterval: 2, perFarmerIntervalReduce: 1, baseAmount: 1, perFarmerAmountBonus: 1 },
    investor:{ maxPledge: 3, waiveMultiplier: 2 },      // 担保保费先扣 n；农民输则缺口减 waiveMultiplier×Σn
    glutton: { allowancePerRound: 1, maxReflips: 3 },   // 每回合 +1 饭账（成本，仅农民胜时从余额扣除并清零，可扣破产）；每局最多 3 次重掷
    landlordGoal: {                                      // 竞技档目标 schedule（覆盖顶层）：回合 3→0.6 … 7→2.0
      schedule: [
        { interval: 3, multiplier: 0.6 }, { interval: 1, multiplier: 1.0 },
        { interval: 1, multiplier: 1.4 }, { interval: 1, multiplier: 1.7 },
        { interval: 1, multiplier: 2.0 },
      ],
      penaltyRate: 0.2, minPenalty: 2,
    },
  },
};

// 角色 → 阵营。地主阵营={landlord, capitalist}，农民阵营={farmer, investor, glutton}。
// 这是竞技模式的核心抽象：Room/结算只关心阵营（哪一侧），具体角色只影响技能。
const LANDLORD_ROLES = new Set(['landlord', 'capitalist']);
const FARMER_ROLES = new Set(['farmer', 'investor', 'glutton']);
export function factionOf(role) {
  if (LANDLORD_ROLES.has(role)) return 'landlord';
  if (FARMER_ROLES.has(role)) return 'farmer';
  return null;
}

// 初始资金。快速模式：农民固定、地主 = 农民总资金 × 倍数。
// 竞技模式（opts.mode==='competitive'）：农民阵营按角色取值；地主 = ⌊farmerTotal × 倍数⌋；
//   资本家个人资金 = 活跃农民数 × personalPerFarmer（资金池另由 getInitialPool 计算）。
// 要换公式只改此函数（§0.2 扩展点）。
export function getInitialBalance(role, farmerCount, config, opts = {}) {
  if (opts.mode === 'competitive') {
    const c = config.competitive;
    if (role === 'farmer') return c.initialBalance.farmer;
    if (role === 'investor') return c.initialBalance.investor;
    if (role === 'glutton') return c.initialBalance.glutton;
    if (role === 'capitalist') return Math.max(1, (farmerCount || 1) * c.capitalist.personalPerFarmer);
    if (role === 'landlord') return Math.max(1, Math.floor((opts.farmerTotal ?? 0) * config.landlordFundMultiplier));
  }
  const farmer = config.initialBalance.farmer;
  if (role !== 'landlord') return farmer;
  const farmers = Math.max(1, farmerCount || 1);
  return Math.max(1, Math.floor(farmers * farmer * config.landlordFundMultiplier));
}

// 资本家资金池初始额（血条）= 活跃农民数 × poolPerFarmer。非资本家返回 null。
export function getInitialPool(role, farmerCount, config) {
  if (role !== 'capitalist') return null;
  return Math.max(0, (farmerCount || 1) * config.competitive.capitalist.poolPerFarmer);
}

// 最小出资额：农民固定，地主随活跃农民人数变化；竞技资本家固定（默认 1）。
export function getMinStake(role, farmerCount, config, opts = {}) {
  if (opts.mode === 'competitive' && role === 'capitalist') {
    return Math.max(1, config.competitive.capitalist.minStake ?? 1);
  }
  if (factionOf(role) === 'landlord') return Math.max(1, farmerCount * config.minStake.landlordPerFarmer);
  return config.minStake.farmer;
}

// 深合并 overrides，返回新配置对象（不改 DEFAULT_CONFIG）。
export function mergeConfig(overrides = {}) {
  const merged = structuredClone(DEFAULT_CONFIG);
  const apply = (target, src) => {
    for (const [key, value] of Object.entries(src ?? {})) {
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object') {
        apply(target[key], value);
      } else if (value !== undefined) {
        target[key] = value;
      }
    }
  };
  apply(merged, overrides);
  return merged;
}

// 房间生效配置：mergeConfig 之后，竞技模式把 competitive 里的 landlordFundMultiplier / landlordGoal
// 覆盖到顶层——这样 landlordGoal.js、settleRound 等既有逻辑直接吃到竞技数值，无需到处分支。
// 角色专属参数（capitalist/wage/investor/glutton/initialBalance）仍保留在 config.competitive 下按需读取。
export function roomConfig(modeId, overrides = {}) {
  const config = mergeConfig(overrides);
  if (modeId === 'competitive') {
    const c = config.competitive ?? {};
    if (c.landlordFundMultiplier != null) config.landlordFundMultiplier = c.landlordFundMultiplier;
    if (c.landlordGoal) config.landlordGoal = { ...config.landlordGoal, ...c.landlordGoal };
  }
  return config;
}
