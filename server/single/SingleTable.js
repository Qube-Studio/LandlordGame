// 单人模式编排器（GAME_SPEC §9）：**独立于 Room 的单机相位机**——无联网多路复用、
// 无多客户端门控/隐私边界/断线代打；一个人类指挥整支队伍 vs 脚本 Boss（bosses/*.js）。
// 复用全部纯逻辑：betBounds/settleRound（对地主侧结算）+ settleSingle（幽灵/监管/幸运儿/工资）
// + allocateDebt/applyAllocation。参数一律 config.single（零硬编码）。
// 相位（单人量身，比多人短）：COMMAND（全队下注+技能）→ REFLIP?（暴食者决策，仅败局且有次数）
// → ALLOCATE（玩家给己队自由分账；无可分则跳过）→ 下一回合 COMMAND | ENDED。
// rng 可注入（测试用确定性序列）；硬币语义 = teamWin 布尔（映射 settleRound 的 tails=玩家队胜）。

import { mergeConfig, roundBy } from '../config.js';
import { betBounds, settleRound, applyAllocation } from '../logic/rules.js';
import {
  ghostMaxBet, ghostBalance, splitLandlordSide, phantomReduction,
  singleSummonCost, summonCooldownOk, summonPenalty, luckyWinProb, singleWage,
} from '../logic/settleSingle.js';
import { getPersona } from './bosses/basic.js';

const TEAM_ROLES = new Set(['farmer', 'investor', 'glutton', 'prosecutor', 'lucky']);

export class SingleTable {
  /**
   * @param {object} o
   * @param {string[]} o.teamRoles 玩家队角色（1-4 个，§9 阵容）
   * @param {object} [o.boss] { persona: 'steward', ghost: false, initialBalance? }
   * @param {object} [o.configOverrides] 叠加在 DEFAULT_CONFIG 上（角色升级=增量合并的入口）
   * @param {() => number} [o.rng] 注入随机源（缺省 Math.random）
   */
  constructor({ teamRoles, boss = {}, configOverrides = {}, rng = Math.random }) {
    if (!Array.isArray(teamRoles) || teamRoles.length < 1 || teamRoles.length > 4) throw new Error('队伍需 1-4 人');
    for (const r of teamRoles) if (!TEAM_ROLES.has(r)) throw new Error(`未知角色：${r}`);
    this.persona = getPersona(boss.persona);
    // Boss 三属性按人格档位提升到顶层（settleRound 经 getLandlordAttrs 读顶层 landlordAttrs）
    const base = mergeConfig(configOverrides);
    const attrs = base.single.boss.attrs[this.persona.attrsTier] ?? base.single.boss.attrs.base;
    this.config = mergeConfig({ ...configOverrides, landlordAttrs: { landlord: { ...attrs } } });
    this.rng = rng;

    const S = this.config.single;
    this.seats = teamRoles.map((role, i) => ({
      id: `s${i}`, role,
      balance: S.initialBalance[role] ?? S.initialBalance.farmer,
      dead: false,
      pledge: 0,                 // 投资人本回合保金
      reflipsLeft: role === 'glutton' ? S.glutton.reflips : 0,
      mealDebt: 0,               // 暴食者饭账（单人口径：每回合固定扣，此处只作展示累计）
    }));
    this.boss = {
      persona: this.persona.id,
      balance: boss.initialBalance ?? S.boss.initialBalance,
      initial: boss.initialBalance ?? S.boss.initialBalance,
      ghost: !!boss.ghost,
      ghostBalance: boss.ghost ? ghostBalance(teamRoles.length, this.config) : 0,
    };
    this.round = 1;
    this.phase = 'COMMAND';
    this.bets = {};              // seatId -> amount（本回合）
    this.bossBet = 0; this.ghostBet = 0;
    this.summon = { lastRound: 0, pendingPenalty: 0 };   // 检察官监管：冷却锚 + 本回合待扣罚金
    this.pityLosses = 0;         // 幸运儿怜悯（连败数；队胜清零）
    this.usedReflipThisRound = false;
    this.lastRoundResult = null; // {teamWin, deltas, events} 供 UI/测试读
    this.winner = null;          // 'team' | 'boss'
    this._pendingSettle = null;  // REFLIP/ALLOCATE 间的中间结算
  }

  _aliveSeats() { return this.seats.filter(s => !s.dead); }
  _farmerCount() { return this._aliveSeats().length; }
  _seat(id) { const s = this.seats.find(x => x.id === id); if (!s || s.dead) return null; return s; }

