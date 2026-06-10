import { useGameStore } from '../store/gameStore';
import BettingPanel from './BettingPanel';
import BankPanel from './BankPanel';

export default function ActionPanel() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const skipVotes = useGameStore(s => s.skipVotes);
  const send = useGameStore(s => s.send);

  if (!state) return null;
  const { phase, players } = state;
  const myPlayer = players.find(p => p.id === playerId);
  const isLobby = phase === 'LOBBY';
  const isEnded = phase === 'ENDED';

  if (isLobby || isEnded) return null;

  const activeFarmers = players.filter(p => p.role === 'farmer' && !p.bankrupt);
  const isFarmerActive = myPlayer?.role === 'farmer' && !myPlayer?.bankrupt;
  const myVoted = skipVotes.includes(playerId);

  return (
    <div className="card action-panel">
      {phase === 'BETTING' && <BettingPanel />}

      {(phase === 'REVEAL' || phase === 'FLIP' || phase === 'SETTLEMENT') && (
        <div className="muted">等待结算…</div>
      )}

      {phase === 'NEGOTIATION' && (
        <div className="negotiation-banner">
          <div className="negotiation-title">🤝 协商阶段 — 农民可协商分配本轮收益</div>

          <div className="skip-votes">
            {activeFarmers.map(p => (
              <span key={p.id} className={`skip-badge ${skipVotes.includes(p.id) ? 'agreed' : 'pending'}`}>
                {p.name}: {skipVotes.includes(p.id) ? '✅ 同意跳过' : '⏳ 判断中'}
              </span>
            ))}
          </div>

          {isFarmerActive && !myVoted && (
            <button className="btn small" onClick={() => send({ type: 'skip_negotiation_vote' })}>
              同意跳过协商
            </button>
          )}
          {isFarmerActive && myVoted && (
            <span className="muted">已投票同意跳过，等待其他农民…</span>
          )}
        </div>
      )}

      <div className="action-panel-divider" />
      <BankPanel />
    </div>
  );
}
