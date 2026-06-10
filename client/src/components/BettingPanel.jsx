import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

export default function BettingPanel() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);
  const [betAmount, setBetAmount] = useState('');

  if (!state) return null;
  const { phase, players, bets, config, myBalance, forceAllIn, allInAmount } = state;
  const myPlayer = players.find(p => p.id === playerId);

  if (!myPlayer || !['landlord', 'farmer'].includes(myPlayer.role)) return null;
  if (myPlayer.bankrupt) return null;
  if (phase !== 'BETTING') return null;

  const minBet = myPlayer.role === 'landlord' ? config.minBetLandlord : config.minBetFarmer;
  const maxBet = myBalance - minBet;
  const alreadyBet = bets?.[playerId] !== undefined;

  const placeBet = (amount) => {
    send({ type: 'place_bet', amount });
    setBetAmount('');
  };

  return (
    <div className="betting-panel">
      <h3>下注阶段 — 第 {state.round} 回合</h3>
      <div className="bet-info">
        余额: <strong>¥{myBalance}</strong>
        &nbsp;·&nbsp;最小下注: <strong>¥{minBet}</strong>
        {!forceAllIn && <>&nbsp;·&nbsp;最大下注: <strong>¥{maxBet}</strong></>}
      </div>

      {alreadyBet ? (
        <div className="already-bet">✅ 已下注 ¥{bets?.[playerId]}，等待其他玩家…</div>
      ) : forceAllIn ? (
        <div className="force-allin">
          <span className="allin-hint">⚠️ 余额不足，只能全押</span>
          <button className="btn primary" onClick={() => placeBet(allInAmount)}>
            全押 ¥{allInAmount}
          </button>
        </div>
      ) : (
        <div className="bet-input-row">
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
          <button className="btn primary" onClick={() => placeBet(Number(betAmount))}
            disabled={Number(betAmount) < minBet || Number(betAmount) > maxBet || !betAmount}>
            确认下注
          </button>
        </div>
      )}
    </div>
  );
}
