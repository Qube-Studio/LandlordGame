// 房间状态机：服务端权威的唯一游戏状态来源（见 docs/GAME_SPEC.md §3、§5）。
// 阶段：LOBBY → DISCUSSION → BETTING → REVEAL → COIN_FLIP → SETTLE → NEGOTIATE → FINALIZE
//      → (回到 DISCUSSION 下一回合) 或 ENDED
// 分钱四子阶段 = SETTLE(系统结算) + NEGOTIATE(农民协商) + FINALIZE(正式结算) + 下一轮 DISCUSSION(农民讨论)。

import crypto from 'crypto';
import { roomConfig, getInitialBalance, getInitialPool, getMinStake, factionOf, capitalistWallet, summonCost } from './config.js';
import { getMode } from './modes/index.js';
import { flipCoin, betBounds, validateBet, settleRound, applyAllocation } from './logic/rules.js';
import { relativeGoal, goalPenalty, drawGoalInterval } from './logic/landlordGoal.js';
import { computeWage, wageDueThisRound, investorWaiver, computeTax, taxInterval, taxDueThisRound, judgeAccusation } from './logic/competitive.js';
import { createLedger, buildSettleScript, flowsFromParts } from './logic/payout.js';
import { wealthOf, pickExecutioner, compensationOf } from './logic/execution.js';
import { apportion } from './logic/apportion.js';
import { saveGameRecord } from './storage.js';
import { ERR, SYS, STEP_LABEL, ROLE_LABEL, MISC } from './text.js';

// 确定性 PRNG（mulberry32）：地主目标检查点间隔用它抽取，按局种子可复现（重连/回放一致）。
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// REFLIP = 竞技暴食者重掷决策窗（§8.4），夹在 COIN_FLIP 与 SETTLE 之间，仅农民输且有暴食者时出现。
// CHALLENGE = 竞技对质窗（§8.8），夹在 BETTING 与 REVEAL 之间，仅竞技且有农民凑得齐票时出现。
// EXECUTION = 本地实验处决窗（§3.9），默认/生产关闭；显式开启且本回合有新破产者时才出现。
export const PHASES = ['LOBBY', 'DISCUSSION', 'BETTING', 'CHALLENGE', 'REVEAL', 'COIN_FLIP', 'REFLIP', 'SETTLE', 'NEGOTIATE', 'FINALIZE', 'EXECUTION', 'ENDED'];

const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];
const IN_GAME_PHASES = ['DISCUSSION', 'BETTING', 'CHALLENGE', 'REVEAL', 'COIN_FLIP', 'REFLIP', ...PAYOUT_PHASES, 'EXECUTION'];

// 金额按 10/5/2/1 贪心分解后的张数（与客户端 game/notes.js decompose 一致）。
// 张数对所有人可见（任务：桌面堆叠露张数，下注阶段仍不露金额）。
function noteCount(amount) {
  let rest = Math.max(0, Math.floor(amount || 0));
  let c = 0;
  for (const d of [10, 5, 2, 1]) { c += Math.floor(rest / d); rest %= d; }
  return c;
}

