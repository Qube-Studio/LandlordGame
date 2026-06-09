import { useGameStore } from '../store/gameStore';

export default function FundHistory() {
  const state = useGameStore(s => s.gameState);
  if (!state?.myBalanceHistory?.length) return null;

  const rows = state.myBalanceHistory;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 10 }}>我的资金历史</h3>
      <table className="history-table">
        <thead>
          <tr>
            <th>回合</th>
            <th>余额</th>
            <th>变化</th>
            <th>事件</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.round}>
              <td>{r.round}</td>
              <td>¥{r.balance ?? '—'}</td>
              <td style={{ color: r.delta > 0 ? 'var(--success)' : r.delta < 0 ? 'var(--danger)' : 'var(--muted)' }}>
                {r.delta === null ? '—' : r.delta > 0 ? `+${r.delta}` : r.delta}
              </td>
              <td>{r.event ? <span className={`event-tag ${r.event}`}>{eventLabel(r.event)}</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function eventLabel(e) {
  const map = {
    landlord_wins: '地主赢',
    landlord_wins_partial: '地主赢(补差)',
    farmers_win: '农民赢',
    bankrupt: '破产',
  };
  return map[e] ?? e;
}
