// 房间状态机：服务端权威的唯一游戏状态来源（见 docs/GAME_SPEC.md §3、§5）。
// 阶段：LOBBY → DISCUSSION → BETTING → REVEAL → COIN_FLIP → SETTLE → NEGOTIATE → FINALIZE
//      → (回到 DISCUSSION 下一回合) 或 ENDED
// 分钱四子阶段 = SETTLE(系统结算) + NEGOTIATE(农民协商) + FINALIZE(正式结算) + 下一轮 DISCUSSION(农民讨论)。

import crypto from 'crypto';
import { roomConfig, getInitialBalance, getInitialPool, getMinStake, factionOf } from './config.js';
import { getMode } from './modes/index.js';
import { flipCoin, betBounds, validateBet, settleRound, applyAllocation } from './logic/rules.js';
import { upcomingGoal, goalForRound, goalPenalty } from './logic/landlordGoal.js';
import { computeWage, wageDueThisRound, investorWaiver, computeTax } from './logic/competitive.js';
import { apportion } from './logic/apportion.js';
import { saveGameRecord } from './storage.js';

// REFLIP = 竞技暴食者重掷决策窗（§8.4），夹在 COIN_FLIP 与 SETTLE 之间，仅农民输且有暴食者时出现。
export const PHASES = ['LOBBY', 'DISCUSSION', 'BETTING', 'REVEAL', 'COIN_FLIP', 'REFLIP', 'SETTLE', 'NEGOTIATE', 'FINALIZE', 'ENDED'];