  // ---------- COMMAND：给某席位下注（投资人可携带 pledge）----------
  setBet(seatId, amount, { pledge = 0 } = {}) {
    if (this.phase !== 'COMMAND') return { error: '当前不是下令阶段' };
    const seat = this._seat(seatId);
    if (!seat) return { error: '席位无效' };
    let premium = 0;
    if (pledge > 0) {
      if (seat.role !== 'investor') return { error: '只有投资人可以投保' };
      const cap = this.config.single.investor.maxPledge;
      premium = Math.min(pledge, cap, seat.balance - 1);
      if (premium < 1) return { error: '保金无效' };
    }
    const b = betBounds({ balance: seat.balance - premium, role: seat.role, farmerCount: this._farmerCount(), config: this.config, mode: 'single' });
    const amt = b.forceAllIn ? seat.balance - premium : amount;
    if (!Number.isInteger(amt) || amt < b.min || amt > (b.forceAllIn ? seat.balance : b.max)) {
      return { error: `下注需在 ${b.min}-${b.max} 之间` };
    }
    seat.pledge = premium;
    this.bets[seatId] = amt;
    return { ok: true, forceAllIn: b.forceAllIn };
  }

  // ---------- COMMAND：检察官·监管（固定费+冷却，须在该席位下注前）----------
  summonBoss(seatId) {
    if (this.phase !== 'COMMAND') return { error: '当前不是下令阶段' };
    const seat = this._seat(seatId);
    if (!seat || seat.role !== 'prosecutor') return { error: '只有检察官可以监管' };
    if (this.bets[seatId] != null) return { error: '请在该席位下注前监管' };
    if (this.summon.pendingPenalty > 0) return { error: '本回合已监管' };
    if (!summonCooldownOk(this.round, this.summon.lastRound, this._farmerCount(), this.config)) {
      return { error: '监管冷却中' };
    }
    const cost = singleSummonCost(this._farmerCount(), this.config);
    const minStake = 1;
    if (seat.balance < cost + minStake) return { error: '资金不足' };
    seat.balance -= cost;                                   // 费进虚空
    this.summon.lastRound = this.round;
    this.summon.pendingPenalty = summonPenalty(this._farmerCount(), this.config);
    return { ok: true, cost };
  }

  // ---------- COMMAND 完成 → 掷硬币 + 系统结算 ----------
  resolve() {
    if (this.phase !== 'COMMAND') return { error: '当前不是下令阶段' };
    const alive = this._aliveSeats();
    for (const s of alive) if (this.bets[s.id] == null) return { error: `席位 ${s.id} 未下注` };
    // Boss 出注（人格脚本 → 合法边界夹紧）
    const bb = betBounds({ balance: this.boss.balance, role: 'landlord', farmerCount: alive.length, config: this.config, mode: 'single' });
    const frac = this.persona.betFrac({ bossBalance: this.boss.balance, bossInitial: this.boss.initial, round: this.round });
    this.bossBet = bb.forceAllIn ? this.boss.balance : Math.min(bb.max, Math.max(bb.min, Math.round(this.boss.balance * frac)));
    this.ghostBet = this.boss.ghost ? ghostMaxBet(this.bossBet, this.boss.ghostBalance) : 0;
    // 硬币（幸运儿：队里有 lucky 且存活 → 概率偏移；Boss 侧幸运儿未实装=enemy false）
    const hasLucky = alive.some(s => s.role === 'lucky');
    const p = luckyWinProb({ mine: hasLucky, myPityLosses: hasLucky ? this.pityLosses : 0 }, this.config);
    const teamWin = this.rng() < p;
    return this._settle(teamWin);
  }

  // 暴食者重掷：败局窗口内消耗 1 次重掷，硬币重抽（继承当次概率，怜悯不重复叠加——§9.3）。
  requestReflip(seatId) {
    if (this.phase !== 'REFLIP') return { error: '当前不是重掷阶段' };
    const seat = this._seat(seatId);
    if (!seat || seat.role !== 'glutton') return { error: '只有暴食者可以重掷' };
    if (seat.reflipsLeft <= 0) return { error: '重掷次数已用尽' };
    if (this.usedReflipThisRound) return { error: '每回合最多重掷一次' };
    seat.reflipsLeft -= 1;
    this.usedReflipThisRound = true;
    const teamWin = this.rng() < this._pendingSettle.probability;
    return this._settle(teamWin);
  }

  passReflip() {
    if (this.phase !== 'REFLIP') return { error: '当前不是重掷阶段' };
    return this._book(this._pendingSettle);
  }

