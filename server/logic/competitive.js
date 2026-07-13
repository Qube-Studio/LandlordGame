// 竞技模式角色技能的纯逻辑（无 IO，可单测）。见 docs/GAME_SPEC.md §8。
// 阵营/状态机/计时归 Room.js；这里只做可单测的数值计算。

import { roundBy } from '../config.js';

// 基础农民工资（§8.2）。m = 活跃农民总数（含投资人/暴食者）。
//   发薪间隔 interval = max(minInterval, baseInterval − (m−1)·perFarmerIntervalReduce)
//   每次工资额 amount   = baseAmount + (m−1)·perFarmerAmountBonus
// 默认 m=1..4 → interval 5/4/3/2，amount 1/2/3/4。
export function computeWage(farmerCount, config) {
  const w = config.competitive.wage;
  const m = Math.max(1, farmerCount || 1);
  const interval = Math.max(w.minInterval, w.baseInterval - (m - 1) * w.perFarmerIntervalReduce);
  const amount = w.baseAmount + (m - 1) * w.perFarmerAmountBonus;
  return { interval, amount };
}

// 本回合是否发薪：round 为间隔整数倍（round≥1）。
export function wageDueThisRound(round, interval) {
  return round >= 1 && interval > 0 && round % interval === 0;
}

// 投资人担保减债总额（§8.3）= waiveMultiplier × Σ担保保费。
export function investorWaiver(totalPledge, config) {
  return Math.max(0, totalPledge) * config.competitive.investor.waiveMultiplier;
}

// 资本家资金池税（§8.6，2026-07-08 改版）：**每「农民阵营人数」回合征一次**（间隔制，见 taxDueThisRound），
// 税额 = max(taxMin, round(当前池 × taxRate))——按当前池计（越亏扣越少，给失血的资本家喘息；下限 taxMin 兜底）。
// 单次至多扣到池空，pool ≤ 0 不再扣。
export function computeTax(pool, config) {
  const t = config.competitive.capitalist;
  if (!(pool > 0)) return 0;
  return Math.min(pool, Math.max(t.taxMin, roundBy(pool * t.taxRate, config)));
}

// 资本家征税间隔 = 活跃农民阵营人数，下限 2。人越多、征得越疏；
// 1 农民时保持每隔一回合征一次，不退化成每回合抽血（用户裁决 2026-07-13）。
export function taxInterval(farmerCount) {
  return Math.max(2, farmerCount || 1);
}

// 本回合是否征税：距锚点回合数为间隔整数倍（≥1）。与工资 wageDueThisRound 同构。
// anchor（默认 0=开局，行为与旧版完全一致）：检察官传唤（§8.9）强制双倍税后把税钟归零——
// 锚点挪到传唤回合，下次征税从那里重新起算（传唤自带的「资敌面」：延后了排期税）。
export function taxDueThisRound(round, farmerCount, anchor = 0) {
  const interval = taxInterval(farmerCount);
  const since = round - (anchor || 0);
  return since >= 1 && since % interval === 0;
}

// 对质判定（§8.8，纯函数）：敌方暗注 targetBet 与农民阵营总注 factionTotal 比较，dir∈{'more','less'}。
// 相等 → 判错（无法严格「多/少」）。服务端在指控落定（accuseResolve）时调用；猜对才强制敌方多结算一次制约。
export function judgeAccusation(targetBet, factionTotal, dir) {
  if (dir === 'more') return targetBet > factionTotal;
  if (dir === 'less') return targetBet < factionTotal;
  return false;
}
