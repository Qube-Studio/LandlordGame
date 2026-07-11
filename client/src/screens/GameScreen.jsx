import { useGameStore } from '../store/gameStore';
import Scene3D from '../scene/Scene3D';
import UiLayer from '../ui/UiLayer';
import McChat from '../ui/McChat';
import InsuranceDropLayer from '../ui/InsuranceDropLayer';
import VictoryOverlay from '../ui/VictoryOverlay';
import { T } from '../text';

export default function GameScreen() {
  const state = useGameStore(s => s.state);
  const connected = useGameStore(s => s.connected);

  if (!state) {
    return <div className="center-screen dim">{connected ? T.game.entering : T.common.connecting}</div>;
  }
  return (
    <div className="game-screen">
      <Scene3D />
      <UiLayer />
      <McChat />
      <InsuranceDropLayer />
      <VictoryOverlay />
    </div>
  );
}
