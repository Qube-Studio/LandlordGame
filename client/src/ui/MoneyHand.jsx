// 手持钱牌：余额动态分解为 10/5/2/1 面额，扇形持牌；
// 保留金锁定在旁边不可操作；长按拆分；选牌组成下注额；确认后飞入 3D 桌面。
// 父组件用 key={round-balance} 控制重建，因此这里的本地状态生命周期与一次下注一致。

import { useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import { decompose, splitNote, sumNotes, SPLITS } from '../game/notes';

const MoneyNote = getArt('moneyNote');
const Icon = getArt('icon');

const LONG_PRESS_MS = 450;

export default function MoneyHand() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const addFlights = useGameStore(s => s.addFlights);

  const me = state.me;
  const bounds = me.bounds ?? { minStake: 1, min: 1, max: me.balance, forceAllIn: false };
  const spendable = bounds.forceAllIn ? me.balance : me.balance - bounds.minStake;

  const [notes, setNotes] = useState(() => decompose(spendable));
  const [selected, setSelected] = useState(() => new Set());
  const containerRef = useRef(null);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);

  const reservedNotes = bounds.forceAllIn ? [] : decompose(bounds.minStake);
  const total = bounds.forceAllIn ? me.balance : sumNotes(notes, selected);
  const canConfirm = bounds.forceAllIn || (total >= bounds.min && total <= bounds.max);

  const startPress = (note) => {
    longPressed.current = false;
    if (!SPLITS[note.value]) return;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setNotes(n => splitNote(n, note.id));
      setSelected(s => {
        if (!s.has(note.id)) return s;
        const next = new Set(s);
        next.delete(note.id);
        return next;
      });
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => clearTimeout(pressTimer.current);

  const toggleSelect = (note) => {
    if (longPressed.current) { longPressed.current = false; return; }
    if (bounds.forceAllIn) return;
    setSelected(s => {
      const next = new Set(s);
      if (next.has(note.id)) next.delete(note.id);
      else next.add(note.id);
      return next;
    });
  };

  const confirm = () => {
    if (!canConfirm) return;
    const amount = bounds.forceAllIn ? me.balance : total;
    // 选中的钱牌从手中飞向桌面（FLIP：起点取真实 DOM 矩形，终点取桌心锚点）
    const target = document.querySelector('[data-pot-anchor]');
    if (target && containerRef.current) {
      const toRect = target.getBoundingClientRect();
      const els = containerRef.current.querySelectorAll('[data-flyable="1"]');
      const items = [...els].map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          id: `bet-${Date.now()}-${i}`,
          value: Number(el.dataset.value),
          faceDown: true,
          from: { x: r.x, y: r.y, w: r.width, h: r.height * 0.72 },
          to: { x: toRect.x - 22 + i * 9, y: toRect.y + 60, w: 44, h: 62 },
        };
      });
      if (items.length) addFlights(items);
    }
    send({ type: 'place_bet', amount });
  };

  const mid = (notes.length - 1) / 2;

  return (
    <div className="money-hand" ref={containerRef}>
      <div className="hand-info">
        {bounds.forceAllIn ? (
          <span className="force-allin">资金不足，本回合必须全押 <b>{me.balance}</b></span>
        ) : (
          <span>已选 <b className="gold">{total}</b>（可下注 {bounds.min} ~ {bounds.max}）</span>
        )}
        <button className="btn primary" disabled={!canConfirm} onClick={confirm}>
          {bounds.forceAllIn ? `全押 ${me.balance}` : '确认下注'}
        </button>
      </div>
      <div className="hand-row" data-hand-anchor>
        <div className="hand-fan">
          {notes.map((n, i) => {
            const isSel = bounds.forceAllIn || selected.has(n.id);
            return (
              <button
                key={n.id}
                className={`hand-note ${isSel ? 'selected' : ''}`}
                data-flyable={isSel ? '1' : '0'}
                data-value={n.value}
                style={{ transform: `rotate(${(i - mid) * 5}deg) translateY(${Math.abs(i - mid) * Math.abs(i - mid) * 2}px)` }}
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
