// 单人模式会话层（GAME_SPEC §9.6）：把 SingleTable 适配成**与多人 viewFor() 同形的 state**，
// 让现有客户端（Scene3D/HandLayer/PayoutLayer/UiLayer）零结构改动即可渲染单机局。
// - SETUP 相位（交互 v2）：single_start 先进组队期（相位 'SINGLE_SETUP'）——4 个席位槽在
//   左下角席位列里循环选角、切幽灵；single_begin 才真正构造 SingleTable。测试/旧协议仍可在
//   single_start 里直接带 teamRoles 跳过组队期。
// - 相位映射：COMMAND→BETTING、REFLIP→REFLIP、ALLOCATE→NEGOTIATE、ENDED→ENDED；
//   掷币演出由本层合成：resolve 后先广播 COIN_FLIP 叠加相位（timing.coinAnimMs），到点再放真相位。
// - 槽位（seat 字段）：玩家在组队期选的槽 0-3 就是桌边的固定座位——开局后 players[].seat
//   仍指向原槽（Scene3D 单人长桌按 seat 落座），Boss 恒为 seat 4（对面）。
// - 意图复用既有消息名（place_bet/summon/request_reflip/pass_reflip/negotiate_transfer/negotiate_confirm），
//   加 single_seat 切换操控席位、single_role/single_ghost/single_begin 组队期专用。
//   全部席位下注即自动 resolve（同多人 _checkAllBet）。
// - 单人无隐私剥离：Boss 出注在掷币前只显张数口径（hasBet/betCount），金额掷币后随 pot 公开。
import { SingleTable, TEAM_ROLES } from './SingleTable.js';
import { mergeConfig } from '../config.js';
import { betBounds } from '../logic/rules.js';
import { singleSummonCost, summonCooldownOk } from '../logic/settleSingle.js';
import { ROLE_LABEL, SINGLE } from '../text.js';

const PHASE_MAP = { COMMAND: 'BETTING', REFLIP: 'REFLIP', ALLOCATE: 'NEGOTIATE', ENDED: 'ENDED' };

// 金额 → 张数（贪心 10/5/2/1，与 Room.noteCount 同式）：切席后队友已下注的牌堆靠它渲染。
function noteCount(amount) {
  let n = 0, r = amount;
  for (const v of [10, 5, 2, 1]) { n += Math.floor(r / v); r %= v; }
  return Math.max(1, n);
}
// 本层接管的意图（index.js 在 ws 挂着单机会话时优先路由这些）。
export const SINGLE_INTENTS = new Set([
  'single_seat', 'single_quit', 'single_role', 'single_ghost', 'single_begin',
  'place_bet', 'summon',
  'request_reflip', 'pass_reflip', 'negotiate_transfer', 'negotiate_confirm', 'ready',
]);

export class SingleSession {
  /** @param {object} o { teamRoles?, ghost, configOverrides, send(msg), rng }
   *  teamRoles 给出即跳过组队期直接开局（测试/脚本用）；缺省进 SETUP。 */
  constructor({ teamRoles, ghost, configOverrides = {}, send, rng }) {
    this.send = send;
    this.configOverrides = configOverrides;
    this.rng = rng ?? Math.random;
    this.baseConfig = mergeConfig(configOverrides);   // 组队期展示用（初始资金等）
    this.ghost = !!ghost;
    this.table = null;
    this.seatId = null;
    this.slotOf = [];             // table.seats 下标 → 组队期槽位（桌边固定座位）
    this.coinResult = null;       // 最近一次掷币结果（'heads'|'tails'，REFLIP/NEGOTIATE 期间保留展示）
    this._coinOverlay = false;    // 正在播掷币动画（叠加相位 COIN_FLIP）
    this._timer = null;
    if (Array.isArray(teamRoles) && teamRoles.length) {
      // 直接开局：槽位=数组序
      this.setup = false;
      this.slots = [...teamRoles.slice(0, 4)];
      while (this.slots.length < 4) this.slots.push(null);
      this._buildTable();         // 角色非法在此抛出，index.js 转 errBadTeam
    } else {
      this.setup = true;
      this.slots = ['farmer', 'farmer', null, null];
    }
  }

