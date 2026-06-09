import { useGameStore } from './store/gameStore';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import './App.css';

export default function App() {
  const roomId = useGameStore(s => s.roomId);
  const playerId = useGameStore(s => s.playerId);

  if (!roomId || !playerId) return <Lobby />;
  return <GameBoard />;
}
