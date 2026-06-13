// 房间状态机：服务端权威的唯一游戏状态来源（见 docs/GAME_SPEC.md §3、§5）。
// 阶段：LOBBY → DISCUSSION → BETTING → REVEAL → COIN_FLIP → SETTLE → NEGOTIATE → FINALIZE
//      → (回到 DISCUSSION 下一回合) 或 ENDED
// 分钱四子阶段 = SETTLE(系统结算) + NEGOTIATE(农民协商) + FINALIZE(正式结算) + 下一轮 DISCUSSION(农民讨论)。

import crypto from 'crypto';
import { mergeConfig, getInitialBalance } from './config.js';
import { getMode } from './modes/index.js';
import { flipCoin, betBounds, validateBet, settleRound, applyAllocation } from './logic/rules.js';
import { saveGameRecord } from './storage.js';

export const PHASES = ['LOBBY', 'DISCUSSION', 'BETTING', 'REVEAL', 'COIN_FLIP', 'SETTLE', 'NEGOTIATE', 'FINALIZE', 'ENDED'];

const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];
const IN_GAME_PHASES = ['DISCUSSION', 'BETTING', 'REVEAL', 'COIN_FLIP', ...PAYOUT_PHASES];

export class Room {
  constructor(roomId, name, modeId, configOverrides = {}) {
    this.roomId = roomId;
    this.name = name || '未命名房间';
    this.mode = getMode(modeId)?.id ?? 'quick';
    this.config = mergeConfig(configOverrides);
    this.players = new Map(); // playerId -> player
    this.hostId = null;
    this.phase = 'LOBBY';
    this.round = 0;
    this.gameId = null;
    this.startedAt = null;
    this.bets = {};
    this.coinResult = null;
    this.settlement = null;
    this.allocation = null;        // {takes, debts} 协商中的方案
    this.negotiateDeadline = null;
    this.roundFarmerIds = [];
    this.roundStartBalances = {};
    this.history = [];
    this.chatLog = [];             // {channel, from, name, text, ts}
    this.lastActivity = Date.now();
    this._timers = new Set();
    this._seat = 0;
  }

  // ---------- 玩家进出 ----------

  addPlayer(username, ws) {
    const existing = [...this.players.values()].find(p => p.username === username);
    if (existing) {
      // 断线重连 / 顶号后重进：回到原座位、原余额
      existing.ws = ws;
      existing.online = true;
      this._touch();
      this._broadcastState();
      return { ok: true, playerId: existing.id };
    }
    if (this.phase !== 'LOBBY') return { error: '游戏已开始，无法加入' };
    if (this.players.size >= 1 + this.config.maxFarmers) return { error: '房间已满' };

    const player = {
      id: crypto.randomBytes(4).toString('hex'),
      username,
      seat: this._seat++,
      role: null,
      balance: 0,
      bankrupt: false,
      online: true,
      ready: false,
      confirmed: false,
      negotiateConfirmed: false,
      ws,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this._touch();
    this._broadcastState();
    return { ok: true, playerId: player.id };
  }

  // 连接断开：大厅阶段直接移除；游戏中保留座位标记离线（自动代为准备/确认）。
  handleDisconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.ws = null;
    player.online = false;
    if (this.phase === 'LOBBY') {
      this.players.delete(playerId);
      this._reassignHost();
    } else if (this.config.autoActForOffline) {
      this._autoActOffline();
    }
    this._touch();
    this._broadcastState();
  }

