import { v4 as uuid } from 'uuid';
import { settle, flipCoin, accrueInterest, isBankrupt, validateBet } from './GameLogic.js';

const PHASES = {
  LOBBY: 'LOBBY',
  BETTING: 'BETTING',
  REVEAL: 'REVEAL',
  FLIP: 'FLIP',
  SETTLEMENT: 'SETTLEMENT',
  NEGOTIATION: 'NEGOTIATION',
  ENDED: 'ENDED',
};

const DEFAULT_CONFIG = {
  minBetLandlord: 1, // overwritten at game start to farmer count
  minBetFarmer: 1,
  interestRate: 0.1,
  complaintFee: 5,
  landlordStartBalance: 21,
  bankStartBalance: 500,
  negotiationSeconds: 30,
};

export class GameRoom {
  constructor(roomId, roomName = '未命名房间', config = {}) {
    this.roomId = roomId;
    this.roomName = roomName;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.phase = PHASES.LOBBY;
    this.players = {}; // { id: { id, name, role, balance, bankrupt, ws } }
    this.loans = [];   // { id, borrowerId, principal, totalOwed, remainingRounds, forgiven }
    this.bets = {};    // { playerId: amount } per round
    this.round = 0;
    this.history = []; // round results
    this.balanceSnapshots = []; // { round, balances: {playerId: balance} }
    this.negotiationProposals = {};
    this.negotiationTimer = null;
    this.skipVotes = new Set();
  }

  addPlayer(ws, name) {
    const id = uuid();
    this.players[id] = { id, name, role: null, balance: 0, bankrupt: false, ws };
    ws.playerId = id;
    this._broadcastState();
    return id;
  }

  removePlayer(id) {
    delete this.players[id];
    this._broadcastState();
  }

  assignRole(playerId, role) {
    if (!['landlord', 'farmer', 'bank'].includes(role)) return { error: '无效角色' };
    const taken = Object.values(this.players).find(p => p.role === role && p.id !== playerId);
    if (role === 'landlord' && taken) return { error: '地主已被占用' };
    if (role === 'bank' && taken) return { error: '银行已被占用' };
    this.players[playerId].role = role;
    this._broadcastState();
    return { ok: true };
  }

  startGame() {
    const landlord = this._getByRole('landlord');
    const farmers = this._getByRole('farmer');
    const bank = this._getByRole('bank');

    if (!landlord) return { error: '缺少地主' };
    if (farmers.length === 0) return { error: '缺少农民' };

    // minBetLandlord = number of farmers
    this.config.minBetLandlord = farmers.length;

    const landlordStart = this.config.landlordStartBalance;
    landlord.balance = landlordStart;

    const farmerStart = Math.ceil(landlordStart * 0.8 / farmers.length);
    farmers.forEach(p => { p.balance = farmerStart; });

    if (bank) bank.balance = this.config.bankStartBalance;

    this.phase = PHASES.BETTING;
    this.round = 1;
    this.bets = {};
    this.broadcast({ type: 'game_started', config: this.config });
    this._broadcastState();
    return { ok: true };
  }

  placeBet(playerId, amount) {
    if (this.phase !== PHASES.BETTING) return { error: '当前不是下注阶段' };
    const player = this.players[playerId];
    if (!player || player.bankrupt) return { error: '玩家不存在或已破产' };
    if (!['landlord', 'farmer'].includes(player.role)) return { error: '只有地主/农民可下注' };

    const validation = validateBet(amount, player.balance, this.config, player.role);
    if (!validation.valid) return { error: validation.reason };

    this.bets[playerId] = amount;
    // Notify all that this player has bet (but NOT the amount until reveal)
    this.broadcast({ type: 'bet_placed', playerId, hasPlaced: true });

    if (this._allActiveBettorsPlaced()) {
      this._startReveal();
    }
    return { ok: true };
  }

