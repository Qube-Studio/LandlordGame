// 单一表情决策（任务⑧）：把「阶段 + 角色 + 硬币胜负 + 玩家状态」映射成一个表情名。
// 这是表情系统的唯一权威映射；scene/textures.js#faceTexture 负责把表情名画成像素脸。
// 优先级：破产 > 手动表情(emote 覆盖) > 阶段/胜负默认 > 待机。

import { factionOf } from '../game/roles';

// faceTexture 当前支持的全部表情；新增表情需同步在 textures.js 里实现画法。
export const EXPRESSIONS = ['idle', 'ready', 'bet', 'win', 'lose', 'bankrupt'];
// 允许玩家手动摆出的表情（不含 bankrupt——破产由状态决定，不能手动装死）。
export const MANUAL_EMOTES = ['idle', 'ready', 'bet', 'win', 'lose'];

export function expressionFor(player, state) {
  if (!player) return 'idle';
  if (player.bankrupt) return 'bankrupt';                                  // 破产：✕✕ 眼，最高优先级
  if (player.emote && MANUAL_EMOTES.includes(player.emote)) return player.emote; // 手动覆盖（预留接口）

  switch (state.phase) {
    case 'DISCUSSION':
      return player.ready ? 'ready' : 'idle';
    case 'BETTING':
    case 'REVEAL':
      return player.hasBet ? 'bet' : 'idle';                               // 已下注：眯眼盘算
    case 'SETTLE':
    case 'NEGOTIATE':
    case 'FINALIZE':
      return resultExpression(player, state);                             // 已知硬币结果：按阵营胜负
    case 'ENDED':
      return endedExpression(player, state);
    default:
      return 'idle';                                                       // COIN_FLIP 等：保持悬念
  }
}

// 本回合硬币结果下，该玩家所属阵营是赢是输。
function resultExpression(player, state) {
  if (!state.coinResult) return 'idle';
  const farmersWin = state.coinResult === 'tails';
  const faction = factionOf(player.role);
  if (faction === 'farmer') return farmersWin ? 'win' : 'lose';
  if (faction === 'landlord') return farmersWin ? 'lose' : 'win';
  return 'idle';
}

// 终局：与最终胜方阵营一致即胜。
function endedExpression(player, state) {
  if (!state.winnerSide) return 'idle';
  const won = (state.winnerSide === 'farmers') === (factionOf(player.role) === 'farmer');
  return won ? 'win' : 'lose';
}
