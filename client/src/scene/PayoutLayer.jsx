// 桌面显式结算编导层（§3.8，纯表现）：SETTLE 起接管全部桌面钱渲染——
//   聚拢（各家下注堆→彩池）→ 分堆（彩池重新数钱、朝各得主方向分成几份）→ 派送（滑进各家圆圈）
//   → 协商实时镜像（对账机制）→ FINALIZE 收账/技能调整（通用 adjust 步 + 浮动标签）
//   → 拿取（自己的堆飞向右下资金蜡烛、他人的堆飞向其身体收拢）。
// 服务端只发「谁给谁多少」（state.payout.script/piles），这里翻译成弧线飞牌；
// 播完队列后与权威 piles 对账、差额自动飞牌追平——协商镜像与地主的 FINALIZE 追平共用该机制。
// 新机制（新的 adjust source）无需改这里：flows 通用演出 + payoutText 文案回落服务端 label。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { decompose } from '../game/notes';
import { labelForStep } from '../game/payoutText';
import { getCoinRest } from './coinSim';
import { MoneyStack, ArcNote, cardLocal, cardYaw, stackTopY, TABLE_TOP } from './cards';
import PixelText from '../assets/pixelfont/PixelText';
import { P } from '../assets/palette';

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SPEED = REDUCED ? 0.03 : 1;             // 减少动态：飞行近乎瞬时（终态一致）
const S = (ms) => Math.max(1, ms * SPEED);
const UP = new THREE.Vector3(0, 1, 0);

const notesOf = (amount, debt = false) => decompose(amount).map(n => (debt ? { ...n, debt: true } : n));

// ---------------------------------------------------------------------------
// 导演：拥有桌面钱的本地模型 + 步骤队列 + 计时器。React 侧只做 render = f(model)。
class Director {
  constructor(bump, ctxRef) {
    this._bump = bump;
    this._ctxRef = ctxRef;        // 组件每次渲染后刷新：{spot, body, hand, potSpot, playerId}
    this.reset();
  }

  get ctx() { return this._ctxRef.current; }

  reset() {
    this.model = { piles: {}, debts: {}, pot: [], clusters: [], flights: [], labels: [], potAmount: null };
    this.tasks = [];              // {rel, due, fn} —— 帧钟排程（见 at/update）
    this.now = null;              // 渲染帧钟（ms）；首帧前为 null
    this.queue = [];
    this.running = false;
    this.inited = false;
    this.playedMax = 0;
    this.seenTaken = new Set();
    this.latestPiles = {};
    this.latestDebts = {};
    this.seq = 0;
    this._pot = null;             // 彩池落点：首次使用时按硬币落点惰性解析（reset 每回合重解）
  }

  // 彩池落点：等到真正要用（首帧后）才解析——硬币落定位置那时才可知
  potSpot() {
    if (!this._pot) this._pot = this.ctx?.resolvePotSpot() ?? [1.05, 0, 0];
    return this._pot;
  }

  dispose() { this.reset(); }
  bump() { this._bump(); }

  // 排程用与 ArcNote 相同的渲染帧钟（DirectorClock 每帧驱动 update），而非 setTimeout：
  // 慢机/软渲染下首帧编译会停几秒，墙钟计时器会在飞牌还没画出来时就切下一步。
  at(ms, fn) {
    this.tasks.push({ rel: ms, due: this.now != null ? this.now + ms : null, fn });
  }

  update(nowMs) {
    this.now = nowMs;
    for (const t of this.tasks) { if (t.due == null) t.due = nowMs + t.rel; }
    const ready = this.tasks.filter(t => t.due <= nowMs);
    if (!ready.length) return;
    this.tasks = this.tasks.filter(t => t.due > nowMs);
    for (const t of ready) t.fn();
  }

