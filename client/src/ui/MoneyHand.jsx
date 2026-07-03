// 手持钱牌：余额动态分解为 10/5/2/1 面额，扇形持牌；保留金锁定在旁；
// 长按拆分——长按期间钱牌抖动（短按只选中、不抖、不拆）；选牌组成下注额；确认后飞入 3D 桌面。
// 竞技投资人：手牌左侧多一个「投保槽」，把牌拖进去即投保（保费 ≤ 上限）；确认下注时，
//   下注牌飞向桌面、投保槽里的牌一张张掉出屏幕（不上桌），投保与下注随 place_bet 一并提交。
// 父组件用 key={round-balance} 控制重建，本地状态生命周期与一次下注一致。

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import CandleMark from '../assets/pixelfont/CandleMark';
import { decompose, splitNote, sumNotes, SPLITS, insStackStyle } from '../game/notes';

const MoneyNote = getArt('moneyNote');
const Icon = getArt('icon');

const LONG_PRESS_MS = 450;   // 触发拆分的长按时长
const SHAKE_DELAY_MS = 140;  // 开始抖动的延迟（短于此=短按，不抖）

export default function MoneyHand() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const startBetFlight = useGameStore(s => s.startBetFlight);
  const dropInsurance = useGameStore(s => s.dropInsurance);
  const chatOpen = useGameStore(s => s.chatOpen);

  const me = state.me;
  const bounds = me.bounds ?? { minStake: 1, min: 1, max: me.balance, forceAllIn: false };
  // 是否需要留保留金：强制全押、或上限已等于全部余额（如竞技资本家可全押）时无需保留。
  const noReserve = bounds.forceAllIn || bounds.max >= me.balance;
  const spendable = noReserve ? me.balance : me.balance - bounds.minStake;

  // 竞技投资人投保（§8.3）：仅在尚未投保时可拖牌入槽；强制全押时不开放投保。
  const isInvestor = me.role === 'investor';
  const insurable = isInvestor && !bounds.forceAllIn;
  const maxPledge = me.pledgeMax ?? 3;

  const [notes, setNotes] = useState(() => decompose(spendable));
  const [selected, setSelected] = useState(() => new Set());
  const [slot, setSlot] = useState([]);          // 投保槽里的保单牌
  const [shakingId, setShakingId] = useState(null);
  const [dragNote, setDragNote] = useState(null);   // 正在从手牌拖拽的牌（同页拖拽，dragover 时可读其面额做判定）
  const [slotHover, setSlotHover] = useState(false);// 拖拽是否悬停在钱框上
  const containerRef = useRef(null);
  const pressTimer = useRef(null);
  const shakeTimer = useRef(null);
  const longPressed = useRef(false);

  const premium = slot.reduce((s, n) => s + n.value, 0);
  const reservedNotes = noReserve ? [] : decompose(bounds.minStake);
  const total = bounds.forceAllIn ? me.balance : sumNotes(notes, selected);
  const effMax = Math.max(0, bounds.max - premium);   // 投保占用后的有效下注上限
  const canConfirm = bounds.forceAllIn || (total >= bounds.min && total <= effMax);
  // 当前拖拽的牌能否被钱框接受（不超投保上限）；无拖拽时视为可接受。
  const slotAccept = !dragNote || premium + dragNote.value <= maxPledge;

  const clearTimers = () => {
    clearTimeout(pressTimer.current);
    clearTimeout(shakeTimer.current);
    setShakingId(null);
  };

  const startPress = (note) => {
    longPressed.current = false;
    if (!SPLITS[note.value]) return;            // 不可拆分的牌不抖动
    shakeTimer.current = setTimeout(() => setShakingId(note.id), SHAKE_DELAY_MS);
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setShakingId(null);
      setNotes(n => splitNote(n, note.id));
      setSelected(s => {
        if (!s.has(note.id)) return s;
        const next = new Set(s); next.delete(note.id); return next;
      });
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => clearTimers();

  const toggleSelect = (note) => {
    if (longPressed.current) { longPressed.current = false; return; }  // 刚长按拆分过，不再切换选中
    if (bounds.forceAllIn) return;
    setSelected(s => {
      const next = new Set(s);
      if (next.has(note.id)) next.delete(note.id); else next.add(note.id);
      return next;
    });
  };

  // 拖一张手牌进投保槽（超上限拒绝）；点击槽内牌取回手牌。
  const moveToSlot = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note || premium + note.value > maxPledge) return;
    setNotes(ns => ns.filter(n => n.id !== id));
    setSelected(s => { if (!s.has(id)) return s; const next = new Set(s); next.delete(id); return next; });
    setSlot(sl => [...sl, note]);
  };
  const moveFromSlot = (id) => {
    const note = slot.find(n => n.id === id);
    if (!note) return;
    setSlot(sl => sl.filter(n => n.id !== id));
    setNotes(ns => [...ns, note].sort((a, b) => b.value - a.value));
  };

  const confirm = () => {
    if (!canConfirm) return;
    const amount = bounds.forceAllIn ? me.balance : total;
    // 投保保单牌：从槽位掉出屏幕（不上桌）。
    if (insurable && premium > 0 && containerRef.current) {
      const slotEls = containerRef.current.querySelectorAll('[data-slot-note="1"]');
      const drops = [...slotEls].map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          id: `ins-${Date.now()}-${i}`, value: Number(el.dataset.value),
          x: r.x, y: r.y, w: r.width, delay: i * 130, spin: (i % 2 ? 1 : -1) * (18 + i * 10),
        };
      });
      if (drops.length) dropInsurance(drops);
    }
    // 下注牌飞向桌面（同一批模型既飞行也落桌）。
    let count = 0;
    if (containerRef.current) {
      const els = containerRef.current.querySelectorAll('[data-flyable="1"]');
      const items = [...els].map((el, i) => {
        const r = el.getBoundingClientRect();
        return { id: `bn-${Date.now()}-${i}`, value: Number(el.dataset.value), fromScreen: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
      });
      count = items.length;
      if (items.length) startBetFlight({ round: state.round, items });
    }
    send({ type: 'place_bet', amount, count, pledge: insurable ? premium : 0 });
  };

  // 键盘：下注阶段按 Enter 确认（聊天/输入聚焦时让位）
  const confirmRef = useRef(null);
  useEffect(() => { confirmRef.current = confirm; });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter') return;
      const el = document.activeElement;
      if (chatOpen || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
      e.preventDefault();
      confirmRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen]);

  useEffect(() => () => clearTimers(), []);

  const mid = (notes.length - 1) / 2;

  return (
    <div className="money-hand" ref={containerRef}>
      <div className="hand-info">
        {bounds.forceAllIn ? (
          <span className="force-allin">资金不足，本回合必须全押 <b>{me.balance}</b></span>
        ) : (
          <span>已选 <b className="gold">{total}</b>（可下注 {bounds.min} ~ {effMax}{premium > 0 ? `，已投保 ${premium}` : ''}）</span>
        )}
        <button className="btn primary" disabled={!canConfirm} onClick={confirm}>
          {bounds.forceAllIn ? `全押 ${me.balance}` : '确认下注'} <span className="keycap">⏎</span>
        </button>
      </div>
      <div className="hand-row" data-hand-anchor>
        {insurable && (
          <div className="insurance-slot">
            <span className="ins-slot-label">投保 <CandleMark />{premium}/{maxPledge}</span>
            {/* 判定区(.ins-dropzone)比可见钱框大一圈——命中更宽松；拖拽中内部不吃指针事件，
                避免子元素打断 dragenter/leave。反馈样式落在内层钱框上。 */}
            <div
              className={`ins-dropzone${dragNote ? ' dragging' : ''}${slotHover ? (slotAccept ? ' can-drop' : ' no-drop') : ''}`}
              onDragEnter={(e) => { e.preventDefault(); setSlotHover(true); }}
              onDragOver={(e) => { e.preventDefault(); if (!slotHover) setSlotHover(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSlotHover(false); }}
              onDrop={(e) => { e.preventDefault(); moveToSlot(e.dataTransfer.getData('text/plain')); setSlotHover(false); setDragNote(null); }}
              title={`把手牌拖进来投保（保费先扣，输则免阵营 2× 债务；上限 ${maxPledge}）`}
            >
              <div className="ins-slot-notes">
                {slot.map((n, i) => (
                  <button key={n.id} className="ins-slot-note" data-slot-note="1" data-value={n.value}
                    style={insStackStyle(i, slot.length)}
                    onClick={() => moveFromSlot(n.id)} title="点击取回">
                    <MoneyNote value={n.value} width={62} />
                  </button>
                ))}
                {slot.length === 0 && <span className="ins-slot-hint">拖牌入槽</span>}
              </div>
            </div>
          </div>
        )}
        <div className="hand-fan">
          {notes.map((n, i) => {
            const isSel = bounds.forceAllIn || selected.has(n.id);
            const tf = `rotate(${(i - mid) * 5}deg) translateY(${Math.abs(i - mid) * Math.abs(i - mid) * 2}px)`;
            return (
              <button
                key={n.id}
                className={`hand-note ${isSel ? 'selected' : ''} ${shakingId === n.id ? 'shaking' : ''}`}
                data-flyable={isSel ? '1' : '0'}
                data-value={n.value}
                draggable={insurable}
                onDragStart={(e) => { clearTimers(); setDragNote(n); e.dataTransfer.setData('text/plain', n.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragNote(null); setSlotHover(false); }}
                style={{ transform: tf, '--note-tf': tf }}
                onPointerDown={() => startPress(n)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onClick={() => toggleSelect(n)}
                title={SPLITS[n.value] ? '点击选择，长按拆分' : '点击选择'}
              >
                <MoneyNote value={n.value} width={62} />
              </button>
            );
          })}
          {notes.length === 0 && <span className="dim">没有可支配的钱</span>}
        </div>
        {reservedNotes.length > 0 && (
          <div className="reserved-zone" title={`必须留下的最小出资额 ${bounds.minStake}，不可下注`}>
            <span className="reserved-label"><Icon name="lock" size={13} /> 保留金</span>
            <div className="reserved-notes">
              {reservedNotes.map(n => (
                <span key={n.id} className="hand-note locked">
                  <MoneyNote value={n.value} locked width={48} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