  _startReveal() {
    this.phase = PHASES.REVEAL;
    // Now broadcast actual bet amounts
    this.broadcast({ type: 'bets_revealed', bets: this.bets });
    setTimeout(() => this._doFlip(), 2000);
  }

  _doFlip() {
    this.phase = PHASES.FLIP;
    const coinResult = flipCoin();
    this.broadcast({ type: 'coin_flipped', coinResult });
    setTimeout(() => this._doSettlement(coinResult), 1500);
  }

  _doSettlement(coinResult) {
    this.phase = PHASES.SETTLEMENT;
    const landlord = this._getByRole('landlord');
    const activeFarmers = this._getByRole('farmer').filter(p => !p.bankrupt);

    // Accrue interest on loans before settlement
    const interestCharges = accrueInterest(this.loans, this.config);
    interestCharges.forEach(({ playerId, interest }) => {
      if (this.players[playerId]) {
        this.players[playerId].balance -= interest;
      }
    });

    const balances = {};
    Object.values(this.players).forEach(p => { balances[p.id] = p.balance; });

    const { deltas, events } = settle({
      coinResult,
      bets: this.bets,
      balances,
      landlordId: landlord.id,
      farmerIds: activeFarmers.map(p => p.id),
      config: this.config,
    });

    // Apply deltas
    Object.entries(deltas).forEach(([id, delta]) => {
      if (this.players[id]) this.players[id].balance += delta;
    });

    // Check bankruptcies
    const newlyBankrupt = [];
    Object.values(this.players).forEach(p => {
      if (!p.bankrupt && p.role !== 'bank' && isBankrupt(p.balance, this.config)) {
        p.bankrupt = true;
        p.balance = 0;
        newlyBankrupt.push(p.id);
      }
    });

    const roundResult = {
      round: this.round,
      coinResult,
      bets: { ...this.bets },
      deltas,
      events,
      interestCharges,
      newlyBankrupt,
    };
    this.history.push(roundResult);

    // Record balance snapshot for fund history
    const snapshot = { round: this.round, balances: {} };
    Object.values(this.players).forEach(p => { snapshot.balances[p.id] = p.balance; });
    this.balanceSnapshots.push(snapshot);

    this.broadcast({ type: 'settlement', roundResult });

    const winner = this._checkWinner();
    if (winner) {
      this.phase = PHASES.ENDED;
      this.broadcast({ type: 'game_ended', winner });
      return;
    }

    // Start negotiation phase
    this.phase = PHASES.NEGOTIATION;
    this.negotiationProposals = {};
    this.skipVotes = new Set();
    this.broadcast({ type: 'negotiation_start', seconds: this.config.negotiationSeconds, skipVotes: [] });
    this.negotiationTimer = setTimeout(() => this._endNegotiation(), this.config.negotiationSeconds * 1000);
  }

  submitNegotiationProposal(playerId, distribution) {
    if (this.phase !== PHASES.NEGOTIATION) return { error: '不在协商阶段' };
    this.negotiationProposals[playerId] = distribution;
    this.broadcast({ type: 'negotiation_proposal', playerId, distribution });
    return { ok: true };
  }

  acceptNegotiation(playerId, proposerId) {
    const proposal = this.negotiationProposals[proposerId];
    if (!proposal) return { error: '提案不存在' };
    this.broadcast({ type: 'negotiation_accepted', playerId, proposerId });
    return { ok: true };
  }

  voteSkipNegotiation(playerId) {
    if (this.phase !== PHASES.NEGOTIATION) return { error: '不在协商阶段' };
    const player = this.players[playerId];
    if (!player || player.role !== 'farmer' || player.bankrupt) return { error: '只有活跃农民可投票' };

    this.skipVotes.add(playerId);
    const votes = [...this.skipVotes];
    this.broadcast({ type: 'negotiation_skip_votes', votes });

    const activeFarmers = this._getByRole('farmer').filter(p => !p.bankrupt);
    if (activeFarmers.every(p => this.skipVotes.has(p.id))) {
      clearTimeout(this.negotiationTimer);
      this._endNegotiation();
    }
    return { ok: true };
  }