export class Room {
  constructor(roomId, name, modeId, configOverrides = {}, { allowExecution = false } = {}) {
    this.roomId = roomId;
    this.name = name || MISC.defaultRoomName;
    this.mode = getMode(modeId)?.id ?? 'quick';
    this.config = roomConfig(this.mode, configOverrides);
    // 处决是保留的本地实验功能：配置请求和运行时能力必须同时为 true。
    // 生产入口不授予 allowExecution，因此伪造建房 config 也无法开启。
    this._allowExecution = allowExecution === true;
    this.config.execution = {
      ...(this.config.execution ?? {}),
      enabled: this._allowExecution && this.config.execution?.enabled === true,
    };
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
    this.betDeadline = null;       // 下注倒计时截止绝对时刻（timing.betMs；到点未下注自动押最小注）
    this.revealDeadline = null;    // 揭牌确认倒计时截止绝对时刻（timing.revealConfirmMs；到点自动全员确认）
    this.reflipDeadline = null;    // 重掷决策窗截止绝对时刻（timing.reflipDecisionMs；到点自动进结算）
    this.payout = null;            // 桌面显式结算（§3.8）：{script, piles, taken, eligible, after, …}
    this._stepSeq = 0;             // 编导脚本步骤自增 id（每回合重置）
    this.landlordInitial = 0;      // 地主开局资金（首个相对目标的基准）
    // 地主资金目标（相对制，逐检查点推进）：目标/间隔有状态，随余额动态重定基。
    this.goalTarget = 0;           // 当前须在下个检查点达到的目标额
    this.goalBaseline = 0;         // 本目标所依据的基准余额（上一检查点/开局的余额）
    this.goalPrevRound = 0;        // 上一检查点回合（0=开局）
    this.goalNextRound = 0;        // 下一检查点回合（0=无考核，如资本家）
    this.goalSeed = 0;             // 间隔 PRNG 种子（可复现）
    this._goalRng = null;          // 间隔 PRNG（由种子生成）
    // 对质/指控（§8.8）：本回合进行中的指控与上一次裁决；强制检查点 flag 在 CHALLENGE 置真、FINALIZE 消费。
    this.accusation = null;        // 交流窗进行中：{accuserId, targetId, dir?, deadline}；null=决定窗(IDLE)
    this.lastAccusation = null;    // 本回合已落定的指控裁决（贯穿 REVEAL/FINALIZE 显示，下回合清空）
    this.challengeDeadline = null; // 决定窗（15s）截止绝对时刻
    this._forceGoalCheckpoint = false; // 猜对地主 → FINALIZE 强制一次目标评估（不重定基）
    this._forceTax = false;            // 猜对资本家 → FINALIZE 强制额外扣一次税
    // 检察官·传唤（§8.9）：BETTING 置真、FINALIZE 消费——正式考核提前开庭（倍罚上缴国库 + 重定基/税钟归零）。
    this._summonGoal = false;          // 传唤地主 → 本回合目标按 penaltyMult 倍结算（罚进虚空）+ 重定基重抽间隔
    this._summonTax = false;           // 传唤资本家 → 本回合税按 penaltyMult 倍扣 + 税钟锚点归到本回合
    this.taxAnchorRound = 0;           // 资本家税钟锚点（0=开局；传唤重置到传唤回合）
    this.lastSummon = null;            // 本回合传唤事件 {byId, targetId, cost, round}（HUD 告警；下回合下注前清）
    this.roundFarmerIds = [];
    this.roundStartBalances = {};
    this.roundStartPools = {};     // 资本家池的回合初快照（处决赔偿口径：池子缩水，§3.9）
    this.execution = null;         // 处决窗状态 {queue, idx, targetId, executionerId, deadline, results[]}
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
    if (this.phase !== 'LOBBY') return { error: ERR.joinStarted };
    if (this.players.size >= 1 + this.config.maxFarmers) return { error: ERR.roomFull };

    const player = {
      id: crypto.randomBytes(4).toString('hex'),
      username,
      seat: this._seat++,
      role: null,
      balance: 0,
      bankrupt: false,
      online: true,
      ready: false,
      lobbyReady: false,  // 大厅准备标记（纯协调信号，不做开局门槛——房主自行掌握时机）
      confirmed: false,
      negotiateConfirmed: false,
      spectator: false,   // 断线超时降级观战（任务⑥）
      emote: null,        // 手动表情覆盖（任务⑧ 预留接口）
      // 竞技模式角色技能状态（§8；非竞技恒为默认值）：
      pool: null,             // 资本家资金池（血条）；非资本家为 null
      pledge: 0,              // 投资人本回合担保额（掷币前可改）
      premium: 0,             // 投资人本回合已扣保费（锁定后）
      mealAllowance: 0,       // 暴食者累积饭账（成本，农民胜时扣除）
      reflipsLeft: 0,         // 暴食者剩余重掷次数（每局；开局 = 农民阵营人数）
      reflipsMax: 0,          // 暴食者本局重掷总次数（HUD 进度条满格基准，随局固定）
      usedReflipThisRound: false,
      passedReflip: false,    // 暴食者本重掷窗已放弃
      tickets: 0,             // 对质票（每角色按局发放，§8.8；非竞技/地主阵营恒 0）
      challengeSkip: false,   // 对质决定窗：本农民已投票跳过
      summonsUsed: 0,         // 检察官本局已传唤次数（§8.9；递增费的指数）
      usedSummonThisRound: false, // 检察官本回合已传唤（回合 1 次上限 + 同回合不可再指控）
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
    if (!player) return { error: ERR.notInRoom };
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
    if (this.phase !== 'LOBBY') return { error: ERR.roleOnlyLobby };
    const player = this.players.get(playerId);
    if (!player) return { error: ERR.notInRoom };
    const mode = getMode(this.mode);
    if (!mode.roles.includes(role)) return { error: ERR.roleNotInMode };
    if (role === 'bank') return { error: ERR.bankNotOpen };
    const faction = factionOf(role);
    if (!faction) return { error: ERR.invalidRole };
    if (faction === 'landlord') {
      // 地主阵营恰 1 人：地主 / 资本家互斥。
      const taken = [...this.players.values()].find(p => factionOf(p.role) === 'landlord' && p.id !== playerId);
      if (taken) return { error: ERR.landlordTaken };
    } else {
      // 农民阵营可重复（farmer/investor/glutton），仅限人数上限。
      const farmers = [...this.players.values()].filter(p => factionOf(p.role) === 'farmer' && p.id !== playerId);
      if (farmers.length >= this.config.maxFarmers) return { error: ERR.farmersFull };
    }
    player.role = role;
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  startGame(playerId) {
    if (this.phase !== 'LOBBY') return { error: ERR.gameInProgress };
    if (playerId !== this.hostId) return { error: ERR.hostOnlyStart };
    const all = [...this.players.values()];
    const landlordSide = all.filter(p => factionOf(p.role) === 'landlord');
    const farmers = all.filter(p => factionOf(p.role) === 'farmer');
    if (all.some(p => !p.role)) return { error: ERR.someoneNoRole };
    if (all.some(p => !p.lobbyReady)) return { error: ERR.someoneNotReady }; // 全员准备才能开局（反馈①：准备=开局门槛）
    if (landlordSide.length !== 1) return { error: ERR.needOneLandlord };
    if (farmers.length < this.config.minFarmers) return { error: ERR.needFarmers(this.config.minFarmers) };
    if (farmers.length > this.config.maxFarmers) return { error: ERR.tooManyFarmers(this.config.maxFarmers) };

    this.gameId = crypto.randomBytes(6).toString('hex');
    this.startedAt = Date.now();
    this.history = [];
    const opts = { mode: this.mode };
    this.capFarmers = farmers.length;   // 花名册农民阵营人数：资本家动态钱包/资金池的固定基准（不随破产缩水）
    // 竞技地主初始按花名册：农民阵营各自初始资金之和。
    const farmerTotal = farmers.reduce((s, p) => s + getInitialBalance(p.role, farmers.length, this.config, opts), 0);
    const g = this.config.competitive?.glutton;
    for (const p of all) {
      p.balance = getInitialBalance(p.role, farmers.length, this.config, { ...opts, farmerTotal });
      p.pool = getInitialPool(p.role, farmers.length, this.config); // 资本家资金池；非资本家 null
      p.poolInitial = p.pool;   // 开局池量（资金池血条的满格基准，随局固定）
      // 开局个人资金（HUD 占比区基准，随局固定——下注中 balance 暂时下探，不能让占比抖动）
      p.personalInitial = p.role === 'capitalist' ? p.balance : null;
      p.bankrupt = false;
      p.lobbyReady = false;
      p.pledge = 0;
      p.premium = 0;
      p.mealAllowance = 0;
      // 暴食者重掷次数 = 农民阵营人数（硬上限 maxReflips；正常局 1~4 人 ≤ 4 即恒等农民数）。
      p.reflipsLeft = p.role === 'glutton' ? Math.min(farmers.length, g?.maxReflips ?? farmers.length) : 0;
      p.reflipsMax = p.reflipsLeft;
      p.usedReflipThisRound = false;
      // 对质票按角色**按局**发放（仅竞技农民阵营；地主阵营/快速模式恒 0）。之后不每回合重置，可 NEGOTIATE 转赠。
      p.tickets = this.mode === 'competitive' ? (this.config.competitive.accusation?.tickets?.[p.role] ?? 0) : 0;
      p.challengeSkip = false;
      p.summonsUsed = 0;
      p.usedSummonThisRound = false;
    }
    // 对质/传唤状态归零（新局）：进行中指控/裁决/强制检查点 flag/税钟锚点。
    this.accusation = null;
    this.lastAccusation = null;
    this._forceGoalCheckpoint = false;
    this._forceTax = false;
    this._summonGoal = false;
    this._summonTax = false;
    this.taxAnchorRound = 0;
    this.lastSummon = null;
    // 地主资金目标基准：仅地主（非资本家）才有考核。相对制：开局定第一个目标与随机检查点。
    this.landlordInitial = this._landlord()?.role === 'landlord' ? (this._landlord()?.balance ?? 0) : 0;
    if (this.config.landlordGoal?.enabled && this.landlordInitial > 0) {
      this.goalSeed = crypto.randomBytes(4).readUInt32LE(0);
      this._goalRng = mulberry32(this.goalSeed);
      this.goalBaseline = this.landlordInitial;
      this.goalTarget = relativeGoal(this.landlordInitial, this.config);
      this.goalPrevRound = 0;
      this.goalNextRound = drawGoalInterval(this._goalRng, this.config);
    } else {
      this.goalTarget = 0; this.goalBaseline = 0; this.goalPrevRound = 0; this.goalNextRound = 0; this._goalRng = null;
    }
    this.round = 1;
    this._enterDiscussion();
    return { ok: true };
  }

  // 再来一局：回到大厅并清空所有角色，让每个人重新选（任务⑤：之前会立即沿用旧角色开局，身份被锁死）。
  restartGame(playerId) {
    if (this.phase !== 'ENDED') return { error: ERR.gameNotEnded };
    if (playerId !== this.hostId) return { error: ERR.hostOnlyRestart };
    this._resetToLobby();
    return { ok: true, backToLobby: true };
  }

  // 回大厅重置：房主手动「再来一局」与终局演出后自动回大厅（§阶段七）共用同一套清场逻辑。
  _resetToLobby() {
    this._setPhase('LOBBY');
    this.round = 0;
    this.gameId = null;
    this.startedAt = null;
    this.bets = {};
    this.coinResult = null;
    this.settlement = null;
    this.allocation = null;
    this.negotiateDeadline = null;
    this.betDeadline = null;
    this.revealDeadline = null;
    this.reflipDeadline = null;
    this.payout = null;
    this._stepSeq = 0;
    this.execution = null;
    this.roundStartPools = {};
    this.winnerSide = null;
    this.endReason = null;
    this.endedReturnAt = null;
    this.debtWaiver = 0;
    this.history = [];
    this._clearGraceTimers();
    for (const p of this.players.values()) {
      p.role = null;          // 清空角色，重新选
      p.balance = 0;
      p.bankrupt = false;
      p.spectator = false;    // 解除观战降级，可重新参战
      p.ready = false;
      p.lobbyReady = false;
      p.confirmed = false;
      p.negotiateConfirmed = false;
      p.emote = null;
      p.pool = null;          // 竞技角色技能状态清空
      p.poolInitial = null;
      p.personalInitial = null;
      p.pledge = 0;
      p.premium = 0;
      p.mealAllowance = 0;
      p.reflipsLeft = 0;
      p.reflipsMax = 0;
      p.usedReflipThisRound = false;
      p.passedReflip = false;
      p.tickets = 0;
      p.challengeSkip = false;
      p.summonsUsed = 0;
      p.usedSummonThisRound = false;
    }
    this.accusation = null;
    this.lastAccusation = null;
    this._forceGoalCheckpoint = false;
    this._forceTax = false;
    this._summonGoal = false;
    this._summonTax = false;
    this.taxAnchorRound = 0;
    this.lastSummon = null;
    this._broadcastState();
  }

  // ---------- 本地测试辅助（仅 index.js 在 LLG_TEST 开启时调用，任务③） ----------

  // 把房间补满真实测试玩家并自动配好阵容（首位=地主，其余=农民），关闭自动代离线行动——
  // 全部交给测试者用 possess 逐个手动操控，实现单人玩通全部角色。
  devFill() {
    if (this.phase !== 'LOBBY') return { error: ERR.devFillLobbyOnly };
    const target = Math.min(1 + this.config.maxFarmers, 4); // 1 地主 + 3 农民
    let n = this.players.size;
    while (this.players.size < target) {
      n += 1;
      const id = crypto.randomBytes(4).toString('hex');
      this.players.set(id, {
        id, username: MISC.devPlayerPrefix + n, seat: this._seat++, role: null,
        balance: 0, bankrupt: false, online: true, ready: false, confirmed: false,
        negotiateConfirmed: false, spectator: false, emote: null,
        pool: null, pledge: 0, premium: 0, mealAllowance: 0, reflipsLeft: 0, reflipsMax: 0, usedReflipThisRound: false, passedReflip: false,
        tickets: 0, challengeSkip: false, summonsUsed: 0, usedSummonThisRound: false,
        ws: null,
      });
    }
    const all = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    // 竞技模式补满成「地主 + 三种农民各一」，方便用 V 键逐个附身、单人玩通新角色
    // （想测资本家：附身 0 号位、LOBBY 里改选资本家即可）。
    const roster = this.mode === 'competitive'
      ? ['landlord', 'investor', 'glutton', 'farmer']
      : ['landlord', 'farmer', 'farmer', 'farmer'];
    // 全员配好角色并**自动准备**（反馈①：加了「全员准备」开局门槛后，测试仍一键可开——房主直接按 S）
    all.forEach((p, i) => { p.role = roster[i] ?? 'farmer'; p.lobbyReady = true; });
    this.config.autoActForOffline = false; // 测试：不自动代离线，全部手动切换控制
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  // 强制处决窗（§3.9 快速验证入口，仅 LLG_TEST）：伪造 n 个破产者直接开窗——
  // 活跃农民取最穷优先；withLandlord 把地主侧也拉入（混合队列：换行刑者/被赦接棒/连发全场景）。
  // 当前财富快照为「回合初」、余额/池打到 0 → 赔偿价码=原财富，真实为正。
  devForceExecution({ targets = 1, withLandlord = false } = {}) {
    if (!this._allowExecution || this.config.execution?.enabled !== true) return { error: ERR.devExecutionDisabled };
    if (!IN_GAME_PHASES.includes(this.phase)) return { error: ERR.devExecInGameOnly };
    const picked = this._activeFarmers()
      .sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))
      .slice(0, Math.max(1, Math.min(3, targets)));
    if (withLandlord) {
      const lord = this._landlord();
      if (lord && !lord.bankrupt) picked.push(lord);
    }
    if (picked.length === 0) return { error: ERR.devExecInGameOnly };
    for (const p of picked) {
      if (p.role === 'capitalist') {
        this.roundStartPools[p.id] = p.pool > 0 ? p.pool : 20;
        p.pool = 0;
      } else {
        this.roundStartBalances[p.id] = p.balance > 0 ? p.balance : 8;
        p.balance = 0;
      }
    }
    // 伪造最小 payout（_maybeEnterExecution 只读 newlyBankrupt；EXECUTION 不在 PAYOUT_PHASES，不外泄）
    this.payout = { ...(this.payout ?? {}), newlyBankrupt: picked.map(p => p.id), done: true, eligible: [], taken: new Set(), piles: {}, script: [], deadline: null };
    this._maybeEnterExecution();
    return { ok: true };
  }

  // 把控制 socket 转移到目标玩家（附身）：旧占用者解绑 ws（仍 online，待被再次附身）。
  possess(ws, playerId) {
    const target = this.players.get(playerId);
    if (!target) return { error: ERR.possessNoTarget };
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
    this.betDeadline = null;
    this.revealDeadline = null;
    this.reflipDeadline = null;
    this.payout = null;
    this._stepSeq = 0;
    for (const p of this.players.values()) {
      p.ready = false;
      p.confirmed = false;
      p.negotiateConfirmed = false;
      p.emote = null;       // 手动表情每回合清空
      p.challengeSkip = false; // 对质跳过投票每回合清空
      p.usedSummonThisRound = false; // 传唤回合上限每回合清空（summonsUsed 按局累计不清）
    }
    // 上一回合的对质裁决/传唤/强制检查点 flag 到此清空（本回合 REVEAL/FINALIZE 才需看到，已过去）。
    this.accusation = null;
    this.lastAccusation = null;
    this._forceGoalCheckpoint = false;
    this._forceTax = false;
    this._summonGoal = false;
    this._summonTax = false;
    this.lastSummon = null;
    this.challengeDeadline = null;
    this._broadcastState();
    // 短喘息（反馈②）：进讨论后到点 discussionMs **自动**进下注——纯过场喘息，玩家端无「准备/跳过」入口。
    // 仍保留 ready 门槛：仅供**离线全员自动代准备**时即时推进（无在线人观看，无需等喘息）。discussionMs=0 回退旧门槛。
    this._checkGate('ready', () => this._enterBetting());
    const ms = this.config.timing.discussionMs;
    if (ms > 0) this._after(ms, () => { if (this.phase === 'DISCUSSION') this._enterBetting(); });
  }

  // 手动设置表情（任务⑧ 预留接口）：null 清除，其余须为允许的手动表情之一。
  // 客户端目前不暴露 UI，后续接面板时直接发 { type:'set_emote', emote } 即可。
  setEmote(playerId, emote) {
    const player = this.players.get(playerId);
    if (!player) return { error: ERR.notInRoom };
    const allowed = ['idle', 'ready', 'bet', 'win', 'lose'];
    if (emote !== null && !allowed.includes(emote)) return { error: ERR.badEmote };
    player.emote = emote;
    this._broadcastState();
    return { ok: true };
  }

  setReady(playerId) {
    if (this.phase !== 'DISCUSSION') return { error: ERR.notDiscussion };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: ERR.spectatorNoReady };
    player.ready = true;
    this._broadcastState();
    this._checkGate('ready', () => this._enterBetting());
    return { ok: true };
  }

