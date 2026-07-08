// 终局演出（§阶段七，仅 3D 输入模式；2D 仍用 UiLayer#EndedPanel 的按钮面板）：
// 阵营区分文案 → 逐字机甲组装式砸入（屏外带过冲落位）→ 组装完成爆金色粒子 → 驻留 → 收尾淡出，
// **淡出后露出终局桌面、不自动回大厅——房主点「下一局」才重开**（endedToLobbyMs 默认 0）。
// 罩层 pointer-events:none：只挡视觉不挡交互，鼠标仍可转视角（相机 look 挂在 window 上，天然不受影响）。
// 打开账本（L）时自身淡隐让位，收起即回。
// 注：高斯模糊罩底另在演示分支单独评估，不并入正式游戏。
import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { ROLE_LABEL, factionOf, isFarmerSide, isLandlordSide } from '../game/roles';
import { IS_3D_INPUT, IS_TOUCH } from '../game/inputMode';
import PixelText from '../assets/pixelfont/PixelText';

const STAG = 130;      // 逐字入场间隔
const SPARKS = 32;     // 组装完成的爆点粒子数
const TEXT_SIZE = 14;  // 大字像素点边长（字高 ≈ 7×size）
const DWELL = 2600;    // 爆点后驻留多久开始收尾淡出（无自动回大厅时自走）

export default function VictoryOverlay() {
  const phase = useGameStore(s => s.state?.phase);
  if (!IS_3D_INPUT || phase !== 'ENDED') return null; // 2D 模式让位给 EndedPanel
  return <VictoryStage />;
}

function VictoryStage() {
  const winnerSide = useGameStore(s => s.state.winnerSide);
  const myRole = useGameStore(s => s.state.me?.role);
  const spectator = useGameStore(s => !!s.state.me?.spectator);
  const isHost = useGameStore(s => !!s.state.me?.isHost);
  const send = useGameStore(s => s.send);
  const endedReturnAt = useGameStore(s => s.state.endedReturnAt);
  const panelOpen = useGameStore(s => s.panel != null);
  const landlordRole = useGameStore(s => s.state.players.find(p => isLandlordSide(p.role))?.role);

  const noFaction = spectator || !factionOf(myRole);
  const iWon = winnerSide && ((winnerSide === 'farmers') === isFarmerSide(myRole));
  const winnerName = winnerSide === 'farmers' ? '农民' : (ROLE_LABEL[landlordRole] ?? '地主');

  const text = noFaction ? `${winnerName}胜利` : iWon ? '胜利！' : '败北';
  const tone = noFaction ? 'neutral' : iWon ? 'win' : 'lose';
  const winColor = winnerSide === 'farmers' ? 'var(--ok)' : 'var(--px-gold)';
  const color = tone === 'lose' ? '#93a0b2' : winColor;
  const chars = useMemo(() => [...text], [text]);

  const burstAt = (chars.length - 1) * STAG + 400; // 与末字砸落瞬间对齐
  const [burst, setBurst] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timers = [setTimeout(() => setBurst(true), burstAt)];
    // 收尾淡出：默认（endedToLobbyMs=0，endedReturnAt 为 null）自走驻留 DWELL 后淡出，露出终局桌面；
    // 若配置了自动回大厅（>0）则仍对齐其时刻提前 ~0.9s 淡（回大厅时 phase 变更卸载本层）。
    const leaveAt = endedReturnAt
      ? Math.max(burstAt + 600, endedReturnAt - Date.now() - 900)
      : burstAt + DWELL;
    timers.push(setTimeout(() => setLeaving(true), leaveAt));
    return () => timers.forEach(clearTimeout);
  }, [burstAt, endedReturnAt]);

  return (
    <>
      <div className={`victory-overlay ${tone}${leaving ? ' leaving' : ''}${panelOpen ? ' dimmed' : ''}`}>
        <div className={`victory-stage${burst ? ' landed' : ''}`}>
          <div className="victory-text">
            {chars.map((ch, i) => (
              <span key={i} className="victory-char" style={{ animationDelay: `${i * STAG}ms`, '--rd': i % 2 ? 1 : -1 }}>
                <PixelText size={TEXT_SIZE} color={color}>{ch}</PixelText>
              </span>
            ))}
          </div>
          {burst && <Sparks />}
        </div>
      </div>
      {/* 终局操作行：淡出后浮现（不随大字淡走）。房主=「下一局」按钮（重开）；其余=等待文案。
          移动端不显示「按 L 查看战绩」（无键盘；账本仍可点桌沿 Dock 的账本页签）。 */}
      {leaving && (
        <div className={`victory-controls${panelOpen ? ' dimmed' : ''}`}>
          {isHost
            ? (
              <button className="btn primary victory-next" onClick={() => send({ type: 'restart_game' })}>
                下一局{!IS_TOUCH && <span className="keycap">空格</span>}
              </button>
            )
            : <PixelText size={2.5} color="var(--ink-dim)">等待房主开下一局</PixelText>}
          {!IS_TOUCH && <div className="victory-hint"><PixelText size={2} color="var(--ink-dim)">按 L 查看战绩</PixelText></div>}
        </div>
      )}
    </>
  );
}

// 一次性金色爆点（不随阵营变色——规格明确「爆金色粒子」）：粒子从中心四散、旋转、淡出，外加一圈扩散光环。
// 散布用基于序号的确定性伪随机（GLSL 经典 sin-hash，纯函数）——避免 Math.random 的渲染期不纯，且每次爆点稳定。
const rnd = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
function Sparks() {
  const sparks = useMemo(() => Array.from({ length: SPARKS }, (_, i) => {
    const ang = (i / SPARKS) * Math.PI * 2 + (rnd(i) - 0.5) * 0.5;
    const dist = 95 + rnd(i + 7) * 185;
    return {
      dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist,
      rot: (rnd(i + 13) * 2 - 1) * 240, size: 7 + Math.floor(rnd(i + 21) * 8),
      gold: i % 3 ? '#ffd76e' : '#e8a83a', delay: Math.floor(rnd(i + 29) * 60),
    };
  }), []);
  return (
    <div className="victory-sparks" aria-hidden="true">
      <div className="victory-flash" />
      {sparks.map((s, i) => (
        <span
          key={i}
          className="victory-spark"
          style={{
            '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--rot': `${s.rot}deg`,
            width: `${s.size}px`, height: `${s.size}px`, background: s.gold, animationDelay: `${s.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}
