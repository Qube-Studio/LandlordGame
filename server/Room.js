// 房间状态机：服务端权威的唯一游戏状态来源（见 docs/GAME_SPEC.md §3、§5）。
// 阶段：LOBBY → DISCUSSION → BETTING → REVEAL → COIN_FLIP → SETTLE → NEGOTIATE → FINALIZE
//      → (回到 DISCUSSION 下一回合) 或 ENDED
// 分钱四子阶段 = SETTLE(系统结算) + NEGOTIATE(农民协商) + FINALIZE(正式结算) + 下一轮 DISCUSSION(农民讨论)。

import crypto from 'crypto';
import { mergeConfig, getInitialBalance } from './config.js';
import { getMode } from './modes/index.js';
import { flipCoin, betBounds, validateBet, settleRound, applyAllocation } from './logic/rules.js';
import { upcomingGoal, goalForRound, goalPenalty } from './logic/landlordGoal.js';
import { apportion } from './logic/apportion.js';
import { saveGameRecord } from './storage.js';

export const PHASES = ['LOBBY', 'DISCUSSION', 'BETTING', 'REVEAL', 'COIN_FLIP', 'SETTLE', 'NEGOTIATE', 'FINALIZE', 'ENDED'];

const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];
const IN_GAME_PHASES = ['DISCUSSION', 'BETTING', 'REVEAL', 'COIN_FLIP', ...PAYOUT_PHASES];