  // ---------- ALLOCATE：玩家给己队重排收益/债务（守恒校验后落账）----------
  allocate({ takes, debts }) {
    if (this.phase !== 'ALLOCATE') return { error: '当前不是分账阶段' };
    const plan = this._pendingSettle;
    const ids = this._aliveSeats().map(s => s.id);
    const sum = (o) => ids.reduce((x, id) => x + (o?.[id] ?? 0), 0);
    const bad = (o) => ids.some(id => !Number.isInteger(o?.[id] ?? 0) || (o?.[id] ?? 0) < 0);
    if (bad(takes) || bad(debts)) return { error: '分配必须是非负整数' };
    if (sum(takes) !== sum(plan.allocation.takes) || sum(debts) !== sum(plan.allocation.debts)) {
      return { error: '分配必须守恒（总量不变）' };
    }
    plan.allocation = { takes: { ...takes }, debts: { ...debts } };
    return this._book(plan);
  }

  confirmAllocate() {
    if (this.phase !== 'ALLOCATE') return { error: '当前不是分账阶段' };
    return this._book(this._pendingSettle);
  }

  // ---------- 内部：结算一枚硬币结果 ----------
  _settle(teamWin) {
    const alive = this._aliveSeats();
    const fids = alive.map(s => s.id);
    const start = {}; const bal = {}; const bets = { ...this.bets };
    // 席位余额尚未真正扣注/扣保金（setBet 只登记）——此处统一换算成「下注后余额」口径
    for (const s of alive) { bal[s.id] = s.balance - (this.bets[s.id] ?? 0) - s.pledge; start[s.id] = s.balance; }
    bets.L = this.bossBet + this.ghostBet;                  // 阵营总注（§9.1 多地主）
    const startBoss = this.boss.balance;
    bal.L = this.boss.balance - this.bossBet;               // 幽灵注从幽灵资金出，不动 Boss 余额
    start.L = startBoss;
    // 投资人减免（单人口径：己方输即生效，含注金；倍率 config）
    const waiver = teamWin ? 0 : alive.reduce((x, s) => x + s.pledge, 0) * (this.config.single.investor.waiverMultiplier ?? 1);
    const settlement = settleRound({
      coinResult: teamWin ? 'tails' : 'heads', bets, balances: bal,
      landlordId: 'L', landlordRole: 'landlord', farmerIds: fids, config: this.config, debtWaiver: waiver,
    });
    const probability = (() => {                            // REFLIP 继承当次概率（§9.3）
      const hasLucky = alive.some(s => s.role === 'lucky');
      return luckyWinProb({ mine: hasLucky, myPityLosses: hasLucky ? this.pityLosses : 0 }, this.config);
    })();
    const plan = { teamWin, settlement, allocation: { takes: { ...settlement.takes }, debts: { ...settlement.debts } }, bal, start, bets, fids, probability };
    // 败局 + 暴食者有次数且本回合未用 → 开重掷决策窗
    const canReflip = !teamWin && !this.usedReflipThisRound && alive.some(s => s.role === 'glutton' && s.reflipsLeft > 0);
    if (canReflip) { this._pendingSettle = plan; this.phase = 'REFLIP'; return { ok: true, phase: 'REFLIP', teamWin }; }
    // 有可分配内容（多席位且有收益或债务）→ 开分账窗；否则直接落账
    const hasAlloc = this.fidsWithAlloc(plan).length > 1;
    if (hasAlloc) { this._pendingSettle = plan; this.phase = 'ALLOCATE'; return { ok: true, phase: 'ALLOCATE', teamWin, plan: { takes: plan.allocation.takes, debts: plan.allocation.debts } }; }
    return this._book(plan);
  }

  fidsWithAlloc(plan) {
    const ids = plan.fids;
    const any = ids.some(id => (plan.allocation.takes[id] ?? 0) > 0 || (plan.allocation.debts[id] ?? 0) > 0);
    return any ? ids : [];
  }