  // 大厅准备标记（UI 阶段二）：可反复切换的协调信号，让房主看到谁就绪了；
  // 不做开局门槛（startGame 不检查），房主自行掌握时机。
  setLobbyReady(playerId, ready) {
    if (this.phase !== 'LOBBY') return { error: ERR.lobbyReadyOnly };
    const player = this.players.get(playerId);
    if (!player) return { error: ERR.notInRoom };
    if (!player.role) return { error: ERR.pickRoleFirst };
    player.lobbyReady = !!ready;
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  _enterBetting() {
    this._setPhase('BETTING');
    this.bets = {};
    this.betCounts = {};
    this.roundFarmerIds = this._activeFarmers().map(p => p.id);
    this.roundStartBalances = {};
    this.roundStartPools = {};
    for (const p of this._activePlayers()) {
      this.roundStartBalances[p.id] = p.balance;
      if (p.pool != null) this.roundStartPools[p.id] = p.pool; // 资本家池快照（处决赔偿口径，§3.9）
    }
    if (this._competitive) this._beginCompetitiveRound();
    // 下注倒计时（timing.betMs）：到点仍未下注者自动押最小注，AFK 不拖全场（_setPhase 清计时器，不会跨相位误触发）。
    const betMs = this.config.timing.betMs;
    this.betDeadline = betMs > 0 ? Date.now() + betMs : null;
    if (betMs > 0) this._after(betMs, () => this._forceBetPending());
    this._autoActOffline();
    this._broadcastState();
    this._checkAllBet();
  }

  // 给一名未下注玩家自动押最小注（强全押区间则全押）：离线代打与下注超时共用。
  _autoBetMin(p) {
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

  // 下注超时：仍未下注的活跃玩家全部自动押最小注并推进。
  _forceBetPending() {
    if (this.phase !== 'BETTING') return;
    const pending = this._activePlayers().filter(p => this.bets[p.id] === undefined);
    if (pending.length === 0) return;
    for (const p of pending) this._autoBetMin(p);
    this._systemChat(SYS.betTimeout(pending.map(p => p.username).join('、')));
    this._broadcastState();
    this._checkAllBet();
  }

  // 竞技每回合开始：清空本回合担保/保费/重掷标记，暴食者累积 1 点饭账（§8.2/8.4）；
  // 资本家动态钱包按当前池重算（§8.6）。此方法在 _enterBetting 捕获 roundStartBalances **之后**调用，
  // 故重设钱包后须同步覆盖 roundStartBalances[cap]，否则 FINALIZE「本金归还」会还原到旧钱包、poolDelta 算错。
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
    // 资本家动态钱包：可下注额 = 6n + round(当前池×0.1)，每回合按当前池重算（藏池→L 不可预测=技巧地基）。
    const cap = this._capitalist();
    if (cap && this._isActive(cap)) {
      cap.balance = capitalistWallet(cap.pool ?? 0, this.capFarmers, this.config);
      cap.personalInitial = cap.balance;             // HUD 满格基准 = 本回合钱包（下注中 balance 下探不抖）
      this.roundStartBalances[cap.id] = cap.balance; // 本金归还目标对齐新钱包（FINALIZE result.after[cap]=start）
    }
  }

  placeBet(playerId, amount, count, pledge) {
    if (this.phase !== 'BETTING') return { error: ERR.notBetting };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: ERR.spectatorNoBet };
    if (this.bets[playerId] !== undefined) return { error: ERR.alreadyBet };
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
    if (pending.length === 0) {
      // 竞技且有农民凑得齐票 → 进对质窗；否则（快速模式/无人有票）直接揭牌，不空耗 15s。
      if (this._competitive && this._anyFarmerCanAccuse()) {
        this._enterChallenge();
      } else {
        // 跳过要有播报（否则像 UI 消失的 BUG）：仅当有人「本可以但不能」时提示——
        // 手里还剩票但不够 cost，或检察官本回合已传唤；全 0 票（如纯暴食者阵容）不聒噪。
        if (this._competitive) {
          const farmers = this._roundFarmers();
          if (farmers.some(f => (f.tickets ?? 0) > 0 || f.usedSummonThisRound)) {
            this._systemChat(SYS.challengeSkipped);
          }
        }
        this._enterReveal();
      }
    }
  }

  // ---------- 对质 / 指控（§8.8，竞技专属，夹在 BETTING 与 REVEAL 之间） ----------

  // 本回合参与的活跃农民（roundFarmerIds ∩ 活跃）。跳过闸门/可指控判定/跳过重置都用它。
  _roundFarmers() {
    return this.roundFarmerIds.map(id => this.players.get(id)).filter(p => p && this._isActive(p));
  }

  _anyFarmerCanAccuse() {
    const cost = this.config.competitive.accusation?.cost ?? 2;
    // 已传唤的检察官同回合不可对质（§8.9）——若他是唯一有票的农民，别开一扇没人能用的 15s 空窗。
    return this._roundFarmers().some(f => (f.tickets ?? 0) >= cost && !f.usedSummonThisRound);
  }

  _enterChallenge() {
    this._setPhase('CHALLENGE');
    this.lastAccusation = null;
    for (const p of this._roundFarmers()) p.challengeSkip = false;
    this._armChallengeWindow();  // 置 accusation=null + 决定窗 deadline + 15s 计时
    this._broadcastState();
    this._autoActOffline();      // 离线农民自动投跳过
  }

  // 决定窗（IDLE）：清 accusation、重挂 15s 计时。cancel 也复用它回到决定窗。
  _armChallengeWindow() {
    this._clearTimers();
    this.accusation = null;
    const ms = this.config.timing.challengeMs;
    this.challengeDeadline = ms > 0 ? Date.now() + ms : null;
    if (ms > 0) this._after(ms, () => {
      if (this.phase === 'CHALLENGE' && !this.accusation) this._enterReveal();
    });
  }

