import { useGameStore } from '../store/gameStore';

const COIN_LABEL = { heads: '正面 👑 (地主方向)', tails: '反面 🌾 (农民方向)' };

export default function GameTable() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const revealedBets = useGameStore(s => s.revealedBets);
  const coinResult = useGameStore(s => s.coinResult);
  const lastRoundResult = useGameStore(s => s.lastRoundResult);

  if (!state) return null;
  const { phase, players, bets } = state;

  const activePlayers = players.filter(p => ['landlord', 'farmer'].includes(p.role) && !p.bankrupt);

  if (phase === 'LOBBY') {
    return (
      <div className="card game-table">
        <h3>牌桌</h3>
        <p className="muted">等待游戏开始…</p>
      </div>
    );
  }

  if (phase === 'ENDED') {
    return (
      <div className="card game-table">
        <h3>牌桌</h3>
        <p className="muted">游戏已结束</p>
      </div>
    );
  }

  if (phase === 'BETTING') {
    const myBet = bets?.[playerId];
    return (
      <div className="card game-table">
        <h3>牌桌 — 下注阶段</h3>
        <div className="bet-info">
          我的下注: <strong>{myBet !== undefined ? `¥${myBet}` : '未下注'}</strong>
        </div>
        <div className="bet-status">
          {activePlayers.filter(p => p.id !== playerId).map(p => (
            <span key={p.id} className={`bet-badge ${bets?.[p.id] !== undefined ? 'placed' : 'waiting'}`}>
              {p.name}: {bets?.[p.id] !== undefined ? '✅ 已下注' : '⏳ 等待中'}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'REVEAL' || phase === 'FLIP') {
    const realBets = (typeof bets === 'object' && bets) || revealedBets || {};
    return (
      <div className="card game-table">
        <h3>牌桌 — {phase === 'FLIP' ? '掷硬币' : '揭牌'}</h3>
        {phase === 'FLIP' && coinResult && (
          <div className="bet-info" style={{ fontSize: 16, marginBottom: 12 }}>
            硬币结果: <strong>{COIN_LABEL[coinResult] ?? coinResult}</strong>
          </div>
        )}
        <div className="bet-status">
          {activePlayers.map(p => (
            <span key={p.id} className={`bet-badge ${p.id === playerId ? 'placed' : ''}`}>
              {p.name}{p.id === playerId ? '(我)' : ''}: ¥{realBets[p.id] ?? '?'}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // SETTLEMENT / NEGOTIATION
  const result = lastRoundResult ?? state.history?.[state.history.length - 1];
  if (!result) {
    return (
      <div className="card game-table">
        <h3>牌桌</h3>
        <p className="muted">结算中…</p>
      </div>
    );
  }

  return (
    <div className="card game-table">
      <h3>牌桌 — 第 {result.round} 回合结果</h3>
      <div className="bet-info" style={{ fontSize: 16, marginBottom: 12 }}>
        硬币结果: <strong>{COIN_LABEL[result.coinResult] ?? result.coinResult}</strong>
      </div>
      <div style={{ marginBottom: 10 }}>
        {result.events?.map((e, i) => (
          <span key={i} className={`event-tag ${e.type}`}>
            {e.type === 'landlord_wins' && `地主赢 +¥${e.landlordGain}`}
            {e.type === 'landlord_wins_partial' && `地主赢(不足) 差¥${e.shortfall?.toFixed(1)}`}
            {e.type === 'farmers_win' && `农民赢 底池¥${e.pot?.toFixed(1)}`}
          </span>
        ))}
      </div>
      <div className="bet-status">
        {Object.entries(result.deltas ?? {}).map(([id, delta]) => {
          const p = players.find(pl => pl.id === id);
          return (
            <span key={id} className={`bet-badge ${delta >= 0 ? 'placed' : 'waiting'}`}
              style={{ color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--muted)' }}>
              {p?.name ?? id}{id === playerId ? '(我)' : ''}: {delta > 0 ? `+¥${delta}` : `¥${delta}`}
            </span>
          );
        })}
      </div>
      {result.newlyBankrupt?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {result.newlyBankrupt.map(id => {
            const p = players.find(pl => pl.id === id);
            return <span key={id} className="event-tag bankrupt">💀 {p?.name ?? id} 破产</span>;
          })}
        </div>
      )}
    </div>
  );
}
