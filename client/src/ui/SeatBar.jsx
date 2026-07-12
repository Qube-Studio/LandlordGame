// 左下角席位列（§9.6 交互 v2）：单人模式的全部队伍操作都在这里，无独立组队面板。
// - 组队期（SINGLE_SETUP）：4 个槽位芯片点击循环选角（含空位）+ 幽灵开关 + 开局按钮。
// - 对局期：点击芯片附身该席位（相机飞入落座）、Tab 附身/循环切席、X 起身回全局走动。
// 只读 store；发 single_role / single_ghost / single_begin / single_seat。
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { bustUrl } from '../scene/bustSnapshot';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL, ROLE_DESC } from '../game/roles';
import { T } from '../text';

// 槽位循环序（null=空位）。至少留 1 人由开局按钮守门。
const SEAT_CYCLE = [null, 'farmer', 'investor', 'glutton', 'prosecutor', 'lucky'];

export default function SeatBar() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const singleCam = useGameStore(s => s.singleCam);
  const setSingleCam = useGameStore(s => s.setSingleCam);
  const setup = state.single?.setup ?? null;
  const seats = state.players.filter(p => p.id !== 'L');
  const currentId = state.single?.seatId;
  const betting = state.phase === 'BETTING';

  // Tab 附身/循环切席、X 起身（输入框聚焦让路；组队期无席可切）
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if ((e.key === 'x' || e.key === 'X') && !setup) { setSingleCam('walk'); return; }
      if (e.key !== 'Tab' || setup) return;
      e.preventDefault();
      const alive = seats.filter(s => !s.bankrupt);
      if (!alive.length) return;
      // 走动中按 Tab = 附身当前操控席位；已落座再按 = 循环下一席
      if (singleCam !== 'seat') { setSingleCam('seat'); return; }
      if (alive.length < 2) return;
      const i = alive.findIndex(s => s.id === currentId);
      send({ type: 'single_seat', seatId: alive[(i + 1) % alive.length].id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seats, currentId, send, setup, singleCam, setSingleCam]);

  // ---- 组队期：桌边选角（列为 column-reverse，DOM 首元素在最下）----
  if (setup) {
    const filled = setup.roles.filter(Boolean).length;
    return (
      <div className="seat-bar">
        <span className="seat-hint dim"><PixelText size={2} color="var(--ink-dim)">{T.single.setupHint}</PixelText></span>
        {setup.roles.map((role, i) => (
          <button
            key={i}
            className={`seat-chip ${role ? '' : 'empty'}`}
            onClick={() => send({ type: 'single_role', slot: i, role: SEAT_CYCLE[(SEAT_CYCLE.indexOf(role) + 1) % SEAT_CYCLE.length] })}
            title={role ? ROLE_DESC[role] : T.single.emptySeat}
          >
            {role
              ? <img className="seat-bust" src={bustUrl(role)} alt={ROLE_LABEL[role]} draggable={false} />
              : <span className="seat-empty-mark">+</span>}
            <PixelText size={2} color={role ? 'var(--px-gold)' : 'var(--ink-dim)'}>{role ? ROLE_LABEL[role] : T.single.emptySeat}</PixelText>
          </button>
        ))}
        <button className={`seat-chip toggle ${setup.ghost ? 'current' : ''}`} onClick={() => send({ type: 'single_ghost', on: !setup.ghost })}>
          <PixelText size={2} color={setup.ghost ? 'var(--px-gold)' : 'var(--ink-dim)'}>{T.single.ghostToggle}</PixelText>
        </button>
        <button className="seat-chip begin" disabled={!filled} onClick={() => send({ type: 'single_begin' })}>
          <PixelText size={2} color={filled ? '#fff' : 'var(--ink-dim)'}>{T.single.begin}</PixelText>
        </button>
      </div>
    );
  }

  // ---- 对局期：附身/切席/起身 ----
  return (
    <div className="seat-bar">
      <span className="seat-hint dim">
        <PixelText size={2} color="var(--ink-dim)">
          {singleCam === 'seat' ? T.single.switchHint : T.single.walkHint}
        </PixelText>
      </span>
      {seats.map(p => {
        const current = p.id === currentId;
        const seated = current && singleCam === 'seat';
        const tag = p.bankrupt ? T.single.seatDead : current ? T.single.seatCurrent : (betting && p.hasBet ? T.single.seatDone : null);
        return (
          <button
            key={p.id}
            className={`seat-chip ${current ? 'current' : ''} ${p.bankrupt ? 'dead' : ''}`}
            disabled={p.bankrupt || seated}
            onClick={() => { if (p.id !== currentId) send({ type: 'single_seat', seatId: p.id }); setSingleCam('seat'); }}
            title={p.name}
          >
            <img className="seat-bust" src={bustUrl(p.role)} alt={ROLE_LABEL[p.role] ?? p.role} draggable={false} />
            <PixelText size={2} color={current ? 'var(--px-gold)' : 'var(--ink-dim)'}>{ROLE_LABEL[p.role] ?? p.role}</PixelText>
            {tag && <span className={`seat-tag ${p.bankrupt ? 'dead' : current ? 'cur' : 'done'}`}><PixelText size={2} color="#fff">{tag}</PixelText></span>}
          </button>
        );
      })}
      {singleCam === 'seat' && (
        <button className="seat-chip toggle" onClick={() => setSingleCam('walk')}>
          <PixelText size={2} color="var(--ink-dim)">{T.single.standUp}</PixelText>
        </button>
      )}
    </div>
  );
}
