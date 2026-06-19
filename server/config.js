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
    settleViewMs: 3500,       // 系统结算展示后自动进入协商
    finalizeMs: 2600,         // 正式结算动画后进入下一回合讨论
    negotiateTimeoutMs: 120000, // 协商超时按当前方案生效（0 = 不超时）
  },

  // --- 连接 ---
  reconnectGraceSec: 60,      // 断线保留座位时长
  autoActForOffline: true,    // 离线玩家自动准备/确认，避免卡住流程
  heartbeatSec: 30,

  // --- 聊天/语音 ---
  channels: ['public', 'farmer'],
  voiceEnabled: false,        // 语音联机预留开关
};

// 初始资金。农民固定；地主 = 农民总资金 × landlordFundMultiplier（向下取整，至少 1）。
export function getInitialBalance(role, farmerCount, config) {
  const farmer = config.initialBalance.farmer;
  if (role !== 'landlord') return farmer;
  const farmers = Math.max(1, farmerCount || 1);
  return Math.max(1, Math.floor(farmers * farmer * config.landlordFundMultiplier));
}

// 最小出资额：农民固定，地主随活跃农民人数变化。
export function getMinStake(role, farmerCount, config) {
  if (role === 'landlord') return Math.max(1, farmerCount * config.minStake.landlordPerFarmer);
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
