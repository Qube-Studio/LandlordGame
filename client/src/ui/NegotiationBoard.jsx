// 农民协商板（分钱子阶段二）：每个农民以钞票牌看到分给自己的钱（金）与债务（红），
// 把自己的牌拖拽到队友列即转移该面额；任何变动重置确认；全部农民确认后生效。

import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import { decompose } from '../game/notes';

const MoneyNote = getArt('moneyNote');

function Countdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return <span className="dim">超时自动生效：{left}s</span>;
}

export default function NegotiationBoard() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);

  const alloc = state.allocation;
  if (!alloc) return <p className="dim">农民正在协商分配…</p>;

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
        <span>把自己的钱或债务拖给队友，全部农民确认后生效</span>
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
                <b>{f.name}{mine ? '（我）' : ''}</b>
                <span className={confirmed ? 'ok' : 'dim'}>{confirmed ? '已确认' : '协商中'}</span>
              </div>
              <div className="nego-amounts">
                <span className="gold">得 {take}</span>
                <span className={debt > 0 ? 'danger' : 'dim'}>债 {debt}</span>
              </div>
              <div className="nego-notes">
                {decompose(take).map(n => (
                  <span
                    key={n.id}
                    className={`nego-note ${mine && canAct ? 'draggable' : ''}`}
                    draggable={mine && canAct}
                    onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'take', value: n.value }))}
                    title={mine && canAct ? '拖到队友列转移这张钱' : undefined}
                  >
                    <MoneyNote value={n.value} width={42} />
                  </span>
                ))}
                {decompose(debt).map(n => (
                  <span
                    key={n.id}
                    className={`nego-note ${mine && canAct ? 'draggable' : ''}`}
                    draggable={mine && canAct}
                    onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'debt', value: n.value }))}
                    title={mine && canAct ? '拖到队友列转移这笔债务' : undefined}
                  >
                    <MoneyNote value={n.value} debt width={42} />
                  </span>
                ))}
                {take === 0 && debt === 0 && <span className="dim">无</span>}
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
          {iConfirmed ? '撤销确认' : '确认当前分配'}
        </button>
      )}
    </div>
  );
}