  destroy() { clearTimeout(this._timer); }

  _push() { this.send({ type: 'state', state: this.view() }); }

  _buildTable() {
    const filled = this.slots.map((r, i) => ({ r, i })).filter(x => x.r);
    this.table = new SingleTable({
      teamRoles: filled.map(x => x.r),
      boss: { ghost: this.ghost },
      configOverrides: this.configOverrides,
      rng: this.rng,
    });
    this.slotOf = filled.map(x => x.i);
    this.seatId = this.table.seats[0].id;
  }

  // 意图入口。返回 {error} 时由 index.js 转成 error 消息；成功一律广播新 state。
  handle(type, msg = {}) {
    if (this._coinOverlay && type !== 'single_quit') return { error: '掷硬币中…' }; // 演出期间锁操作
    // ---------- 组队期（SETUP）----------
    if (this.setup) {
      switch (type) {
        case 'ready': break;                                     // 兼容客户端习惯性发送
        case 'single_role': {
          const slot = Number(msg.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot > 3) return { error: SINGLE.errBadSlot };
          const role = msg.role ?? null;
          if (role !== null && !TEAM_ROLES.has(role)) return { error: SINGLE.errBadTeam };
          this.slots[slot] = role;
          break;
        }
        case 'single_ghost': this.ghost = !!msg.on; break;
        case 'single_begin': {
          if (!this.slots.some(Boolean)) return { error: SINGLE.errEmptyTeam };
          this._buildTable();
          this.setup = false;
          break;
        }
        case 'single_seat': break;                               // 组队期无操控席位可切
        default: return { error: SINGLE.errNotStarted };
      }
      this._push();
      return { ok: true };
    }
    if (type === 'single_role' || type === 'single_ghost' || type === 'single_begin') {
      return { error: SINGLE.errNotSetup };
    }
    // ---------- 对局期 ----------
    let r;
    switch (type) {
      case 'ready': r = { ok: true }; break;                       // 单人无准备门槛（兼容客户端习惯性发送）
      case 'single_seat': {
        const seat = this.table.seats.find(s => s.id === msg.seatId && !s.dead);
        if (!seat) return { error: SINGLE.errBadSeat };
        this.seatId = seat.id; r = { ok: true }; break;
      }
      case 'place_bet': {
        r = this.table.setBet(this.seatId, Number(msg.amount), { pledge: Number(msg.pledge) || 0 });
        if (!r.error) this._maybeResolve();
        break;
      }
      case 'summon': r = this.table.summonBoss(this.seatId); break;
      case 'request_reflip': {
        r = this.table.requestReflip(this.seatId);
        if (!r.error) return this._afterCoin(r);                    // 重掷=又一枚硬币 → 走演出
        break;
      }
      case 'pass_reflip': r = this.table.passReflip(); break;
      case 'negotiate_transfer':
        r = this.table.transferAllocation(this.seatId, msg.toId, msg.kind === 'debt' ? 'debt' : 'take', Number(msg.amount));
        break;
      case 'negotiate_confirm': r = this.table.confirmAllocate(); break;
      default: return { error: `未知消息类型: ${type}` };
    }
    if (r?.error) return r;
    this._push();
    return { ok: true };
  }

  // 全部存活席位下注完 → 自动掷币（同多人 _checkAllBet 心智）。
  _maybeResolve() {
    const alive = this.table.seats.filter(s => !s.dead);
    if (alive.every(s => this.table.bets[s.id] != null)) {
      const r = this.table.resolve();
      if (!r.error) this._afterCoin(r);
    }
  }