  _endNegotiation() {
    if (this.phase !== PHASES.NEGOTIATION) return;
    this.phase = PHASES.BETTING;
    this.round++;
    this.bets = {};
    this.skipVotes = new Set();
    this.broadcast({ type: 'round_start', round: this.round });
    this._broadcastState();
  }

  // Bank actions
  requestLoan(borrowerId, amount, repayRounds) {
    if (this.phase === PHASES.LOBBY || this.phase === PHASES.ENDED) return { error: '游戏未进行中' };
    const borrower = this.players[borrowerId];
    if (!borrower) return { error: '玩家不存在' };
    const loanRequest = { id: uuid(), borrowerId, amount, repayRounds, status: 'pending' };
    this.broadcast({ type: 'loan_requested', loanRequest });
    return { ok: true, loanRequestId: loanRequest.id };
  }

  bankDecision(bankPlayerId, loanRequestId, approved, complaintPaid = false) {
    const bank = this._getByRole('bank');
    if (!bank || bank.id !== bankPlayerId) return { error: '只有银行玩家可操作' };

    if (!approved && !complaintPaid) {
      this.broadcast({ type: 'loan_rejected', loanRequestId });
      return { ok: true };
    }

    if (complaintPaid) {
      this.broadcast({ type: 'complaint_filed', loanRequestId });
    }

    this.broadcast({ type: 'loan_approved', loanRequestId });
    return { ok: true };
  }

  fileComplaint(playerId, loanRequestId) {
    const player = this.players[playerId];
    if (!player || player.balance < this.config.complaintFee) return { error: '余额不足支付投诉费' };
    const bank = this._getByRole('bank');

    player.balance -= this.config.complaintFee;
    if (bank) bank.balance += this.config.complaintFee;

    this.broadcast({ type: 'complaint_filed', loanRequestId, filer: playerId });
    return { ok: true };
  }

  approveLoan(bankPlayerId, borrowerId, amount, repayRounds) {
    const bank = this._getByRole('bank');
    if (!bank) return { error: '无银行玩家' };
    if (bank.id !== bankPlayerId) return { error: '只有银行可审批' };
    if (bank.balance < amount) {
      bank.bankrupt = true;
      this.broadcast({ type: 'bank_bankrupt' });
      this.phase = PHASES.ENDED;
      this.broadcast({ type: 'game_ended', winner: 'bank_bankrupt' });
      return { error: '银行破产' };
    }

    bank.balance -= amount;
    this.players[borrowerId].balance += amount;

    const loan = {
      id: uuid(),
      borrowerId,
      bankId: bank.id,
      principal: amount,
      totalOwed: amount,
      remainingRounds: repayRounds,
      forgiven: false,
    };
    this.loans.push(loan);

    this.broadcast({ type: 'loan_granted', loan });
    this._broadcastState();
    return { ok: true, loan };
  }

  forgiveLoan(bankPlayerId, loanId) {
    const bank = this._getByRole('bank');
    if (!bank || bank.id !== bankPlayerId) return { error: '只有银行可免债' };
    const loan = this.loans.find(l => l.id === loanId);
    if (!loan) return { error: '贷款不存在' };
    loan.forgiven = true;
    if (this.players[loan.borrowerId]) {
      this.players[loan.borrowerId].loanBanned = true;
    }
    this.broadcast({ type: 'loan_forgiven', loanId, borrowerId: loan.borrowerId });
    return { ok: true };
  }

  chat(playerId, message) {
    const player = this.players[playerId];
    if (!player) return;
    const isBankruptFarmer = player.bankrupt && player.role === 'farmer';
    if (isBankruptFarmer) {
      this._sendToBankruptFarmers({ type: 'chat', from: playerId, name: player.name, message, channel: 'bankrupt' });
    } else {
      this.broadcast({ type: 'chat', from: playerId, name: player.name, message, channel: 'public' });
    }
  }

