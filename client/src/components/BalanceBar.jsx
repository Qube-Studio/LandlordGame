import { useGameStore } from '../store/gameStore';

export default function BalanceBar() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);

  if (!state) return null;
  const { players, myBalance, config } = state;
  const myPlayer = players.find(p => p.id === playerId);
  if (!myPlayer) return null;

  if (myPlayer.bankrupt) {
    return (
      <div className="card">
        <h3>我的资金</h3>
        <div className="muted">💀 已破产</div>
      </div>
    );
  }

  let maxBalance = config.landlordStartBalance;
  if (myPlayer.role === 'farmer') {
    maxBalance = Math.ceil(config.landlordStartBalance * 0.8 / config.minBetLandlord);
  } else if (myPlayer.role === 'bank') {
    maxBalance = Math.ceil(config.landlordStartBalance * 1.5);
  }

  const pct = Math.max(0, Math.min(100, (myBalance / maxBalance) * 100));
  const fillClass = pct > 50 ? 'hp-bar-fill--high' : pct > 20 ? 'hp-bar-fill--mid' : 'hp-bar-fill--low';

  return (
    <div className="card">
      <h3>我的资金</h3>
      <div className="hp-bar">
        <div className={`hp-bar-fill ${fillClass}`} style={{ width: `${pct}%` }} />
        <div className="hp-bar-label">¥{myBalance?.toFixed(1)} / ¥{maxBalance}</div>
      </div>
    </div>
  );
}
