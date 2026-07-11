// 单人模式席位条（§9.6 席位切换指挥 v1）：底部一排己方席位头像——点击或 Tab 切换操控席位。
// 当前席位金框；下注期已下注的席位打勾；破产席位置灰不可选。只读 store、只发 single_seat。
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { bustUrl } from '../scene/bustSnapshot';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL } from '../game/roles';
import { T } from '../text';

export default function SeatBar() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const seats = state.players.filter(p => p.id !== 'L');
  const currentId = state.single?.seatId;
  const betting = state.phase === 'BETTING';

  // Tab 循环切席（单人无聊天，Tab 空闲；输入框聚焦时让路）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const alive = seats.filter(s => !s.bankrupt);
      if (alive.length < 2) return;
      const i = alive.findIndex(s => s.id === currentId);
      send({ type: 'single_seat', seatId: alive[(i + 1) % alive.length].id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seats, currentId, send]);

  return (
    <div className="seat-bar">
      {seats.map(p => {
        const current = p.id === currentId;
        const tag = p.bankrupt ? T.single.seatDead : current ? T.single.seatCurrent : (betting && p.hasBet ? T.single.seatDone : null);
        return (
          <button
            key={p.id}
            className={`seat-chip ${current ? 'current' : ''} ${p.bankrupt ? 'dead' : ''}`}
            disabled={p.bankrupt || current}
            onClick={() => send({ type: 'single_seat', seatId: p.id })}
            title={p.name}
          >
            <img className="seat-bust" src={bustUrl(p.role)} alt={ROLE_LABEL[p.role] ?? p.role} draggable={false} />
            <PixelText size={2} color={current ? 'var(--px-gold)' : 'var(--ink-dim)'}>{ROLE_LABEL[p.role] ?? p.role}</PixelText>
            {tag && <span className={`seat-tag ${p.bankrupt ? 'dead' : current ? 'cur' : 'done'}`}><PixelText size={2} color="#fff">{tag}</PixelText></span>}
          </button>
        );
      })}
      <span className="seat-hint dim"><PixelText size={2} color="var(--ink-dim)">{T.single.switchHint}</PixelText></span>
    </div>
  );
}
