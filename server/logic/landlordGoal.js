// 地主资金目标（相对制，纯函数，无 IO）。见 docs/GAME_SPEC.md §3.7 与 docs/TUNING.md。
// 每过随机 interval 回合一个检查点：该回合 FINALIZE 时地主余额须 ≥ 目标（= round(上一检查点余额 ×
// goalMultiplier)）；未达标扣 max(minPenalty, round(当前余额 × penaltyRate))，平分给本回合农民。
// 达标无奖励。检查点后按（罚后）当前余额重定下一个目标。**目标/间隔是有状态的，由 Room 逐检查点推进**，
// 这里只提供无状态的计算件（目标额、惩罚额、间隔抽取）。

import { roundBy } from '../config.js';

// 相对目标：基准余额涨 goalMultiplier（四舍五入）。基准按 0 下限处理。
export function relativeGoal(baseline, config) {
  const g = config.landlordGoal ?? {};
  return roundBy(Math.max(0, baseline) * (g.goalMultiplier ?? 1.1), config);
}

// 未达标时的惩罚额：max(minPenalty, round(余额 × penaltyRate))。余额按 0 下限处理。
export function goalPenalty(balance, config) {
  const g = config.landlordGoal ?? {};
  return Math.max(g.minPenalty ?? 0, roundBy(Math.max(0, balance) * (g.penaltyRate ?? 0), config));
}

// 抽取下一个检查点间隔：正态(mean, sd) 四舍五入后 clamp 到 [min,max]。rng() ∈ [0,1)。
// Box-Muller；至少为 1 回合。可注入确定性 rng 便于单测/复现。
export function drawGoalInterval(rng, config) {
  const iv = (config.landlordGoal ?? {}).interval ?? {};
  const min = Math.max(1, iv.min ?? 2);
  const max = Math.max(min, iv.max ?? 5);
  const mean = iv.mean ?? (min + max) / 2;
  const sd = iv.sd ?? 0.9;
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd + mean;
  return Math.max(min, Math.min(max, Math.round(n)));
}