  // 掷币演出：先广播 COIN_FLIP 叠加相位，coinAnimMs 后放行真相位（REFLIP/NEGOTIATE/BETTING/ENDED）。
  _afterCoin(result) {
    this.coinResult = result.teamWin ? 'tails' : 'heads';
    const ms = this.table.config.timing?.coinAnimMs ?? 0;
    if (ms > 0) {
      this._coinOverlay = true;
      this._push();
      this._timer = setTimeout(() => { this._coinOverlay = false; this._push(); }, ms);
    } else {
      this._push();
    }
    return { ok: true };
  }

  // ---------- 多人同形 state ----------
  view() {
    if (this.setup) return this._setupView();
    const t = this.table;
    const phase = this._coinOverlay ? 'COIN_FLIP' : (PHASE_MAP[t.phase] ?? t.phase);
    const betting = phase === 'BETTING';
    const alive = t.seats.filter(s => !s.dead);
    const meSeat = t.seats.find(s => s.id === this.seatId) ?? t.seats[0];
    const plan = t.phase === 'ALLOCATE' ? t.view().pendingPlan : null;
    const pot = Object.values(t.bets).reduce((x, y) => x + y, 0) + t.bossBet + t.ghostBet;

    const players = [
      ...t.seats.map((s, i) => ({
        id: s.id, name: SINGLE.seatName(ROLE_LABEL[s.role] ?? s.role, i + 1), role: s.role,
        seat: this.slotOf[i] ?? i,                       // 槽位=桌边固定座位（组队期所选）
        online: true, isHost: s.id === t.seats[0].id, lobbyReady: true, ready: true,
        hasBet: t.bets[s.id] != null,
        betCount: t.bets[s.id] != null ? noteCount(t.bets[s.id]) : 0,
        bet: betting ? (t.bets[s.id] ?? null) : (t.bets[s.id] ?? null),
        balance: s.balance,                              // 单人无隐私：全队余额可见
        bankrupt: s.dead, spectator: false, confirmed: true,
        negotiateConfirmed: false, emote: null,
        reflipsLeft: s.role === 'glutton' ? s.reflipsLeft : undefined,
        pledge: s.pledge, tickets: null, challengeSkip: false,
      })),
      {
        id: 'L', name: SINGLE.bossName, role: 'landlord',
        seat: 4, online: true, isHost: false, lobbyReady: true, ready: true,
        hasBet: !betting, betCount: null, bet: betting ? null : (t.bossBet + t.ghostBet || null),
        balance: t.boss.balance, bankrupt: t.winner === 'team', spectator: false,
        confirmed: true, negotiateConfirmed: false, emote: null, tickets: null, challengeSkip: false,
      },
    ];

    const bounds = betting && !meSeat.dead
      ? betBounds({ balance: meSeat.balance - meSeat.pledge, role: meSeat.role, farmerCount: alive.length, config: t.config, mode: 'single' })
      : null;

    return {
      roomId: 'SINGLE', roomName: SINGLE.roomName, mode: 'single',
      phase, round: t.round, hostId: t.seats[0].id,
      config: t.config,
      players,
      me: meSeat ? {
        id: meSeat.id, role: meSeat.role, balance: meSeat.balance, spectator: false, isHost: true,
        lobbyReady: true, ready: true, confirmed: true, negotiateConfirmed: false,
        bet: t.bets[meSeat.id] ?? null, bounds,
        pledge: meSeat.pledge, premium: meSeat.pledge, pledgeMax: t.config.single.investor.maxPledge,
        mealAllowance: meSeat.role === 'glutton' ? meSeat.mealDebt : 0,
        reflipsLeft: meSeat.reflipsLeft, reflipsMax: t.config.single.glutton.reflips, passedReflip: false,
        pool: null, wage: null, tickets: 0, canAccuse: false, myAccusation: null, challengeSkip: false,
        ...(meSeat.role === 'prosecutor' ? {
          summonsUsed: 0, usedSummonThisRound: t.summon.pendingPenalty > 0,
          summonCost: singleSummonCost(alive.length, t.config),
          canSummon: t.phase === 'COMMAND' && !meSeat.dead && t.bets[meSeat.id] == null
            && t.summon.pendingPenalty === 0
            && summonCooldownOk(t.round, t.summon.lastRound, alive.length, t.config)
            && meSeat.balance >= singleSummonCost(alive.length, t.config) + 1,
        } : {}),
      } : null,
      pot: betting ? null : pot,
      coinResult: ['COIN_FLIP', 'REFLIP', 'NEGOTIATE'].includes(phase) ? this.coinResult : null,
      settlement: null,
      allocation: phase === 'NEGOTIATE' && plan
        ? { takes: plan.takes, debts: plan.debts, confirms: [], deadline: null }
        : null,
      // v1 最简 payout（冷挂载快照口径）：无编导脚本，钱堆=当前分配 → 客户端直接摆终局布局。
      payout: phase === 'NEGOTIATE' && plan
        ? { script: [], piles: { ...plan.takes }, taken: [], eligible: alive.map(s => s.id), deadline: null }
        : null,
      roundFarmerIds: alive.map(s => s.id),
      landlordGoal: null, capitalist: null, challenge: null, lastAccusation: null,
      lastSummon: t.summon.pendingPenalty > 0 ? { byId: this.seatId, targetId: 'L', cost: singleSummonCost(alive.length, t.config), round: t.round } : null,
      history: [],
      winnerSide: t.winner ? (t.winner === 'team' ? 'farmers' : 'landlord') : null,
      endReason: t.winner ? 'bankrupt' : null,
      endedReturnAt: null,
      single: {                                          // 单人补充块（客户端席位列/走动相机用）
        seatId: this.seatId,
        setup: null,
        bossGhost: t.boss.ghost, ghostBalance: t.boss.ghostBalance,
        lastRoundResult: t.lastRoundResult,
      },
    };
  }

