import { useGameStore } from '../store/gameStore';
import TableScene from '../scene/TableScene';
import UiLayer from '../ui/UiLayer';
import ChatPanel from '../ui/ChatPanel';
import FlightLayer from '../ui/FlightLayer';

export default function GameScreen() {
  const state = useGameStore(s => s.state);
  const connected = useGameStore(s => s.connected);

  if (!state) {
    return <div className="center-screen dim">{connected ? '正在进入房间…' : '正在连接服务器…'}</div>;
  }
  return (
    <div className="game-screen">
      <TableScene />
      <UiLayer />
      <ChatPanel />
      <FlightLayer />
    </div>
  );
}
