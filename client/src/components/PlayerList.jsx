import { useGameStore } from '../store/gameStore';

const ROLE_LABEL = { landlord: '地主', farmer: '农民', bank: '银行', null: '未选择' };
const ROLE_COLOR = { landlord: '#e74c3c', farmer: '#27ae60', bank: '#f39c12' };

export default function PlayerList() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);

  if (!state) return null;
  const { players, bets, phase } = state;

  const myPlayer = players.find(p => p.id === playerId);
  const needsRole = !myPlayer?.role;
  const isBetting = phase === 'BETTING';

  const statusDot = (p) => {
    if (p.bankrupt) return { cls: 'status-dot--bankrupt', label: '💀' };
    if (!p.role) return { cls: 'status-dot--pending', label: '未选择角色' };
    if (isBetting && ['landlord', 'farmer'].includes(p.role)) {
      return bets?.[p.id] !== undefined
        ? { cls: 'status-dot--active', label: '已下注' }
        : { cls: 'status-dot--waiting', label: '待下注' };
    }
    return { cls: 'status-dot--active', label: '在线' };
  };

  const betDisplay = (p) => {
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

      {needsRole && phase === 'LOBBY' && (
        <div className="role-select">
          <span>选择角色：</span>
          {['landlord', 'farmer', 'bank'].map(role => (
            <button key={role} className="btn small"
              style={{ borderColor: ROLE_COLOR[role] }}
              onClick={() => send({ type: 'assign_role', role })}>
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
      )}

      <div className="player-card-list">
        {players.map(p => {
          const dot = statusDot(p);
          return (
            <div key={p.id} className={`player-card ${p.id === playerId ? 'me' : ''}`}>
              <div>
                <span className={`status-dot ${dot.cls}`} title={dot.label} />
                <span>{p.name}{p.id === playerId ? ' (我)' : ''}</span>
                <span style={{ color: ROLE_COLOR[p.role], marginLeft: 8, fontSize: 12 }}>
                  {ROLE_LABEL[p.role ?? null]}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                <span>{p.bankrupt ? '—' : (p.balance == null ? '🔒' : `¥${p.balance.toFixed(1)}`)}</span>
                <span>{betDisplay(p)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
