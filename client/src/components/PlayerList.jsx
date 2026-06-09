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

      <table className="player-table">
        <thead>
          <tr>
            <th>名字</th>
            <th>角色</th>
            <th>余额</th>
            <th>{isBetting ? '下注状态' : '本轮下注'}</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const hasBet = bets?.[p.id] !== undefined;
            const betDisplay = isBetting
              ? (hasBet
                  ? <span className="bet-done">✅ 已下注</span>
                  : (['landlord', 'farmer'].includes(p.role) && !p.bankrupt
                      ? <span className="bet-wait">⏳ 待下注</span>
                      : '—'))
              : (hasBet
                  ? (typeof bets[p.id] === 'number' ? `¥${bets[p.id]}` : bets[p.id])
                  : '—');

            return (
              <tr key={p.id} className={p.id === playerId ? 'me' : ''}>
                <td>{p.name}{p.id === playerId ? ' (我)' : ''}</td>
                <td style={{ color: ROLE_COLOR[p.role] }}>{ROLE_LABEL[p.role ?? null]}</td>
                <td>{p.bankrupt ? '—' : `¥${p.balance?.toFixed(1)}`}</td>
                <td>{betDisplay}</td>
                <td>{p.bankrupt ? '💀 破产' : '✓'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