  getStateFor(playerId) {
    const player = this.players[playerId];
    const isBankruptFarmer = player?.bankrupt && player?.role === 'farmer';

    // Compute forceAllIn for this player
    let forceAllIn = false;
    let allInAmount = null;
    if (player && ['landlord', 'farmer'].includes(player.role) && !player.bankrupt) {
      const min = player.role === 'landlord' ? this.config.minBetLandlord : this.config.minBetFarmer;
      forceAllIn = player.role === 'landlord' ? player.balance <= min + 1 : player.balance <= min;
      if (forceAllIn) allInAmount = player.balance;
    }

    // Build per-player balance history
    const myBalanceHistory = this.balanceSnapshots.map((snap, i) => {
      const prevBalance = i === 0 ? null : this.balanceSnapshots[i - 1].balances[playerId];
      const balance = snap.balances[playerId] ?? null;
      const delta = prevBalance !== null && balance !== null ? balance - prevBalance : null;
      const roundResult = this.history.find(h => h.round === snap.round);
      const event = roundResult?.events?.[0]?.type ?? '';
      return { round: snap.round, balance, delta, event };
    });

    return {
      roomId: this.roomId,
      roomName: this.roomName,
      phase: this.phase,
      round: this.round,
      config: this.config,
      players: Object.values(this.players).map(p => this._publicPlayer(p.id)),
      myBalance: player?.balance,
      myBet: this.phase === PHASES.BETTING ? (this.bets[playerId] !== undefined ? '已下注' : null) : this.bets[playerId],
      bets: this.phase !== PHASES.BETTING ? this.bets : this._maskedBets(playerId),
      loans: this.loans.filter(l => !l.forgiven),
      history: this.history.slice(-10),
      isBankruptSpectator: isBankruptFarmer,
      skipVotes: [...this.skipVotes],
      forceAllIn,
      allInAmount,
      myBalanceHistory,
    };
  }

  _maskedBets(viewerId) {
    const masked = {};
    Object.keys(this.bets).forEach(id => {
      masked[id] = id === viewerId ? this.bets[id] : '已下注';
    });
    return masked;
  }

  _publicPlayer(id) {
    const p = this.players[id];
    return { id: p.id, name: p.name, role: p.role, balance: p.balance, bankrupt: p.bankrupt, loanBanned: p.loanBanned };
  }

  _getByRole(role) {
    const all = Object.values(this.players).filter(p => p.role === role);
    return role === 'farmer' || role === 'bank' ? all : all[0];
  }

  _allActiveBettorsPlaced() {
    const landlord = this._getByRole('landlord');
    const activeFarmers = this._getByRole('farmer').filter(p => !p.bankrupt);
    const required = [landlord, ...activeFarmers].filter(Boolean);
    return required.every(p => this.bets[p.id] !== undefined);
  }

  _checkWinner() {
    const landlord = this._getByRole('landlord');
    const farmers = this._getByRole('farmer');
    if (!landlord) return null;

    if (isBankrupt(landlord.balance, this.config)) return { role: 'farmers', reason: '地主破产' };
    if (farmers.every(p => p.bankrupt)) return { role: 'landlord', reason: '所有农民破产' };
    return null;
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    Object.values(this.players).forEach(p => {
      try { p.ws?.send(data); } catch {}
    });
  }

  _sendToBankruptFarmers(msg) {
    const data = JSON.stringify(msg);
    Object.values(this.players).forEach(p => {
      if (p.bankrupt && p.role === 'farmer') {
        try { p.ws?.send(data); } catch {}
      }
    });
  }

  _broadcastState() {
    Object.values(this.players).forEach(p => {
      try {
        p.ws?.send(JSON.stringify({ type: 'state_update', state: this.getStateFor(p.id) }));
      } catch {}
    });
  }
}

export { PHASES };
