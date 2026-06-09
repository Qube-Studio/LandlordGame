// Pure functions for game settlement — reusable for Monte Carlo simulation

export function flipCoin() {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

/**
 * Settle one round given bets and coin result.
 * Returns { balanceDeltas, events }
 *
 * @param {object} params
 * @param {'heads'|'tails'} params.coinResult
 * @param {object} params.bets - { playerId: amount }
 * @param {object} params.balances - { playerId: currentBalance }
 * @param {string} params.landlordId
 * @param {string[]} params.farmerIds  (only active/non-bankrupt)
 * @param {object} params.config
 */
export function settle({ coinResult, bets, balances, landlordId, farmerIds, config }) {
  const deltas = {};
  const events = [];

  const landlordBet = bets[landlordId] ?? config.minBetLandlord;
  const totalFarmerBet = farmerIds.reduce((s, id) => s + (bets[id] ?? config.minBetFarmer), 0);

  if (coinResult === 'heads') {
    // Landlord wins
    const needed = landlordBet * 2; // landlord wants back 2× his bet
    if (totalFarmerBet >= needed) {
      // Normal win
      deltas[landlordId] = (deltas[landlordId] ?? 0) + needed;
      farmerIds.forEach(id => {
        const fb = bets[id] ?? config.minBetFarmer;
        deltas[id] = (deltas[id] ?? 0) - fb;
      });
      events.push({ type: 'landlord_wins', landlordGain: needed });
    } else {
      // Farmers can't cover — each farmer pays double the shortfall proportionally
      const shortfall = needed - totalFarmerBet;
      farmerIds.forEach(id => {
        const fb = bets[id] ?? config.minBetFarmer;
        const proportion = totalFarmerBet > 0 ? fb / totalFarmerBet : 1 / farmerIds.length;
        const extraOwed = shortfall * proportion * 2;
        const totalOwed = fb + extraOwed;
        const canPay = Math.max(0, balances[id] - config.minBetFarmer);
        const actualPay = Math.min(totalOwed, canPay + fb);
        deltas[id] = (deltas[id] ?? 0) - actualPay;
      });

      // Collect what farmers actually paid
      const actualCollected = farmerIds.reduce((s, id) => s + Math.abs(deltas[id] ?? 0), 0);

      // If farmers still can't cover fully, landlord takes half of remaining balance from each farmer
      farmerIds.forEach(id => {
        const remaining = (balances[id] ?? 0) + (deltas[id] ?? 0);
        if (remaining > config.minBetFarmer) {
          const grab = (remaining - config.minBetFarmer) / 2;
          deltas[id] = (deltas[id] ?? 0) - grab;
          deltas[landlordId] = (deltas[landlordId] ?? 0) + grab;
        }
      });

      deltas[landlordId] = (deltas[landlordId] ?? 0) + actualCollected;
      events.push({ type: 'landlord_wins_partial', shortfall });
    }
  } else {
    // Farmers win — split pot by contribution ratio
    const pot = landlordBet + totalFarmerBet;
    deltas[landlordId] = (deltas[landlordId] ?? 0) - landlordBet;
    farmerIds.forEach(id => {
      const fb = bets[id] ?? config.minBetFarmer;
      deltas[id] = (deltas[id] ?? 0) - fb;
    });
    // Default: distribute pot proportional to farmer contribution
    farmerIds.forEach(id => {
      const fb = bets[id] ?? config.minBetFarmer;
      const share = totalFarmerBet > 0 ? (fb / totalFarmerBet) * pot : pot / farmerIds.length;
      deltas[id] = (deltas[id] ?? 0) + share;
    });
    events.push({ type: 'farmers_win', pot });
  }

  return { deltas, events };
}

/**
 * Apply interest to outstanding loans.
 * Returns list of { playerId, interestCharged }
 */
export function accrueInterest(loans, config) {
  const charges = [];
  for (const loan of loans) {
    if (loan.remainingRounds > 0) {
      const interest = loan.principal * config.interestRate;
      charges.push({ loanId: loan.id, playerId: loan.borrowerId, interest });
      loan.remainingRounds--;
      loan.totalOwed = (loan.totalOwed ?? loan.principal) + interest;
    }
  }
  return charges;
}

export function isBankrupt(balance, config) {
  return balance <= 0;
}

export function validateBet(amount, balance, config, role) {
  const min = role === 'landlord' ? config.minBetLandlord : config.minBetFarmer;
  const max = balance - min;
  if (amount < min) return { valid: false, reason: `最小下注额为 ${min}` };
  if (amount > max) return { valid: false, reason: `必须保留至少 ${min} 的底仓` };
  return { valid: true };
}
