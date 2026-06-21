// 竞技模式角色技能的纯逻辑（无 IO，可单测）。见 docs/GAME_SPEC.md §8。
// 阵营/状态机/计时归 Room.js；这里只做可单测的数值计算。

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

// 资本家每回合资金池税（§8.6）= max(taxMin, ⌊pool × taxRate⌋)；pool ≤ 0 则不再扣（已破产）。
export function computeTax(pool, config) {
  const t = config.competitive.capitalist;
  if (!(pool > 0)) return 0;
  return Math.min(pool, Math.max(t.taxMin, Math.floor(pool * t.taxRate)));
}
