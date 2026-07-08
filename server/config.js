// 全部可调参数集中于此（见 docs/GAME_SPEC.md §6）。
// 任何规则数值都禁止散落在其他文件里硬编码；房间创建时可用 overrides 覆盖。

export const DEFAULT_CONFIG = {
  // --- 初始资金（地主按农民总资金动态：见 getInitialBalance） ---
  // farmer：每个农民的初始资金；landlordFundMultiplier：地主初始资金 = 农民总资金 × 该倍数（向下取整）。
  initialBalance: { farmer: 8 },
  landlordFundMultiplier: 1.2,

  // --- 最小出资额 ---
  minStake: { farmer: 1, landlordPerFarmer: 1 },

  // --- 结算：地主阵营角色属性（三杠杆，见 GAME_SPEC §3.5；经 getLandlordAttrs(role) 解析） ---
  //   greed 贪婪   ×倍率(≥1)：地主胜的目标 = floor(下注 × greed)（赢了拿几倍；<1 会赢了反亏）
  //   squeeze 盘剥 ×倍率(≥1)：对方填不满目标时，缺口债务放大 = floor(缺口 × squeeze)（越大逼债越狠）
  //   rake 抽成    比例[0,1]：对方溢出时，地主从溢出里多拿 = floor(溢出 × rake)
  landlordAttrs: {
    landlord: { greed: 1.5, squeeze: 1.5, rake: 0.5 }, // 快速模式基础地主（保持原平衡）
  },
  rounding: 'round',          // 'round' 四舍五入 | 'floor' | 'ceil' —— 一切带小数的比例计算的取整方式
  debtAllocation: 'inverseBet',   // 'inverseBet' | 'equal' | 'proportionalBet'
  farmerSplit: 'equal',           // 农民胜时分 pot 的方式（当前仅 'equal'）
  surplusTieBreak: 'highestBet',  // 最大余数法并列时余数单位归属：'highestBet' | 'lowestBet'
  bankruptcyThreshold: 0,         // balance ≤ 此值即破产

  // --- 地主资金目标（相对制，见 logic/landlordGoal.js 与 docs/TUNING.md） ---
  // 每过随机 interval 回合（正态 clamp 到 [min,max]）一个检查点：该回合 FINALIZE 时若地主余额
  // < 目标（=round(上一检查点余额 × goalMultiplier)），扣 max(minPenalty, round(当前余额 × penaltyRate))，
  // 惩罚平分给本回合农民（可致地主破产）。达标无奖励。检查点后按（罚后）当前余额重定下一个目标。
  landlordGoal: {
    enabled: true,
    goalMultiplier: 1.1,      // 目标 = round(基准余额 × 1.1)——要求较上一检查点涨 10%
    penaltyRate: 0.1,         // 未达标扣 round(当前余额 × 0.1)
    minPenalty: 2,            // 未达标时至少扣除的资金
    interval: { min: 2, max: 5, mean: 3.5, sd: 0.9 }, // 检查点间隔：正态随机、四舍五入后 clamp 到 [min,max]
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
    endedToLobbyMs: 0,        // ENDED 后自动回大厅的延时；**默认 0 = 不自动回，留在终局对局、等房主手动「下一局」**（>0 才到点自动回大厅）
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
    landlordFundMultiplier: 2,                          // 地主初始 = ⌊农民总资金 × 2⌋
    initialBalance: { farmer: 15, investor: 12, glutton: 8 }, // 农民阵营按角色的初始资金
    // 资本家：个人资金=押注钱包（本金必归还、不决定破产）；资金池=血条（承接盈亏、被税、耗尽即破产）。
    capitalist: { personalPerFarmer: 5, poolPerFarmer: 15, minStake: 1, taxRate: 0.10, taxMin: 2 },
    // 地主阵营角色属性（覆盖顶层 landlordAttrs；两角色差异化，见 GAME_SPEC §3.5）。
    //   地主：厚资本、赢面凶（贪婪高、抽成狠）；资本家：赢面温和但逼债极狠（盘剥 3），配合资金池打法。
    landlordAttrs: {
      landlord:   { greed: 2,   squeeze: 1.5, rake: 0.8 },
      capitalist: { greed: 1.5, squeeze: 3,   rake: 0.4 },
    },
    // 基础农民工资（m=活跃农民总数）：interval=max(minInterval, baseInterval−(m−1)·reduce)，amount=base+(m−1)·bonus。
    wage:    { baseInterval: 5, minInterval: 2, perFarmerIntervalReduce: 1, baseAmount: 1, perFarmerAmountBonus: 1 },
    investor:{ maxPledge: 3, waiveMultiplier: 2 },      // 担保保费先扣 n；农民输则缺口减 waiveMultiplier×Σn
    glutton: { allowancePerRound: 1, maxReflips: 3 },   // 每回合 +1 饭账（成本，仅农民胜时从余额扣除并清零，可扣破产）；每局最多 3 次重掷
    // 地主资金目标沿用顶层相对制（不再单独 schedule 覆盖）——地主/资本家均吃 landlordGoal 相对目标。
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
    // 竞技地主初始经统一 roundBy（默认倍数 2 为整数、当前零影响；将来倍率若设小数会自动四舍五入）。
    if (role === 'landlord') return Math.max(1, roundBy((opts.farmerTotal ?? 0) * config.landlordFundMultiplier, config));
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

// 一切带小数的比例计算的取整（config.rounding：'round' 四舍五入 | 'floor' | 'ceil'）。
// 结算三倍率、目标/罚款、资本家税 全部经此，保证取整口径统一、可一处切换。
export function roundBy(value, config) {
  const mode = config?.rounding ?? 'round';
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'floor') return Math.floor(value);
  return Math.round(value);
}

// 地主阵营角色属性（结算三杠杆 greed/squeeze/rake，见 GAME_SPEC §3.5）。
// 缺省回落：角色专属 → landlord 那套 → 硬保底（1.5/1.5/0.5，保持原平衡）。
export function getLandlordAttrs(role, config) {
  const table = config.landlordAttrs ?? {};
  const a = table[role] ?? table.landlord ?? {};
  return { greed: a.greed ?? 1.5, squeeze: a.squeeze ?? 1.5, rake: a.rake ?? 0.5 };
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
    if (c.landlordAttrs) config.landlordAttrs = { ...config.landlordAttrs, ...c.landlordAttrs };
  }
  return config;
}
