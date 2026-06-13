// 场景层：第一视角矩形赌桌（CSS 3D 平面），其他玩家与桌面钱牌的空间相对位置真实，
// 近大远小由透视变换自然产生。只读 store，不含任何游戏逻辑。

import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import { decompose, makeNote } from '../game/notes';

const MoneyNote = getArt('moneyNote');
const CubeAvatar = getArt('avatar');
const TableSurface = getArt('tableSurface');

// 对手座位锚点（桌面平面坐标，百分比）：沿远边/侧边环桌分布
const SEAT_LAYOUTS = {
  1: [{ x: 50, y: 2 }],
  2: [{ x: 30, y: 3 }, { x: 70, y: 3 }],
  3: [{ x: 11, y: 24 }, { x: 50, y: 2 }, { x: 89, y: 24 }],
  4: [{ x: 9, y: 30 }, { x: 33, y: 3 }, { x: 67, y: 3 }, { x: 91, y: 30 }],
};

const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];

function expressionFor(p, state) {
  if (p.bankrupt) return 'bankrupt';
  if (state.phase === 'DISCUSSION') return p.ready ? 'ready' : 'idle';
  if (state.phase === 'BETTING' || state.phase === 'REVEAL') return p.hasBet ? 'bet' : 'idle';
  if (PAYOUT_PHASES.includes(state.phase) && state.coinResult) {
    const farmersWin = state.coinResult === 'tails';
    if (p.role === 'farmer') return farmersWin ? 'win' : 'lose';
    if (p.role === 'landlord') return farmersWin ? 'lose' : 'win';
  }
  if (state.phase === 'ENDED' && state.winnerSide) {
    const won = (state.winnerSide === 'farmers') === (p.role === 'farmer');
    return won ? 'win' : 'lose';
  }
  return 'idle';
}

// 一摞摆在桌面上的钱牌（平躺在 3D 平面里，跟随平面透视）
function TableNotes({ amount, faceUp, anchorX, anchorY, isMine, slotId }) {
  // 金额未知（他人下注未揭晓）时显示两张反面占位
  const notes = amount != null ? decompose(amount) : [makeNote(0), makeNote(0)];
  const mid = (notes.length - 1) / 2;
  return (
    <div className="table-slot" data-slot={slotId} style={{ left: `${anchorX}%`, top: `${anchorY}%` }}>
      {notes.map((n, i) => (
        <div
          key={`${n.id}-${faceUp}`}
          className={`table-note ${faceUp ? 'revealed' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translateX(${(i - mid) * 26}px) rotate(${(i - mid) * 4}deg)`,
            zIndex: i + 1,
          }}
        >
          <MoneyNote value={n.value || 1} faceDown={!faceUp} width={isMine ? 52 : 44} />
        </div>
      ))}
      {faceUp && amount != null && <div className="table-note-amount">{amount}</div>}
    </div>
  );
}