  // ---------- 模型操作 ----------
  pile(pid) { return (this.model.piles[pid] ??= { amount: 0, notes: [] }); }
  debtPile(pid) { return (this.model.debts[pid] ??= { amount: 0, notes: [] }); }
  setPile(pid, amount) { this.model.piles[pid] = { amount, notes: notesOf(amount) }; }
  setDebt(pid, amount) { this.model.debts[pid] = { amount, notes: notesOf(amount, true) }; }
  // 从堆顶抽走 amount：堆金额减少并按余额重摆，返回飞出的钱牌
  drawFrom(pid, amount, debt = false) {
    const p = debt ? this.debtPile(pid) : this.pile(pid);
    const take = Math.min(p.amount, amount);
    p.amount -= take;
    p.notes = notesOf(p.amount, debt);
    return notesOf(amount, debt);
  }
  landInto(pid, note, debt = false) {
    const p = debt ? this.debtPile(pid) : this.pile(pid);
    p.amount += note.value;
    p.notes = [...p.notes, note];
  }
  addLabel(pos, text, tone) {
    const key = `lb${++this.seq}`;
    this.model.labels.push({ key, pos, text, tone });
    this.at(1600, () => { this.model.labels = this.model.labels.filter(l => l.key !== key); this.bump(); });
  }
  // 生成一批飞牌；onLand 每张落定回调。返回总时长估计（ms；真正的步进闸门看飞牌排空，见 _advance）
  fly(notes, fromOf, toOf, { dur = 620, stagger = 45, delay0 = 0, apex = 0.75, growIn = false, shrinkOut = false, debt = false, onLand } = {}) {
    notes.forEach((note, i) => {
      const key = `f${++this.seq}`;
      this.model.flights.push({
        key, value: note.value, debt: debt || !!note.debt,
        from: fromOf(i), to: toOf(i),
        delay: ((delay0 + i * stagger) * SPEED) / 1000, duration: (dur * SPEED) / 1000,
        apex, growIn, shrinkOut,
        yawEnd: toOf.yaw ? toOf.yaw(i) : 0,
        onDone: () => {
          this.model.flights = this.model.flights.filter(f => f.key !== key);
          onLand?.(note, i);
          this.bump();
        },
      });
    });
    return S(delay0 + dur + stagger * notes.length);
  }

  // ---------- 状态同步入口（组件 useEffect 调用） ----------
  sync(snap) {
    const { phase, payout, players, myStackNotes } = snap;
    this.latestPiles = payout.piles ?? {};
    this.latestDebts = snap.debts ?? {};

    if (!this.inited) {
      this.inited = true;
      if (phase === 'SETTLE') {
        // 正常流：从当前下注堆无缝接管（自己的堆沿用飞上桌的那批牌模型）
        for (const p of players) {
          if (!p.hasBet || !(p.bet > 0)) continue;
          const notes = p.id === snap.playerId && myStackNotes ? myStackNotes : decompose(p.bet);
          this.model.piles[p.id] = { amount: p.bet, notes };
        }
      } else {
        // 冷挂载（断线重连/画廊直入协商或拿取阶段）：直接摆终态，不重播
        for (const [pid, amount] of Object.entries(this.latestPiles)) this.setPile(pid, amount);
        for (const [pid, amount] of Object.entries(this.latestDebts)) if (amount > 0) this.setDebt(pid, amount);
        this.playedMax = Math.max(0, ...payout.script.map(s => s.id));
        for (const pid of payout.taken) this.seenTaken.add(pid);
      }
      this.bump();
    }

    for (const step of payout.script) {
      if (step.id <= this.playedMax) continue;
      this.playedMax = step.id;
      this.queue.push({ kind: step.t, step });
    }
    for (const pid of payout.taken) {
      if (this.seenTaken.has(pid)) continue;
      this.seenTaken.add(pid);
      this.queue.push({ kind: 'take', pid });
    }
    if (!this.queue.some(t => t.kind === 'reconcile')) this.queue.push({ kind: 'reconcile' });
    this.at(0, () => this.pump()); // 首帧后再开播：硬币落点/相机那时才齐备
  }

  get busy() { return this.running || this.queue.length > 0; }

  pump() {
    if (this.running) return;
    const task = this.queue.shift();
    if (!task) { this.bump(); return; }
    this.running = true;
    const ms = this.play(task);
    this.bump();
    this.at(Math.max(1, ms), () => this._advance());
  }

