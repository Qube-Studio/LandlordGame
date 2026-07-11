// 单人模式会话层（GAME_SPEC §9.6）：把 SingleTable 适配成**与多人 viewFor() 同形的 state**，
// 让现有客户端（Scene3D/HandLayer/PayoutLayer/UiLayer）零结构改动即可渲染单机局。
// - 相位映射：COMMAND→BETTING、REFLIP→REFLIP、ALLOCATE→NEGOTIATE、ENDED→ENDED；
//   掷币演出由本层合成：resolve 后先广播 COIN_FLIP 叠加相位（timing.coinAnimMs），到点再放真相位。
// - 意图复用既有消息名（place_bet/summon/request_reflip/pass_reflip/negotiate_transfer/negotiate_confirm），
//   加 single_seat 切换操控席位（席位切换指挥 v1）。全部席位下注即自动 resolve（同多人 _checkAllBet）。
// - 单人无隐私剥离：Boss 出注在掷币前只显张数口径（hasBet/betCount），金额掷币后随 pot 公开。
import { SingleTable } from './SingleTable.js';
import { betBounds } from '../logic/rules.js';
import { singleSummonCost, summonCooldownOk } from '../logic/settleSingle.js';
import { ROLE_LABEL, SINGLE, MISC } from '../text.js';

const PHASE_MAP = { COMMAND: 'BETTING', REFLIP: 'REFLIP', ALLOCATE: 'NEGOTIATE', ENDED: 'ENDED' };
// 本层接管的意图（index.js 在 ws 挂着单机会话时优先路由这些）。
export const SINGLE_INTENTS = new Set([
  'single_seat', 'single_quit', 'place_bet', 'summon',
  'request_reflip', 'pass_reflip', 'negotiate_transfer', 'negotiate_confirm', 'ready',
]);

export class SingleSession {
  /** @param {object} o { teamRoles, persona, ghost, configOverrides, send(msg), rng } */
  constructor({ teamRoles, persona, ghost, configOverrides = {}, send, rng }) {
    this.table = new SingleTable({ teamRoles, boss: { persona, ghost: !!ghost }, configOverrides, rng: rng ?? Math.random });
    this.send = send;
    this.seatId = this.table.seats[0].id;
    this.coinResult = null;       // 最近一次掷币结果（'heads'|'tails'，REFLIP/NEGOTIATE 期间保留展示）
    this._coinOverlay = false;    // 正在播掷币动画（叠加相位 COIN_FLIP）
    this._timer = null;
  }

  destroy() { clearTimeout(this._timer); }

  _push() { this.send({ type: 'state', state: this.view() }); }

  // 意图入口。返回 {error} 时由 index.js 转成 error 消息；成功一律广播新 state。
  handle(type, msg = {}) {
    if (this._coinOverlay && type !== 'single_quit') return { error: '掷硬币中…' }; // 演出期间锁操作
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
    const t = this.table;
    const phase = this._coinOverlay ? 'COIN_FLIP' : (PHASE_MAP[t.phase] ?? t.phase);
    const betting = phase === 'BETTING';
    const alive = t.seats.filter(s => !s.dead);
    const meSeat = t.seats.find(s => s.id === this.seatId) ?? t.seats[0];
    const plan = t.phase === 'ALLOCATE' ? t.view().pendingPlan : null;
    const pot = Object.values(t.bets).reduce((x, y) => x + y, 0) + t.bossBet + t.ghostBet;

    const players = [
      ...t.seats.map((s, i) => ({
        id: s.id, name: SINGLE.seatName(ROLE_LABEL[s.role] ?? s.role, i + 1), role: s.role, seat: i,
        online: true, isHost: s.id === t.seats[0].id, lobbyReady: true, ready: true,
        hasBet: t.bets[s.id] != null, betCount: null,
        bet: betting ? null : (t.bets[s.id] ?? null),
        balance: s.balance,                              // 单人无隐私：全队余额可见
        bankrupt: s.dead, spectator: false, confirmed: true,
        negotiateConfirmed: false, emote: null,
        reflipsLeft: s.role === 'glutton' ? s.reflipsLeft : undefined,
        pledge: s.pledge, tickets: null, challengeSkip: false,
      })),
      {
        id: 'L', name: SINGLE.bossLabel[t.boss.persona] ?? MISC.landlordFallback, role: 'landlord',
        seat: t.seats.length, online: true, isHost: false, lobbyReady: true, ready: true,
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
      single: {                                          // 单人补充块（客户端席位切换 UI 用）
        seatId: this.seatId,
        persona: t.boss.persona,
        bossGhost: t.boss.ghost, ghostBalance: t.boss.ghostBalance,
        lastRoundResult: t.lastRoundResult,
      },
    };
  }
}
