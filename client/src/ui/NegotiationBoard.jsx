// 农民协商板（分钱子阶段二）：每个农民以钞票牌看到分给自己的钱（金）与债务（红），
// 把自己的牌拖拽到队友列即转移该面额；长按拆分成小面额可转移更小金额（任务 3）；
// 任何变动重置确认；全部农民确认后生效。债务可以全部压给某农民使其破产（任务 7）。

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import { decompose, splitNote, SPLITS } from '../game/notes';
import { T } from '../text';

const MoneyNote = getArt('moneyNote');

const LONG_PRESS_MS = 450;   // 触发拆分的长按时长（与手牌一致）
const SHAKE_DELAY_MS = 140;  // 开始抖动的延迟（短于此=短按，不抖）

function Countdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return <span className="dim">{T.nego2d.countdown(left)}</span>;
}

// 我自己那列的钱/债务牌：本地可长按拆分（纯表现），拖到队友列转移该面额。
// 父组件用 key={kind-amount} 控制重建——服务端方案变动（转移生效）后本地拆分自然重置。
function MyNotes({ amount, kind, canAct }) {
  const [notes, setNotes] = useState(() => decompose(amount));
  const [shakingId, setShakingId] = useState(null);
  const pressTimer = useRef(null);
  const shakeTimer = useRef(null);

  const clearTimers = () => {
    clearTimeout(pressTimer.current);
    clearTimeout(shakeTimer.current);
    setShakingId(null);
  };
  useEffect(() => () => clearTimers(), []);

  const startPress = (note) => {
    if (!canAct || !SPLITS[note.value]) return;
    shakeTimer.current = setTimeout(() => setShakingId(note.id), SHAKE_DELAY_MS);
    pressTimer.current = setTimeout(() => {
      setShakingId(null);
      setNotes(n => splitNote(n, note.id));
    }, LONG_PRESS_MS);
  };

  if (amount === 0 && notes.length === 0) return <span className="dim">{T.nego2d.empty}</span>;

  return notes.map(n => (
    <span
      key={n.id}
      className={`nego-note ${canAct ? 'draggable' : ''} ${shakingId === n.id ? 'shaking' : ''}`}
      draggable={canAct}
      onPointerDown={() => startPress(n)}
      onPointerUp={clearTimers}
      onPointerLeave={clearTimers}
      onDragStart={e => {
        clearTimers();
        if (!canAct) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind, value: n.value }));
      }}
      onDragEnd={clearTimers}
      title={canAct ? (SPLITS[n.value] ? T.nego2d.dragSplitTitle : T.nego2d.dragTitle) : undefined}
    >
      <MoneyNote value={n.value} debt={kind === 'debt'} width={42} />
    </span>
  ));
}

export default function NegotiationBoard() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);

  const alloc = state.allocation;
  if (!alloc) return <p className="dim">{T.nego2d.negotiating}</p>;

  const farmers = state.players.filter(p => state.roundFarmerIds.includes(p.id));
  const canAct = state.roundFarmerIds.includes(playerId) && !state.me?.spectator;
  const iConfirmed = alloc.confirms.includes(playerId);

  const onDropTo = (toId) => (e) => {
    e.preventDefault();
    if (!canAct || toId === playerId) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data && data.kind && data.value > 0) {
        send({ type: 'negotiate_transfer', toId, kind: data.kind, amount: data.value });
      }
    } catch { /* 非法拖拽数据忽略 */ }
  };

  return (
    <div className="negotiation-board">
      <div className="nego-head">
        <span>{T.nego2d.headHint}</span>
        {alloc.deadline && <Countdown deadline={alloc.deadline} />}
      </div>
      <div className="nego-columns">
        {farmers.map(f => {
          const take = alloc.takes[f.id] ?? 0;
          const debt = alloc.debts[f.id] ?? 0;
          const mine = f.id === playerId;
          const confirmed = alloc.confirms.includes(f.id);
          return (
            <div
              key={f.id}
              className={`nego-col ${mine ? 'mine' : ''} ${confirmed ? 'confirmed' : ''}`}
              onDragOver={e => e.preventDefault()}
              onDrop={onDropTo(f.id)}
            >
              <div className="nego-col-head">
                <b>{f.name}{mine ? T.nego2d.meSuffix : ''}</b>
                <span className={confirmed ? 'ok' : 'dim'}>{confirmed ? T.nego2d.confirmed : T.nego2d.pending}</span>
              </div>
              <div className="nego-amounts">
                <span className="gold">{T.nego2d.take(take)}</span>
                <span className={debt > 0 ? 'danger' : 'dim'}>{T.nego2d.debt(debt)}</span>
              </div>
              <div className="nego-notes">
                {mine ? (
                  <>
                    <MyNotes key={`take-${take}`} amount={take} kind="take" canAct={canAct} />
                    <MyNotes key={`debt-${debt}`} amount={debt} kind="debt" canAct={canAct} />
                    {take === 0 && debt === 0 && <span className="dim">{T.nego2d.empty}</span>}
                  </>
                ) : (
                  <>
                    {decompose(take).map(n => <span key={n.id} className="nego-note"><MoneyNote value={n.value} width={42} /></span>)}
                    {decompose(debt).map(n => <span key={n.id} className="nego-note"><MoneyNote value={n.value} debt width={42} /></span>)}
                    {take === 0 && debt === 0 && <span className="dim">{T.nego2d.empty}</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {canAct && (
        <button
          className={`btn wide ${iConfirmed ? 'ghost' : 'primary'}`}
          onClick={() => send({ type: 'negotiate_confirm', confirmed: !iConfirmed })}
        >
          {iConfirmed ? T.nego2d.undoConfirm : T.nego2d.confirm}
        </button>
      )}
    </div>
  );
}
