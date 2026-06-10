import { useGameStore } from './store/gameStore';
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import DebugPanel from './components/DebugPanel';
import BettingScene from './components/BettingScene';
import './App.css';

export default function App() {
  const username = useGameStore(s => s.username);
  const roomId = useGameStore(s => s.roomId);
  const playerId = useGameStore(s => s.playerId);

  if (new URLSearchParams(window.location.search).get('debug') === '1') return <DebugPanel />;
  if (!username) return <Login />;
  if (!roomId || !playerId) return <Lobby />;
  if (new URLSearchParams(window.location.search).get('scene') === 'new') return <BettingScene />;
  return <GameBoard />;
}
