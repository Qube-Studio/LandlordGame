// 最大余数法整数分摊（纯函数，无 IO）。见 docs/GAME_SPEC.md §3.6。
// 保证：返回的份额全为非负整数，且总和恰好等于 total，单人误差 ≤ 1。

/**
 * @param {number} total 要分摊的非负整数总量
 * @param {Array<{id: string, weight: number, tie?: number}>} items
 *   weight 为分摊权重（≤0 视为 0；全为 0 时按均分处理）；
 *   tie 用于小数余量并列时的优先级（大者先得余数单位）。
 * @returns {Record<string, number>} id -> 整数份额
 */
export function apportion(total, items) {
  const result = {};
  for (const item of items) result[item.id] = 0;
  if (total <= 0 || items.length === 0) return result;

  let list = items.map(i => ({ id: i.id, weight: Math.max(i.weight ?? 0, 0), tie: i.tie ?? 0 }));
  let sumWeight = list.reduce((s, i) => s + i.weight, 0);
  if (sumWeight <= 0) {
    list = list.map(i => ({ ...i, weight: 1 }));
    sumWeight = list.length;
  }

  let assigned = 0;
  const remainders = [];
  for (const item of list) {
    const quota = (total * item.weight) / sumWeight;
    const base = Math.floor(quota);
    result[item.id] = base;
    assigned += base;
    remainders.push({ id: item.id, frac: quota - base, tie: item.tie });
  }

  remainders.sort((a, b) => b.frac - a.frac || b.tie - a.tie);
  let leftover = total - assigned;
  for (let k = 0; leftover > 0; k++, leftover--) {
    result[remainders[k % remainders.length].id] += 1;
  }
  return result;
}
