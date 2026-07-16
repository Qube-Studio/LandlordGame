import { useGameStore } from '../store/gameStore';
import Scene3D from '../scene/Scene3D';
import UiLayer from '../ui/UiLayer';
import McChat from '../ui/McChat';
import SeatBar from '../ui/SeatBar';
import InsuranceDropLayer from '../ui/InsuranceDropLayer';
import VictoryOverlay from '../ui/VictoryOverlay';
import { T } from '../text';

export default function GameScreen() {
  const state = useGameStore(s => s.state);
  const connected = useGameStore(s => s.connected);
  const hideUi = useGameStore(s => s.hideUi);

  if (!state) {
    return <div className="center-screen dim">{connected ? T.game.entering : T.common.connecting}</div>;
  }
  const single = state.mode === 'single';
  return (
    <div className={`game-screen ${hideUi ? 'ui-hidden' : ''}`}>
      <Scene3D />
      <UiLayer />
      {/* 单人：无他人可聊，聊天让位给席位条（Tab 也让给切席，§9.6） */}
      {single ? <SeatBar /> : <McChat />}
      <InsuranceDropLayer />
      <VictoryOverlay />
    </div>
  );
}
