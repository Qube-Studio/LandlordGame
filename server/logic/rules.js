// 快速模式核心规则（纯函数，无 IO，可单测/仿真）。见 docs/GAME_SPEC.md §3。
// 所有数值参数来自 config，禁止在此硬编码。

import { getMinStake } from '../config.js';
import { apportion } from './apportion.js';

export function flipCoin(rng = Math.random) {
  return rng() < 0.5 ? 'heads' : 'tails';
}

// 比例计算的取整方式（config.rounding，预留 'ceil'）。
function roundBy(value, config) {
  return config.rounding === 'ceil' ? Math.ceil(value) : Math.floor(value);
}

/**
 * 下注边界：返回 {minStake, min, max, forceAllIn, allInAmount}。
 * 规则：minStake ≤ bet ≤ balance − minStake；balance < 2×minStake 时强制全押。
 * 竞技资本家（mode==='competitive' && role==='capitalist'）：本金必归还、可全押 →
 *   [minStake, balance]，无需留保留金、无强制全押（balance 即个人资金钱包）。
 */
export function betBounds({ balance, role, farmerCount, config, mode }) {
  const minStake = getMinStake(role, farmerCount, config, { mode });
  if (mode === 'competitive' && role === 'capitalist') {
    return { minStake, min: Math.min(minStake, balance), max: balance, forceAllIn: false, allInAmount: null };
  }
  if (balance < 2 * minStake) {
    return { minStake, min: balance, max: balance, forceAllIn: true, allInAmount: balance };
  }
  return { minStake, min: minStake, max: balance - minStake, forceAllIn: false, allInAmount: null };
}

export function validateBet({ amount, balance, role, farmerCount, config, mode }) {
  const bounds = betBounds({ balance, role, farmerCount, config, mode });
  if (!Number.isInteger(amount) || amount <= 0) return { valid: false, bounds, reason: '下注必须是正整数' };
  if (bounds.forceAllIn) {
    if (amount !== balance) return { valid: false, bounds, reason: `资金不足，只能全押 ${balance}` };
    return { valid: true, bounds };
  }
  if (amount < bounds.min) return { valid: false, bounds, reason: `下注不能低于最小出资额 ${bounds.min}` };
  if (amount > bounds.max) return { valid: false, bounds, reason: `必须留下最小出资额 ${bounds.minStake}` };
  return { valid: true, bounds };
}

// 债务分摊权重（config.debtAllocation）。默认 inverseBet：谁出的多谁补的少。
function debtWeight(bet, mode) {
  switch (mode) {
    case 'equal': return 1;
    case 'proportionalBet': return Math.max(bet, 0);
    case 'inverseBet':
    default: return 1 / Math.max(bet, 1);
  }
}

// 余数单位并列时的优先级（config.surplusTieBreak）。
function tieRank(bet, config) {
  return config.surplusTieBreak === 'lowestBet' ? -bet : bet;
}

/**
 * 在容量（各农民手中余额）约束下分摊债务：超出某人容量的部分在其余人之间递归重摊。
 * @returns {{debts: Record<string, number>, uncovered: number}}
 */
export function allocateDebt(total, farmers, config) {
  // farmers: [{id, bet, capacity}]
  const debts = {};
  for (const f of farmers) debts[f.id] = 0;
  let remaining = total;
  let pool = farmers.filter(f => f.capacity > 0);

  while (remaining > 0 && pool.length > 0) {
    const shares = apportion(
      remaining,
      pool.map(f => ({ id: f.id, weight: debtWeight(f.bet, config.debtAllocation), tie: tieRank(f.bet, config) })),
    );
    let overflow = 0;
    const next = [];
    for (const f of pool) {
      const want = shares[f.id] ?? 0;
      const room = f.capacity - debts[f.id];
      const got = Math.min(want, room);
      debts[f.id] += got;
      overflow += want - got;
      if (debts[f.id] < f.capacity) next.push(f);
    }
    remaining = overflow;
    pool = next; // 有人封顶则池子缩小，循环必然终止；无人封顶则 overflow=0
  }
  return { debts, uncovered: remaining };
}

/**
 * 系统结算（分钱子阶段一）：根据硬币结果计算默认分配方案。
 * balances 为下注后的手中余额（下注时已扣除）。
 * 返回的方案满足：landlordTake + Σtakes === pot；debts 已按各农民手中余额封顶。
 *
 * @returns {{
 *   coinResult, pot, landlordBet, farmerBetTotal,
 *   landlordTake: number,            // 地主从桌面拿走的钱
 *   takes: Record<string, number>,   // 各农民从桌面分到的钱（默认方案，可协商调整）
 *   debts: Record<string, number>,   // 各农民需额外用手中余额补给地主的债务（默认方案）
 *   uncovered: number,               // 全员封顶后仍未补足的缺口（地主实际收不到）
 *   events: Array<object>,           // 供 UI 解说的结算事件
 * }}
 */