  // 玩家主动退出房间（区别于断线）：游戏中退出视为弃局。
  leave(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { error: '不在房间中' };
    this.players.delete(playerId);
    this._reassignHost();

    if (IN_GAME_PHASES.includes(this.phase)) {
      if (player.role === 'landlord') {
        this._endGame('farmers', 'landlord_left');
      } else if (player.role === 'farmer' && this._activeFarmers().length === 0) {
        this._endGame('landlord', 'farmers_left');
      } else {
        this._autoActOffline();
      }
    }
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  _reassignHost() {
    if (!this.players.has(this.hostId)) {
      this.hostId = [...this.players.values()].sort((a, b) => a.seat - b.seat)[0]?.id ?? null;
    }
  }

  isEmpty() {
    return this.players.size === 0;
  }

  allOffline() {
    return [...this.players.values()].every(p => !p.online);
  }

  // ---------- 大厅 ----------

  takeRole(playerId, role) {
    if (this.phase !== 'LOBBY') return { error: '只能在大厅阶段选择角色' };
    const player = this.players.get(playerId);
    if (!player) return { error: '不在房间中' };
    const mode = getMode(this.mode);
    if (!mode.roles.includes(role)) return { error: '该模式不支持此角色' };
    if (role === 'bank') return { error: '银行角色尚未开放' };
    if (role === 'landlord') {
      const taken = [...this.players.values()].find(p => p.role === 'landlord' && p.id !== playerId);
      if (taken) return { error: '已有玩家选择地主' };
    }
    if (role === 'farmer') {
      const farmers = [...this.players.values()].filter(p => p.role === 'farmer' && p.id !== playerId);
      if (farmers.length >= this.config.maxFarmers) return { error: '农民人数已满' };
    }
    player.role = role;
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  startGame(playerId) {
    if (this.phase !== 'LOBBY') return { error: '游戏已在进行中' };
    if (playerId !== this.hostId) return { error: '只有房主可以开始游戏' };
    const all = [...this.players.values()];
    const landlords = all.filter(p => p.role === 'landlord');
    const farmers = all.filter(p => p.role === 'farmer');
    if (all.some(p => !p.role)) return { error: '还有玩家未选择角色' };
    if (landlords.length !== 1) return { error: '需要恰好 1 名地主' };
    if (farmers.length < this.config.minFarmers) return { error: `至少需要 ${this.config.minFarmers} 名农民` };
    if (farmers.length > this.config.maxFarmers) return { error: `农民最多 ${this.config.maxFarmers} 名` };

    this.gameId = crypto.randomBytes(6).toString('hex');
    this.startedAt = Date.now();
    this.history = [];
    for (const p of all) {
      p.balance = getInitialBalance(p.role, farmers.length, this.config);
      p.bankrupt = false;
    }
    this.round = 1;
    this._enterDiscussion();
    return { ok: true };
  }

  restartGame(playerId) {
    if (this.phase !== 'ENDED') return { error: '游戏尚未结束' };
    if (playerId !== this.hostId) return { error: '只有房主可以重新开始' };
    this.phase = 'LOBBY';
    for (const p of this.players.values()) {
      p.ready = false;
      p.confirmed = false;
      p.negotiateConfirmed = false;
      p.bankrupt = false;
    }
    const result = this.startGame(playerId);
    if (result.error) this._broadcastState(); // 人员构成不再合法，退回大厅重新配置
    return result.error ? { ok: true, backToLobby: true } : result;
  }

  // ---------- 阶段推进 ----------

  _setPhase(phase) {
    this._clearTimers();
    this.phase = phase;
    this._touch();
  }

  _enterDiscussion() {
    this._setPhase('DISCUSSION');
    this.bets = {};
    this.coinResult = null;
    this.settlement = null;
    this.allocation = null;
    this.negotiateDeadline = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.confirmed = false;
      p.negotiateConfirmed = false;
    }
    this._broadcastState();
    this._checkGate('ready', () => this._enterBetting());
  }

  setReady(playerId) {
    if (this.phase !== 'DISCUSSION') return { error: '当前不是准备阶段' };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: '观战者无需准备' };
    player.ready = true;
    this._broadcastState();
    this._checkGate('ready', () => this._enterBetting());
    return { ok: true };
  }

  _enterBetting() {
    this._setPhase('BETTING');
    this.bets = {};
    this.roundFarmerIds = this._activeFarmers().map(p => p.id);
    this.roundStartBalances = {};
    for (const p of this._activePlayers()) this.roundStartBalances[p.id] = p.balance;
    this._autoActOffline();
    this._broadcastState();
    this._checkAllBet();
  }

