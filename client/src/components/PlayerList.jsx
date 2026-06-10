import { useGameStore } from '../store/gameStore';
import { ROLE_LABEL, ROLE_COLOR } from '../roleLabels';
import { ROLE_ICONS } from '../uiAssets';

export default function PlayerList() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);

  if (!state) return null;
  const { players, bets, phase, hostId } = state;

  const isBetting = phase === 'BETTING';

  const statusDot = (p) => {
    if (p.bankrupt) return { cls: 'status-dot--bankrupt', label: '💀' };
    if (!p.role) return { cls: 'status-dot--pending', label: '未选择角色' };
    if (phase === 'LOBBY') {
      return p.ready
        ? { cls: 'status-dot--active', label: '已准备' }
        : { cls: 'status-dot--waiting', label: '未准备' };
    }
    if (isBetting && ['landlord', 'farmer'].includes(p.role)) {
      return bets?.[p.id] !== undefined
        ? { cls: 'status-dot--active', label: '已下注' }
        : { cls: 'status-dot--waiting', label: '待下注' };
    }
    return { cls: 'status-dot--active', label: '在线' };
  };

  const rightStatus = (p) => {
    if (phase === 'LOBBY') {
      if (!p.role) return '—';
      return p.ready ? '✅ 已准备' : '⏳ 未准备';
    }
    const hasBet = bets?.[p.id] !== undefined;
    if (isBetting) {
      if (hasBet) return '✅ 已下注';
      return ['landlord', 'farmer'].includes(p.role) && !p.bankrupt ? '⏳ 待下注' : '—';
    }
    if (!hasBet) return '—';
    return typeof bets[p.id] === 'number' ? `¥${bets[p.id]}` : bets[p.id];
  };

  return (
    <div className="player-list card">
      <h3>玩家列表</h3>

      <div className="player-card-list">
        {players.map(p => {
          const dot = statusDot(p);
          return (
            <div key={p.id} className={`player-card ${p.id === playerId ? 'me' : ''}`}>
              <div>
                <span className={`status-dot ${dot.cls}`} title={dot.label} />
                <span>{p.name}{p.id === playerId ? ' (我)' : ''}{p.id === hostId ? ' 👑' : ''}</span>
                <span style={{ color: ROLE_COLOR[p.role], marginLeft: 8, fontSize: 12 }}>
                  {ROLE_ICONS[p.role] && <img className="role-icon" src={ROLE_ICONS[p.role]} alt="" />}
                  {ROLE_LABEL[p.role ?? null]}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                {phase !== 'LOBBY' && (
                  <span>{p.bankrupt ? '—' : (p.balance == null ? '🔒' : `¥${p.balance.toFixed(1)}`)}</span>
                )}
                <span>{rightStatus(p)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
