import { useGameStore } from '../store/gameStore';
import Scene3D from '../scene/Scene3D';
import UiLayer from '../ui/UiLayer';
import McChat from '../ui/McChat';
import FlightLayer from '../ui/FlightLayer';

export default function GameScreen() {
  const state = useGameStore(s => s.state);
  const connected = useGameStore(s => s.connected);

  if (!state) {
    return <div className="center-screen dim">{connected ? '正在进入房间…' : '正在连接服务器…'}</div>;
  }
  return (
    <div className="game-screen">
      <Scene3D />
      <UiLayer />
      <McChat />
      <FlightLayer />
    </div>
  );
}