  // 组队期视图：与对局视图同键形（客户端零分支崩溃面），players=已选槽位 + Boss。
  _setupView() {
    const S = this.baseConfig.single;
    const players = [
      ...this.slots.map((role, i) => (role ? {
        id: `slot${i}`, name: SINGLE.seatName(ROLE_LABEL[role] ?? role, i + 1), role, seat: i,
        online: true, isHost: i === 0, lobbyReady: false, ready: false,
        hasBet: false, betCount: 0, bet: null,
        balance: S.initialBalance[role] ?? S.initialBalance.farmer,
        bankrupt: false, spectator: false, confirmed: false,
        negotiateConfirmed: false, emote: null,
        reflipsLeft: role === 'glutton' ? S.glutton.reflips : undefined,
        pledge: 0, tickets: null, challengeSkip: false,
      } : null)).filter(Boolean),
      {
        id: 'L', name: SINGLE.bossName, role: 'landlord',
        seat: 4, online: true, isHost: false, lobbyReady: false, ready: false,
        hasBet: false, betCount: null, bet: null,
        balance: S.boss.initialBalance, bankrupt: false, spectator: false,
        confirmed: false, negotiateConfirmed: false, emote: null, tickets: null, challengeSkip: false,
      },
    ];
    return {
      roomId: 'SINGLE', roomName: SINGLE.roomName, mode: 'single',
      phase: 'SINGLE_SETUP', round: 0, hostId: null,
      config: this.baseConfig,
      players,
      me: null,
      pot: null, coinResult: null, settlement: null, allocation: null, payout: null,
      roundFarmerIds: [],
      landlordGoal: null, capitalist: null, challenge: null, lastAccusation: null, lastSummon: null,
      history: [],
      winnerSide: null, endReason: null, endedReturnAt: null,
      single: {
        seatId: null,
        setup: { roles: [...this.slots], ghost: this.ghost },
        bossGhost: this.ghost, ghostBalance: 0,
        lastRoundResult: null,
      },
    };
  }
}
