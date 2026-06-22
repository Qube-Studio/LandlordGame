// 投保确认后：保单牌从纸币槽位置一张一张掉出屏幕底部（不上桌）。由 gameStore.insuranceDrops 驱动。
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';

const MoneyNote = getArt('moneyNote');
const FALL_MS = 720;

function DropNote({ item }) {
  const remove = useGameStore(s => s.removeInsuranceDrop);
  const [fall, setFall] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFall(true));
    const timer = setTimeout(() => remove(item.id), FALL_MS + item.delay + 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [item.id, item.delay, remove]);

  const y = fall ? window.innerHeight + 160 : item.y;
  const rot = fall ? item.spin : 0;
  return (
    <div
      className="insurance-drop"
      style={{
        transform: `translate(${item.x}px, ${y}px) rotate(${rot}deg)`,
        transitionDuration: `${FALL_MS}ms`,
        transitionDelay: `${item.delay}ms`,
        opacity: fall ? 0.15 : 1,
      }}
    >
      <MoneyNote value={item.value || 1} width={item.w || 62} />
    </div>
  );
}

export default function InsuranceDropLayer() {
  const drops = useGameStore(s => s.insuranceDrops);
  if (drops.length === 0) return null;
  return <div className="flight-layer">{drops.map(d => <DropNote key={d.id} item={d} />)}</div>;
}
