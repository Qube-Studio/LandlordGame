// 桌沿抽屉把手（HUD 2.0）：屏幕正下方两个小把手，呼出/收起选角墙(R)与账本(L)。
// 新一轮入账时账本把手脉冲一下并更新轮数角标，提示「有新账可查」。
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { T } from '../text';

export default function Dock() {
  const panel = useGameStore(s => s.panel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const histLen = useGameStore(s => s.state?.history?.length ?? 0);
  const [pulse, setPulse] = useState(false);
  const prevLen = useRef(histLen);

  useEffect(() => {
    const grew = histLen > prevLen.current;
    prevLen.current = histLen;
    if (!grew) return undefined;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1600);
    return () => clearTimeout(t);
  }, [histLen]);

  return (
    <div className="dock">
      <button className={`dock-tab ${panel === 'roles' ? 'open' : ''}`} onClick={() => togglePanel('roles')}>
        <PixelText size={2}>{T.dock.roles}</PixelText>
        <span className="keycap">R</span>
      </button>
      <button className={`dock-tab ${panel === 'ledger' ? 'open' : ''} ${pulse ? 'pulse' : ''}`} onClick={() => togglePanel('ledger')}>
        <PixelText size={2}>{T.dock.ledger}</PixelText>
        <span className="keycap">L</span>
        {histLen > 0 && <span className="dock-badge"><PixelText size={2} color="var(--c-wood-900)">{String(histLen)}</PixelText></span>}
      </button>
    </div>
  );
}
