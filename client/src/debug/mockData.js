export const PHASES = ['LOBBY', 'BETTING', 'REVEAL', 'FLIP', 'SETTLEMENT', 'NEGOTIATION', 'ENDED'];

export const PHASE_LABEL = {
  LOBBY: '等待开始',
  BETTING: '下注中',
  REVEAL: '揭示下注',
  FLIP: '掷硬币',
  SETTLEMENT: '结算中',
  NEGOTIATION: '协商分配',
  ENDED: '游戏结束',
};

const BASE_PLAYERS = [
  { id: 'p-landlord', name: '地主小张', role: 'landlord', ready: true, balance: 18, bankrupt: false },
  { id: 'p-farmer-a', name: '农民小李', role: 'farmer', ready: true, balance: 12, bankrupt: false },
  { id: 'p-farmer-b', name: '农民小王', role: 'farmer', ready: true, balance: 0, bankrupt: true },
  { id: 'p-bank', name: '银行小赵', role: 'bank', ready: true, balance: 50, bankrupt: false },
];

const BASE_CONFIG = {
  minBetLandlord: 2,
  minBetFarmer: 1,
  interestRate: 0.1,
  complaintFee: 5,
  landlordStartBalance: 21,
  negotiationSeconds: 30,
};

const BASE_BETS = { 'p-landlord': 3, 'p-farmer-a': 2 };

const BASE_HISTORY = [
  {
    round: 1,
    coinResult: 'heads',
    bets: { 'p-landlord': 2, 'p-farmer-a': 1 },
    deltas: { 'p-landlord': 1, 'p-farmer-a': -1, 'p-farmer-b': 0, 'p-bank': 0 },
    events: [{ type: 'landlord_wins', landlordGain: 1 }],
    newlyBankrupt: [],
  },
  {
    round: 2,
    coinResult: 'tails',
    bets: { 'p-landlord': 3, 'p-farmer-a': 2 },
    deltas: { 'p-landlord': -5, 'p-farmer-a': 2.5, 'p-farmer-b': 2.5, 'p-bank': 0 },
    events: [{ type: 'farmers_win', pot: 5 }],
    newlyBankrupt: [],
  },
];

export const LAST_ROUND_RESULT = {
  round: 3,
  coinResult: 'tails',
  bets: { 'p-landlord': 3, 'p-farmer-a': 2 },
  deltas: { 'p-landlord': -5, 'p-farmer-a': 2.5, 'p-farmer-b': 0, 'p-bank': 0 },
  events: [{ type: 'farmers_win', pot: 5 }],
  newlyBankrupt: ['p-farmer-b'],
};

export function buildMockState({ phase, viewerId, coinResult, viewerHasBet = false }) {
  const isBankruptSpectator = viewerId === 'p-farmer-b';

  const players = BASE_PLAYERS.map(p => ({
    ...p,
    balance: (p.id === viewerId || isBankruptSpectator) ? p.balance : (p.bankrupt ? p.balance : null),
  }));

  let bets;
  let myBet;
  if (phase === 'BETTING') {
    bets = {};
    Object.keys(BASE_BETS).forEach(id => {
      if (id === viewerId) {
        if (viewerHasBet) bets[id] = BASE_BETS[id];
      } else {
        bets[id] = '已下注';
      }
    });
    myBet = viewerHasBet && BASE_BETS[viewerId] !== undefined ? '已下注' : null;
  } else {
    bets = { ...BASE_BETS };
    myBet = BASE_BETS[viewerId];
  }

  const myBalanceHistory = BASE_HISTORY.map((h, i) => {
    const balance = players.find(p => p.id === viewerId)?.balance;
    return {
      round: h.round,
      balance: i === BASE_HISTORY.length - 1 ? balance : null,
      delta: h.deltas[viewerId] ?? null,
      event: h.events?.[0]?.type ?? '',
    };
  });

  return {
    roomId: 'DEBUG',
    roomName: '调试房间',
    phase,
    round: 3,
    hostId: 'p-landlord',
    config: BASE_CONFIG,
    players,
    myBalance: players.find(p => p.id === viewerId)?.balance ?? null,
    myBet,
    bets,
    loans: [],
    history: BASE_HISTORY,
    isBankruptSpectator,
    skipVotes: phase === 'NEGOTIATION' ? ['p-farmer-a'] : [],
    forceAllIn: false,
    allInAmount: null,
    myBalanceHistory,
    coinResult: phase === 'FLIP' ? (coinResult ?? 'heads') : undefined,
  };
}

export function buildMockChat() {
  return {
    chatMessages: [
      { from: 'p-landlord', name: '地主小张', message: '这把我梭了', channel: 'public' },
      { from: 'p-farmer-a', name: '农民小李', message: '稳住', channel: 'public' },
    ],
    bankruptChat: [
      { from: 'p-farmer-b', name: '农民小王', message: '我已经看穿一切了', channel: 'bankrupt' },
    ],
  };
}