export default function TableScene() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const addFlights = useGameStore(s => s.addFlights);
  const prevPhase = useRef(state.phase);

  // FINALIZE：赢到的钱从桌面飞回 2D UI 手牌区
  useEffect(() => {
    if (prevPhase.current !== state.phase && state.phase === 'FINALIZE') {
      const last = state.history[state.history.length - 1];
      const myDelta = last?.deltas?.[playerId] ?? 0;
      if (myDelta > 0) {
        const fromEl = document.querySelector('[data-pot-anchor]');
        const toEl = document.querySelector('[data-hand-anchor]');
        if (fromEl && toEl) {
          const from = fromEl.getBoundingClientRect();
          const to = toEl.getBoundingClientRect();
          addFlights(decompose(myDelta).map((n, i) => ({
            id: `fin-${last.round}-${n.id}`,
            value: n.value,
            faceDown: false,
            from: { x: from.x + i * 6, y: from.y, w: 52, h: 73 },
            to: { x: to.x + to.width / 2 - 26 + i * 10, y: to.y, w: 52, h: 73 },
          })));
        }
      }
    }
    prevPhase.current = state.phase;
  }, [state.phase, state.history, playerId, addFlights]);

  const players = state.players;
  const meIdx = Math.max(0, players.findIndex(p => p.id === playerId));
  // 以自己为近边起点，顺时针环桌排列其他玩家 —— 空间相对位置正确
  const opponents = [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];
  const layout = SEAT_LAYOUTS[Math.min(opponents.length, 4)] ?? [];
  const me = players.find(p => p.id === playerId);

  const betsVisible = !['LOBBY', 'DISCUSSION', 'BETTING'].includes(state.phase);
  const showCoin = state.phase === 'COIN_FLIP';
  const showCoinResult = PAYOUT_PHASES.includes(state.phase);
  const coinMs = state.config.timing.coinAnimMs;

  return (
    <div className="scene3d">
      <div className="table-plane">
        <div className="table-surface"><TableSurface /></div>

        {/* 对手：站在桌沿，直立（反向旋转抵消平面倾斜），透视自动近大远小 */}
        {opponents.map((p, i) => {
          const seat = layout[i];
          if (!seat) return null;
          return (
            <div key={p.id} className="seat-anchor" style={{ left: `${seat.x}%`, top: `${seat.y}%` }}>
              <div className="avatar-upright">
                <CubeAvatar expression={expressionFor(p, state)} role={p.role ?? 'farmer'} width={seat.y < 10 ? 88 : 96} />
                <div className={`nameplate ${p.online ? '' : 'offline'}`}>
                  <span className={`role-tag ${p.role ?? ''}`}>{p.role === 'landlord' ? '地主' : p.role === 'farmer' ? '农民' : '未选'}</span>
                  <span>{p.name}</span>
                  {p.bankrupt && <span className="bankrupt-tag">破产</span>}
                  {!p.online && <span className="dim">(离线)</span>}
                </div>
              </div>
            </div>
          );
        })}

        {/* 对手摆在桌上的钱：座位锚点向桌心偏移的平面坐标 */}
        {opponents.map((p, i) => {
          const seat = layout[i];
          if (!seat || !p.hasBet) return null;
          const slotX = seat.x + (50 - seat.x) * 0.3;
          const slotY = seat.y + (48 - seat.y) * 0.45;
          return (
            <TableNotes
              key={`notes-${p.id}`}
              amount={betsVisible ? p.bet : null}
              faceUp={betsVisible}
              anchorX={slotX}
              anchorY={slotY}
              isMine={false}
              slotId={p.id}
            />
          );
        })}

        {/* 自己摆在桌上的钱（近边正前方） */}
        {me?.hasBet && (
          <TableNotes
            amount={state.me?.bet ?? me.bet}
            faceUp={betsVisible}
            anchorX={50}
            anchorY={76}
            isMine
            slotId="me"
          />
        )}

        {/* 桌心：硬币 / 彩池锚点 */}
        <div className="pot-anchor" data-pot-anchor style={{ left: '50%', top: '42%' }}>
          {showCoin && (
            <div className="coin-upright">
              <CoinFlip result={state.coinResult} durationMs={coinMs} />
            </div>
          )}
          {showCoinResult && state.coinResult && (
            <div className="coin-upright">
              <CoinResultBadge result={state.coinResult} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Coin = getArt('coin');

// 抛硬币动画：双面硬币 3D 旋转，按结果停在正/反面
function CoinFlip({ result, durationMs }) {
  return (
    <div
      className={`coin-flip ${result === 'tails' ? 'land-tails' : 'land-heads'}`}
      style={{ animationDuration: `${durationMs}ms` }}
    >
      <div className="coin-face front"><Coin face="heads" size={92} /></div>
      <div className="coin-face back"><Coin face="tails" size={92} /></div>
    </div>
  );
}

function CoinResultBadge({ result }) {
  return (
    <div className="coin-result">
      <Coin face={result} size={64} />
      <span>{result === 'heads' ? '正面 · 地主胜' : '反面 · 农民胜'}</span>
    </div>
  );
}
