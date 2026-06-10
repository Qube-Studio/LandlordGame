export const DENOMINATIONS = [10, 5, 2, 1];

export function buildHand(maxAmount) {
  const cards = [];
  let remaining = maxAmount;
  for (const d of DENOMINATIONS) {
    while (remaining >= d) {
      cards.push(d);
      remaining -= d;
    }
  }
  return cards;
}
