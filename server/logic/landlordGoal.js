// 地主资金目标（纯函数，无 IO）。见 docs/GAME_SPEC.md §3.7 与 docs/TUNING.md。
// 检查点由 config.landlordGoal.schedule 显式给出：每项 {interval, multiplier} 表示
//   「再过 interval 回合，目标 = floor(地主初始资金 × multiplier)」。
//   累计回合 R_k = Σ_{j≤k} interval_j；目标 G_k = floor(initial × multiplier_k)。
//   超出列表长度后按最后一项的 interval/multiplier 重复（维持最高目标）。

const HORIZON_CHECKPOINTS = 64; // 足够长（一局远不会有这么多检查点）

// 构建检查点序列 [{ index, round, goal }]，按回合升序。纯函数、结果只依赖 initial 与 config。
export function buildGoalSchedule(initial, config) {
  const g = config.landlordGoal ?? {};
  const steps = g.schedule;
  if (!g.enabled || !Array.isArray(steps) || steps.length === 0) return [];

  const schedule = [];
  let round = 0;
  for (let k = 0; k < HORIZON_CHECKPOINTS; k++) {
    const step = steps[Math.min(k, steps.length - 1)]; // 超出列表后重复最后一项
    round += Math.max(1, step.interval);
    const goal = Math.floor(initial * step.multiplier);
    schedule.push({ index: k, round, goal });
  }
  return schedule;
}

// 即将到来的检查点（含当前回合本身）：{ goal, dueRound, roundsLeft, interval } | null。用于 UI 展示。
// interval = 本检查点与上一检查点的回合跨度（首个检查点从第 0 回合起算），供倒计时计点画满格。
export function upcomingGoal(round, initial, config) {
  const schedule = buildGoalSchedule(initial, config);
  const idx = schedule.findIndex(c => c.round >= round);
  if (idx < 0) return null;
  const cp = schedule[idx];
  const prevRound = idx > 0 ? schedule[idx - 1].round : 0;
  return { goal: cp.goal, dueRound: cp.round, roundsLeft: Math.max(0, cp.round - round), interval: cp.round - prevRound };
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
