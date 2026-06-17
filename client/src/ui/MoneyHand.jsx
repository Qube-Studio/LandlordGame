// 手持钱牌：余额动态分解为 10/5/2/1 面额，扇形持牌；保留金锁定在旁；
// 长按拆分——长按期间钱牌抖动（短按只选中、不抖、不拆）；选牌组成下注额；确认后飞入 3D 桌面。
// 父组件用 key={round-balance} 控制重建，本地状态生命周期与一次下注一致。

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import { decompose, splitNote, sumNotes, SPLITS } from '../game/notes';

const MoneyNote = getArt('moneyNote');
const Icon = getArt('icon');

const LONG_PRESS_MS = 450;   // 触发拆分的长按时长
const SHAKE_DELAY_MS = 140;  // 开始抖动的延迟（短于此=短按，不抖）

export default function MoneyHand() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const startBetFlight = useGameStore(s => s.startBetFlight);
  const chatOpen = useGameStore(s => s.chatOpen);

  const me = state.me;
  const bounds = me.bounds ?? { minStake: 1, min: 1, max: me.balance, forceAllIn: false };
  const spendable = bounds.forceAllIn ? me.balance : me.balance - bounds.minStake;

  const [notes, setNotes] = useState(() => decompose(spendable));
  const [selected, setSelected] = useState(() => new Set());
  const [shakingId, setShakingId] = useState(null);
  const containerRef = useRef(null);
  const pressTimer = useRef(null);
  const shakeTimer = useRef(null);
  const longPressed = useRef(false);

  const reservedNotes = bounds.forceAllIn ? [] : decompose(bounds.minStake);
  const total = bounds.forceAllIn ? me.balance : sumNotes(notes, selected);
  const canConfirm = bounds.forceAllIn || (total >= bounds.min && total <= bounds.max);

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

  const confirm = () => {
    if (!canConfirm) return;
    const amount = bounds.forceAllIn ? me.balance : total;
    // 把「选中的这几张牌」交给 3D 场景：从它们当前手牌屏幕位置起飞，沿计算好的弧线落到桌面，
    // 落点即该牌在桌上的槽位 —— 飞出去的和留在桌上的是同一批模型。
    let count = 0;
    if (containerRef.current) {
      const els = containerRef.current.querySelectorAll('[data-flyable="1"]');
      const items = [...els].map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          id: `bn-${Date.now()}-${i}`,
          value: Number(el.dataset.value),
          fromScreen: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        };
      });
      count = items.length;
      if (items.length) startBetFlight({ round: state.round, items });
    }
    // 上报实际拍下的张数（含拆分），让所有人看到的桌面堆叠张数一致。
    send({ type: 'place_bet', amount, count });
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
          <span>已选 <b className="gold">{total}</b>（可下注 {bounds.min} ~ {bounds.max}）</span>
        )}
        <button className="btn primary" disabled={!canConfirm} onClick={confirm}>
          {bounds.forceAllIn ? `全押 ${me.balance}` : '确认下注'} <span className="keycap">⏎</span>
        </button>
      </div>
      <div className="hand-row" data-hand-anchor>
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