  // 步进闸门：到时且【场上所有飞牌都已落定】才进下一步——落牌按帧结算，低帧率下
  // 光靠时长估计会让对账/下一步抢在落定之前跑（曾导致钱堆翻倍、彩池残留）。
  _advance() {
    if (this.model.flights.length > 0) { this.at(60, () => this._advance()); return; }
    this.running = false;
    this.pump();
  }

  play(task) {
    switch (task.kind) {
      case 'gather': return this.playGather(task.step);
      case 'split': return this.playSplit(task.step);
      case 'adjust': return this.playAdjust(task.step);
      case 'take': return this.playTake(task.pid);
      case 'reconcile': return this.playReconcile();
      default: return 1;
    }
  }

  // ---------- ① 聚拢：各家下注堆 → 彩池 ----------
  playGather(step) {
    const potSpot = this.potSpot();
    let slot = 0;
    let ms = 0;
    for (const c of step.from) {
      const p = this.pile(c.id);
      const notes = p.notes.length ? p.notes : decompose(c.amount);
      this.model.piles[c.id] = { amount: 0, notes: [] };
      const spot = this.ctx.spot(c.id);
      const base = slot;
      ms = Math.max(ms, this.fly(
        notes,
        (i) => { const l = cardLocal(i); return [spot.x + l[0], l[1], spot.z + l[2]]; },
        Object.assign((i) => { const l = cardLocal(base + i); return [potSpot[0] + l[0], l[1], potSpot[2] + l[2]]; },
          { yaw: (i) => cardYaw(base + i) }),
        { dur: 620, stagger: 40, apex: 0.85, onLand: (note) => { this.model.pot = [...this.model.pot, note]; } },
      ));
      slot += notes.length;
    }
    this.at(ms, () => { this.model.potAmount = step.pot; this.bump(); });
    return ms + S(260); // 彩池成形后小驻留（亮金额）
  }

  // ---------- ② 分堆 + 派送：彩池重新数钱 → 朝各得主方向分成几份 → 滑进圆圈 ----------
  playSplit(step) {
    const potSpot = this.potSpot();
    if (!step.shares.length) { this.model.pot = []; this.model.potAmount = null; return S(200); }
    const potSlots = Math.max(1, this.model.pot.length);
    this.model.pot = [];                    // 彩池「数钱重摆」：原牌撤下，按各份重新发出
    this.model.potAmount = null;
    const beatA = 480, dwell = 300;
    let maxA = 0, maxB = 0;
    const clusters = step.shares.map((share, k) => {
      const spot = this.ctx.spot(share.id);
      const dx = spot.x - potSpot[0], dz = spot.z - potSpot[2];
      const d = Math.hypot(dx, dz) || 1;
      return { key: `c${k}`, share, notes: notesOf(share.amount), pos: [potSpot[0] + (dx / d) * 0.78, potSpot[2] + (dz / d) * 0.78] };
    });
    clusters.forEach((cl, k) => {
      const clSlot = (i) => { const l = cardLocal(i); return [cl.pos[0] + l[0] * 0.6, l[1], cl.pos[1] + l[2] * 0.6]; };
      // 拍 A：彩池 → 份堆（朝得主方向分成几份）
      maxA = Math.max(maxA, this.fly(
        cl.notes,
        (i) => { const l = cardLocal((k * 3 + i) % potSlots); return [potSpot[0] + l[0], l[1], potSpot[2] + l[2]]; },
        clSlot,
        { dur: beatA, stagger: 36, apex: 0.5, onLand: (note) => { const c = this.model.clusters.find(x => x.key === cl.key); if (c) c.notes = [...c.notes, note]; } },
      ));
      this.model.clusters.push({ key: cl.key, notes: [], pos: cl.pos });
    });
    // 拍 B：各份滑进得主圆圈
    this.at(maxA + S(dwell), () => {
      this.model.clusters = [];
      clusters.forEach((cl) => {
        const spot = this.ctx.spot(cl.share.id);
        const clSlot = (i) => { const l = cardLocal(i); return [cl.pos[0] + l[0] * 0.6, l[1], cl.pos[1] + l[2] * 0.6]; };
        maxB = Math.max(maxB, this.fly(
          cl.notes,
          clSlot,
          Object.assign((i) => { const l = cardLocal(i); return [spot.x + l[0], l[1], spot.z + l[2]]; }, { yaw: cardYaw }),
          { dur: 560, stagger: 36, apex: 0.35, onLand: (note) => this.landInto(cl.share.id, note) },
        ));
      });
      this.bump();
    });
    const maxShare = Math.max(...clusters.map(c => c.notes.length));
    return maxA + S(dwell) + S(560 + 36 * maxShare) + S(180);
  }