  placeBet(playerId, amount) {
    if (this.phase !== 'BETTING') return { error: '当前不是下注阶段' };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: '观战者不能下注' };
    if (this.bets[playerId] !== undefined) return { error: '已经下过注了' };
    const check = validateBet({
      amount,
      balance: player.balance,
      role: player.role,
      farmerCount: this.roundFarmerIds.length,
      config: this.config,
    });
    if (!check.valid) return { error: check.reason, bounds: check.bounds };
    this.bets[playerId] = amount;
    player.balance -= amount;
    this._broadcastState();
    this._checkAllBet();
    return { ok: true };
  }

  _checkAllBet() {
    if (this.phase !== 'BETTING') return;
    const pending = this._activePlayers().filter(p => this.bets[p.id] === undefined);
    if (pending.length === 0) this._enterReveal();
  }

  _enterReveal() {
    this._setPhase('REVEAL');
    for (const p of this.players.values()) p.confirmed = false;
    this._broadcastState();
    this._checkGate('confirmed', () => this._enterCoinFlip());
  }

  confirmReveal(playerId) {
    if (this.phase !== 'REVEAL') return { error: '当前不是揭牌阶段' };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: '观战者无需确认' };
    player.confirmed = true;
    this._broadcastState();
    this._checkGate('confirmed', () => this._enterCoinFlip());
    return { ok: true };
  }

  _enterCoinFlip() {
    this._setPhase('COIN_FLIP');
    this.coinResult = flipCoin();
    this._broadcastState();
    this._after(this.config.timing.coinAnimMs, () => this._enterSettle());
  }

  _enterSettle() {
    this._setPhase('SETTLE');
    const balances = {};
    for (const p of this.players.values()) balances[p.id] = p.balance;
    this.settlement = settleRound({
      coinResult: this.coinResult,
      bets: this.bets,
      balances,
      landlordId: this._landlord()?.id,
      farmerIds: this.roundFarmerIds,
      config: this.config,
    });
    this.allocation = {
      takes: { ...this.settlement.takes },
      debts: { ...this.settlement.debts },
    };
    this._broadcastState();
    this._after(this.config.timing.settleViewMs, () => this._enterNegotiate());
  }

  _enterNegotiate() {
    const farmers = this.roundFarmerIds.map(id => this.players.get(id)).filter(Boolean);
    const totalTakes = Object.values(this.allocation?.takes ?? {}).reduce((s, v) => s + v, 0);
    const totalDebts = Object.values(this.allocation?.debts ?? {}).reduce((s, v) => s + v, 0);
    if (farmers.length <= 1 || (totalTakes === 0 && totalDebts === 0)) {
      this._finalize(); // 没有可协商的内容，自动跳过
      return;
    }
    this._setPhase('NEGOTIATE');
    for (const p of this.players.values()) p.negotiateConfirmed = false;
    const timeout = this.config.timing.negotiateTimeoutMs;
    this.negotiateDeadline = timeout > 0 ? Date.now() + timeout : null;
    if (timeout > 0) this._after(timeout, () => this._finalize());
    this._broadcastState();
    this._checkNegotiateGate();
  }

  negotiateTransfer(playerId, toId, kind, amount) {
    if (this.phase !== 'NEGOTIATE') return { error: '当前不是协商阶段' };
    if (!Number.isInteger(amount) || amount <= 0) return { error: '转移金额必须是正整数' };
    if (playerId === toId) return { error: '不能转给自己' };
    if (!this.roundFarmerIds.includes(playerId) || !this.roundFarmerIds.includes(toId)) {
      return { error: '只能在本回合参与的农民之间转移' };
    }
    const pool = kind === 'debt' ? this.allocation.debts : this.allocation.takes;
    if ((pool[playerId] ?? 0) < amount) return { error: '可转移的数额不足' };
    if (kind === 'debt') {
      const target = this.players.get(toId);
      if ((this.allocation.debts[toId] ?? 0) + amount > target.balance) {
        return { error: '对方余额不足以承担这笔债务' };
      }
    }
    pool[playerId] -= amount;
    pool[toId] = (pool[toId] ?? 0) + amount;
    for (const p of this.players.values()) p.negotiateConfirmed = false; // 方案变动，重置确认
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  negotiateConfirm(playerId, confirmed) {
    if (this.phase !== 'NEGOTIATE') return { error: '当前不是协商阶段' };
    if (!this.roundFarmerIds.includes(playerId)) return { error: '只有本回合参与的农民可以确认' };
    const player = this.players.get(playerId);
    player.negotiateConfirmed = confirmed !== false;
    this._broadcastState();
    this._checkNegotiateGate();
    return { ok: true };
  }

  _checkNegotiateGate() {
    if (this.phase !== 'NEGOTIATE') return;
    const farmers = this.roundFarmerIds.map(id => this.players.get(id)).filter(Boolean);
    const allConfirmed = farmers.every(p => p.negotiateConfirmed || (!p.online && this.config.autoActForOffline));
    if (allConfirmed) this._finalize();
  }

  _finalize() {
    if (!['SETTLE', 'NEGOTIATE'].includes(this.phase)) return;
    this._setPhase('FINALIZE');
    const balances = {};
    for (const p of this.players.values()) balances[p.id] = p.balance;
    const landlordId = this._landlord()?.id;
    const result = applyAllocation({
      settlement: this.settlement,
      allocation: this.allocation,
      balances,
      bets: this.bets,
      landlordId,
      farmerIds: this.roundFarmerIds,
      startBalances: this.roundStartBalances,
      config: this.config,
    });
    for (const [id, balance] of Object.entries(result.after)) {
      const p = this.players.get(id);
      if (p) p.balance = balance;
    }
    const newlyBankrupt = [];
    for (const id of result.bankrupts) {
      const p = this.players.get(id);
      if (p && !p.bankrupt) {
        p.bankrupt = true;
        newlyBankrupt.push(id);
      }
    }
    this.history.push({
      round: this.round,
      coinResult: this.coinResult,
      bets: { ...this.bets },
      pot: this.settlement.pot,
      landlordTake: this.settlement.landlordTake,
      takes: { ...this.allocation.takes },
      debts: { ...this.allocation.debts },
      uncovered: this.settlement.uncovered,
      events: this.settlement.events,
      deltas: result.deltas,
      balancesAfter: result.after,
      newlyBankrupt,
    });
    this._broadcastState();
    this._after(this.config.timing.finalizeMs, () => this._afterRound());
  }

  _afterRound() {
    const landlord = this._landlord();
    if (!landlord || landlord.bankrupt) {
      this._endGame('farmers', 'landlord_bankrupt');
      return;
    }
    if (this._activeFarmers().length === 0) {
      this._endGame('landlord', 'farmers_bankrupt');
      return;
    }
    this.round += 1;
    this._enterDiscussion(); // 分钱子阶段四：回到农民讨论，开启下一回合
  }

  _endGame(winnerSide, reason) {
    this._setPhase('ENDED');
    this.winnerSide = winnerSide;
    this.endReason = reason;
    try {
      saveGameRecord({
        roomId: this.roomId,
        gameId: this.gameId,
        mode: this.mode,
        config: this.config,
        startedAt: this.startedAt,
        endedAt: Date.now(),
        winnerSide,
        reason,
        players: [...this.players.values()].map(p => ({ username: p.username, role: p.role, balance: p.balance, bankrupt: p.bankrupt })),
        history: this.history,
      });
    } catch (err) {
      console.error('保存对局记录失败:', err);
    }
    this._broadcastState();
  }

  // ---------- 聊天（语音接口预留：见 index.js NOT_IMPLEMENTED 分支） ----------

  chat(playerId, channel, text) {
    const player = this.players.get(playerId);
    const message = (text ?? '').toString().trim().slice(0, 200);
    if (!player || !message) return { error: '消息无效' };
    if (!this.config.channels.includes(channel)) return { error: '频道不存在' };
    if (channel === 'farmer' && player.role !== 'farmer') return { error: '只有农民可以使用农民频道' };
    const entry = { channel, from: playerId, name: player.username, text: message, ts: Date.now() };
    this.chatLog.push(entry);
    if (this.chatLog.length > 200) this.chatLog.shift();
    for (const p of this.players.values()) {
      if (this._canSeeChannel(p, channel)) this._send(p, { type: 'chat', ...entry });
    }
    this._touch();
    return { ok: true };
  }

  _canSeeChannel(player, channel) {
    if (channel === 'public') return true;
    return player.role === 'farmer' || player.bankrupt; // 破产观战者全可见
  }

  chatHistoryFor(playerId) {
    const player = this.players.get(playerId);
    if (!player) return [];
    return this.chatLog.filter(m => this._canSeeChannel(player, m.channel));
  }

  // ---------- 每玩家视图（隐私边界） ----------

  viewFor(viewerId) {
    const viewer = this.players.get(viewerId);
    const spectator = !!viewer?.bankrupt;
    const betsPublic = !['LOBBY', 'DISCUSSION', 'BETTING'].includes(this.phase);
    const farmerCount = this.phase === 'LOBBY'
      ? [...this.players.values()].filter(p => p.role === 'farmer').length
      : this.roundFarmerIds.length;

    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat).map(p => ({
      id: p.id,
      name: p.username,
      role: p.role,
      seat: p.seat,
      online: p.online,
      isHost: p.id === this.hostId,
      bankrupt: p.bankrupt,
      ready: p.ready,
      confirmed: p.confirmed,
      negotiateConfirmed: p.negotiateConfirmed,
      hasBet: this.bets[p.id] !== undefined,
      bet: betsPublic ? (this.bets[p.id] ?? null) : null,
      balance: (p.id === viewerId || spectator || this.phase === 'ENDED') ? p.balance : null,
    }));

    const canNegotiateView = spectator || viewer?.role === 'farmer';
    const me = viewer ? {
      id: viewer.id,
      role: viewer.role,
      balance: viewer.balance,
      bet: this.bets[viewerId] ?? null,
      ready: viewer.ready,
      confirmed: viewer.confirmed,
      negotiateConfirmed: viewer.negotiateConfirmed,
      spectator,
      isHost: viewerId === this.hostId,
      bounds: this._isActive(viewer) && farmerCount > 0
        ? betBounds({ balance: viewer.balance, role: viewer.role, farmerCount, config: this.config })
        : null,
    } : null;

    return {
      roomId: this.roomId,
      roomName: this.name,
      mode: this.mode,
      phase: this.phase,
      round: this.round,
      hostId: this.hostId,
      config: this.config,
      players,
      me,
      pot: betsPublic ? Object.values(this.bets).reduce((s, v) => s + v, 0) : null,
      coinResult: ['COIN_FLIP', ...PAYOUT_PHASES].includes(this.phase) ? this.coinResult : null,
      settlement: PAYOUT_PHASES.includes(this.phase) ? this.settlement : null,
      allocation: this.phase === 'NEGOTIATE' && canNegotiateView
        ? {
            takes: this.allocation.takes,
            debts: this.allocation.debts,
            confirms: this.roundFarmerIds.filter(id => this.players.get(id)?.negotiateConfirmed),
            deadline: this.negotiateDeadline,
          }
        : null,
      roundFarmerIds: this.roundFarmerIds,
      // balancesAfter 会泄露他人余额绝对值，仅观战者/终局可见
      history: this.history.map(h => {
        if (spectator || this.phase === 'ENDED') return h;
        const { balancesAfter: _hidden, ...publicEntry } = h;
        return publicEntry;
      }),
      winnerSide: this.phase === 'ENDED' ? this.winnerSide : null,
      endReason: this.phase === 'ENDED' ? this.endReason : null,
    };
  }

  lobbySummary() {
    return {
      roomId: this.roomId,
      name: this.name,
      mode: this.mode,
      phase: this.phase,
      playerCount: this.players.size,
      maxPlayers: 1 + this.config.maxFarmers,
    };
  }

  // ---------- 内部工具 ----------

  _landlord() {
    return [...this.players.values()].find(p => p.role === 'landlord');
  }

  _activeFarmers() {
    return [...this.players.values()].filter(p => p.role === 'farmer' && !p.bankrupt);
  }

  _activePlayers() {
    return [...this.players.values()].filter(p => (p.role === 'landlord' || p.role === 'farmer') && !p.bankrupt);
  }

  _isActive(player) {
    return (player.role === 'landlord' || player.role === 'farmer') && !player.bankrupt;
  }

  // 通用闸门：所有活跃玩家的 flag 为真（离线玩家按配置自动通过）即推进。
  _checkGate(flag, advance) {
    const satisfied = this._activePlayers().every(
      p => p[flag] || (!p.online && this.config.autoActForOffline),
    );
    if (satisfied) advance();
  }

  // 为离线玩家自动补齐当前阶段需要的动作（准备/下注/确认），避免卡住全场。
  _autoActOffline() {
    if (!this.config.autoActForOffline) return;
    if (this.phase === 'BETTING') {
      for (const p of this._activePlayers()) {
        if (!p.online && this.bets[p.id] === undefined) {
          const bounds = betBounds({
            balance: p.balance,
            role: p.role,
            farmerCount: this.roundFarmerIds.length,
            config: this.config,
          });
          const amount = bounds.forceAllIn ? bounds.allInAmount : bounds.min;
          this.bets[p.id] = amount;
          p.balance -= amount;
        }
      }
      this._checkAllBet();
    } else if (this.phase === 'DISCUSSION') {
      this._checkGate('ready', () => this._enterBetting());
    } else if (this.phase === 'REVEAL') {
      this._checkGate('confirmed', () => this._enterCoinFlip());
    } else if (this.phase === 'NEGOTIATE') {
      this._checkNegotiateGate();
    }
  }

  _after(ms, fn) {
    if (!(ms > 0)) return; // 0 = 不自动推进（调试用）
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      fn();
    }, ms);
    this._timers.add(timer);
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
  }

  _touch() {
    this.lastActivity = Date.now();
  }

  _send(player, payload) {
    if (player.ws && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  _broadcastState() {
    for (const p of this.players.values()) {
      this._send(p, { type: 'state', state: this.viewFor(p.id) });
    }
  }

  destroy() {
    this._clearTimers();
  }
}