export function settleRound({ coinResult, bets, balances, landlordId, farmerIds, config, debtWaiver = 0 }) {
  const landlordBet = bets[landlordId] ?? 0;
  const farmerBetTotal = farmerIds.reduce((s, id) => s + (bets[id] ?? 0), 0);
  const pot = landlordBet + farmerBetTotal;
  const takes = {};
  const debts = {};
  for (const id of farmerIds) { takes[id] = 0; debts[id] = 0; }
  const events = [];
  let landlordTake = 0;
  let uncovered = 0;
  let target = 0;
  let shortfall = 0; // 乘后、扣减债后的最终债额（地主胜桌面不足时），供 FINALIZE 复用

  if (coinResult === 'heads') {
    target = roundBy(landlordBet * config.landlordWinMultiplier, config); // 取整保证钱为整数（倍数可为 1.5 等）
    if (pot >= target) {
      // 地主拿走目标额；盈余地主再拿一份，剩余农民平分
      const surplus = pot - target;
      const landlordExtra = roundBy(surplus * config.surplusLandlordShare, config);
      landlordTake = target + landlordExtra;
      const farmerPool = surplus - landlordExtra;
      if (farmerPool > 0) {
        const shares = apportion(
          farmerPool,
          farmerIds.map(id => ({ id, weight: 1, tie: tieRank(bets[id] ?? 0, config) })),
        );
        for (const id of farmerIds) takes[id] = shares[id] ?? 0;
      }
      events.push({ type: 'landlord_win', target, surplus, landlordExtra, farmerPool });
    } else {
      // 桌面不够：地主先拿走整个 pot，缺口【再乘一次乘数】后由农民用手中余额共同补足
      // （惩罚消极下注；地主最终可拿到超过 target）。
      // 竞技投资人担保（§8.3）：减债作用于乘后债额，被免除的部分地主收不到。
      landlordTake = pot;
      const baseShortfall = target - pot;
      const rawShortfall = roundBy(baseShortfall * config.landlordWinMultiplier, config); // 缺口×乘数
      const waived = Math.min(rawShortfall, Math.max(0, debtWaiver));
      shortfall = rawShortfall - waived;
      const allocation = allocateDebt(
        shortfall,
        farmerIds.map(id => ({ id, bet: bets[id] ?? 0, capacity: Math.max(balances[id] ?? 0, 0) })),
        config,
      );
      for (const id of farmerIds) debts[id] = allocation.debts[id] ?? 0;
      uncovered = allocation.uncovered;
      if (waived > 0) events.push({ type: 'investor_waive', waived });
      events.push({ type: 'landlord_win_shortfall', target, base: baseShortfall, shortfall, rawShortfall, waived, uncovered });
    }
  } else {
    // 反面：农民胜，直接平分桌面所有钱
    const shares = apportion(
      pot,
      farmerIds.map(id => ({ id, weight: 1, tie: tieRank(bets[id] ?? 0, config) })),
    );
    for (const id of farmerIds) takes[id] = shares[id] ?? 0;
    events.push({ type: 'farmers_win', pot });
  }

  return { coinResult, pot, landlordBet, farmerBetTotal, landlordTake, takes, debts, uncovered, target, shortfall, events };
}

/**
 * 正式结算（分钱子阶段三）：把（可能经协商修改过的）方案落账。
 * 返回各玩家最终余额与本回合净变动（相对回合开始时）。
 */
export function applyAllocation({ settlement, allocation, balances, bets, landlordId, farmerIds, startBalances, config }) {
  const after = { ...balances };
  let collected = 0;
  const paidBy = {}; // 各农民实付的债务补偿（供桌面收账演出精确标注，见 §3.8）
  for (const id of farmerIds) {
    // 农民只付得起手中余额（含本回合分到的钱）的部分；付不起的债务就此作废（地主收不到）。
    // 协商可把超出某农民承受力的债务全压给他（任务 7），他付光破产，地主只拿到这点钱。
    const take = allocation.takes[id] ?? 0;
    const fundable = Math.max(0, (after[id] ?? 0) + take);
    const paid = Math.min(allocation.debts[id] ?? 0, fundable);
    after[id] = (after[id] ?? 0) + take - paid;
    collected += paid;
    paidBy[id] = paid;
  }
  // 任务 8：地主拿到桌面应得（landlordTake）+ 农民实际补偿（collected），补偿多少就多拿多少。
  after[landlordId] = (after[landlordId] ?? 0) + settlement.landlordTake + collected;

  const deltas = {};
  const bankrupts = [];
  for (const id of [landlordId, ...farmerIds]) {
    deltas[id] = (after[id] ?? 0) - (startBalances[id] ?? 0);
    if ((after[id] ?? 0) <= config.bankruptcyThreshold) bankrupts.push(id);
  }
  return { after, deltas, collected, bankrupts, paidBy };
}