  // ---------- 内部：把结算落账 + 幽灵/监管/工资/饭账/生死，推进回合 ----------
  _book(plan) {
    const { teamWin, settlement, allocation, bal, start, bets, fids } = plan;
    const r = applyAllocation({ settlement, allocation, balances: bal, bets, landlordId: 'L', farmerIds: fids, startBalances: start, config: this.config });
    const events = [];
    // 玩家队入账
    for (const s of this._aliveSeats()) s.balance = r.after[s.id];
    // 幽灵幻影（§9.3）：队胜时，彩池里幽灵注是幻影 → 各席位实拿等比缩水（进虚空）
    if (teamWin && this.ghostBet > 0) {
      const pot = Object.values(bets).reduce((x, y) => x + y, 0);
      const red = phantomReduction({ takes: allocation.takes, ghostBet: this.ghostBet, pot, config: this.config });
      for (const s of this._aliveSeats()) s.balance -= red.reductions[s.id] ?? 0;
      events.push({ type: 'phantom', voided: red.total });
    }
    // Boss 侧入账：多地主按出资比例分（§9.1），幽灵份额进虚空、注金保底收回
    let bossAfter = r.after.L;
    if (this.ghostBet > 0) {
      const sideIncome = bossAfter - bal.L;                 // 本回合阵营总进账
      if (sideIncome > 0) {
        const split = splitLandlordSide({
          income: sideIncome,
          members: [{ id: 'L', bet: this.bossBet }, { id: 'G', bet: this.ghostBet, ghost: true }],
          config: this.config,
        });
        bossAfter = bal.L + split.shares.L;
        events.push({ type: 'ghostVoid', voided: split.voided });
      }
      // 幽灵永远收回注金：ghostBalance 不变（§9.3）
    }
    // 检察官·监管罚金：Boss 直接损失 2×监管费，进虚空（§9.2）
    if (this.summon.pendingPenalty > 0) {
      const pay = Math.min(bossAfter, this.summon.pendingPenalty);
      bossAfter -= pay;
      events.push({ type: 'summonPenalty', amount: pay });
      this.summon.pendingPenalty = 0;
    }
    this.boss.balance = bossAfter;
    // 幸运儿被动（§9.3）：敌胜 → 每个存活幸运儿 −lossDrain、怜悯 +1；队胜 → 怜悯清零
    if (!teamWin) {
      const drain = this.config.single.lucky.lossDrain ?? 1;
      for (const s of this._aliveSeats()) if (s.role === 'lucky') s.balance -= drain;
      this.pityLosses += 1;
    } else {
      this.pityLosses = 0;
    }
    // 暴食者饭账：每回合固定扣、无视输赢（§9.2）
    const meal = this.config.single.glutton.allowancePerRound ?? 1;
    for (const s of this._aliveSeats()) if (s.role === 'glutton') { s.balance -= meal; s.mealDebt += meal; }
    // 工资（凭空铸造，破产判定前——可救活濒死农民）
    const wage = singleWage(this._farmerCount(), this.round, this.config);
    if (wage > 0) for (const s of this._aliveSeats()) s.balance += wage;
    // 生死判定
    const threshold = this.config.bankruptcyThreshold ?? 0;
    for (const s of this._aliveSeats()) if (s.balance <= threshold) { s.dead = true; events.push({ type: 'seatDead', seatId: s.id, role: s.role }); }
    if (this.boss.balance <= threshold) this.winner = 'team';
    else if (this._aliveSeats().length === 0) this.winner = 'boss';
    // 收尾
    this.lastRoundResult = { round: this.round, teamWin, deltas: r.deltas, events, bossBet: this.bossBet, ghostBet: this.ghostBet };
    this.bets = {}; this.bossBet = 0; this.ghostBet = 0;
    for (const s of this.seats) s.pledge = 0;
    this.usedReflipThisRound = false;
    this._pendingSettle = null;
    if (this.winner) { this.phase = 'ENDED'; return { ok: true, phase: 'ENDED', winner: this.winner, teamWin }; }
    this.round += 1;
    this.phase = 'COMMAND';
    return { ok: true, phase: 'COMMAND', teamWin };
  }

  // ---------- 视图（单人无隐私剥离；Boss 出注意图=半电报，§9.1 待实测）----------
  view() {
    return {
      mode: 'single', phase: this.phase, round: this.round, winner: this.winner,
      seats: this.seats.map(s => ({ ...s })),
      boss: { ...this.boss, intent: this.persona.id },      // 人格明牌=意图电报的最简形态
      bets: { ...this.bets },
      summon: { ...this.summon, cooldownOk: summonCooldownOk(this.round, this.summon.lastRound, this._farmerCount(), this.config), cost: singleSummonCost(this._farmerCount(), this.config) },
      pityLosses: this.pityLosses,
      lastRoundResult: this.lastRoundResult,
      pendingPlan: this.phase === 'ALLOCATE' ? { takes: { ...this._pendingSettle.allocation.takes }, debts: { ...this._pendingSettle.allocation.debts } } : null,
    };
  }
}