const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];
const IN_GAME_PHASES = ['DISCUSSION', 'BETTING', 'REVEAL', 'COIN_FLIP', 'REFLIP', ...PAYOUT_PHASES];

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
    this.config = roomConfig(this.mode, configOverrides);
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
      // 竞技模式角色技能状态（§8；非竞技恒为默认值）：
      pool: null,             // 资本家资金池（血条）；非资本家为 null
      pledge: 0,              // 投资人本回合担保额（掷币前可改）
      premium: 0,             // 投资人本回合已扣保费（锁定后）
      mealAllowance: 0,       // 暴食者累积饭账（成本，农民胜时扣除）
      reflipsLeft: 0,         // 暴食者剩余重掷次数（每局）
      usedReflipThisRound: false,
      passedReflip: false,    // 暴食者本重掷窗已放弃
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
    if (factionOf(player.role) === 'landlord') { this._endGame('farmers', 'landlord_abandoned'); return; }
    if (factionOf(player.role) === 'farmer' && this._activeFarmers().length === 0) {
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
      if (factionOf(player.role) === 'landlord') {
        this._endGame('farmers', 'landlord_left');
      } else if (factionOf(player.role) === 'farmer' && this._activeFarmers().length === 0) {
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
    const faction = factionOf(role);
    if (!faction) return { error: '无效角色' };
    if (faction === 'landlord') {
      // 地主阵营恰 1 人：地主 / 资本家互斥。
      const taken = [...this.players.values()].find(p => factionOf(p.role) === 'landlord' && p.id !== playerId);
      if (taken) return { error: '地主阵营已有玩家（地主/资本家互斥）' };
    } else {
      // 农民阵营可重复（farmer/investor/glutton），仅限人数上限。
      const farmers = [...this.players.values()].filter(p => factionOf(p.role) === 'farmer' && p.id !== playerId);
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
    const landlordSide = all.filter(p => factionOf(p.role) === 'landlord');
    const farmers = all.filter(p => factionOf(p.role) === 'farmer');
    if (all.some(p => !p.role)) return { error: '还有玩家未选择角色' };
    if (landlordSide.length !== 1) return { error: '需要恰好 1 名地主阵营玩家（地主或资本家）' };
    if (farmers.length < this.config.minFarmers) return { error: `至少需要 ${this.config.minFarmers} 名农民` };
    if (farmers.length > this.config.maxFarmers) return { error: `农民最多 ${this.config.maxFarmers} 名` };

    this.gameId = crypto.randomBytes(6).toString('hex');
    this.startedAt = Date.now();
    this.history = [];
    const opts = { mode: this.mode };
    // 竞技地主初始按花名册：农民阵营各自初始资金之和。
    const farmerTotal = farmers.reduce((s, p) => s + getInitialBalance(p.role, farmers.length, this.config, opts), 0);
    const g = this.config.competitive?.glutton;
    for (const p of all) {
      p.balance = getInitialBalance(p.role, farmers.length, this.config, { ...opts, farmerTotal });
      p.pool = getInitialPool(p.role, farmers.length, this.config); // 资本家资金池；非资本家 null
      p.bankrupt = false;
      p.pledge = 0;
      p.premium = 0;
      p.mealAllowance = 0;
      p.reflipsLeft = p.role === 'glutton' ? (g?.maxReflips ?? 0) : 0;
      p.usedReflipThisRound = false;
    }
    // 地主资金目标基准：仅地主（非资本家）才有考核。
    this.landlordInitial = this._landlord()?.role === 'landlord' ? (this._landlord()?.balance ?? 0) : 0;
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
    this.debtWaiver = 0;
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
      p.pool = null;          // 竞技角色技能状态清空
      p.pledge = 0;
      p.premium = 0;
      p.mealAllowance = 0;
      p.reflipsLeft = 0;
      p.usedReflipThisRound = false;
      p.passedReflip = false;
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
        negotiateConfirmed: false, spectator: false, emote: null,
        pool: null, pledge: 0, premium: 0, mealAllowance: 0, reflipsLeft: 0, usedReflipThisRound: false, passedReflip: false,
        ws: null,
      });
    }
    const all = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    // 竞技模式补满成「地主 + 三种农民各一」，方便用 V 键逐个附身、单人玩通新角色
    // （想测资本家：附身 0 号位、LOBBY 里改选资本家即可）。
    const roster = this.mode === 'competitive'
      ? ['landlord', 'investor', 'glutton', 'farmer']
      : ['landlord', 'farmer', 'farmer', 'farmer'];
    all.forEach((p, i) => { p.role = roster[i] ?? 'farmer'; });
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
    if (this._competitive) this._beginCompetitiveRound();
    this._autoActOffline();
    this._broadcastState();
    this._checkAllBet();
  }

  // 竞技每回合开始：清空本回合担保/保费/重掷标记，暴食者累积 1 点饭账（§8.2/8.4）。
  _beginCompetitiveRound() {
    this.debtWaiver = 0;
    const inc = this.config.competitive.glutton.allowancePerRound;
    for (const p of this._activePlayers()) {
      p.pledge = 0;
      p.premium = 0;
      p.usedReflipThisRound = false;
      p.passedReflip = false;
      if (p.role === 'glutton') p.mealAllowance += inc;
    }
  }

  placeBet(playerId, amount, count, pledge) {
    if (this.phase !== 'BETTING') return { error: '当前不是下注阶段' };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: '观战者不能下注' };
    if (this.bets[playerId] !== undefined) return { error: '已经下过注了' };
    // 竞技投资人：投保与下注同时提交（§8.3 手牌下保）。先扣保费，扣后余额才是下注校验基数。
    if (this._competitive && player.role === 'investor' && player.premium === 0
        && Number.isInteger(pledge) && pledge >= 1) {
      const n = Math.min(pledge, this.config.competitive.investor.maxPledge, player.balance);
      if (n >= 1) { player.pledge = n; player.premium = n; player.balance -= n; }
    }
    const check = validateBet({
      amount,
      balance: player.balance,
      role: player.role,
      farmerCount: this.roundFarmerIds.length,
      config: this.config,
      mode: this.mode,
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

  // 暴食者放弃本窗重掷（§8.4）：所有可重掷暴食者都放弃（或离线自动放弃）即进入结算。
  passReflip(playerId) {
    if (this.phase !== 'REFLIP') return { error: '当前不是重掷阶段' };
    const player = this.players.get(playerId);
    if (!player || player.role !== 'glutton' || !this._isActive(player)) return { error: '只有暴食者可以操作' };
    if (!this.roundFarmerIds.includes(playerId)) return { error: '本回合未参与' };
    player.passedReflip = true;
    this._broadcastState();
    this._checkReflipGate();
    return { ok: true };
  }

  _checkReflipGate() {
    if (this.phase !== 'REFLIP') return;
    const capable = this._reflipGluttons();
    const allPassed = capable.every(g => g.passedReflip || (!g.online && this.config.autoActForOffline));
    if (allPassed) this._enterSettle();
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
    if (this._competitive) this._lockInvestorPledges();
    this._flipAndAnimate();
  }

  // 汇总担保减债（§8.3）：保费已在 BETTING 投保时即扣，这里只累计本回合减债总额。
  _lockInvestorPledges() {
    let totalPremium = 0;
    for (const p of this._activePlayers()) {
      if (p.role === 'investor') totalPremium += (p.premium ?? 0);
    }
    this.debtWaiver = investorWaiver(totalPremium, this.config);
  }

  // 抛硬币 + 播放动画；动画结束后决定进入重掷窗或系统结算。重掷也复用此方法重播。
  _flipAndAnimate() {
    this._setPhase('COIN_FLIP');
    this.coinResult = flipCoin();
    this._broadcastState();
    this._after(this.config.timing.coinAnimMs, () => this._afterCoinFlip());
  }

  _afterCoinFlip() {
    // 竞技：农民输（heads）且仍有暴食者可重掷 → 进入 REFLIP 决策窗；否则系统结算。
    if (this._competitive && this.coinResult === 'heads' && this._reflipGluttons().length > 0) {
      this._enterReflip();
    } else {
      this._enterSettle();
    }
  }

  _enterReflip() {
    this._setPhase('REFLIP');
    for (const g of this._reflipGluttons()) g.passedReflip = false; // 新窗重置放弃标记
    this._broadcastState();
    // 决策窗：超时（或全部放弃）则进入结算（窗内暴食者可 request_reflip / pass_reflip）。
    this._after(this.config.timing.reflipDecisionMs, () => {
      if (this.phase === 'REFLIP') this._enterSettle();
    });
    this._autoActOffline(); // 离线暴食者自动放弃
  }

  // 暴食者请求重掷（§8.4）：消耗一次，标记本回合已重掷（决定伙食费是否清零），权威重掷并重播动画。
  requestReflip(playerId) {
    if (this.phase !== 'REFLIP') return { error: '当前不是重掷阶段' };
    const player = this.players.get(playerId);
    if (!player || player.role !== 'glutton' || !this._isActive(player)) return { error: '只有暴食者可以重掷' };
    if (!this.roundFarmerIds.includes(playerId)) return { error: '本回合未参与，不能重掷' };
    if (player.reflipsLeft <= 0) return { error: '重掷次数已用尽' };
    player.reflipsLeft -= 1;
    player.usedReflipThisRound = true;
    this._flipAndAnimate();
    return { ok: true };
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
      debtWaiver: this._competitive ? (this.debtWaiver ?? 0) : 0,
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
    // 缺口已在 settleRound 乘过乘数并扣减债；FINALIZE 直接复用其最终债额，避免重算口径分叉。
    const shortfall = this.coinResult === 'heads' ? (this.settlement.shortfall ?? 0) : 0;
    const uncovered = Math.max(0, shortfall - result.collected);

    // 地主资金目标（任务 6）：检查点回合的 FINALIZE 若地主未达标，扣除惩罚（资金沉没，可致破产）。
    let landlordPenalty = 0;
    let landlordGoalValue = null;
    let landlordGoalMet = null;
    if (this.config.landlordGoal?.enabled && landlordId && this.players.get(landlordId)?.role === 'landlord') {
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

    // === 竞技模式入账（§8）：资本家资金池换算、基础农民工资、暴食者伙食费。均在破产判定前。===
    let capitalistPool = null, capitalistTax = 0, capitalistPoolDelta = 0;
    const wagePaid = {}, allowanceCharged = {};
    if (this._competitive) {
      // 资本家：个人押注本金原封不动归还（个人净变动 0），净盈亏入资金池，再扣税；资金池才是血条。
      const cap = this._capitalist();
      if (cap && landlordId === cap.id) {
        const start = this.roundStartBalances[cap.id] ?? 0;
        capitalistPoolDelta = (result.after[cap.id] ?? 0) - start;
        result.after[cap.id] = start;          // 个人资金恒定
        result.deltas[cap.id] = 0;
        cap.pool = (cap.pool ?? 0) + capitalistPoolDelta;
        capitalistTax = computeTax(cap.pool, this.config);
        cap.pool -= capitalistTax;
        capitalistPool = cap.pool;
      }
      // 基础农民工资：按活跃农民数缩放，到点发薪给存活的基础农民。
      const { interval, amount } = computeWage(this.roundFarmerIds.length, this.config);
      if (wageDueThisRound(this.round, interval) && amount > 0) {
        for (const id of this.roundFarmerIds) {
          if (this.players.get(id)?.role === 'farmer') {
            result.after[id] = (result.after[id] ?? 0) + amount;
            result.deltas[id] = (result.deltas[id] ?? 0) + amount;
            wagePaid[id] = amount;
          }
        }
      }
      // 暴食者饭账：每回合累积成「饭账」（成本）。农民胜时从余额扣除并清零（允许扣到破产）；
      // 农民负则饭账继续累积——含重掷仍输也不清零（§8.4）。
      const farmersWon = this.coinResult === 'tails';
      for (const id of this.roundFarmerIds) {
        const p = this.players.get(id);
        if (!p || p.role !== 'glutton') continue;
        if (farmersWon && p.mealAllowance > 0) {
          result.after[id] = (result.after[id] ?? 0) - p.mealAllowance;
          result.deltas[id] = (result.deltas[id] ?? 0) - p.mealAllowance;
          allowanceCharged[id] = p.mealAllowance;
          p.mealAllowance = 0;
        }
      }
    }

    for (const [id, balance] of Object.entries(result.after)) {
      const p = this.players.get(id);
      if (p) p.balance = balance;
    }

    // 破产判定在惩罚扣除之后重算（惩罚可能直接压垮地主）。
    // 资本家用资金池判定（个人资金恒定不破产）；其余按余额。
    const newlyBankrupt = [];
    for (const id of [landlordId, ...this.roundFarmerIds]) {
      const p = this.players.get(id);
      if (!p || p.bankrupt) continue;
      const broke = p.role === 'capitalist'
        ? (p.pool ?? 0) <= this.config.bankruptcyThreshold
        : (result.after[id] ?? 0) <= this.config.bankruptcyThreshold;
      if (broke) { p.bankrupt = true; newlyBankrupt.push(id); }
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
      // 竞技模式回合记录（§8）：
      ...(this._competitive ? {
        debtWaiver: this.debtWaiver ?? 0,
        capitalistPool, capitalistTax, capitalistPoolDelta,
        wagePaid, allowanceCharged,
      } : {}),
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
    // 观战者（破产/降级）发言一律强制进观战频道：其有上帝视角，绝不能向活跃玩家泄露余额/暗注。
    if (player.bankrupt || player.spectator) channel = 'spectator';
    else if (channel === 'spectator') return { error: '只有观战者可以使用观战频道' };
    if (!this.config.channels.includes(channel)) return { error: '频道不存在' };
    if (channel === 'farmer' && factionOf(player.role) !== 'farmer') return { error: '只有农民阵营可以使用农民频道' };
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
    const isSpec = player.bankrupt || player.spectator;
    if (channel === 'spectator') return isSpec;                          // 观战频道：仅观战者可读（活跃玩家看不到）
    if (channel === 'farmer') return factionOf(player.role) === 'farmer' || isSpec; // 农民密谈：农民阵营 + 观战者
    return false;
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
      ? [...this.players.values()].filter(p => factionOf(p.role) === 'farmer').length
      : this.roundFarmerIds.length;

    // 基础农民工资进度（§8.2）：还剩几回合发薪、每次发多少（按当前活跃农民数缩放）。公开信息。
    let wageInfo = null;
    if (this._competitive && IN_GAME_PHASES.includes(this.phase)) {
      const m = Math.max(1, this._activeFarmers().length);
      const { interval, amount } = computeWage(m, this.config);
      const mod = this.round % interval;
      wageInfo = { interval, amount, roundsToNext: mod === 0 ? 0 : interval - mod };
    }

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
      // 竞技角色技能进度（§8.7 隐私边界）：担保/伙食费/资金池仅本人/观战可见；剩余重掷次数公开（施压）。
      ...(this._competitive ? {
        pledge: p.role === 'investor' ? ((p.id === viewerId || spectator || betsPublic) ? p.pledge : null) : null,
        reflipsLeft: p.role === 'glutton' ? p.reflipsLeft : null,
        usedReflip: p.role === 'glutton' ? p.usedReflipThisRound : null,
        mealAllowance: p.role === 'glutton' ? ((p.id === viewerId || spectator) ? p.mealAllowance : null) : null,
        pool: p.role === 'capitalist' ? ((p.id === viewerId || spectator) ? p.pool : null) : null,
        wage: p.role === 'farmer' ? wageInfo : null,
      } : {}),
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

    // 资本家 HUD（§8.6/8.7）：资金池/个人资金仅本人/观战可见；taxRate 公开（用于展示扣税规则）。
    const cap = this._capitalist();
    const capitalist = (this._competitive && cap && IN_GAME_PHASES.includes(this.phase)) ? {
      id: cap.id,
      personal: (viewerId === cap.id || spectator) ? cap.balance : null,
      pool: (viewerId === cap.id || spectator) ? cap.pool : null,
      taxRate: this.config.competitive.capitalist.taxRate,
      taxMin: this.config.competitive.capitalist.taxMin,
    } : null;

    const canNegotiateView = spectator || factionOf(viewer?.role) === 'farmer';
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
        ? betBounds({ balance: viewer.balance, role: viewer.role, farmerCount, config: this.config, mode: this.mode })
        : null,
      // 竞技自身技能状态（方便面板读取；隐私无碍——都是本人数据）：
      ...(this._competitive && viewer ? {
        pledge: viewer.pledge,
        premium: viewer.premium,
        pledgeMax: this.config.competitive.investor.maxPledge,
        mealAllowance: viewer.mealAllowance,
        reflipsLeft: viewer.reflipsLeft,
        passedReflip: viewer.passedReflip,
        pool: viewer.pool,
        wage: viewer.role === 'farmer' ? wageInfo : null,
      } : {}),
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
      coinResult: ['COIN_FLIP', 'REFLIP', ...PAYOUT_PHASES].includes(this.phase) ? this.coinResult : null,
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
      capitalist,
      // balancesAfter 会泄露他人余额绝对值，仅观战者/终局可见
      history: this.history.map(h => {
        if (spectator || this.phase === 'ENDED') return h;
        const { balancesAfter: _hidden, ...publicEntry } = h;
        // 资本家资金池绝对值/变动/税 仅资本家本人可见（与余额隐私一致）。
        if (this._competitive && viewer?.role !== 'capitalist') {
          const { capitalistPool: _p, capitalistTax: _t, capitalistPoolDelta: _d, ...pub } = publicEntry;
          return pub;
        }
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

  get _competitive() {
    return this.mode === 'competitive';
  }

  // 地主阵营的唯一玩家（地主 或 资本家）。结算/胜负判定都把它当作「地主侧」。
  _landlord() {
    return [...this.players.values()].find(p => factionOf(p.role) === 'landlord');
  }

  _capitalist() {
    return [...this.players.values()].find(p => p.role === 'capitalist');
  }

  // 活跃农民 = 农民阵营（farmer/investor/glutton）中未破产、未观战者。
  _activeFarmers() {
    return [...this.players.values()].filter(p => factionOf(p.role) === 'farmer' && !p.bankrupt && !p.spectator);
  }

  _activePlayers() {
    return [...this.players.values()].filter(p => factionOf(p.role) && !p.bankrupt && !p.spectator);
  }

  _isActive(player) {
    return !!factionOf(player.role) && !player.bankrupt && !player.spectator;
  }

  // 暴食者中仍可重掷者（活跃 + 本回合参与 + 尚有次数）。
  _reflipGluttons() {
    return this.roundFarmerIds
      .map(id => this.players.get(id))
      .filter(p => p && p.role === 'glutton' && this._isActive(p) && p.reflipsLeft > 0);
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
            mode: this.mode,
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
    } else if (this.phase === 'REFLIP') {
      this._checkReflipGate();
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
