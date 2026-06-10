import { useGameStore } from '../store/gameStore';

export default function BalanceBar() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);

  if (!state) return null;
  const { players, myBalance } = state;
  const myPlayer = players.find(p => p.id === playerId);
  if (!myPlayer) return null;

  return (
    <div className="balance-display">
      {myPlayer.bankrupt ? (
        <div className="balance-amount balance-amount--bankrupt">💀 已破产</div>
      ) : (
        <div className="balance-amount">
          {myBalance}<span className="balance-unit">$</span>
        </div>
      )}
    </div>
  );
}
