// 处决窗纯逻辑（§3.9）：行刑者遴选 + 赔偿口径。无 IO，供 Room 与单测复用。
import { factionOf } from '../config.js';

// 「钱」的统一口径：资本家=担保资金池（pool，其 balance 每回合被重置成动态钱包，无意义）、
// 其余角色=余额。行刑者遴选（钱最多）与赦免付得起判定共用。
export function wealthOf(p) {
  return p.role === 'capitalist' ? (p.pool ?? 0) : (p.balance ?? 0);
}

// 行刑者 = 目标敌对阵营中钱最多的活人（!bankrupt && !spectator）；并列取座位号小者（确定性）。
// 敌对阵营无活人 → null（调用方对该目标自动处决跳过）。
export function pickExecutioner(target, players) {
  const enemy = factionOf(target.role) === 'landlord' ? 'farmer' : 'landlord';
  const candidates = players.filter(p => factionOf(p.role) === enemy && !p.bankrupt && !p.spectator);
  candidates.sort((a, b) => wealthOf(b) - wealthOf(a) || a.seat - b.seat);
  return candidates[0] ?? null;
}

// 赦免赔偿额 = 目标本回合输掉的钱：资本家=回合初池 − 当前池；其余=回合初余额 − 当前余额。下限 0。
export function compensationOf(target, startBalance, startPool) {
  return target.role === 'capitalist'
    ? Math.max(0, (startPool ?? 0) - (target.pool ?? 0))
    : Math.max(0, (startBalance ?? 0) - (target.balance ?? 0));
}