  // 检察官·传唤（§8.9）：下注阶段、自己下注前、每回合 1 次、不限总次数。
  // 花 round(农民数 × 1.5^已传次数) 进虚空 → 正式考核**提前开庭**：本回合 FINALIZE 按 penaltyMult 倍
  // 结算敌方制约（地主目标罚/资本家税），罚款**上缴国库**（进虚空，不分农民——切断自供血），
  // 然后重定基+重抽间隔（税钟锚点归到本回合）。免猜、必然开庭；同回合不可再发起对质。
  summon(playerId) {
    if (!this._competitive) return { error: ERR.summonCompetitiveOnly };
    if (this.phase !== 'BETTING') return { error: ERR.summonBettingOnly };
    const actor = this.players.get(playerId);
    if (!actor || actor.role !== 'prosecutor' || !this._isActive(actor)) return { error: ERR.summonProsecutorOnly };
    if (!this.roundFarmerIds.includes(playerId)) return { error: ERR.notInRound };
    if (this.bets[playerId] != null) return { error: ERR.summonBeforeBet };
    if (actor.usedSummonThisRound) return { error: ERR.summonUsed };
    if (this._summonGoal || this._summonTax) return { error: ERR.summonExists };
    const target = this._landlord();
    if (!target || !this._isActive(target)) return { error: ERR.summonBadTarget };
    const cost = summonCost(this.roundFarmerIds.length, actor.summonsUsed, this.config);
    const minStake = getMinStake(actor.role, this.roundFarmerIds.length, this.config, { mode: this.mode });
    if (actor.balance < cost + minStake) return { error: ERR.summonNoFunds(cost) };
    actor.balance -= cost;                 // 传唤费当场进虚空（下注上下界随余额即时收缩）
    actor.summonsUsed += 1;
    actor.usedSummonThisRound = true;
    if (target.role === 'landlord') this._summonGoal = true;
    else this._summonTax = true;
    this.lastSummon = { byId: playerId, targetId: target.id, cost, round: this.round };
    this._systemChat(SYS.summon(actor.username, cost, target.username, ROLE_LABEL[target.role] ?? MISC.landlordFallback));
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  // 发起指控（决定窗）：恒扣 cost 票（任何情况不返还），开交流窗（≤accuseDeliberateMs），等 accuseResolve/accuseCancel。
  accuse(playerId, targetId) {
    if (this.phase !== 'CHALLENGE') return { error: ERR.notChallenge };
    if (this.accusation) return { error: ERR.accuseInProgress };
    const actor = this.players.get(playerId);
    if (!actor || factionOf(actor.role) !== 'farmer' || !this._isActive(actor)) return { error: ERR.accuseFarmersOnly };
    if (!this.roundFarmerIds.includes(playerId)) return { error: ERR.notInRound };
    if (actor.usedSummonThisRound) return { error: ERR.summonBlocksAccuse }; // §8.9 同回合互斥
    const cost = this.config.competitive.accusation?.cost ?? 2;
    if ((actor.tickets ?? 0) < cost) return { error: ERR.noTickets };
    const target = this.players.get(targetId);
    if (!target || factionOf(target.role) !== 'landlord' || !this._isActive(target)) return { error: ERR.accuseBadTarget };
    actor.tickets -= cost; // 立即扣，之后一律不返还
    this._clearTimers();
    const ms = this.config.timing.accuseDeliberateMs;
    const deadline = ms > 0 ? Date.now() + ms : null;
    this.accusation = { accuserId: playerId, targetId, deadline };
    this.challengeDeadline = deadline;
    // 交流窗超时 → 自动取消并直接揭牌（整段硬上限，不回决定窗）。
    if (ms > 0) this._after(ms, () => {
      if (this.phase === 'CHALLENGE' && this.accusation?.accuserId === playerId) {
        this.accusation = null;
        this._enterReveal();
      }
    });
    this._systemChat(SYS.accuse(actor.username, cost, target.username, ROLE_LABEL[target.role] ?? MISC.landlordFallback));
    this._broadcastState();
    return { ok: true };
  }

  // 预选方向（交流窗、仅发起者，§8.8 两段确认第一击）：只记 pendingDir 并广播（农民阵营可见——
  // 队友同步看到「哪个符号变大」），不判定。再点同一方向（accuseResolve）才落定。可反复改选。
  accusePick(playerId, dir) {
    if (this.phase !== 'CHALLENGE') return { error: ERR.notChallenge };
    const acc = this.accusation;
    if (!acc || acc.accuserId !== playerId) return { error: ERR.noActiveAccuse };
    if (dir !== 'more' && dir !== 'less') return { error: ERR.badAccuseDir };
    acc.pendingDir = dir;
    this._broadcastState();
    return { ok: true };
  }

  // 落定指控（交流窗、仅发起者）：判定敌方暗注 vs 农民阵营总注，猜对置强制检查点 flag，进揭牌。
  accuseResolve(playerId, dir) {
    if (this.phase !== 'CHALLENGE') return { error: ERR.notChallenge };
    const acc = this.accusation;
    if (!acc || acc.accuserId !== playerId) return { error: ERR.noActiveAccuse };
    if (dir !== 'more' && dir !== 'less') return { error: ERR.badAccuseDir };
    const targetBet = this.bets[acc.targetId] ?? 0;
    const factionTotal = this.roundFarmerIds.reduce((s, id) => s + (this.bets[id] ?? 0), 0);
    const correct = judgeAccusation(targetBet, factionTotal, dir);
    this.lastAccusation = { accuserId: playerId, targetId: acc.targetId, dir, correct, targetBet, factionTotal };
    if (correct) {
      const t = this.players.get(acc.targetId);
      if (t?.role === 'landlord') this._forceGoalCheckpoint = true;       // 强制一次目标评估（FINALIZE 消费，不重定基）
      else if (t?.role === 'capitalist') this._forceTax = true;           // 强制额外扣一次税
    }
    const target = this.players.get(acc.targetId);
    this._systemChat(correct
      ? SYS.accuseHit(target?.username ?? MISC.enemyFallback)
      : SYS.accuseMiss(this.players.get(playerId)?.username ?? MISC.accuserFallback));
    this.accusation = null;
    this._broadcastState();
    this._enterReveal();
    return { ok: true };
  }

  // 取消指控（交流窗、仅发起者）：票不返还，回到决定窗（重置 15s 与跳过投票）。
  accuseCancel(playerId) {
    if (this.phase !== 'CHALLENGE') return { error: ERR.notChallenge };
    const acc = this.accusation;
    if (!acc || acc.accuserId !== playerId) return { error: ERR.noActiveAccuse };
    for (const p of this._roundFarmers()) p.challengeSkip = false;
    this._armChallengeWindow();
    this._systemChat(SYS.accuseCancel);
    this._broadcastState();
    return { ok: true };
  }

  // 投票跳过对质（决定窗、活跃农民）：全体农民同意跳过（离线自动满足）即揭牌。
  challengeSkip(playerId) {
    if (this.phase !== 'CHALLENGE') return { error: ERR.notChallenge };
    if (this.accusation) return { error: ERR.skipBlocked };
    const actor = this.players.get(playerId);
    if (!actor || factionOf(actor.role) !== 'farmer' || !this._isActive(actor)) return { error: ERR.skipFarmersOnly };
    if (!this.roundFarmerIds.includes(playerId)) return { error: ERR.notInRound };
    actor.challengeSkip = true;
    this._broadcastState();
    this._checkChallengeSkipGate();
    return { ok: true };
  }

  _checkChallengeSkipGate() {
    if (this.phase !== 'CHALLENGE' || this.accusation) return;
    const farmers = this._roundFarmers();
    const allSkip = farmers.every(f => f.challengeSkip || (!f.online && this.config.autoActForOffline));
    if (allSkip) this._enterReveal();
  }

  // 暴食者放弃本窗重掷（§8.4）：所有可重掷暴食者都放弃（或离线自动放弃）即进入结算。
  passReflip(playerId) {
    if (this.phase !== 'REFLIP') return { error: ERR.notReflip };
    const player = this.players.get(playerId);
    if (!player || player.role !== 'glutton' || !this._isActive(player)) return { error: ERR.gluttonOnly };
    if (!this.roundFarmerIds.includes(playerId)) return { error: ERR.notInRound };
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
    // 确认倒计时（timing.revealConfirmMs）：到点未确认的自动确认、直接进掷币——确认只是节奏闸门，不该拖场。
    const ms = this.config.timing.revealConfirmMs;
    this.revealDeadline = ms > 0 ? Date.now() + ms : null;
    if (ms > 0) this._after(ms, () => this._forceConfirmReveal());
    this._broadcastState();
    this._checkGate('confirmed', () => this._enterCoinFlip());
  }

  _forceConfirmReveal() {
    if (this.phase !== 'REVEAL') return;
    for (const p of this._activePlayers()) p.confirmed = true;
    this._enterCoinFlip();
  }

  confirmReveal(playerId) {
    if (this.phase !== 'REVEAL') return { error: ERR.notReveal };
    const player = this.players.get(playerId);
    if (!player || !this._isActive(player)) return { error: ERR.spectatorNoConfirm };
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
    const ms = this.config.timing.reflipDecisionMs;
    this.reflipDeadline = ms > 0 ? Date.now() + ms : null; // 决策窗倒计时（浮字显示,同 bet/revealDeadline 模式）
    this._broadcastState();
    // 决策窗：超时（或全部放弃）则进入结算（窗内暴食者可 request_reflip / pass_reflip）。
    this._after(ms, () => {
      if (this.phase === 'REFLIP') this._enterSettle();
    });
    this._autoActOffline(); // 离线暴食者自动放弃
  }

  // 暴食者请求重掷（§8.4）：消耗一次，标记本回合已重掷（决定伙食费是否清零），权威重掷并重播动画。
  requestReflip(playerId) {
    if (this.phase !== 'REFLIP') return { error: ERR.notReflip };
    const player = this.players.get(playerId);
    if (!player || player.role !== 'glutton' || !this._isActive(player)) return { error: ERR.gluttonOnlyReflip };
    if (!this.roundFarmerIds.includes(playerId)) return { error: ERR.notInRoundReflip };
    if (player.reflipsLeft <= 0) return { error: ERR.reflipExhausted };
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
      landlordRole: this._landlord()?.role,   // 地主侧角色决定 greed/squeeze/rake（§3.5）
      farmerIds: this.roundFarmerIds,
      config: this.config,
      debtWaiver: this._competitive ? (this.debtWaiver ?? 0) : 0,
    });
    this.allocation = {
      takes: { ...this.settlement.takes },
      debts: { ...this.settlement.debts },
    };
    // 桌面显式结算（§3.8）：生成聚拢/分堆编导脚本。钱堆此刻只是「摆出来的方案」，
    // FINALIZE 才收账/调整，拿取才入账（REFLIP 窗在 SETTLE 之前，本方法每回合只进一次）。
    this.payout = {
      script: buildSettleScript({
        settlement: this.settlement,
        bets: this.bets,
        landlordId: this._landlord()?.id,
        farmerIds: this.roundFarmerIds,
      }, () => ++this._stepSeq),
      piles: null,          // FINALIZE 前由 viewFor 按方案/协商推导；FINALIZE 起为权威值
      taken: new Set(),
      eligible: [],
      after: null,
      newlyBankrupt: [],
      deadline: null,
      done: false,
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
    if (this.phase !== 'NEGOTIATE') return { error: ERR.notNegotiate };
    if (!Number.isInteger(amount) || amount <= 0) return { error: ERR.transferNotPositive };
    if (playerId === toId) return { error: ERR.transferSelf };
    if (!this.roundFarmerIds.includes(playerId) || !this.roundFarmerIds.includes(toId)) {
      return { error: ERR.transferRoundFarmersOnly };
    }
    const pool = kind === 'debt' ? this.allocation.debts : this.allocation.takes;
    if ((pool[playerId] ?? 0) < amount) return { error: ERR.transferInsufficient };
    // 债务可以全部压给某个农民使其破产（任务 7）：不再校验对方余额是否承担得起。
    // 落账时该农民只付出其全部余额（applyAllocation 取 min(债务, 余额)），地主只收到这点钱。
    pool[playerId] -= amount;
    pool[toId] = (pool[toId] ?? 0) + amount;
    for (const p of this.players.values()) p.negotiateConfirmed = false; // 方案变动，重置确认
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  // 对质票转赠（§8.8）：搭在 NEGOTIATE 阶段——农民把票给队友（信任/分歧的杠杆）。与钱/债转移同样重置确认。
  transferTicket(playerId, toId, n) {
    if (this.phase !== 'NEGOTIATE') return { error: ERR.notNegotiate };
    if (!Number.isInteger(n) || n <= 0) return { error: ERR.ticketNotPositive };
    if (playerId === toId) return { error: ERR.transferSelf };
    if (!this.roundFarmerIds.includes(playerId) || !this.roundFarmerIds.includes(toId)) {
      return { error: ERR.ticketRoundFarmersOnly };
    }
    const from = this.players.get(playerId);
    const to = this.players.get(toId);
    if (!from || !to || factionOf(from.role) !== 'farmer' || factionOf(to.role) !== 'farmer') {
      return { error: ERR.ticketFarmersOnly };
    }
    if ((from.tickets ?? 0) < n) return { error: ERR.noTickets };
    from.tickets -= n;
    to.tickets = (to.tickets ?? 0) + n;
    for (const p of this.players.values()) p.negotiateConfirmed = false; // 方案变动，重置确认
    this._touch();
    this._broadcastState();
    return { ok: true };
  }

  negotiateConfirm(playerId, confirmed) {
    if (this.phase !== 'NEGOTIATE') return { error: ERR.notNegotiate };
    if (!this.roundFarmerIds.includes(playerId)) return { error: ERR.confirmRoundFarmersOnly };
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

    // === 桌面台账（§3.8）：起点 = 协商定稿的桌面（农民圈 = takes，地主圈 = landlordTake）。===
    // 之后每笔机制入账都同步产出一条 adjust 步（flows 标注堆/手来源）供客户端通用演出；
    // 台账保证恒等式 pile[id] === after[id] − (balanceNow[id] − handDebit[id])。
    const ledger = createLedger({
      ...Object.fromEntries(this.roundFarmerIds.map(id => [id, this.allocation.takes[id] ?? 0])),
      ...(landlordId ? { [landlordId]: this.settlement.landlordTake } : {}),
    });
    const steps = [];
    const nextId = () => ++this._stepSeq;

    // 双倍补偿精确入账（任务 8）：地主胜且桌面不足目标时，按最终（可能经协商的）债务实际收齐的
    // 部分重算缺口，使展示与入账一致——地主拿到 pot + 实际补偿，剩余无人能付的即 uncovered。
    // 缺口已在 settleRound 乘过乘数并扣减债；FINALIZE 直接复用其最终债额，避免重算口径分叉。
    const shortfall = this.coinResult === 'heads' ? (this.settlement.shortfall ?? 0) : 0;
    const uncovered = Math.max(0, shortfall - result.collected);
    // 每人未偿债务（分配债 − 实付）：处决窗焦点排序键的一半（§3.9：债务=本回合损失+未偿）
    this._roundDebtUnpaid = {};
    for (const id of this.roundFarmerIds) {
      const owed = this.allocation?.debts?.[id] ?? 0;
      const paid = result.paidBy?.[id] ?? 0;
      if (owed - paid > 0) this._roundDebtUnpaid[id] = owed - paid;
    }

    // ① 债务收账：各农民实付 → 地主堆；付不起的部分（uncovered）红色债务牌就地熄灭。
    if (landlordId) {
      const collectFlows = [];
      for (const id of this.roundFarmerIds) {
        const paid = result.paidBy?.[id] ?? 0;
        if (paid <= 0) continue;
        for (const part of ledger.debit(id, paid)) {
          collectFlows.push({ from: { kind: part.kind, id }, to: { kind: 'pile', id: landlordId }, amount: part.amount });
        }
      }
      if (collectFlows.length > 0 || uncovered > 0) {
        ledger.credit(landlordId, result.collected);
        steps.push({ id: nextId(), t: 'adjust', source: 'debtCollect', label: STEP_LABEL.debtCollect, flows: collectFlows, uncovered });
      }
    }

    // ② 地主资金目标（任务 6）：检查点回合的 FINALIZE 若地主未达标，扣除惩罚（资金沉没，可致破产）。
    //    对质命中地主（§8.8）→ _forceGoalCheckpoint：本回合额外触发一次评估，但**不重定基**（不重置间隔）。
    //    检察官传唤（§8.9）→ _summonGoal：正式考核**提前开庭**——按 penaltyMult 倍罚且罚款**上缴国库**
    //    （进虚空、不分农民），并像排期检查点一样重定基+重抽间隔。同回合三者并存只评估一次，传唤语义优先。
    let landlordPenalty = 0;
    let landlordGoalValue = null;
    let landlordGoalMet = null;
    const scheduledGoalDue = this.goalNextRound > 0 && this.round === this.goalNextRound;
    if (this.config.landlordGoal?.enabled && landlordId && this.players.get(landlordId)?.role === 'landlord'
        && (scheduledGoalDue || this._forceGoalCheckpoint || this._summonGoal)) {
      const after = result.after[landlordId] ?? 0;
      landlordGoalValue = this.goalTarget;
      landlordGoalMet = after >= landlordGoalValue;
      if (!landlordGoalMet) {
        const mult = this._summonGoal ? (this.config.competitive?.prosecutor?.summon?.penaltyMult ?? 2) : 1;
        landlordPenalty = Math.min(after, goalPenalty(after, this.config) * mult); // 倍罚封顶到余额（罚穿即破产）
        result.after[landlordId] = after - landlordPenalty;
        result.deltas[landlordId] = (result.deltas[landlordId] ?? 0) - landlordPenalty;
        const parts = ledger.debit(landlordId, landlordPenalty);
        const recipients = [];
        // 传唤检查点：罚款上缴国库（显式 void 接收方 → 桌面演出=钱飞向虚空收缩消失），农民一分不进——切断检察官自供血。
        if (this._summonGoal && landlordPenalty > 0) recipients.push({ to: { kind: 'void' }, amount: landlordPenalty });
        // 排期/对质检查点：惩罚平分给本回合农民（最大余数法；破产判定前入账，可能救活濒临破产者）。
        if (!this._summonGoal && landlordPenalty > 0 && this.roundFarmerIds.length > 0) {
          const shares = apportion(
            landlordPenalty,
            this.roundFarmerIds.map(id => ({ id, weight: 1, tie: this.bets[id] ?? 0 })),
          );
          for (const id of this.roundFarmerIds) {
            const s = shares[id] ?? 0;
            if (s <= 0) continue;
            result.after[id] = (result.after[id] ?? 0) + s;
            result.deltas[id] = (result.deltas[id] ?? 0) + s;
            ledger.credit(id, s);
            recipients.push({ to: { kind: 'pile', id }, amount: s });
          }
        }
        steps.push({
          id: nextId(), t: 'adjust',
          source: this._summonGoal ? 'summonPenalty' : 'goalPenalty',
          label: this._summonGoal ? STEP_LABEL.summonPenalty : STEP_LABEL.goalPenalty,
          flows: flowsFromParts(landlordId, parts, recipients),
        });
      }
      // 重定基：排期检查点照旧；**传唤 = 正式考核提前开庭**，同样重定基+重抽间隔（对质强制不动日程）。
      if (scheduledGoalDue || this._summonGoal) {
        const base = result.after[landlordId] ?? 0;
        this.goalBaseline = base;
        this.goalTarget = relativeGoal(base, this.config);
        this.goalPrevRound = this.round;
        this.goalNextRound = this.round + drawGoalInterval(this._goalRng ?? Math.random, this.config);
      }
    }

    // === ③ 竞技模式入账（§8）：资本家资金池换算、基础农民工资、暴食者伙食费。均在破产判定前。===
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
        // 征税间隔 = 活跃农民阵营人数（每 interval 回合一次，非每回合）；税基 = 当前池；税钟带锚点（传唤重置）。
        // 对质命中资本家（§8.8）→ _forceTax：本回合额外扣一次（同回合排期+强制只扣一次）。
        // 检察官传唤（§8.9）→ _summonTax：按 penaltyMult 倍扣（封顶到池），并把税钟锚点归到本回合
        // （下次排期税从本回合重新起算——传唤自带的「资敌面」）。同回合并存只扣一次，传唤语义优先。
        if (this._summonTax) {
          const mult = this.config.competitive?.prosecutor?.summon?.penaltyMult ?? 2;
          capitalistTax = Math.min(Math.max(0, cap.pool), computeTax(cap.pool, this.config) * mult);
          cap.pool -= capitalistTax;
          this.taxAnchorRound = this.round;
        } else if (taxDueThisRound(this.round, this.roundFarmerIds.length, this.taxAnchorRound) || this._forceTax) {
          capitalistTax = computeTax(cap.pool, this.config);
          cap.pool -= capitalistTax;
        }
        capitalistPool = cap.pool;
        // 桌面演出：堆与本金 L 的差额在 堆↔池 间搬运（差额 === capitalistPoolDelta，可由公开信息推出，无泄密）。
        const principal = this.bets[cap.id] ?? 0;
        const d = ledger.pileOf(cap.id) - principal;
        if (d > 0) {
          ledger.debit(cap.id, d);
          steps.push({
            id: nextId(), t: 'adjust', source: 'capitalistPool', label: STEP_LABEL.poolSurplus,
            flows: [{ from: { kind: 'pile', id: cap.id }, to: { kind: 'pool', id: cap.id }, amount: d }],
          });
        } else if (d < 0) {
          ledger.credit(cap.id, -d);
          steps.push({
            id: nextId(), t: 'adjust', source: 'capitalistPool', label: STEP_LABEL.poolCover,
            flows: [{ from: { kind: 'pool', id: cap.id }, to: { kind: 'pile', id: cap.id }, amount: -d }],
          });
        }
        if (capitalistTax > 0) {
          steps.push({
            id: nextId(), t: 'adjust',
            source: this._summonTax ? 'summonTax' : 'capitalistTax',
            label: this._summonTax ? STEP_LABEL.summonTax : STEP_LABEL.capitalistTax,
            flows: [{ from: { kind: 'pool', id: cap.id }, to: { kind: 'void' }, amount: capitalistTax }],
          });
        }
      }
      // 基础农民工资：按活跃农民数缩放，到点发薪给存活的基础农民。
      const { interval, amount } = computeWage(this.roundFarmerIds.length, this.config);
      if (wageDueThisRound(this.round, interval) && amount > 0) {
        const wageFlows = [];
        for (const id of this.roundFarmerIds) {
          if (this.players.get(id)?.role === 'farmer') {
            result.after[id] = (result.after[id] ?? 0) + amount;
            result.deltas[id] = (result.deltas[id] ?? 0) + amount;
            wagePaid[id] = amount;
            ledger.credit(id, amount);
            wageFlows.push({ from: { kind: 'void' }, to: { kind: 'pile', id }, amount });
          }
        }
        if (wageFlows.length > 0) steps.push({ id: nextId(), t: 'adjust', source: 'wage', label: STEP_LABEL.wage, flows: wageFlows });
      }
      // 暴食者饭账：每回合累积成「饭账」（成本）。农民胜时从余额扣除并清零（允许扣到破产）；
      // 农民负则饭账继续累积——含重掷仍输也不清零（§8.4）。
      const farmersWon = this.coinResult === 'tails';
      const mealFlows = [];
      for (const id of this.roundFarmerIds) {
        const p = this.players.get(id);
        if (!p || p.role !== 'glutton') continue;
        if (farmersWon && p.mealAllowance > 0) {
          result.after[id] = (result.after[id] ?? 0) - p.mealAllowance;
          result.deltas[id] = (result.deltas[id] ?? 0) - p.mealAllowance;
          allowanceCharged[id] = p.mealAllowance;
          for (const part of ledger.debit(id, p.mealAllowance)) {
            mealFlows.push({ from: { kind: part.kind, id }, to: { kind: 'void' }, amount: part.amount });
          }
          p.mealAllowance = 0;
        }
      }
      if (mealFlows.length > 0) steps.push({ id: nextId(), t: 'adjust', source: 'mealAllowance', label: STEP_LABEL.mealAllowance, flows: mealFlows });
    }

