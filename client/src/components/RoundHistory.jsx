import { useGameStore } from '../store/gameStore';

export default function RoundHistory() {
  const state = useGameStore(s => s.gameState);
  if (!state?.history?.length) return null;

  const recent = [...state.history].reverse().slice(0, 8);

  return (
    <div className="card history">
      <h3>回合历史</h3>
      <table className="history-table">
        <thead>
          <tr><th>回合</th><th>硬币</th><th>结果</th></tr>
        </thead>
        <tbody>
          {recent.map(r => (
            <tr key={r.round}>
              <td>{r.round}</td>
              <td>{r.coinResult === 'heads' ? '正面 👑' : '反面 🌾'}</td>
              <td>
                {r.events.map((e, i) => (
                  <span key={i} className={`event-tag ${e.type}`}>
                    {e.type === 'landlord_wins' && `地主赢 +¥${e.landlordGain}`}
                    {e.type === 'landlord_wins_partial' && `地主赢(不足) 差¥${e.shortfall?.toFixed(1)}`}
                    {e.type === 'farmers_win' && `农民赢 底池¥${e.pot?.toFixed(1)}`}
                  </span>
                ))}
                {r.newlyBankrupt?.length > 0 && (
                  <span className="event-tag bankrupt">💀 破产</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
