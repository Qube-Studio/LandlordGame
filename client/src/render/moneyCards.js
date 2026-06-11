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

export function splitDenomination(value) {
  switch (value) {
    case 10: return [5, 5];
    case 5: return [1, 1, 1, 1, 1];
    case 2: return [1, 1];
    default: return null;
  }
}