  // ---------- ③ 通用调整步：技能/机制改变钱堆（工资/罚金/收账/池/税/饭账/未来新机制） ----------
  playAdjust(step) {
    const text = labelForStep(step);
    let ms = 0;
    const paidFrom = {};
    step.flows.forEach((flow, k) => {
      const src = this.anchor(flow.from, flow.amount, true);
      const dst = this.anchor(flow.to, flow.amount, false);
      if (flow.from?.id) paidFrom[flow.from.id] = (paidFrom[flow.from.id] ?? 0) + flow.amount;
      ms = Math.max(ms, this.fly(
        src.notes,
        src.slotOf,
        dst.slotOf,
        {
          dur: 620, stagger: 55, delay0: k * 140, apex: dst.rise ? 0.25 : 0.7,
          growIn: src.grow, shrinkOut: dst.shrink,
          onLand: dst.land,
        },
      ));
    });
    // 浮动标签：每个涉事玩家一条 ±N
    const delta = {};
    for (const f of step.flows) {
      if (f.to?.kind === 'pile') delta[f.to.id] = (delta[f.to.id] ?? 0) + f.amount;
      if (f.from?.kind === 'pile' || f.from?.kind === 'hand') delta[f.from.id] = (delta[f.from.id] ?? 0) - f.amount;
    }
    for (const [pid, d] of Object.entries(delta)) {
      if (d === 0) continue;
      const spot = this.ctx.spot(pid);
      this.addLabel([spot.x, stackTopY(6) + 0.42, spot.z], `${text} ${d > 0 ? '+' : ''}${d}`, d > 0 ? 'ok' : 'danger');
    }
    // 收账步收尾：红色债务牌谢幕——实付部分已飞走；真有坏账（uncovered>0）才标「无力偿还」
    // （地主在协商期看的是冻结方案，若债被挪走但全额付清，按本地残差标注会误报）
    if (step.source === 'debtCollect') {
      this.at(ms, () => {
        if (step.uncovered > 0) {
          for (const [pid, dp] of Object.entries(this.model.debts)) {
            const residual = dp.amount - Math.min(dp.amount, paidFrom[pid] ?? 0);
            if (residual > 0) {
              const spot = this.ctx.spot(pid);
              this.addLabel([spot.x, stackTopY(3) + 0.3, spot.z], `无力偿还 ${residual}`, 'danger');
            }
          }
        }
        this.model.debts = {};
        this.bump();
      });
      ms += S(240);
    }
    return ms + S(320);
  }

  // flow 端点 → 锚（notes 来源 / 槽位函数 / 渐入渐出 / 落定回调）
  anchor(end, amount, isSource) {
    const kind = end?.kind ?? 'void';
    const pid = end?.id;
    if (kind === 'pile') {
      const spot = this.ctx.spot(pid);
      if (isSource) {
        const notes = this.drawFrom(pid, amount);
        return { notes, slotOf: (i) => { const l = cardLocal(this.pile(pid).notes.length + 1 + i); return [spot.x + l[0], l[1], spot.z + l[2]]; }, grow: false };
      }
      return {
        slotOf: Object.assign((i) => { const l = cardLocal(this.pile(pid).notes.length + i); return [spot.x + l[0], l[1], spot.z + l[2]]; }, { yaw: () => 0 }),
        land: (note) => this.landInto(pid, note),
      };
    }
    if (kind === 'hand') {
      const point = pid === this.ctx.playerId ? this.ctx.hand() : this.ctx.body(pid);
      if (isSource) return { notes: notesOf(amount), slotOf: () => point, grow: true };
      return { slotOf: () => point, shrink: true };
    }
    if (kind === 'pool') {
      const point = this.ctx.body(pid);
      if (isSource) return { notes: notesOf(amount), slotOf: () => point, grow: true };
      return { slotOf: () => point, shrink: true };
    }
    // void：凭空出现（工资从天而降）/ 凭空消失（税收、饭账升起熄灭）
    const pot = this.potSpot();
    if (isSource) {
      return { notes: notesOf(amount), slotOf: () => [pot[0], TABLE_TOP + 1.6, pot[2]], grow: true };
    }
    return { slotOf: () => [pot[0], TABLE_TOP + 1.1, pot[2]], shrink: true, rise: true };
  }

