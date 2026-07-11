// 单人模式结算纯函数（GAME_SPEC §9，与多人 settleRound 并列——不魔改多人结算）。
// 全部无 IO、可单测：对称结算（同阵营对战）/ 多地主侧按出资比例分账 / 幽灵幻影记账 /
// 检察官监管（固定费+冷却）/ 幸运儿概率 / 工资。参数一律走 config.single（零硬编码）。
import { apportion } from './apportion.js';
import { roundBy } from '../config.js';

const S = (config) => config.single ?? {};

// ---------- 对称结算（农民队 vs 农民队 / 地主队 vs 地主队，双方均无三属性）----------
// 胜方按**出资比例**瓜分败方总注；无缺口、无乘数（§9.1）。败方损失即其注金（已在桌上）。
// 胜方全员 0 注（理论上不可能，最小注兜底）退化为均分。
export function settleSymmetric({ winnerIds, loserIds, bets }) {
  const loserTotal = loserIds.reduce((s, id) => s + (bets[id] ?? 0), 0);
  const allZero = winnerIds.every(id => (bets[id] ?? 0) === 0);
  const shares = apportion(
    loserTotal,
    winnerIds.map(id => ({ id, weight: allZero ? 1 : (bets[id] ?? 0), tie: 0 })),
  );
  const takes = {};
  // 胜方收回己方注金 + 分得败方注金份额；败方注金归零（losses 供演出/账本用）。
  for (const id of winnerIds) takes[id] = (bets[id] ?? 0) + (shares[id] ?? 0);
  const losses = {};
  for (const id of loserIds) losses[id] = bets[id] ?? 0;
  return { takes, losses, loserTotal };
}

// ---------- 多地主侧：阵营总注结算后按出资比例分账（§9.1）----------
// income = 结算给地主侧的总进账（含收回注金）。members: [{id, bet, ghost}]。
// 幽灵的份额进虚空（voided），但幽灵**永远先收回自己的注金**（ghostRefund，§9.3）。
export function splitLandlordSide({ income, members, config }) {
  const total = members.reduce((s, m) => s + m.bet, 0);
  const shares = {};
  let voided = 0;
  let remaining = income;
  // 幽灵先收回注金（不可分割的保底），再按出资比例分剩余。
  const ghost = members.find(m => m.ghost);
  const ghostRefund = ghost ? Math.min(ghost.bet, Math.max(0, remaining)) : 0;
  remaining -= ghostRefund;
  const split = apportion(
    Math.max(0, remaining),
    members.map(m => ({ id: m.id, weight: total > 0 ? m.bet : 1, tie: 0 })),
  );
  for (const m of members) {
    const part = split[m.id] ?? 0;
    if (m.ghost) {
      shares[m.id] = ghostRefund;   // 幽灵实得=注金；其比例份额蒸发
      voided += part;
    } else {
      shares[m.id] = part;
    }
  }
  return { shares, voided, ghostRefund };
}

// ---------- 幽灵幻影彩池（敌方胜局「实拿变少」，§9.3）----------
// 敌方赢下的彩池里，幽灵注金那部分是幻影：各家的实拿按 ghostBet/pot 等比缩水（取整走 config.rounding）。
export function phantomReduction({ takes, ghostBet, pot, config }) {
  const reductions = {};
  let total = 0;
  if (!(ghostBet > 0) || !(pot > 0)) return { reductions, total };
  for (const [id, take] of Object.entries(takes)) {
    const r = Math.min(take, roundBy(take * (ghostBet / pot), config));
    reductions[id] = r;
    total += r;
  }
  return { reductions, total };
}

// 幽灵注金上限：必须**严格小于**核心注金（防无限虚张，§9.3）。
export function ghostMaxBet(coreBet, ghostBalance) {
  return Math.max(0, Math.min(coreBet - 1, ghostBalance));
}

// 幽灵动态资金 = 敌方农民数 × balancePerEnemyFarmer（队友数变动时重算，§9.3）。
export function ghostBalance(enemyFarmerCount, config) {
  const per = S(config).ghost?.balancePerEnemyFarmer ?? 4;
  return Math.max(0, enemyFarmerCount * per);
}

// ---------- 检察官·监管（单人口径：固定费 + 冷却，§9.2）----------
export function singleSummonCost(farmerCount, config) {
  const per = S(config).prosecutor?.summon?.costPerFarmer ?? 2;
  return Math.max(1, Math.max(1, farmerCount) * per);
}

// 两次监管至少间隔 农民数×cooldownPerFarmer 回合：lastRound=上次监管回合（0=从未）。
export function summonCooldownOk(round, lastRound, farmerCount, config) {
  if (!lastRound) return true;
  const gap = Math.max(1, farmerCount) * (S(config).prosecutor?.summon?.cooldownPerFarmer ?? 1);
  return round - lastRound >= gap;
}

// 地主被监管的损失 = penaltyMult × 监管费（无目标考核，直接罚款，§9.2）。
export function summonPenalty(farmerCount, config) {
  const mult = S(config).prosecutor?.summon?.penaltyMult ?? 2;
  return roundBy(singleSummonCost(farmerCount, config) * mult, config);
}

// ---------- 幸运儿概率（§9.3）----------
// 己方胜率 = 0.5 + 己方加成 − 敌方加成（互相抵消）；加成 = baseBonus + min(怜悯, pityCap)。
// 怜悯 = 连败次数 × pityStep（己胜清零）。夹在 [0.05, 0.95] 防退化成必然事件。
export function luckyWinProb({ myPityLosses = 0, enemyPityLosses = 0, mine = false, enemy = false }, config) {
  const L = S(config).lucky ?? {};
  const base = L.baseBonus ?? 0.10;
  const step = L.pityStep ?? 0.05;
  const cap = L.pityCap ?? 0.15;
  const bonus = (has, losses) => (has ? base + Math.min(losses * step, cap) : 0);
  const p = 0.5 + bonus(mine, myPityLosses) - bonus(enemy, enemyPityLosses);
  return Math.min(0.95, Math.max(0.05, p));
}

// ---------- 工资（单人口径：固定间隔 + 人数加成，§9.2）----------
// 每 interval 回合，每个存活农民 +（base + (农民数−1)×perFarmerBonus）。返回 0 表示本回合不发。
export function singleWage(farmerCount, round, config) {
  const W = S(config).wage ?? {};
  const interval = W.interval ?? 2;
  if (round < 1 || round % interval !== 0) return 0;
  return (W.base ?? 2) + (Math.max(1, farmerCount) - 1) * (W.perFarmerBonus ?? 1);
}