    // === 入账时刻重定义（§3.8）：手上支出此刻入账（钱可视地离开手）；堆上的钱等拿取才入账。===
    for (const [id, debit] of Object.entries(ledger.handDebits)) {
      const p = this.players.get(id);
      if (p) p.balance -= debit;
    }

    // 破产名单在全部调整之后计算（惩罚/饭账可能直接压垮）；标记在全员拿取完成时才落
    // （_checkTakeGate），钱还摆在桌上的人不该先倒下。资本家用资金池判定（个人资金恒定不破产）。
    const newlyBankrupt = [];
    for (const id of [landlordId, ...this.roundFarmerIds]) {
      const p = this.players.get(id);
      if (!p || p.bankrupt) continue;
      const broke = p.role === 'capitalist'
        ? (p.pool ?? 0) <= this.config.bankruptcyThreshold
        : (result.after[id] ?? 0) <= this.config.bankruptcyThreshold;
      if (broke) newlyBankrupt.push(id);
    }

    const timing = this.config.timing;
    this.payout = {
      script: [...(this.payout?.script ?? []), ...steps],
      piles: { ...ledger.piles },   // 自此为权威值（拿取清零）
      taken: new Set(),
      eligible: [landlordId, ...this.roundFarmerIds].filter(id => id && (ledger.piles[id] ?? 0) > 0),
      after: result.after,
      newlyBankrupt,
      deadline: timing.takeTimeoutMs > 0 ? Date.now() + timing.takeTimeoutMs : null,
      done: false,
    };
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

