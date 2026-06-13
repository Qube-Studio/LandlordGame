// 飞牌动画层：钱牌在 2D UI 与 3D 桌面之间穿梭的幽灵元素（FLIP 动画）。
// flights 由 gameStore 驱动；动画结束自行移除。

import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';

const MoneyNote = getArt('moneyNote');

const FLIGHT_MS = 650;

function FlightGhost({ flight }) {
  const removeFlight = useGameStore(s => s.removeFlight);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setArrived(true));
    const timer = setTimeout(() => removeFlight(flight.id), FLIGHT_MS + 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [flight.id, removeFlight]);

  const pos = arrived ? flight.to : flight.from;
  const scale = arrived ? flight.to.w / flight.from.w : 1;
  return (
    <div
      className="flight-ghost"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
        transitionDuration: `${FLIGHT_MS}ms`,
      }}
    >
      <MoneyNote value={flight.value || 1} faceDown={flight.faceDown} debt={flight.debt} width={flight.from.w} />
    </div>
  );
}

export default function FlightLayer() {
  const flights = useGameStore(s => s.flights);
  if (flights.length === 0) return null;
  return (
    <div className="flight-layer">
      {flights.map(f => <FlightGhost key={f.id} flight={f} />)}
    </div>
  );
}
