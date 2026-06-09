import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

export default function BettingPanel() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);
  const [betAmount, setBetAmount] = useState('');

  if (!state) return null;
  const { phase, players, bets, config, myBalance } = state;
  const myPlayer = players.find(p => p.id === playerId);

  if (!myPlayer || !['landlord', 'farmer'].includes(myPlayer.role)) return null;
  if (myPlayer.bankrupt) return null;
  if (phase !== 'BETTING') return null;

  const minBet = myPlayer.role === 'landlord' ? config.minBetLandlord : config.minBetFarmer;
  const maxBet = myBalance - minBet;
  const alreadyBet = bets?.[playerId] !== undefined;

  const placeBet = () => {
    const amount = Number(betAmount);
    if (amount < minBet || amount > maxBet) return;
    send({ type: 'place_bet', amount });
    setBetAmount('');
  };

  return (
    <div className="card betting-panel">
      <h3>下注阶段 — 第 {state.round} 回合</h3>
      {alreadyBet ? (
        <div className="already-bet">✅ 已下注，等待其他玩家…</div>
      ) : (
        <div className="bet-input-row">
          <span>余额: ¥{myBalance?.toFixed(1)}</span>
          <input
            type="number"
            className="input small"
            min={minBet}
            max={maxBet}
            step="1"
            placeholder={`${minBet}~${maxBet}`}
            value={betAmount}
            onChange={e => setBetAmount(e.target.value)}
          />
          <button className="btn primary" onClick={placeBet}
            disabled={Number(betAmount) < minBet || Number(betAmount) > maxBet}>
            确认下注
          </button>
        </div>
      )}
      <div className="bet-status">
        {players.filter(p => ['landlord', 'farmer'].includes(p.role) && !p.bankrupt).map(p => (
          <span key={p.id} className={`bet-badge ${bets?.[p.id] !== undefined ? 'placed' : 'waiting'}`}>
            {p.name}: {bets?.[p.id] !== undefined ? '已下注' : '等待中'}
          </span>
        ))}
      </div>
    </div>
  );
}