    // 拿取闸门（§3.8）：离线/降级者延迟代拿（让观众看完演出）；超时全员自动；无人可拿直接收尾。
    if (timing.takeAutoDelayMs > 0) this._after(timing.takeAutoDelayMs, () => this._autoTakeOffline());
    else this._autoTakeOffline();
    if (timing.takeTimeoutMs > 0) this._after(timing.takeTimeoutMs, () => this._autoTakePending(() => true));
    this._checkTakeGate();
  }

  // ---------- 拿取（分钱子阶段三的收尾交互，§3.8） ----------

  // 玩家从桌面拿取自己的钱堆：此刻余额才入账（拿取前 viewFor 的余额 = 手上现钱）。
  takePayout(playerId) {
    if (this.phase !== 'FINALIZE' || !this.payout) return { error: ERR.notTakePhase };
    const player = this.players.get(playerId);
    if (!player) return { error: ERR.notInRoom };
    if (!this.payout.eligible.includes(playerId)) return { error: ERR.nothingToTake };
    if (this.payout.taken.has(playerId)) return { error: ERR.alreadyTaken };
    this._bookTake(playerId);
    this._touch();
    this._broadcastState();
    this._checkTakeGate();
    return { ok: true };
  }

  _bookTake(id) {
    const p = this.players.get(id);
    this.payout.taken.add(id);
    this.payout.piles[id] = 0;
    if (p && this.payout.after?.[id] != null) p.balance = this.payout.after[id];
  }

  // 代拿：已降级观战者，以及（按配置）离线玩家。
  _autoTakeOffline() {
    this._autoTakePending(p => p.spectator || (!p.online && this.config.autoActForOffline));
  }

  _autoTakePending(filter) {
    if (this.phase !== 'FINALIZE' || !this.payout || this.payout.done) return;
    let changed = false;
    for (const id of this.payout.eligible) {
      if (this.payout.taken.has(id)) continue;
      const p = this.players.get(id);
      if (!p || filter(p)) { this._bookTake(id); changed = true; }
    }
    if (changed) this._broadcastState();
    this._checkTakeGate();
  }

  // 全员拿取完成：落破产标记（数值与旧算法一致，只是时刻后移到钱真正到手时），
  // finalizeMs 收尾间隔后进入下一回合/终局。
  _checkTakeGate() {
    if (this.phase !== 'FINALIZE' || !this.payout || this.payout.done) return;
    if (this.payout.eligible.some(id => !this.payout.taken.has(id))) return;
    this.payout.done = true;
    // 破产标记**推迟到处决落定**（§3.9）：此处只知道名单（payout.newlyBankrupt），
    // 不置 bankrupt——目标在处决窗内保持正常外观/语义（被赦免者从未破产过）。
    // 无处决窗路径（enabled=false / 名单空 / 弃局）在 _maybeEnterExecution/_endGame 里补落标。
    this._after(this.config.timing.finalizeMs, () => this._maybeEnterExecution());
  }

  // 把 payout.newlyBankrupt 中仍在场且未被赦免的补落破产标记（+播报）。
  // 供处决窗被跳过（enabled=false）与 _endGame 弃局兜底复用；处决窗内的落标走 _resolveExecution。
  _flagBankruptcies(ids) {
    let changed = false;
    for (const id of ids ?? []) {
      const p = this.players.get(id);
      if (p && !p.bankrupt) { p.bankrupt = true; changed = true; this._announceBankrupt(p); }
    }
    return changed;
  }

  // ---------- 处决窗（§3.9）：破产者的生死判决 ----------

  // FINALIZE 收尾后先过处决门禁：本地实验开启且有新破产者 → 开窗；默认直通 _afterRound。
  // 终局判定被推迟到窗后——地主破产被赦免即续命（_afterRound 读的是最新 bankrupt）。
  _maybeEnterExecution() {
    const queue = (this.payout?.newlyBankrupt ?? []).filter(id => {
      const p = this.players.get(id);
      return p && !p.spectator; // 破产标记此刻尚未落（推迟到判决），名单本身就是「应破产」权威
    });
    if (!this._allowExecution || this.config.execution?.enabled !== true || queue.length === 0) {
      // 不开窗：立即补落破产标记（旧行为），再做终局判定
      if (this._flagBankruptcies(this.payout?.newlyBankrupt)) this._broadcastState();
      this._afterRound();
      return;
    }
    // 焦点排序（§3.9）：债务多者优先——债务 = 本回合损失（回合初财富−当前）+ 未偿债务；同值随机。
    // 随机 tie-break 预生成（sort 比较器内直接 random 会破坏传递性）；定序一次、广播后固定。
    const debtOf = (id) => {
      const p = this.players.get(id);
      const loss = p ? compensationOf(p, this.roundStartBalances[id], this.roundStartPools[id]) : 0;
      return loss + (this._roundDebtUnpaid?.[id] ?? 0);
    };
    const rnd = new Map(queue.map(id => [id, Math.random()]));
    queue.sort((a, b) => (debtOf(b) - debtOf(a)) || (rnd.get(a) - rnd.get(b)));
    this._setPhase('EXECUTION');
    this.execution = { queue, idx: -1, targetId: null, executionerId: null, deadline: null, results: [], lastResult: null, volley: false, volleyJudgeId: null };
    this._advanceExecution();
  }

  // 逐目标推进：每个目标按「当时状态」重算行刑者——上一次赦免可能已改变谁最富/谁活着
  // （混合破产队列时行刑者还会跨阵营换人；先被赦免的敌方也可接棒行刑）。
  _advanceExecution() {
    const ex = this.execution;
    ex.idx += 1;
    ex.lastResult = null; // 新焦点开始，清上一笔的结果展示
    if (ex.idx >= ex.queue.length) { this._afterExecution(); return; }
    const target = this.players.get(ex.queue[ex.idx]);
    if (!target || target.bankrupt || target.spectator) { this._advanceExecution(); return; } // bankrupt=防御（不应发生）
    // 行刑者候选须排除本窗**尚未判决**的其他待判者（他们破产标记未落但事实破产，不能持枪）；
    // 已被赦免者不在此列——复活的敌方可以接棒行刑。
    const pending = new Set(ex.queue.slice(ex.idx).filter(id => !ex.results.some(r => r.targetId === id)));
    const judge = pickExecutioner(target, [...this.players.values()].filter(p => !pending.has(p.id)));
    if (!judge) {
      // 敌对阵营无活人行刑 → 该目标自动处决（此刻落破产标记，推迟制 §3.9），照常给结果窗
      target.bankrupt = true;
      this._announceBankrupt(target);
      this._systemChat(SYS.executionNoEnemy(target.username));
      ex.targetId = target.id; ex.executionerId = null;
      this._resolveExecution('executed', { auto: true });
      return;
    }
    // 超时连发模式（§3.9）：AFK 行刑者名下的后续目标不再开窗，直接连续默认处决
    //（第三人称锁定镜头由客户端按 volley 标记演出）；换了行刑者则退出连发、正常给决断窗。
    if (ex.volley) {
      if (judge.id === ex.volleyJudgeId) {
        ex.targetId = target.id;
        ex.executionerId = judge.id;
        ex.deadline = null;
        this._broadcastState(); // 先广播新焦点（镜头跟焦），间隔由 executionVolleyMs 掌控
        this._resolveExecution('executed', { auto: true });
        return;
      }
      ex.volley = false;
      ex.volleyJudgeId = null;
    }
    ex.targetId = target.id;
    ex.executionerId = judge.id;
    const ms = this.config.timing.executionMs;
    ex.deadline = ms > 0 ? Date.now() + ms : null;
    // ⚠ 超时按目标 id 闩存：同相位多目标不经过 _setPhase（不清定时器），旧计时器不许误伤下一个目标
    if (ms > 0) this._after(ms, () => this._executionTimeout(target.id));
    this._systemChat(SYS.executionStart(judge.username, ROLE_LABEL[judge.role] ?? judge.role, target.username, ROLE_LABEL[target.role] ?? target.role));
    this._broadcastState();
    this._autoActOffline(); // 行刑者离线 → 连发默认处决，不卡场
  }

  _pardonCost(targetId) {
    const t = this.players.get(targetId);
    return t ? compensationOf(t, this.roundStartBalances[targetId], this.roundStartPools[targetId]) : 0;
  }

  // 赦免不许把自己赔破产：付后钱须仍 > bankruptcyThreshold（资本家看池、其余看余额）。
  _canAffordPardon(judge, cost) {
    return !!judge && wealthOf(judge) - cost > this.config.bankruptcyThreshold;
  }

  execute(playerId) {
    if (this.phase !== 'EXECUTION' || !this.execution?.targetId) return { error: ERR.notExecution };
    if (playerId !== this.execution.executionerId) return { error: ERR.notExecutioner };
    this._resolveExecution('executed');
    return { ok: true };
  }

  pardon(playerId) {
    if (this.phase !== 'EXECUTION' || !this.execution?.targetId) return { error: ERR.notExecution };
    if (playerId !== this.execution.executionerId) return { error: ERR.notExecutioner };
    const cost = this._pardonCost(this.execution.targetId);
    if (!this._canAffordPardon(this.players.get(playerId), cost)) return { error: ERR.pardonCantAfford(cost) };
    this._resolveExecution('pardoned');
    return { ok: true };
  }

  _executionTimeout(targetId) {
    if (this.phase !== 'EXECUTION' || this.execution?.targetId !== targetId) return;
    const ex = this.execution;
    // 进入连发模式：该行刑者名下所有剩余待判目标以 executionVolleyMs 节奏连续默认处决
    ex.volley = true;
    ex.volleyJudgeId = ex.executionerId;
    this._systemChat(SYS.executionTimeout(this.players.get(ex.executionerId)?.username ?? ''));
    this._resolveExecution('executed', { auto: true });
  }

  // 裁决落账：赦免=行刑者自掏赔偿（资本家扣池、其余扣余额）→ 目标复活、余额/池回到回合初快照。
  // 落定后进入**结果展示窗**（executionResultMs；连发模式用 executionVolleyMs 枪间隔）再推进下一焦点——
  // 客户端的黑屏红/白字、旁观「看结果」镜头都靠这个窗；lastResult 随 viewFor 广播供演出。
  _resolveExecution(outcome, { auto = false } = {}) {
    const ex = this.execution;
    const target = this.players.get(ex.targetId);
    const judge = this.players.get(ex.executionerId);
    let compensation = 0;
    if (outcome === 'pardoned' && target && judge) {
      compensation = this._pardonCost(target.id);
      if (judge.role === 'capitalist') judge.pool -= compensation; else judge.balance -= compensation;
      if (target.role === 'capitalist') target.pool = this.roundStartPools[target.id] ?? target.pool;
      else target.balance = this.roundStartBalances[target.id] ?? target.balance;
      // 破产标记推迟制（§3.9）：被赦免者从未被置过 bankrupt——余额恢复即完全体面地活着
      this._systemChat(SYS.pardoned(judge.username, target.username, compensation));
    } else if (target && !target.bankrupt) {
      target.bankrupt = true; // 此刻才真正破产出局（客户端灰皮瘫倒此刻才切换）
      this._announceBankrupt(target);
      if (judge) this._systemChat(SYS.executed(judge.username, target.username));
    }
    const rec = { targetId: ex.targetId, executionerId: ex.executionerId, outcome, compensation, auto };
    ex.results.push(rec);
    ex.lastResult = rec;
    // ⚠ 结果窗内保留 executionerId：行刑者的相机分派依赖它——清空会把刚开完枪的行刑者
    // 误切到旁观运镜、下一焦点再切回来（视角猛跳）。targetId 清空即可（execute/pardon 有 targetId 硬闸）。
    ex.targetId = null; ex.deadline = null;
    this._broadcastState();
    const delay = ex.volley ? this.config.timing.executionVolleyMs : this.config.timing.executionResultMs;
    if (delay > 0) this._after(delay, () => { if (this.phase === 'EXECUTION') this._advanceExecution(); });
    else this._advanceExecution();
  }

  // 队列清空：结果并入本回合 history，再做被推迟的终局判定。
  _afterExecution() {
    const results = this.execution?.results ?? [];
    const h = this.history[this.history.length - 1];
    if (h) h.executions = results;
    this.execution = null;
    this._broadcastState();
    this._afterRound();
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
    // 拿取阶段被迫终局（弃局/降级）：未拿的钱堆静默入账，破产标记补齐——不丢钱（§3.8）。
    if (this.phase === 'FINALIZE' && this.payout && !this.payout.done) {
      for (const id of this.payout.eligible) {
        if (!this.payout.taken.has(id)) this._bookTake(id);
      }
      this.payout.done = true;
      this._flagBankruptcies(this.payout.newlyBankrupt);
    } else if (this.phase === 'FINALIZE') {
      // 拿取已完成但处决窗尚未开（finalizeMs 间隙内弃局）：标记同样未落，补齐
      this._flagBankruptcies(this.payout?.newlyBankrupt);
    }
    // 处决窗被迫终局（§3.9 弃局路径）：剩余未判者按默认处决落标——终局清算不能有「悬案」
    if (this.phase === 'EXECUTION' && this.execution) {
      const judged = new Set(this.execution.results.map(r => r.targetId));
      this._flagBankruptcies(this.execution.queue.filter(id => !judged.has(id)));
      this.execution = null;
    }
    this._setPhase('ENDED');
    this.winnerSide = winnerSide;
    this.endReason = reason;
    const returnMs = this.config.timing.endedToLobbyMs;
    this.endedReturnAt = returnMs > 0 ? Date.now() + returnMs : null; // 供客户端终局演出对齐收尾淡出（§阶段七）
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
    // 终局后是否自动回大厅：默认 endedToLobbyMs=0 → **不自动回，留在终局对局等房主手动「下一局」**（restart_game）。
    // 仅 >0 时到点自动回；房主手动重开会经 _setPhase 清掉这个定时器，不会二次触发。
    if (returnMs > 0) this._after(returnMs, () => { if (this.phase === 'ENDED') this._resetToLobby(); });
  }

  // ---------- 聊天（语音接口预留：见 index.js NOT_IMPLEMENTED 分支） ----------

  // 系统播报：走公开频道进聊天记录（重连可回看），客户端按 system 标记单独渲染。
  _systemChat(text) {
    const entry = { channel: 'public', from: null, name: '', text, ts: Date.now(), system: true };
    this.chatLog.push(entry);
    if (this.chatLog.length > 200) this.chatLog.shift();
    for (const p of this.players.values()) this._send(p, { type: 'chat', ...entry });
  }

  // 破产播报（UI 精简⑨）：破产不再走底部结算面板，改为聊天区一条系统消息。
  _announceBankrupt(player) {
    const role = ROLE_LABEL[player.role] ?? MISC.playerFallback;
    this._systemChat(SYS.bankrupt(player.username, role));
  }

  chat(playerId, channel, text) {
    const player = this.players.get(playerId);
    // 清洗：控制字符（含换行——绕过客户端单行输入的 WS 直发）压成空格，再裁 200
    const message = (text ?? '').toString().replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!player || !message) return { error: ERR.chatInvalid };
    // 简易滑动窗口限流：10s 内最多 8 条（拦恶意刷屏的 WS 直发；正常对喷够用）
    const nowTs = Date.now();
    player._chatTs = (player._chatTs ?? []).filter(t => nowTs - t < 10000);
    if (player._chatTs.length >= 8) return { error: ERR.chatTooFast };
    player._chatTs.push(nowTs);
    // 观战者（破产/降级）发言一律强制进观战频道：其有上帝视角，绝不能向活跃玩家泄露余额/暗注。
    if (player.bankrupt || player.spectator) channel = 'spectator';
    else if (channel === 'spectator') return { error: ERR.chatSpectateOnly };
    if (!this.config.channels.includes(channel)) return { error: ERR.chatNoChannel };
    if (channel === 'farmer' && factionOf(player.role) !== 'farmer') return { error: ERR.chatFarmersOnly };
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
    if (!player) return { error: ERR.notInRoom };
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
    const betsPublic = !['LOBBY', 'DISCUSSION', 'BETTING', 'CHALLENGE'].includes(this.phase);
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
      lobbyReady: !!p.lobbyReady,
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
        reflipsMax: p.role === 'glutton' ? p.reflipsMax : null,
        usedReflip: p.role === 'glutton' ? p.usedReflipThisRound : null,
        mealAllowance: p.role === 'glutton' ? ((p.id === viewerId || spectator) ? p.mealAllowance : null) : null,
        pool: p.role === 'capitalist' ? ((p.id === viewerId || spectator) ? p.pool : null) : null,
        wage: p.role === 'farmer' ? wageInfo : null,
        // 对质票（§8.8）：农民阵营公开（同 reflipsLeft 施压逻辑）；challengeSkip 供对质窗显示已跳过进度。
        tickets: factionOf(p.role) === 'farmer' ? (p.tickets ?? 0) : null,
        challengeSkip: factionOf(p.role) === 'farmer' ? !!p.challengeSkip : null,
        // 检察官已传唤次数（§8.9）：公开（递增费可由公开事件推出；施压信息，同 reflipsLeft）。
        summonsUsed: p.role === 'prosecutor' ? (p.summonsUsed ?? 0) : null,
      } : {}),
    }));

    // 地主资金目标（相对制）：到期回合(倒计时)对所有人可见；**目标值/基准/余额仅地主本人/观战可见**——
    // 农民只知道「还有几回合结算」，不知具体目标额（§8.8 对质靠读牌，不该直接看到地主 KPI 数字）。
    const landlord = this._landlord();
    const goalActive = this.config.landlordGoal?.enabled && this.goalNextRound > 0
      && landlord && landlord.role === 'landlord' && IN_GAME_PHASES.includes(this.phase);
    const goalPublic = viewer?.role === 'landlord' || spectator;
    const landlordGoal = goalActive ? {
      goal: goalPublic ? this.goalTarget : null,
      dueRound: this.goalNextRound,
      roundsLeft: Math.max(0, this.goalNextRound - this.round),
      interval: Math.max(1, this.goalNextRound - this.goalPrevRound),
      baseline: goalPublic ? this.goalBaseline : null,
      initial: goalPublic ? this.landlordInitial : null,
      landlordId: landlord.id,
      landlordBalance: goalPublic ? landlord.balance : null,
    } : null;

    // 资本家 HUD（§8.6/8.7）：资金池/个人资金仅本人/观战可见；taxRate 公开（用于展示扣税规则）。
    const cap = this._capitalist();
    const capSelf = cap && (viewerId === cap.id || spectator);
    const taxIv = taxInterval(Math.max(1, this._activeFarmers().length)); // 征税间隔 = 活跃农民数
    // 税钟带锚点（§8.9 传唤重置）：距锚点回合数取模；刚被传唤（锚=本回合）→ 下次税整整一个间隔之后。
    const sinceAnchor = this.round - (this.taxAnchorRound || 0);
    const taxMod = sinceAnchor <= 0 ? -1 : sinceAnchor % taxIv;
    const capitalist = (this._competitive && cap && IN_GAME_PHASES.includes(this.phase)) ? {
      id: cap.id,
      personal: capSelf ? cap.balance : null,
      personalInitial: capSelf ? (cap.personalInitial ?? null) : null,
      pool: capSelf ? cap.pool : null,
      poolInitial: capSelf ? (cap.poolInitial ?? null) : null,
      // 下次征税额（§8.6 间隔制、按当前池）：服务端算好直发，客户端只渲染（不再自行套税率公式）。
      taxNext: capSelf ? computeTax(cap.pool ?? 0, this.config) : null,
      taxInterval: taxIv,                                    // 征税间隔（回合）——公开（施压规则）
      // 距下次征税回合数（0=本回合征）；taxMod<0=本回合刚被传唤（锚=本回合）→ 整整一个间隔之后
      taxRoundsToNext: taxMod === 0 ? 0 : taxMod < 0 ? taxIv : taxIv - taxMod,
      taxRate: this.config.competitive.capitalist.taxRate,
      taxMin: this.config.competitive.capitalist.taxMin,
    } : null;

    const canNegotiateView = spectator || factionOf(viewer?.role) === 'farmer';

    // 对质窗（§8.8）：决定/交流窗 deadline、进行中指控、阵营总注（仅农民/观战可见=公开总额决策）。
    // pendingDir（两段确认的预选方向）仅农民阵营/观战可见——队友同步看发起者的犹豫，地主看不到。
    const challenge = (this._competitive && this.phase === 'CHALLENGE') ? {
      deadline: this.challengeDeadline,
      accusation: this.accusation ? {
        accuserId: this.accusation.accuserId,
        targetId: this.accusation.targetId,
        ...(canNegotiateView ? { pendingDir: this.accusation.pendingDir ?? null } : {}),
      } : null,
      targetId: this._landlord()?.id ?? null,
      cost: this.config.competitive.accusation?.cost ?? 2,
      factionTotal: canNegotiateView ? this.roundFarmerIds.reduce((s, id) => s + (this.bets[id] ?? 0), 0) : null,
    } : null;
    // 本回合已落定的对质裁决（贯穿 REVEAL/FINALIZE 显示）：命中/落空对所有人可见；具体注额仅农民/观战可见。
    const lastAccusation = (this._competitive && this.lastAccusation) ? {
      accuserId: this.lastAccusation.accuserId,
      targetId: this.lastAccusation.targetId,
      dir: this.lastAccusation.dir,
      correct: this.lastAccusation.correct,
      ...(canNegotiateView ? { targetBet: this.lastAccusation.targetBet, factionTotal: this.lastAccusation.factionTotal } : {}),
    } : null;
    // 本回合传唤事件（§8.9）：对所有人公开（系统聊天已播报；驱动被传唤方制约卡 ⚠ 告警，下回合下注前清）。
    const lastSummon = (this._competitive && this.lastSummon) ? { ...this.lastSummon } : null;
    // 处决窗（§3.9）：目标/行刑者/截止/赦免价码全公开——赔偿额=目标本回合损失，可由公开结算脚本推出，无泄密。
    const execution = (this.phase === 'EXECUTION' && this.execution) ? {
      targetId: this.execution.targetId,
      executionerId: this.execution.executionerId,
      deadline: this.execution.deadline,
      compensation: this.execution.targetId ? this._pardonCost(this.execution.targetId) : null,
      queue: this.execution.queue,           // 完整焦点队列（演出运镜要看所有破产者位置/中间点）
      queueLeft: Math.max(0, this.execution.queue.length - this.execution.idx),
      results: this.execution.results,
      lastResult: this.execution.lastResult, // 结果展示窗（executionResultMs）内的判决——黑屏字/看结果镜头
      volley: !!this.execution.volley,       // 超时连发中：全员锁第三人称连续开枪镜头
    } : null;

    const me = viewer ? {
      id: viewer.id,
      role: viewer.role,
      balance: viewer.balance,
      bet: this.bets[viewerId] ?? null,
      ready: viewer.ready,
      lobbyReady: !!viewer.lobbyReady,
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
        reflipsMax: viewer.reflipsMax,
        passedReflip: viewer.passedReflip,
        pool: viewer.pool,
        wage: viewer.role === 'farmer' ? wageInfo : null,
        // 对质（§8.8）：自身票数、能否发起指控、我作为发起者进行中的指控、已跳过标记。
        tickets: viewer.tickets ?? 0,
        canAccuse: factionOf(viewer.role) === 'farmer' && this._isActive(viewer)
          && !viewer.usedSummonThisRound // §8.9 同回合传唤/对质互斥（accuse() 有同款硬闸门，这里管入口显隐）
          && (viewer.tickets ?? 0) >= (this.config.competitive.accusation?.cost ?? 2),
        myAccusation: (this.accusation && this.accusation.accuserId === viewerId)
          ? { targetId: this.accusation.targetId, deadline: this.accusation.deadline } : null,
        challengeSkip: !!viewer.challengeSkip,
        // 检察官·传唤（§8.9）：下一次费用 + 本回合可否传唤（服务端整门槛，客户端只渲染）。
        ...(viewer.role === 'prosecutor' ? {
          summonsUsed: viewer.summonsUsed ?? 0,
          usedSummonThisRound: !!viewer.usedSummonThisRound,
          summonCost: summonCost(this.roundFarmerIds.length || this._activeFarmers().length, viewer.summonsUsed ?? 0, this.config),
          canSummon: this.phase === 'BETTING' && this._isActive(viewer)
            && this.roundFarmerIds.includes(viewerId)
            && this.bets[viewerId] == null
            && !viewer.usedSummonThisRound && !this._summonGoal && !this._summonTax
            && viewer.balance >= summonCost(this.roundFarmerIds.length, viewer.summonsUsed ?? 0, this.config)
              + getMinStake(viewer.role, this.roundFarmerIds.length, this.config, { mode: this.mode }),
        } : {}),
      } : {}),
      // 处决窗（§3.9）：仅行刑者视角展开（quick/competitive 均生效，不放进竞技块）。
      ...(this.phase === 'EXECUTION' && this.execution?.executionerId === viewerId ? {
        isExecutioner: true,
        pardonCost: this._pardonCost(this.execution.targetId),
        canPardon: this._canAffordPardon(viewer, this._pardonCost(this.execution.targetId)),
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
      // 下注/揭牌确认倒计时（公开的节奏信息；仅在各自相位内有意义）
      betDeadline: this.phase === 'BETTING' ? this.betDeadline : null,
      revealDeadline: this.phase === 'REVEAL' ? this.revealDeadline : null,
      reflipDeadline: this.phase === 'REFLIP' ? this.reflipDeadline : null,
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
      // 桌面显式结算（§3.8）：编导脚本 + 当前钱堆 + 拿取进度。script/piles 里的金额在
      // 结算阶段均已公开；piles 的协商实时性按观察者区分（_pilesView）。
      payout: PAYOUT_PHASES.includes(this.phase) && this.payout
        ? {
            script: this.payout.script,
            piles: this._pilesView(viewer, spectator),
            taken: [...this.payout.taken],
            eligible: this.payout.eligible,
            deadline: this.payout.deadline,
          }
        : null,
      roundFarmerIds: this.roundFarmerIds,
      landlordGoal,
      capitalist,
      challenge,
      lastAccusation,
      lastSummon,
      execution,
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
      endedReturnAt: this.phase === 'ENDED' ? this.endedReturnAt : null, // 终局演出自动回大厅的绝对时刻（客户端据此收尾淡出/倒计时；0=不自动则为 null）
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

  // 桌面钱堆的观察者视图（§3.8 隐私）：FINALIZE 起是权威 piles（拿取清零）；之前由方案推导——
  // 协商期间农民/观战者看实时 allocation，地主阵营看冻结的系统方案（协商过程对地主保密，
  // 与 allocation 的可见性一致；FINALIZE 进入时地主客户端用一次对账动画追平）。
  _pilesView(viewer, spectator) {
    if (this.payout?.piles) return this.payout.piles;
    const landlordId = this._landlord()?.id;
    const live = this.phase !== 'NEGOTIATE' || spectator || factionOf(viewer?.role) === 'farmer';
    const takes = (live ? this.allocation?.takes : this.settlement?.takes) ?? {};
    const piles = {};
    for (const id of this.roundFarmerIds) piles[id] = takes[id] ?? 0;
    if (landlordId) piles[landlordId] = this.settlement?.landlordTake ?? 0;
    return piles;
  }

  // 暴食者中仍可重掷者（活跃 + 本回合参与 + 尚有次数 + 本回合未用过）。
  // usedReflipThisRound 过滤即「每回合最多申请 1 次」：重掷后即退出可重掷集——
  // 独自暴食者时窗口不再重开（_afterCoinFlip 见 length===0 直接结算），多暴食者时不阻塞闸门。
  _reflipGluttons() {
    return this.roundFarmerIds
      .map(id => this.players.get(id))
      .filter(p => p && p.role === 'glutton' && this._isActive(p) && p.reflipsLeft > 0 && !p.usedReflipThisRound);
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
        if (!p.online && this.bets[p.id] === undefined) this._autoBetMin(p);
      }
      this._checkAllBet();
    } else if (this.phase === 'DISCUSSION') {
      this._checkGate('ready', () => this._enterBetting());
    } else if (this.phase === 'REVEAL') {
      this._checkGate('confirmed', () => this._enterCoinFlip());
    } else if (this.phase === 'NEGOTIATE') {
      this._checkNegotiateGate();
    } else if (this.phase === 'FINALIZE') {
      this._autoTakeOffline();
    } else if (this.phase === 'REFLIP') {
      this._checkReflipGate();
    } else if (this.phase === 'EXECUTION') {
      const ex = this.execution;
      if (ex?.targetId && !this.players.get(ex.targetId)) {
        // 目标中途离场 → 该目标按处决落账（维持出局语义），推进队列
        this._resolveExecution('executed', { auto: true });
      } else if (ex?.targetId) {
        // 行刑者掉线 → 与超时同语义：连发默认处决其名下全部剩余目标（不能替 AFK 玩家掏钱）
        const judge = this.players.get(ex.executionerId);
        if (judge && !judge.online) {
          ex.volley = true;
          ex.volleyJudgeId = ex.executionerId;
          this._resolveExecution('executed', { auto: true });
        }
      }
    } else if (this.phase === 'CHALLENGE') {
      if (this.accusation) {
        // 交流窗中：发起者离线 → 自动取消并揭牌（票已扣、不退）。
        const acc = this.players.get(this.accusation.accuserId);
        if (acc && !acc.online) { this.accusation = null; this._enterReveal(); }
      } else {
        // 决定窗：离线农民按闸门自动满足跳过（_checkChallengeSkipGate 内含离线自动通过）。
        this._checkChallengeSkipGate();
      }
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
