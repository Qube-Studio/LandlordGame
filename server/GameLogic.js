// Pure functions for game settlement — reusable for Monte Carlo simulation

export function flipCoin() {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

/**
 * Settle one round given bets and coin result.
 * Returns { deltas, events } — all amounts are integers (Math.ceil applied).
 */
export function settle({ coinResult, bets, balances, landlordId, farmerIds, config }) {
  const deltas = {};
  const events = [];

  const landlordBet = bets[landlordId] ?? config.minBetLandlord;
  const totalFarmerBet = farmerIds.reduce((s, id) => s + (bets[id] ?? config.minBetFarmer), 0);

  if (coinResult === 'heads') {
    // Landlord wins — wants back 2× his bet from farmers
    const needed = landlordBet * 2;
    if (totalFarmerBet >= needed) {
      deltas[landlordId] = (deltas[landlordId] ?? 0) + needed;
      farmerIds.forEach(id => {
        const fb = bets[id] ?? config.minBetFarmer;
        deltas[id] = (deltas[id] ?? 0) - fb;
      });
      events.push({ type: 'landlord_wins', landlordGain: needed });
    } else {
      // Farmers can't cover — each pays double their proportional shortfall
      const shortfall = needed - totalFarmerBet;
      farmerIds.forEach(id => {
        const fb = bets[id] ?? config.minBetFarmer;
        const proportion = totalFarmerBet > 0 ? fb / totalFarmerBet : 1 / farmerIds.length;
        const extraOwed = Math.ceil(shortfall * proportion * 2);
        const totalOwed = fb + extraOwed;
        const canPay = Math.max(0, balances[id] - config.minBetFarmer);
        const actualPay = Math.min(totalOwed, canPay + fb);
        deltas[id] = (deltas[id] ?? 0) - actualPay;
      });

      const actualCollected = farmerIds.reduce((s, id) => s + Math.abs(deltas[id] ?? 0), 0);

      // Landlord takes half of each farmer's remaining excess balance
      farmerIds.forEach(id => {
        const remaining = (balances[id] ?? 0) + (deltas[id] ?? 0);
        if (remaining > config.minBetFarmer) {
          const grab = Math.ceil((remaining - config.minBetFarmer) / 2);
          deltas[id] = (deltas[id] ?? 0) - grab;
          deltas[landlordId] = (deltas[landlordId] ?? 0) + grab;
        }
      });

      deltas[landlordId] = (deltas[landlordId] ?? 0) + actualCollected;
      events.push({ type: 'landlord_wins_partial', shortfall });
    }
  } else {
    // Farmers win — pot split proportionally (ceil to avoid fractions)
    const pot = landlordBet + totalFarmerBet;
    deltas[landlordId] = (deltas[landlordId] ?? 0) - landlordBet;
    farmerIds.forEach(id => {
      const fb = bets[id] ?? config.minBetFarmer;
      deltas[id] = (deltas[id] ?? 0) - fb;
    });
    farmerIds.forEach(id => {
      const fb = bets[id] ?? config.minBetFarmer;
      const share = Math.ceil(totalFarmerBet > 0 ? (fb / totalFarmerBet) * pot : pot / farmerIds.length);
      deltas[id] = (deltas[id] ?? 0) + share;
    });
    events.push({ type: 'farmers_win', pot });
  }

  return { deltas, events };
}

/**
 * Apply interest to outstanding loans. Interest is ceiled to integer.
 */
export function accrueInterest(loans, config) {
  const charges = [];
  for (const loan of loans) {
    if (loan.remainingRounds > 0) {
      const interest = Math.ceil(loan.principal * config.interestRate);
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

/**
 * Validate a bet amount.
 * Special rule: if balance is at or near the minimum, force all-in.
 * Returns { valid, reason?, forceAllIn?, allInAmount? }
 */
export function validateBet(amount, balance, config, role) {
  const min = role === 'landlord' ? config.minBetLandlord : config.minBetFarmer;

  // Force all-in when balance leaves no room for a normal bet
  const forceAllIn = role === 'landlord' ? balance <= min + 1 : balance <= min;

  if (forceAllIn) {
    if (amount !== balance) {
      return { valid: false, reason: `当前只能全押 ¥${balance}`, forceAllIn: true, allInAmount: balance };
    }
    return { valid: true, forceAllIn: true, allInAmount: balance };
  }

  const max = balance - min;
  if (amount < min) return { valid: false, reason: `最小下注额为 ${min}` };
  if (amount > max) return { valid: false, reason: `必须保留至少 ${min} 的底仓` };
  return { valid: true };
}
