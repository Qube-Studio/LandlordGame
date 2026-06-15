// 地主资金目标（纯函数，无 IO）。见 docs/GAME_SPEC.md §3.7 与 docs/TUNING.md。
// 检查点序列：第 k 个检查点（k=0,1,2…）落在某个回合，地主在该回合 FINALIZE 时
// 必须使余额 ≥ 该检查点的目标，否则受罚。目标与回合间隔都随 k 增长但逐渐放缓，并各自封顶。
//
// 间隔（导向第 k 个检查点的回合数）：
//   I_k = round( startInterval + (maxInterval - startInterval) · (1 - intervalEaseFactor^k) )，并封顶 maxInterval
//   检查点回合 R_k = Σ_{j≤k} I_j（I_0 = startInterval ⇒ R_0 = startInterval）
// 目标：
//   G_k = floor( startGoal + (maxGoal - startGoal) · (1 - goalEaseFactor^k) )，并封顶 maxGoal
//   其中 startGoal = floor(initial · startMultiplier)，maxGoal = floor(initial · maxMultiplier)

const HORIZON_CHECKPOINTS = 64; // 足够长（一局远不会有这么多检查点）

// 构建检查点序列 [{ index, round, goal }]，按回合升序。纯函数、结果只依赖 initial 与 config。
export function buildGoalSchedule(initial, config) {
  const g = config.landlordGoal ?? {};
  if (!g.enabled) return [];
  const startGoal = Math.floor(initial * g.startMultiplier);
  const maxGoal = Math.floor(initial * g.maxMultiplier);
  const goalGap = Math.max(0, maxGoal - startGoal);
  const intervalGap = Math.max(0, g.maxInterval - g.startInterval);

  const schedule = [];
  let round = 0;
  for (let k = 0; k < HORIZON_CHECKPOINTS; k++) {
    const interval = Math.min(
      g.maxInterval,
      Math.max(1, Math.round(g.startInterval + intervalGap * (1 - Math.pow(g.intervalEaseFactor, k)))),
    );
    round += interval;
    const goal = Math.min(maxGoal, Math.floor(startGoal + goalGap * (1 - Math.pow(g.goalEaseFactor, k))));
    schedule.push({ index: k, round, goal });
  }
  return schedule;
}

// 即将到来的检查点（含当前回合本身）：{ goal, dueRound, roundsLeft } | null。用于 UI 展示。
export function upcomingGoal(round, initial, config) {
  const schedule = buildGoalSchedule(initial, config);
  const cp = schedule.find(c => c.round >= round);
  if (!cp) return null;
  return { goal: cp.goal, dueRound: cp.round, roundsLeft: Math.max(0, cp.round - round) };
}

// 若 `round` 恰好是某检查点回合，返回其目标值；否则 null。用于 FINALIZE 结算。
export function goalForRound(round, initial, config) {
  const schedule = buildGoalSchedule(initial, config);
  const cp = schedule.find(c => c.round === round);
  return cp ? cp.goal : null;
}

// 未达标时的惩罚额：max(minPenalty, floor(余额 × penaltyRate))。余额按 0 下限处理。
export function goalPenalty(balance, config) {
  const g = config.landlordGoal ?? {};
  return Math.max(g.minPenalty ?? 0, Math.floor(Math.max(0, balance) * (g.penaltyRate ?? 0)));
}
