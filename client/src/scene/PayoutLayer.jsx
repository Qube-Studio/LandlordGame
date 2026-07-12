// 桌面显式结算编导层（§3.8，纯表现）：SETTLE 起接管全部桌面钱渲染——
//   聚拢（各家下注堆→彩池）→ 分堆（彩池重新数钱、朝各得主方向分成几份）→ 派送（滑进各家圆圈）
//   → 协商（3D 直接操作：重力枪拖自己的钱牌/债务牌到队友圈 = 转移；对账机制兜底镜像他人转移）
//   → FINALIZE 收账/技能调整（通用 adjust 步）→ 拿取（自己的堆飞向右下资金蜡烛，堆上浮纯文字「拿取 [F]」）。
// 服务端只发「谁给谁多少」（state.payout.script/piles），这里翻译成弧线飞牌；
// 播完队列后与权威 piles 对账、差额自动飞牌追平——协商镜像与地主的 FINALIZE 追平共用该机制。
// 新机制（新的 adjust source）无需改这里：flows 通用演出（金额变化直接体现在钱堆上，无浮动数字）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { decompose, splitNote, SPLITS } from '../game/notes';
import { IS_3D_INPUT } from '../game/inputMode';
import { getCoinRest } from './coinSim';
import { MoneyStack, ArcNote, cardLocal, cardYaw, stackTopY, promptAnchor, TABLE_TOP, CARD_W, CARD_T, CARD_D, cardMaterials } from './cards';
import { aimFromPointer, groundFromPointer, CarrySpring, CARRY_HEIGHT } from './carry';
import { TicketRow, TicketArc, ticketWorldPos, ticketGeometry, ticketMaterials } from './Tickets3D';
import { grab } from './grab';
import PromptFloat, { pushFloat } from './PromptFloat';
import KeyCap from '../assets/pixelfont/KeyCap';
import PixelText from '../assets/pixelfont/PixelText';
import { P } from '../assets/palette';
import { T } from '../text';

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
    this.model = { piles: {}, debts: {}, pot: [], clusters: [], flights: [], potAmount: null };
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
    this.holds = 0;               // 重力枪拖拽的引用计数：>0 时冻结队列/对账（牌在手上悬着/在途，账不平）。
                                  // 用计数而非布尔——快速连拖两张时，前一张落地不能提前解冻放行第二张的对账。
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
  // ---------- 协商 3D 拖拽（重力枪）用的模型操作 ----------
  // 抓走一张具体的牌（其余牌不重摆）；找不到（模型已重建）返回 null，调用方忽略本次抓取
  grabNoteById(pid, noteId, debt = false) {
    const p = debt ? this.debtPile(pid) : this.pile(pid);
    const note = p.notes.find(n => n.id === noteId);
    if (!note) return null;
    p.notes = p.notes.filter(n => n.id !== noteId);
    p.amount -= note.value;
    this.bump();
    return note;
  }
  // 长按拆分堆里的一张牌：只改组成不改金额（对账只比金额，组成随意）
  splitPileNote(pid, noteId, debt = false) {
    const p = debt ? this.debtPile(pid) : this.pile(pid);
    const before = p.notes.length;
    p.notes = splitNote(p.notes, noteId).map(n => (debt && !n.debt ? { ...n, debt: true } : n));
    if (p.notes.length !== before) this.bump();
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
    if (this.holds > 0) { this.at(80, () => this.pump()); return; }  // 拖拽中：整条队列等牌落回账上
    const task = this.queue.shift();
    if (!task) { this.bump(); return; }
    this.running = true;
    const ms = this.play(task);
    this.bump();
    this.at(Math.max(1, ms), () => this._advance());
  }

  // 步进闸门：到时且【场上所有飞牌都已落定、没有牌被拖着】才进下一步——落牌按帧结算，
  // 低帧率下光靠时长估计会让对账/下一步抢在落定之前跑（曾导致钱堆翻倍、彩池残留）。
  _advance() {
    if (this.holds > 0 || this.model.flights.length > 0) { this.at(60, () => this._advance()); return; }
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
  // 金额变化直接体现在钱堆与堆顶金额标签上，不再放「±N」浮动数字（明细在底部结算面板/账本）。
  playAdjust(step) {
    let ms = 0;
    step.flows.forEach((flow, k) => {
      const src = this.anchor(flow.from, flow.amount, true);
      const dst = this.anchor(flow.to, flow.amount, false);
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
    // 收账步收尾：红色债务牌谢幕（实付部分已飞走；坏账明细见底部结算面板）
    if (step.source === 'debtCollect') {
      this.at(ms, () => {
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
  // 自己的堆：**第一张**钱牌碰到蜡烛的那一帧就放开余额显示冻结（takePayout 按下时冻上）——
  // 数字随后续落牌一路涨上去（等最后一张才动会显得迟钝，被打回）；空堆/异常路径也必须放开，否则数字永冻。
  playTake(pid) {
    const self = pid === this.ctx.playerId;
    const release = () => { if (self) useGameStore.getState().releaseBalanceFreeze(); };
    const p = this.pile(pid);
    if (p.amount <= 0 && p.notes.length === 0) { release(); return 1; }
    const spot = this.ctx.spot(pid);
    const amount = p.amount;
    const notes = p.notes.length ? p.notes : notesOf(amount);
    this.model.piles[pid] = { amount: 0, notes: [] };
    const target = self ? this.ctx.hand() : this.ctx.body(pid);
    const ms = this.fly(
      notes,
      (i) => { const l = cardLocal(i); return [spot.x + l[0], l[1], spot.z + l[2]]; },
      () => target,
      { dur: 660, stagger: 42, apex: 0.9, shrinkOut: true, onLand: (_n, i) => { if (i === 0) release(); } },
    );
    this.at(ms, release); // 兜底（release 幂等）：万一首张 onDone 丢失也不永冻
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

// 协商拖拽中被抓着的牌（局部系：PayoutLayer 挂在场景旋转组内，指针射线先回世界再反旋进来）。
// 射线直接与携带高度平面求交——牌钉在指针正下方（反馈③，与 HandLayer 拖拽同手感）。
const _negoTarget = new THREE.Vector3(); // 每帧即用即弃的划痕向量
const _negoFelt = new THREE.Vector3();   // 松手瞬间「指针指到毡面哪里」的落点判定用
function NegoCarriedNote({ note, carryRef, ndcRef, rot }) {
  const ref = useRef();
  const { camera } = useThree();
  useFrame((_, dt) => {
    const c = carryRef.current;
    const m = ref.current;
    if (!c || !m) return;
    aimFromPointer(camera, ndcRef.current, CARRY_HEIGHT, _negoTarget);
    _negoTarget.applyAxisAngle(UP, -rot);
    c.spring.update(_negoTarget, dt);
    m.position.copy(c.spring.pos);
    c.spring.tilt(m.rotation);
    m.visible = true;
  });
  return (
    <mesh ref={ref} material={cardMaterials(note.value, !!note.debt)} castShadow visible={false}>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 被重力枪抓着的对质票（§8.8 协商拖票转赠）：与 NegoCarriedNote 同款弹簧跟随+速度倾斜。
// slack 0.7：票排在毡面边缘，允许拽到自己身前（默认毡面夹紧会拦在半路）。
function NegoCarriedTicket({ carryRef, ndcRef, rot }) {
  const ref = useRef();
  const { camera } = useThree();
  useFrame((_, dt) => {
    const c = carryRef.current;
    const m = ref.current;
    if (!c || !m) return;
    aimFromPointer(camera, ndcRef.current, CARRY_HEIGHT, _negoTarget, 0.7);
    _negoTarget.applyAxisAngle(UP, -rot);
    c.spring.update(_negoTarget, dt);
    m.position.copy(c.spring.pos);
    c.spring.tilt(m.rotation);
    m.visible = true;
  });
  return <mesh ref={ref} geometry={ticketGeometry()} material={ticketMaterials()} castShadow visible={false} />;
}

// 协商倒计时（浮字次行）：超时自动生效
function CountdownText({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 500);
    return () => clearInterval(id);
  }, [deadline]);
  return <PixelText size={2} color="var(--ink-dim)">{T.payout3d.autoEffect(left)}</PixelText>;
}

// ---------------------------------------------------------------------------
export default function PayoutLayer({ players, seats, spots, playerId, rot }) {
  const state = useGameStore(s => s.state);
  const myStack = useGameStore(s => s.myStack);
  const send = useGameStore(s => s.send);
  const spaceHeld = useGameStore(s => s.spaceHeld); // 协商确认行的合成按下态（空格松开才触发）
  const { camera, size } = useThree(); // camera 另用于协商松手时按指针所指毡面点判定落圈（反馈③）
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

  useEffect(() => () => { dir.dispose(); useGameStore.getState().releaseBalanceFreeze(); }, [dir]); // 卸载兜底：余额冻结绝不过夜

  // ---------- 协商 3D 直接操作：重力枪拖自己的钱牌/债务牌到队友圈 = 转移 ----------
  const canNegotiate = IS_3D_INPUT && phase === 'NEGOTIATE'
    && !!state.roundFarmerIds?.includes(playerId) && !state.me?.spectator;
  const [negoCarry, setNegoCarry] = useState(null);   // {note, kind}
  const negoCarryRef = useRef(null);
  // 对质票拖拽（§8.8 转赠）：与钱牌同一条指针管线（pressActiveRef/onMove/onUp），独立的按下/携带 ref。
  const ticketDownRef = useRef(null);                 // {x, y} 按下位置（超阈值转拖拽）
  const ticketCarryRef = useRef(null);                // {spring}
  const [ticketCarry, setTicketCarry] = useState(null);
  // 乐观票数（服务端回包前顶着显示，piles 乐观更新同理）：key=players 票数快照，快照一变旧差量即失效（渲染时忽略）。
  const [ticketDeltas, setTicketDeltas] = useState({ key: '', map: {} });
  const ticketKey = players.map(p => `${p.id}:${p.tickets ?? ''}`).join('|');
  const ticketDeltaMap = ticketDeltas.key === ticketKey ? ticketDeltas.map : {};
  // 票的落手飞行（转赠→飞进队友排 / 未落圈→飞回自己排）：hidePid 排在飞行期间少显 1 张（那张在空中）。
  const [ticketFlight, setTicketFlight] = useState(null); // {from,to,yaw,hidePid,key}
  const ticketFlightSeq = useRef(0);
  // 触屏：协商拖钱/拖票时相机 swipe 让位（帧级刷新；卸载兜底重置）
  useFrame(() => { grab.active = !!negoCarryRef.current || !!ticketCarryRef.current; });
  useEffect(() => () => { grab.active = false; }, []);
  const negoDownRef = useRef(null);
  const pressActiveRef = useRef(false);   // 真实按键是否仍按住（window pointerdown/up，可靠，不受 r3f 射线延迟影响）
  const ndcRef = useRef({ x: 0, y: 0 });
  const pressTimer = useRef(null);
  // 每次渲染后刷新的落点/座位快照：拖拽监听器只挂一次（见下方 effect 的稳定依赖），从这里读最新值，
  // 避免每条广播都重挂监听器——那会在长按拆分/拖拽途中被 cleanup 打断（丢牌/取消拆分）。
  const negoCtxRef = useRef({ spotByPid: {}, seatByPid: {}, farmerIds: [], ticketKey: '', ticketDeltaMap: {}, ticketsByPid: {} });
  useEffect(() => {
    const ticketsByPid = {};
    players.forEach(p => { ticketsByPid[p.id] = p.tickets ?? 0; });
    negoCtxRef.current = { spotByPid, seatByPid, farmerIds: state.roundFarmerIds ?? [], ticketKey, ticketDeltaMap, ticketsByPid };
  });

  // 手感与手牌层同参数：按下→移动超阈值=拖拽；按住不动 450ms=拆分（转小面额再拖）
  // r3f 射线拾取可能因慢机延迟到 mouseup 之后：此刻真实按键已松开（pressActiveRef 假）就忽略，否则会误拆牌。
  const onMyNoteDown = (kind) => (note, i, e) => {
    if (!canNegotiate || !pressActiveRef.current) return;
    e.stopPropagation();
    negoDownRef.current = { note, kind, x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer.current);
    if (!SPLITS[note.value]) return;
    pressTimer.current = setTimeout(() => {
      if (!pressActiveRef.current || negoCarryRef.current) return; // 已松开或已转为拖拽：不拆
      negoDownRef.current = null;
      dir.splitPileNote(playerId, note.id, kind === 'debt');
    }, 450);
  };
  // 自己的对质票按下（无拆分，只有拖拽）：同 onMyNoteDown 的 pressActiveRef 守卫（r3f 射线可能迟到）。
  const onMyTicketDown = (i, e) => {
    if (!canNegotiate || !pressActiveRef.current || ticketCarryRef.current || negoCarryRef.current) return;
    e.stopPropagation();
    ticketDownRef.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    if (!canNegotiate) return undefined;
    const onDown = () => { pressActiveRef.current = true; };
    const onMove = (e) => {
      ndcRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ndcRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      // 票按下超阈值 → 转为携带。起点=**排里消失的那张的槽位**（末位；排减一张会重排居中，
      // 从消失位起飞视觉最顺）——起点设在指针点会瞬移（钱牌从牌堆位起飞同理，踩过）。
      const td = ticketDownRef.current;
      if (td && !ticketCarryRef.current && Math.hypot(e.clientX - td.x, e.clientY - td.y) >= 8) {
        ticketDownRef.current = null;
        const { seatByPid: sb, spotByPid: pb, ticketsByPid, ticketDeltaMap: dm } = negoCtxRef.current;
        let start;
        if (sb[playerId] && pb[playerId]) {
          const n = Math.max(1, (ticketsByPid[playerId] ?? 0) + (dm[playerId] ?? 0));
          const { pos } = ticketWorldPos(sb[playerId], pb[playerId], n - 1, n);
          start = new THREE.Vector3(pos[0], pos[1] + 0.04, pos[2]);
        } else { // 兜底（座位缺失）：指针毡面点
          start = groundFromPointer(camera, ndcRef.current, _negoFelt).applyAxisAngle(UP, -rot).clone();
          start.y = TABLE_TOP + 0.25;
        }
        ticketCarryRef.current = { spring: new CarrySpring(start) };
        setTicketCarry(true);
      }
      const d = negoDownRef.current;
      if (!d || negoCarryRef.current) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
      clearTimeout(pressTimer.current);
      const debt = d.kind === 'debt';
      const note = dir.grabNoteById(playerId, d.note.id, debt);
      negoDownRef.current = null;
      if (!note) return;
      dir.holds += 1; // 冻结队列/对账：这张牌悬在玩家手上，账面此刻不平（在途落定后 -1）
      const spot = ctxRef.current.spot(playerId);
      const base = debt ? { x: spot.x * 0.72, z: spot.z * 0.72 } : spot;
      const start = new THREE.Vector3(base.x, TABLE_TOP + 0.25, base.z);
      negoCarryRef.current = { note, kind: d.kind, spring: new CarrySpring(start) };
      setNegoCarry({ note, kind: d.kind });
    };
    const onUp = () => {
      pressActiveRef.current = false;
      clearTimeout(pressTimer.current);
      negoDownRef.current = null;
      ticketDownRef.current = null;
      // 票落手：指针所指毡面最近的队友圈 → transfer_ticket +1（乐观顶显）+ 飞进对方排；
      // 没落到圈 = 取消 → 弧线飞回自己排末位。两种都用 hidePid 在飞行期间把落点排少显 1 张（那张在空中）。
      const tc = ticketCarryRef.current;
      if (tc) {
        ticketCarryRef.current = null;
        setTicketCarry(null);
        const from = [tc.spring.pos.x, tc.spring.pos.y, tc.spring.pos.z]; // 松手瞬间的视觉位置=飞行起点
        const { spotByPid: spots, seatByPid: seatsBy, farmerIds, ticketKey: k, ticketDeltaMap: m0, ticketsByPid } = negoCtxRef.current;
        // 落点双判定（反馈：悬在圈上方松手要生效）：票的悬停位（玩家看到的）与指针毡面点，谁近算谁
        const felt = groundFromPointer(camera, ndcRef.current, _negoFelt).applyAxisAngle(UP, -rot);
        let toId = null, best = 0.8;
        for (const pid of farmerIds) {
          if (pid === playerId) continue;
          const s = spots[pid];
          if (!s) continue;
          const dd = Math.min(
            Math.hypot(felt.x - s.x, felt.z - s.z),
            Math.hypot(from[0] - s.x, from[2] - s.z),
          );
          if (dd < best) { best = dd; toId = pid; }
        }
        const fly = (pid, n) => { // 飞向 pid 的第 n 张位（1-based 张数）；落地前该排少显 1 张
          if (!(n > 0) || !seatsBy[pid] || !spots[pid]) return;
          const { pos, yaw } = ticketWorldPos(seatsBy[pid], spots[pid], n - 1, n);
          setTicketFlight({ from, to: pos, yaw, hidePid: pid, key: ++ticketFlightSeq.current });
        };
        if (toId) {
          send({ type: 'transfer_ticket', toId, n: 1 });
          setTicketDeltas({ key: k, map: { ...m0, [playerId]: (m0[playerId] ?? 0) - 1, [toId]: (m0[toId] ?? 0) + 1 } });
          fly(toId, (ticketsByPid[toId] ?? 0) + (m0[toId] ?? 0) + 1); // 对方到手后的末位
        } else {
          fly(playerId, (ticketsByPid[playerId] ?? 0) + (m0[playerId] ?? 0)); // 飞回自己排末位（票数不变）
        }
        return;
      }
      const c = negoCarryRef.current;
      if (!c) return;
      negoCarryRef.current = null;
      setNegoCarry(null);
      const debt = c.kind === 'debt';
      const pos = c.spring.pos; // 局部系（牌此刻的视觉位置，作飞行起点）
      const { spotByPid: spots, farmerIds } = negoCtxRef.current; // 读最新快照（监听器只挂一次）
      // 落点双判定（反馈：钱悬在圈正上方松手要生效）：指针毡面点 + **牌的悬停位**（视角低时
      // 射线∩桌面会越过牌的正下方——只按射线判，牌明明悬在圈上却不生效），谁近算谁。
      const felt = groundFromPointer(camera, ndcRef.current, _negoFelt).applyAxisAngle(UP, -rot);
      let toId = null, best = 0.8;
      for (const pid of farmerIds) {
        if (pid === playerId) continue;
        const s = spots[pid];
        if (!s) continue;
        const dd = Math.min(
          Math.hypot(felt.x - s.x, felt.z - s.z),
          Math.hypot(pos.x - s.x, pos.z - s.z),
        );
        if (dd < best) { best = dd; toId = pid; }
      }
      const settle = (pid) => {
        const target = debt ? { x: spots[pid].x * 0.72, z: spots[pid].z * 0.72 } : spots[pid];
        const slotOf = Object.assign((k) => {
          const l = cardLocal((debt ? dir.debtPile(pid) : dir.pile(pid)).notes.length + k);
          return [target.x + l[0], l[1], target.z + l[2]];
        }, { yaw: () => 0 });
        dir.fly([c.note], () => [pos.x, pos.y, pos.z], slotOf, {
          dur: 300, apex: 0.15, debt,
          onLand: (n) => { dir.landInto(pid, n, debt); dir.holds = Math.max(0, dir.holds - 1); },
        });
        dir.bump();
      };
      if (toId) {
        send({ type: 'negotiate_transfer', toId, kind: c.kind, amount: c.note.value });
        // 乐观更新最近权威快照：服务端广播回来后 reconcile 恰好无差，不会闪修
        const v = c.note.value;
        if (debt) {
          dir.latestDebts = { ...dir.latestDebts, [playerId]: (dir.latestDebts[playerId] ?? 0) - v, [toId]: (dir.latestDebts[toId] ?? 0) + v };
        } else {
          dir.latestPiles = { ...dir.latestPiles, [playerId]: (dir.latestPiles[playerId] ?? 0) - v, [toId]: (dir.latestPiles[toId] ?? 0) + v };
        }
        settle(toId);
      } else {
        settle(playerId); // 没落到队友圈：飞回自己堆
      }
    };
    // pointerdown 用【捕获阶段】：必须在 r3f 画布拾取（onMyNoteDown）之前把 pressActiveRef 置真，
    // 否则快机正常按下时 onMyNoteDown 先跑、读到假、直接 return，拖拽/拆分全失效。
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      clearTimeout(pressTimer.current);
      pressActiveRef.current = false;
      // 相位切换/卸载时若正拖着票/票在飞：直接丢携带态与飞行（票数从 state 渲染，无账可平）。
      ticketDownRef.current = null;
      if (ticketCarryRef.current) { ticketCarryRef.current = null; setTicketCarry(null); }
      setTicketFlight(null);
      // 相位切换/卸载时若正拖着一张牌（未落定）：把它放回自己堆并解冻，避免丢牌 + 队列永久冻结。
      const c = negoCarryRef.current;
      if (c) {
        negoCarryRef.current = null;
        setNegoCarry(null);
        dir.landInto(playerId, c.note, c.kind === 'debt');
        dir.holds = Math.max(0, dir.holds - 1);
        dir.bump();
      }
    };
  }, [canNegotiate, playerId, dir, send, camera, rot]);

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

  // 协商浮字所需状态（allocation 只发给农民/观战者；地主 null）
  const alloc = state.allocation;
  const iConfirmed = !!alloc?.confirms?.includes(playerId);
  const negoIdle = canNegotiate && !dir.busy && !negoCarry;

  return (
    <group>
      <DirectorClock dir={dir} />
      {/* 各家圆圈钱堆 + 红色债务标记（金额公开）；协商期自己的堆逐张可抓（重力枪） */}
      {Object.entries(m.piles).map(([pid, p]) => (p.notes.length > 0 || p.amount > 0) && (
        <MoneyStack
          key={`pp-${pid}`}
          notes={p.notes}
          amount={p.amount > 0 ? p.amount : null}
          faceUp
          position={[spotByPid[pid]?.x ?? 0, 0, spotByPid[pid]?.z ?? 0]}
          onNoteDown={canNegotiate && pid === playerId ? onMyNoteDown('take') : undefined}
        />
      ))}
      {Object.entries(m.debts).map(([pid, p]) => p.notes.length > 0 && (
        <group key={`pd-${pid}`} position={[(spotByPid[pid]?.x ?? 0) * 0.72, 0, (spotByPid[pid]?.z ?? 0) * 0.72]}>
          <MoneyStack
            notes={p.notes}
            amount={p.amount > 0 ? -p.amount : null}
            faceUp
            position={[0, 0, 0]}
            labelColor={P.danger}
            onNoteDown={canNegotiate && pid === playerId ? onMyNoteDown('debt') : undefined}
          />
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
      {/* 飞行中的钱牌 + 被重力枪抓着的牌 */}
      {m.flights.map(({ key, ...f }) => <ArcNote key={key} {...f} />)}
      {negoCarry && <NegoCarriedNote note={negoCarry.note} carryRef={negoCarryRef} ndcRef={ndcRef} rot={rot} />}

      {/* 协商期对质票（§8.8）：每个本回合农民圈前一排 3D 票；自己的可拖到队友圈=转赠 1 张。
          票数=服务端 state + 乐观差量（回包快照一变即重置）；拖拽中自己排少显 1 张（那张在手上）。 */}
      {phase === 'NEGOTIATE' && (state.roundFarmerIds ?? []).map(pid => {
        const idx = players.findIndex(p => p.id === pid);
        const p = players[idx];
        if (!p || p.tickets == null || !seats[idx] || !spots[idx]) return null;
        const mine = pid === playerId;
        const count = (p.tickets ?? 0) + (ticketDeltaMap[pid] ?? 0)
          - (mine && ticketCarry ? 1 : 0)                       // 拖拽中：那张在手上
          - (ticketFlight?.hidePid === pid ? 1 : 0);            // 飞行中：那张在空中
        return (
          <TicketRow
            key={`tk-${pid}`}
            count={count}
            seat={seats[idx]}
            spot={spots[idx]}
            onTicketDown={mine && canNegotiate ? onMyTicketDown : undefined}
          />
        );
      })}
      {ticketCarry && <NegoCarriedTicket carryRef={ticketCarryRef} ndcRef={ndcRef} rot={rot} />}
      {phase === 'NEGOTIATE' && ticketFlight && (
        <TicketArc key={ticketFlight.key} from={ticketFlight.from} to={ticketFlight.to} yaw={ticketFlight.yaw}
          onLand={() => setTicketFlight(null)} />
      )}

      {/* 协商浮字（白字无背景板）：队友圈上的确认状态 + 自己圈上的确认行 */}
      {IS_3D_INPUT && phase === 'NEGOTIATE' && alloc && (state.roundFarmerIds ?? []).map(pid => {
        if (pid === playerId || !alloc.confirms?.includes(pid)) return null;
        const s = spotByPid[pid];
        if (!s) return null;
        const n = m.piles[pid]?.notes?.length ?? 0;
        return (
          <Html key={`nc-${pid}`} position={[s.x, stackTopY(n) + 0.5, s.z]} center distanceFactor={6.5} zIndexRange={[26, 0]}>
            <div className="felt-float">
              <div className="pushable" onPointerDown={pushFloat}><PixelText size={2} color="var(--ok)">{T.payout3d.confirmed}</PixelText></div>
            </div>
          </Html>
        );
      })}
      {negoIdle && mySpot && (
        <PromptFloat spot={mySpot} nw>
          <PixelText size={2} color="#fff">{iConfirmed ? T.payout3d.confirmedWaiting : (state.mode === 'single' ? T.payout3d.dragHintSingle : T.payout3d.dragHint)}</PixelText>
          <div className={`clickable prompt-line ${spaceHeld ? 'pressed' : ''}`} onClick={() => send({ type: 'negotiate_confirm', confirmed: !iConfirmed })}>
            <PixelText size={2} color="var(--px-gold)">{iConfirmed ? T.payout3d.undoConfirm : T.payout3d.confirmAlloc}</PixelText>
            <KeyCap color="var(--px-gold)" />
          </div>
          {alloc.deadline && <CountdownText deadline={alloc.deadline} />}
        </PromptFloat>
      )}

      {/* 拿取 [F]：与钱堆金额标签同款纯文字（无背景板），呼吸提示可点（可交互 → 无受击动效）。
          位置同浮字规范：自己圈的「西北」压低（反馈⑤），distanceFactor 压小一档与金额标签视觉等大。 */}
      {canTake && mySpot && (
        <Html position={promptAnchor(mySpot.x, mySpot.z)} center distanceFactor={5} zIndexRange={[30, 0]}>
          <div className="money-3d-amount take-float prompt-line" onClick={() => useGameStore.getState().takePayout()}>
            <PixelText size={2} color={P.gold}>{T.payout3d.take}</PixelText>
            <KeyCap k="F" color={P.gold} />
          </div>
        </Html>
      )}
    </group>
  );
}
