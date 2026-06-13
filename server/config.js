// 全部可调参数集中于此（见 docs/GAME_SPEC.md §6）。
// 任何规则数值都禁止散落在其他文件里硬编码；房间创建时可用 overrides 覆盖。

export const DEFAULT_CONFIG = {
  // --- 初始资金（预留按人数动态：改 getInitialBalance 即可） ---
  initialBalance: { farmer: 8, landlord: 23 },

  // --- 最小出资额 ---
  minStake: { farmer: 1, landlordPerFarmer: 1 },

  // --- 结算 ---
  landlordWinMultiplier: 2,   // 地主胜的目标 = 下注 × 该倍数
  surplusLandlordShare: 0.5,  // pot 超出目标的部分，地主再拿的比例
  rounding: 'floor',          // 'floor' | 'ceil' —— 比例计算的取整方式
  debtAllocation: 'inverseBet',   // 'inverseBet' | 'equal' | 'proportionalBet'
  farmerSplit: 'equal',           // 农民胜时分 pot 的方式（当前仅 'equal'）
  surplusTieBreak: 'highestBet',  // 最大余数法并列时余数单位归属：'highestBet' | 'lowestBet'
  bankruptcyThreshold: 0,         // balance ≤ 此值即破产

  // --- 人数 ---
  minFarmers: 1,
  maxFarmers: 4,

  // --- 阶段时长（ms；0 = 不自动推进） ---
  timing: {
    revealAnimMs: 2200,       // 揭牌动画（动画后等待全员确认）
    coinAnimMs: 2800,         // 硬币动画后自动进入系统结算
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

// 初始资金。预留按 farmerCount 动态决定的空间：将来在这里写公式即可。
export function getInitialBalance(role, farmerCount, config) {
  if (role === 'landlord') return config.initialBalance.landlord;
  return config.initialBalance.farmer;
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