  // ---------- ④ 拿取：自己的堆 → 右下资金蜡烛；他人的堆 → 其身体收拢 ----------
  playTake(pid) {
    const p = this.pile(pid);
    if (p.amount <= 0 && p.notes.length === 0) return 1;
    const spot = this.ctx.spot(pid);
    const amount = p.amount;
    const notes = p.notes.length ? p.notes : notesOf(amount);
    this.model.piles[pid] = { amount: 0, notes: [] };
    const target = pid === this.ctx.playerId ? this.ctx.hand() : this.ctx.body(pid);
    const ms = this.fly(
      notes,
      (i) => { const l = cardLocal(i); return [spot.x + l[0], l[1], spot.z + l[2]]; },
      () => target,
      { dur: 660, stagger: 42, apex: 0.9, shrinkOut: true },
    );
    this.addLabel([spot.x, stackTopY(4) + 0.3, spot.z], `+${amount}`, 'ok');
    return ms + S(120);
  }

  // ---------- ⑤ 对账：本地堆与服务端权威 piles/debts 的差额自动飞牌追平 ----------
  // 协商实时镜像（农民视角逐笔转移）与地主的 FINALIZE 一次性追平共用此机制。
  playReconcile() {
    let ms = 0;
    ms = Math.max(ms, this.reconcilePool(this.latestPiles, false));
    ms = Math.max(ms, this.reconcilePool(this.latestDebts, true));
    return ms === 0 ? 1 : ms + S(120);
  }

  reconcilePool(target, debt) {
    const local = debt ? this.model.debts : this.model.piles;
    const ids = new Set([...Object.keys(target), ...Object.keys(local)]);
    const dec = [], inc = [];
    for (const pid of ids) {
      if (!debt && this.seenTaken.has(pid)) continue;    // 已拿取的堆归零由 take 演出负责
      const d = (target[pid] ?? 0) - (local[pid]?.amount ?? 0);
      if (d > 0) inc.push({ pid, amount: d });
      else if (d < 0) dec.push({ pid, amount: -d });
    }
    if (!dec.length && !inc.length) return 0;
    let ms = 0;
    // 双向配对：减者飞向增者（协商转移的常态；金额守恒时正好清空两表）
    for (const from of dec) {
      while (from.amount > 0 && inc.length) {
        const to = inc[0];
        const move = Math.min(from.amount, to.amount);
        from.amount -= move; to.amount -= move;
        if (to.amount === 0) inc.shift();
        ms = Math.max(ms, this.flyBetween(from.pid, to.pid, move, debt));
      }
      if (from.amount > 0) {  // 无对家：就地消失（冷态修正兜底）
        const notes = this.drawFrom(from.pid, from.amount, debt);
        const spot = this.ctx.spot(from.pid);
        ms = Math.max(ms, this.fly(notes, (i) => { const l = cardLocal(i); return [spot.x + l[0], l[1], spot.z + l[2]]; },
          () => [spot.x, TABLE_TOP + 1.2, spot.z], { dur: 480, apex: 0.15, shrinkOut: true, debt }));
      }
    }
    for (const to of inc) {   // 无对家：凭空落下（冷态修正兜底）
      if (to.amount <= 0) continue;
      const spot = this.ctx.spot(to.pid);
      ms = Math.max(ms, this.fly(notesOf(to.amount, debt),
        () => [spot.x, TABLE_TOP + 1.5, spot.z],
        Object.assign((i) => { const l = cardLocal((debt ? this.debtPile(to.pid) : this.pile(to.pid)).notes.length + i); return [spot.x + l[0], l[1], spot.z + l[2]]; }, { yaw: () => 0 }),
        { dur: 480, apex: 0.1, growIn: true, debt, onLand: (note) => this.landInto(to.pid, note, debt) }));
    }
    return ms;
  }