// 金额按 10/5/2/1 贪心分解后的张数（与客户端 game/notes.js decompose 一致）。
// 张数对所有人可见（任务：桌面堆叠露张数，下注阶段仍不露金额）。
function noteCount(amount) {
  let rest = Math.max(0, Math.floor(amount || 0));
  let c = 0;
  for (const d of [10, 5, 2, 1]) { c += Math.floor(rest / d); rest %= d; }
  return c;
}

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
    this.betCounts = {};           // playerId -> 实际拍下的张数（含拆分；客户端上报，仅用于显示一致性）
    this.coinResult = null;
    this.settlement = null;
    this.allocation = null;        // {takes, debts} 协商中的方案
    this.negotiateDeadline = null;
    this.landlordInitial = 0;      // 地主开局资金（地主资金目标的基准）
    this.roundFarmerIds = [];
    this.roundStartBalances = {};
    this.history = [];
    this.chatLog = [];             // {channel, from, name, text, ts}
    this.lastActivity = Date.now();
    this._timers = new Set();
    this._graceTimers = new Map(); // playerId -> 断线宽限计时器（任务⑥）
    this._seat = 0;
  }

  // ---------- 玩家进出 ----------

  addPlayer(username, ws) {
    const existing = [...this.players.values()].find(p => p.username === username);
    if (existing) {
      // 断线重连 / 顶号后重进：回到原座位、原余额。
      // 宽限期内回来 → 继续游戏；已超时降级观战的 → 以观战者身份回来（spectator 标记保留，任务⑥）。
      this._cancelGrace(existing.id);
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
      spectator: false,   // 断线超时降级观战（任务⑥）
      emote: null,        // 手动表情覆盖（任务⑧ 预留接口）
      ws,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this._touch();
    this._broadcastState();
    return { ok: true, playerId: player.id };
  }

  // 连接断开：大厅阶段直接移除；游戏中保留座位标记离线（自动代为准备/确认），
  // 并启动宽限计时器——超时未重连则降级为观战（任务⑥）。
  handleDisconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.ws = null;
    player.online = false;
    if (this.phase === 'LOBBY') {
      this.players.delete(playerId);
      this._reassignHost();
    } else {
      if (this.config.autoActForOffline) this._autoActOffline();
      this._scheduleGrace(playerId);
    }
    this._touch();
    this._broadcastState();
  }

  // 断线宽限：reconnectGraceSec 内未回来则降级观战。0 = 永不超时（沿用旧行为：一直保留座位）。
  _scheduleGrace(playerId) {
    const sec = this.config.reconnectGraceSec;
    if (!(sec > 0)) return;
    this._cancelGrace(playerId);
    const timer = setTimeout(() => {
      this._graceTimers.delete(playerId);
      this._abandonPlayer(playerId);
    }, sec * 1000);
    this._graceTimers.set(playerId, timer);
  }

  _cancelGrace(playerId) {
    const t = this._graceTimers.get(playerId);
    if (t) { clearTimeout(t); this._graceTimers.delete(playerId); }
  }

  // 宽限超时：降级为观战者。关键角色（地主 / 最后一个农民）离场则直接结束对局。
  _abandonPlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.online || player.spectator) return;
    if (!IN_GAME_PHASES.includes(this.phase)) return; // 大厅/终局无需处理
    player.spectator = true;
    if (player.role === 'landlord') { this._endGame('farmers', 'landlord_abandoned'); return; }
    if (player.role === 'farmer' && this._activeFarmers().length === 0) {
      this._endGame('landlord', 'farmers_abandoned');
      return;
    }
    // 其余：该玩家退出活跃序列后，重新推进当前阶段闸门（原本可能在等他）。
    this._autoActOffline();
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
    this.landlordInitial = this._landlord()?.balance ?? 0;
    this.round = 1;
    this._enterDiscussion();
    return { ok: true };
  }

  // 再来一局：回到大厅并清空所有角色，让每个人重新选（任务⑤：之前会立即沿用旧角色开局，身份被锁死）。
  restartGame(playerId) {
    if (this.phase !== 'ENDED') return { error: '游戏尚未结束' };
    if (playerId !== this.hostId) return { error: '只有房主可以重新开始' };
    this._setPhase('LOBBY');
    this.round = 0;
    this.gameId = null;
    this.startedAt = null;
    this.bets = {};
    this.coinResult = null;
    this.settlement = null;
    this.allocation = null;
    this.negotiateDeadline = null;
    this.winnerSide = null;
    this.endReason = null;
    this.history = [];
    this._clearGraceTimers();
    for (const p of this.players.values()) {
      p.role = null;          // 清空角色，重新选
      p.balance = 0;
      p.bankrupt = false;
      p.spectator = false;    // 解除观战降级，可重新参战
      p.ready = false;
      p.confirmed = false;
      p.negotiateConfirmed = false;
      p.emote = null;
    }
    this._broadcastState();
    return { ok: true, backToLobby: true };
  }

  // ---------- 本地测试辅助（仅 index.js 在 LLG_TEST 开启时调用，任务③） ----------

  // 把房间补满真实测试玩家并自动配好阵容（首位=地主，其余=农民），关闭自动代离线行动——
  // 全部交给测试者用 possess 逐个手动操控，实现单人玩通全部角色。
  devFill() {
    if (this.phase !== 'LOBBY') return { error: '只能在大厅补充测试玩家' };
    const target = Math.min(1 + this.config.maxFarmers, 4); // 1 地主 + 3 农民
    let n = this.players.size;
    while (this.players.size < target) {
      n += 1;
      const id = crypto.randomBytes(4).toString('hex');
      this.players.set(id, {
        id, username: '测试' + n, seat: this._seat++, role: null,
        balance: 0, bankrupt: false, online: true, ready: false, confirmed: false,
        negotiateConfirmed: false, spectator: false, emote: null, ws: null,
      });
    }
    const all = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    all.forEach((p, i) => { p.role = i === 0 ? 'landlord' : 'farmer'; });
    this.config.autoActForOffline = false; // 测试：不自动代离线，全部手动切换控制
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  // 把控制 socket 转移到目标玩家（附身）：旧占用者解绑 ws（仍 online，待被再次附身）。
  possess(ws, playerId) {
    const target = this.players.get(playerId);
    if (!target) return { error: '目标玩家不存在' };
    for (const p of this.players.values()) {
      if (p.ws === ws && p.id !== playerId) p.ws = null;
    }
    target.ws = ws;
    target.online = true;
    this._cancelGrace(playerId);
    this._touch();
    this._broadcastState();
    return { ok: true };
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
      p.emote = null;       // 手动表情每回合清空
    }
    this._broadcastState();
    this._checkGate('ready', () => this._enterBetting());
  }

  // 手动设置表情（任务⑧ 预留接口）：null 清除，其余须为允许的手动表情之一。
  // 客户端目前不暴露 UI，后续接面板时直接发 { type:'set_emote', emote } 即可。
  setEmote(playerId, emote) {
    const player = this.players.get(playerId);
    if (!player) return { error: '不在房间中' };
    const allowed = ['idle', 'ready', 'bet', 'win', 'lose'];
    if (emote !== null && !allowed.includes(emote)) return { error: '不支持的表情' };
    player.emote = emote;
    this._broadcastState();
    return { ok: true };
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
    this.betCounts = {};
    this.roundFarmerIds = this._activeFarmers().map(p => p.id);
    this.roundStartBalances = {};
    for (const p of this._activePlayers()) this.roundStartBalances[p.id] = p.balance;
    this._autoActOffline();
    this._broadcastState();
    this._checkAllBet();
  }

  placeBet(playerId, amount, count) {
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
    // 实际拍下的张数（含拆分）：客户端上报、夹紧到合理范围；缺省回落到贪心张数。
    this.betCounts[playerId] = (Number.isInteger(count) && count > 0 && count <= 60) ? count : noteCount(amount);
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
    // 债务可以全部压给某个农民使其破产（任务 7）：不再校验对方余额是否承担得起。
    // 落账时该农民只付出其全部余额（applyAllocation 取 min(债务, 余额)），地主只收到这点钱。
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

    // 双倍补偿精确入账（任务 8）：地主胜且桌面不足目标时，按最终（可能经协商的）债务实际收齐的
    // 部分重算缺口，使展示与入账一致——地主拿到 pot + 实际补偿，剩余无人能付的即 uncovered。
    const target = this.settlement.target ?? 0; // 已在 settleRound 取整（floor(下注×倍数)）
    const shortfall = this.coinResult === 'heads' ? Math.max(0, target - this.settlement.pot) : 0;
    const uncovered = Math.max(0, shortfall - result.collected);

    // 地主资金目标（任务 6）：检查点回合的 FINALIZE 若地主未达标，扣除惩罚（资金沉没，可致破产）。
    let landlordPenalty = 0;
    let landlordGoalValue = null;
    let landlordGoalMet = null;
    if (this.config.landlordGoal?.enabled && landlordId) {
      landlordGoalValue = goalForRound(this.round, this.landlordInitial, this.config);
      if (landlordGoalValue != null) {
        const after = result.after[landlordId] ?? 0;
        landlordGoalMet = after >= landlordGoalValue;
        if (!landlordGoalMet) {
          landlordPenalty = goalPenalty(after, this.config);
          result.after[landlordId] = after - landlordPenalty;
          result.deltas[landlordId] = (result.deltas[landlordId] ?? 0) - landlordPenalty;
          // 惩罚资金平分给本回合农民（最大余数法；破产判定前入账，可能救活濒临破产者）。
          if (landlordPenalty > 0 && this.roundFarmerIds.length > 0) {
            const shares = apportion(
              landlordPenalty,
              this.roundFarmerIds.map(id => ({ id, weight: 1, tie: this.bets[id] ?? 0 })),
            );
            for (const id of this.roundFarmerIds) {
              const s = shares[id] ?? 0;
              result.after[id] = (result.after[id] ?? 0) + s;
              result.deltas[id] = (result.deltas[id] ?? 0) + s;
            }
          }
        }
      }
    }

    for (const [id, balance] of Object.entries(result.after)) {
      const p = this.players.get(id);
      if (p) p.balance = balance;
    }

    // 破产判定在惩罚扣除之后重算（惩罚可能直接压垮地主）。
    const newlyBankrupt = [];
    for (const id of [landlordId, ...this.roundFarmerIds]) {
      const p = this.players.get(id);
      if (p && !p.bankrupt && (result.after[id] ?? 0) <= this.config.bankruptcyThreshold) {
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
      uncovered,
      collected: result.collected,
      landlordPenalty,
      landlordGoalValue,
      landlordGoalMet,
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
    if (!landlord || landlord.bankrupt || landlord.spectator) {
      this._endGame('farmers', landlord?.spectator ? 'landlord_abandoned' : 'landlord_bankrupt');
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

  // 头部朝向中继（任务⑦）：高频瞬态数据，不进全量 state——夹紧后只转发给其他在线玩家。
  setLook(playerId, yaw, pitch) {
    const player = this.players.get(playerId);
    if (!player) return { error: '不在房间中' };
    const clamp = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
    const payload = { type: 'look', id: playerId, yaw: clamp(yaw, 1.2), pitch: clamp(pitch, 0.8) };
    for (const p of this.players.values()) {
      if (p.id !== playerId) this._send(p, payload);
    }
    return { ok: true };
  }

  // ---------- 每玩家视图（隐私边界） ----------

  viewFor(viewerId) {
    const viewer = this.players.get(viewerId);
    const spectator = !!(viewer?.bankrupt || viewer?.spectator); // 破产 或 断线超时降级（任务⑥）
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
      emote: p.emote ?? null,
      spectator: !!p.spectator,
      hasBet: this.bets[p.id] !== undefined,
      betCount: this.bets[p.id] !== undefined ? (this.betCounts[p.id] ?? noteCount(this.bets[p.id])) : 0, // 实际张数，对所有人一致可见
      bet: betsPublic ? (this.bets[p.id] ?? null) : null,
      balance: (p.id === viewerId || spectator || this.phase === 'ENDED') ? p.balance : null,
    }));

    // 地主资金目标（任务 6）：目标值与到期回合对所有人可见；地主当前余额仅地主/观战者/终局可见。
    const landlord = this._landlord();
    const goalInfo = (this.config.landlordGoal?.enabled && this.landlordInitial > 0 && landlord && IN_GAME_PHASES.includes(this.phase))
      ? upcomingGoal(this.round, this.landlordInitial, this.config)
      : null;
    const landlordGoal = goalInfo ? {
      ...goalInfo,
      initial: this.landlordInitial,
      landlordId: landlord.id,
      landlordBalance: (viewer?.role === 'landlord' || spectator) ? landlord.balance : null,
    } : null;

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
      landlordGoal,
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
    return [...this.players.values()].filter(p => p.role === 'farmer' && !p.bankrupt && !p.spectator);
  }

  _activePlayers() {
    return [...this.players.values()].filter(p => (p.role === 'landlord' || p.role === 'farmer') && !p.bankrupt && !p.spectator);
  }

  _isActive(player) {
    return (player.role === 'landlord' || player.role === 'farmer') && !player.bankrupt && !player.spectator;
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
          this.betCounts[p.id] = noteCount(amount);
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

  _clearGraceTimers() {
    for (const t of this._graceTimers.values()) clearTimeout(t);
    this._graceTimers.clear();
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
    this._clearGraceTimers();
  }
}
