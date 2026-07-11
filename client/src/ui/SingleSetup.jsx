// 单人模式组队面板（§9.6）：大厅单人卡点开 → 4 个席位循环选角 + Boss 人格三选 + 幽灵开关 → 开局。
// 纯 2D 面板（开局前无 3D 场景）；文案全走 T.single / T.roles。
import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { bustUrl } from '../scene/bustSnapshot';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL, ROLE_DESC } from '../game/roles';
import { T } from '../text';

// 席位循环序（null=空位）。至少留 1 人由 begin 按钮守门。
const SEAT_CYCLE = [null, 'farmer', 'investor', 'glutton', 'prosecutor', 'lucky'];
const PERSONAS = ['steward', 'gambler', 'miser'];

export default function SingleSetup({ onClose }) {
  const startSingle = useGameStore(s => s.startSingle);
  const connected = useGameStore(s => s.connected);
  const [seats, setSeats] = useState(['farmer', 'farmer', null, null]);
  const [persona, setPersona] = useState('steward');
  const [ghost, setGhost] = useState(false);

  const cycleSeat = (i) => setSeats(prev => prev.map((r, j) => {
    if (j !== i) return r;
    return SEAT_CYCLE[(SEAT_CYCLE.indexOf(r) + 1) % SEAT_CYCLE.length];
  }));
  const teamRoles = seats.filter(Boolean);

  return (
    <div className="single-setup panel">
      <div className="ss-title"><PixelText size={3} color="var(--px-gold)">{T.single.setupTitle}</PixelText></div>
      <p className="dim ss-hint">{T.single.setupHint}</p>
      <div className="ss-seats">
        {seats.map((role, i) => (
          <button key={i} className={`ss-seat ${role ? '' : 'empty'}`} onClick={() => cycleSeat(i)} title={role ? ROLE_DESC[role] : T.single.emptySeat}>
            {role
              ? <img className="ss-bust" src={bustUrl(role)} alt={ROLE_LABEL[role]} draggable={false} />
              : <span className="ss-empty-mark">+</span>}
            <PixelText size={2} color={role ? 'var(--px-gold)' : 'var(--ink-dim)'}>{role ? ROLE_LABEL[role] : T.single.emptySeat}</PixelText>
          </button>
        ))}
      </div>
      <div className="ss-title"><PixelText size={2} color="var(--px-gold)">{T.single.bossTitle}</PixelText></div>
      <div className="ss-bosses">
        {PERSONAS.map(p => (
          <button key={p} className={`ss-boss ${persona === p ? 'picked' : ''}`} onClick={() => setPersona(p)}>
            <PixelText size={2} color={persona === p ? 'var(--px-gold)' : '#ece7d6'}>{T.single.personas[p].name}</PixelText>
            <span className="ss-boss-desc dim">{T.single.personas[p].desc}</span>
          </button>
        ))}
      </div>
      <label className="ss-ghost">
        <input type="checkbox" checked={ghost} onChange={e => setGhost(e.target.checked)} />
        <span className="dim">{T.single.ghostToggle}</span>
      </label>
      <div className="ss-actions">
        <button className="btn primary" disabled={!connected || teamRoles.length < 1}
          onClick={() => startSingle({ teamRoles, persona, ghost })}>{T.single.begin}</button>
        <button className="btn ghost" onClick={onClose}>{T.single.cancel}</button>
      </div>
    </div>
  );
}