  flyBetween(fromPid, toPid, amount, debt) {
    const notes = this.drawFrom(fromPid, amount, debt);
    const a = this.ctx.spot(fromPid), b = this.ctx.spot(toPid);
    return this.fly(
      notes,
      (i) => { const l = cardLocal(i); return [a.x + l[0], l[1] + 0.12, a.z + l[2]]; },
      Object.assign((i) => { const l = cardLocal((debt ? this.debtPile(toPid) : this.pile(toPid)).notes.length + i); return [b.x + l[0], l[1], b.z + l[2]]; }, { yaw: () => 0 }),
      { dur: 560, stagger: 45, apex: 0.6, debt, onLand: (note) => this.landInto(toPid, note, debt) },
    );
  }
}

// 用渲染帧钟驱动导演排程（与 ArcNote 同源时钟，慢机/软渲染下步骤与飞牌永不脱节）
function DirectorClock({ dir }) {
  useFrame((st) => dir.update(st.clock.elapsedTime * 1000));
  return null;
}

// ---------------------------------------------------------------------------
export default function PayoutLayer({ players, seats, spots, playerId, rot }) {
  const state = useGameStore(s => s.state);
  const myStack = useGameStore(s => s.myStack);
  const send = useGameStore(s => s.send);
  const { camera, size } = useThree();
  // 导演是「可变外部模型」：每次变动调 bump 触发重渲，render = f(dir.model)。挂载期恒定单例。
  const [, bump] = useState(0);
  const ctxRef = useRef(null);
  const [dir] = useState(() => new Director(() => bump(v => v + 1), ctxRef));
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__payoutDir = dir; // 调试/截图探针用
  }, [dir]);

  const payout = state.payout;
  const phase = state.phase;

  // 位置索引：pid → 圆圈落点 / 座位
  const spotByPid = useMemo(() => {
    const m = {};
    players.forEach((p, i) => { m[p.id] = spots[i]; });
    return m;
  }, [players, spots]);
  const seatByPid = useMemo(() => {
    const m = {};
    players.forEach((p, i) => { m[p.id] = seats[i]; });
    return m;
  }, [players, seats]);

  // 导演的位置解析上下文：每次渲染后刷新（飞行在 effect/定时器里生成，取到最新相机/座位；
  // 手点/彩池落点惰性求值——生成那一刻硬币落点、资金蜡烛屏幕位置才可知）
  useEffect(() => {
    ctxRef.current = {
      playerId,
      // 彩池落点：贴着硬币躺点挪开一步（不压住命运硬币）；无硬币信息时退到 +x 空毡区
      resolvePotSpot: () => {
        const rest = getCoinRest();
        let x = 1.05, z = 0;
        if (rest) {
          const d = Math.hypot(rest.x, rest.z);
          const dx = d > 0.15 ? -rest.x / d : 1, dz = d > 0.15 ? -rest.z / d : 0;
          x = rest.x + dx * 1.05; z = rest.z + dz * 1.05;
        }
        return [Math.max(-2.1, Math.min(2.1, x)), 0, Math.max(-1.25, Math.min(1.25, z))];
      },
      spot: (pid) => spotByPid[pid] ?? { x: 0, z: 0 },
      body: (pid) => {
        const seat = seatByPid[pid] ?? { x: 0, z: 2.65 };
        return [seat.x * 0.86, 1.18, seat.z * 0.86];
      },
      hand: () => {
        const el = document.querySelector('.balance-hud') ?? document.querySelector('[data-hand-anchor]');
        const r = el?.getBoundingClientRect();
        const sx = r ? r.x + r.width / 2 : size.width * 0.82;
        const sy = r ? r.y + r.height / 2 : size.height * 0.86;
        const v = new THREE.Vector3((sx / size.width) * 2 - 1, -(sy / size.height) * 2 + 1, 0.82)
          .unproject(camera).applyAxisAngle(UP, -rot);
        v.y = Math.max(v.y, TABLE_TOP + 0.1);
        return [v.x, v.y, v.z];
      },
    };
  });

  // 状态同步：脚本步/拿取/对账 进导演队列
  const debts = phase === 'NEGOTIATE'
    ? (state.allocation?.debts ?? state.settlement?.debts ?? {})
    : phase === 'SETTLE' ? (state.settlement?.debts ?? {}) : {};
  useEffect(() => {
    if (!payout) return;
    dir.sync({
      phase, payout, players, playerId, debts,
      myStackNotes: myStack && myStack.round === state.round ? myStack.notes : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payout, phase]);

  useEffect(() => () => dir.dispose(), [dir]);

  const m = dir.model;
  const potAmount = m.potAmount;
  const potPos = dir._pot ?? [1.05, 0, 0]; // 彩池有内容时必已解析（playGather 首帧解析）
  const myPile = m.piles[playerId];
  const canTake = phase === 'FINALIZE'
    && payout?.eligible?.includes(playerId)
    && !payout?.taken?.includes(playerId)
    && !dir.busy
    && (myPile?.amount ?? 0) > 0;
  const mySpot = spotByPid[playerId];

  return (
    <group>
      <DirectorClock dir={dir} />
      {/* 各家圆圈钱堆 + 红色债务标记（金额公开） */}
      {Object.entries(m.piles).map(([pid, p]) => (p.notes.length > 0 || p.amount > 0) && (
        <MoneyStack key={`pp-${pid}`} notes={p.notes} amount={p.amount > 0 ? p.amount : null} faceUp position={[spotByPid[pid]?.x ?? 0, 0, spotByPid[pid]?.z ?? 0]} />
      ))}
      {Object.entries(m.debts).map(([pid, p]) => p.notes.length > 0 && (
        <group key={`pd-${pid}`} position={[(spotByPid[pid]?.x ?? 0) * 0.72, 0, (spotByPid[pid]?.z ?? 0) * 0.72]}>
          <MoneyStack notes={p.notes} amount={p.amount > 0 ? -p.amount : null} faceUp position={[0, 0, 0]} labelColor={P.danger} />
        </group>
      ))}
      {/* 彩池与分堆中的份堆 */}
      {(m.pot.length > 0 || potAmount != null) && (
        <MoneyStack notes={m.pot} amount={potAmount} faceUp position={potPos} />
      )}
      {m.clusters.map(cl => (
        <group key={cl.key} position={[cl.pos[0], 0, cl.pos[1]]} scale={[0.6, 1, 0.6]}>
          <MoneyStack notes={cl.notes} faceUp position={[0, 0, 0]} />
        </group>
      ))}
      {/* 飞行中的钱牌 */}
      {m.flights.map(({ key, ...f }) => <ArcNote key={key} {...f} />)}
      {/* 浮动结算标签（工资 +2 / 饭账 −3 / 无力偿还…） */}
      {m.labels.map(l => (
        <Html key={l.key} position={l.pos} center distanceFactor={6} zIndexRange={[26, 0]}>
          <div className={`payout-float ${l.tone}`}>
            <PixelText size={2} color={l.tone === 'danger' ? 'var(--danger)' : 'var(--ok)'}>{l.text}</PixelText>
          </div>
        </Html>
      ))}
      {/* 拿取 (F)：只出现在自己的堆上 */}
      {canTake && mySpot && (
        <Html position={[mySpot.x, stackTopY(myPile.notes.length) + 0.34, mySpot.z]} center distanceFactor={6.5} zIndexRange={[30, 0]}>
          <button className="take-prompt" onClick={() => send({ type: 'take_payout' })}>
            <PixelText size={2} color="var(--c-wood-900)">拿取</PixelText>
            <span className="take-key">F</span>
          </button>
        </Html>
      )}
    </group>
  );
}
