// 桌面显式结算：编导脚本 + 台账（纯函数，无 IO；见 docs/GAME_SPEC.md §3.8）。
// 金额算法在 rules.js / Room.js 不变，这里只把「谁给谁多少」翻译成客户端可
// 通用播放的 step/flow，并保证堆/手归属与最终入账恒等：
//   pile[id] = max(0, after[id] − (balanceNow[id] − handDebit[id]))

/**
 * 台账：追踪结算演出中每人「桌上堆」(pile) 与「手上支出」(handDebit)。
 * 规则：扣款先扣堆、不足再扣手（手可为透支——如饭账/罚金允许扣到破产）；进账一律进堆。
 */
export function createLedger(startPiles = {}) {
  const piles = {};
  for (const [id, v] of Object.entries(startPiles)) piles[id] = Math.max(0, v ?? 0);
  const handDebits = {};
  return {
    piles,
    handDebits,
    pileOf(id) { return piles[id] ?? 0; },
    credit(id, amount) {
      if (amount > 0) piles[id] = (piles[id] ?? 0) + amount;
    },
    // 返回扣款来源分解 [{kind:'pile'|'hand', amount}]（0 项省略），供 flows 标注动画起点。
    debit(id, amount) {
      const parts = [];
      if (!(amount > 0)) return parts;
      const fromPile = Math.min(piles[id] ?? 0, amount);
      if (fromPile > 0) { piles[id] -= fromPile; parts.push({ kind: 'pile', amount: fromPile }); }
      const fromHand = amount - fromPile;
      if (fromHand > 0) { handDebits[id] = (handDebits[id] ?? 0) + fromHand; parts.push({ kind: 'hand', amount: fromHand }); }
      return parts;
    },
  };
}

/**
 * SETTLE 编导脚本：各家下注堆聚拢成彩池 → 按默认方案分堆、派送进各家圆圈。
 * 债务（缺口）不是钱的移动，不进脚本——客户端从 settlement/allocation 的 debts 渲染红色债务牌。
 */
export function buildSettleScript({ settlement, bets, landlordId, farmerIds }, nextId) {
  const from = [landlordId, ...farmerIds]
    .map(id => ({ id, amount: bets[id] ?? 0 }))
    .filter(c => c.amount > 0);
  const shares = [];
  if (settlement.landlordTake > 0) shares.push({ id: landlordId, amount: settlement.landlordTake });
  for (const id of farmerIds) {
    const take = settlement.takes[id] ?? 0;
    if (take > 0) shares.push({ id, amount: take });
  }
  return [
    { id: nextId(), t: 'gather', from, pot: settlement.pot },
    { id: nextId(), t: 'split', shares },
  ];
}

/**
 * 把「一个人扣出的 parts」按多个接收方份额切成 flows（金额精确对应，先耗尽堆再耗手）。
 * recipients: [{to:{kind,id?}, amount}]
 */
export function flowsFromParts(fromId, parts, recipients) {
  const flows = [];
  const queue = parts.map(p => ({ ...p }));
  for (const r of recipients) {
    let need = r.amount;
    while (need > 0 && queue.length) {
      const head = queue[0];
      const use = Math.min(head.amount, need);
      flows.push({ from: { kind: head.kind, id: fromId }, to: r.to, amount: use });
      head.amount -= use;
      need -= use;
      if (head.amount === 0) queue.shift();
    }
  }
  return flows;
}
