import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { buildHand } from '../render/moneyCards';
import {
  computeTableShape,
  drawTable,
  computeHandLayout,
  computeBalancePosition,
  computeConfirmButtonPosition,
  computeTotalPosition,
  CARD_SIZE,
} from '../render/gameRenderer';

function useContainerSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export default function BettingScene() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const { width, height } = useContainerSize(containerRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const points = computeTableShape(width, height);
    drawTable(ctx, points, width, height);
  }, [width, height]);

  if (!state) return null;
  const { phase, players, bets, config, myBalance, forceAllIn, allInAmount } = state;
  const myPlayer = players.find(p => p.id === playerId);

  const balancePos = computeBalancePosition();

  if (!myPlayer || !['landlord', 'farmer'].includes(myPlayer.role) || myPlayer.bankrupt || phase !== 'BETTING') {
    return (
      <div className="betting-scene" ref={containerRef}>
        <canvas ref={canvasRef} />
        <div className="scene-status-text">
          {myPlayer?.bankrupt ? '已破产 — 观战中' : phase !== 'BETTING' ? '等待下一回合下注…' : '观战中'}
        </div>
        {!myPlayer?.bankrupt && (
          <div className="scene-balance" style={{ right: balancePos.right, bottom: balancePos.bottom }}>
            ${myBalance}
          </div>
        )}
      </div>
    );
  }

  const minBet = myPlayer.role === 'landlord' ? config.minBetLandlord : config.minBetFarmer;
  const maxBet = myBalance - minBet;
  const alreadyBet = bets?.[playerId] !== undefined;

  if (alreadyBet) {
    return (
      <div className="betting-scene" ref={containerRef}>
        <canvas ref={canvasRef} />
        <div className="scene-status-text">已下注 ¥{bets[playerId]} — 等待其他玩家…</div>
        <div className="scene-balance" style={{ right: balancePos.right, bottom: balancePos.bottom }}>
          ${myBalance}
        </div>
      </div>
    );
  }

  if (forceAllIn) {
    return (
      <BettingSceneInner
        containerRef={containerRef}
        canvasRef={canvasRef}
        width={width}
        height={height}
        myBalance={myBalance}
        statusText="余额不足 — 只能全押"
        confirmLabel="ALL IN [E]"
        total={allInAmount}
        hand={[]}
        selected={new Set()}
        onToggle={() => {}}
        valid={true}
        onConfirm={() => send({ type: 'place_bet', amount: allInAmount })}
        minBet={allInAmount}
        maxBet={allInAmount}
      />
    );
  }

  return (
    <BettingSceneWithHand
      containerRef={containerRef}
      canvasRef={canvasRef}
      width={width}
      height={height}
      myBalance={myBalance}
      minBet={minBet}
      maxBet={maxBet}
      send={send}
    />
  );
}

function BettingSceneWithHand({ containerRef, canvasRef, width, height, myBalance, minBet, maxBet, send }) {
  const [hand] = useState(() => buildHand(maxBet));
  const [selected, setSelected] = useState(() => new Set());

  const total = [...selected].reduce((sum, i) => sum + hand[i], 0);
  const valid = total >= minBet && total <= maxBet;

  const toggle = (i) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const onConfirm = () => {
    if (valid) send({ type: 'place_bet', amount: total });
  };

  return (
    <BettingSceneInner
      containerRef={containerRef}
      canvasRef={canvasRef}
      width={width}
      height={height}
      myBalance={myBalance}
      statusText={null}
      confirmLabel="CONFIRM [E]"
      total={total}
      hand={hand}
      selected={selected}
      onToggle={toggle}
      valid={valid}
      onConfirm={onConfirm}
      minBet={minBet}
      maxBet={maxBet}
    />
  );
}

function BettingSceneInner({
  containerRef, canvasRef, width, height, myBalance,
  statusText, confirmLabel, total, hand, selected, onToggle, valid, onConfirm, minBet, maxBet,
}) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.key === 'e' || e.key === 'E') && valid) onConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [valid, onConfirm]);

  const balancePos = computeBalancePosition();
  const confirmPos = computeConfirmButtonPosition(width, height);
  const totalPos = computeTotalPosition(width, height);
  const handLayout = width > 0 && height > 0
    ? computeHandLayout({ count: hand.length, containerWidth: width, containerHeight: height })
    : [];

  return (
    <div className="betting-scene" ref={containerRef}>
      <canvas ref={canvasRef} />

      <div className="scene-total" style={{ left: totalPos.x, top: totalPos.y }}>
        ¥{total} <span className="scene-total-range">(¥{minBet} ~ ¥{maxBet})</span>
      </div>

      {statusText && <div className="scene-status-text">{statusText}</div>}

      {hand.map((value, i) => {
        const pos = handLayout[i];
        if (!pos) return null;
        return (
          <div
            key={i}
            className={`poker-card ${selected.has(i) ? 'selected' : ''}`}
            style={{
              left: pos.x,
              top: pos.y,
              width: CARD_SIZE.width,
              height: CARD_SIZE.height,
              zIndex: pos.zIndex,
              transform: `rotate(${pos.rotationDeg}deg) translateY(${selected.has(i) ? -16 : 0}px)`,
            }}
            onClick={() => onToggle(i)}
          >
            {value}
          </div>
        );
      })}

      <button
        className="scene-confirm-btn"
        style={{ left: confirmPos.x, bottom: confirmPos.bottom }}
        disabled={!valid}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>

      <div className="scene-balance" style={{ right: balancePos.right, bottom: balancePos.bottom }}>
        ${myBalance}
      </div>
    </div>
  );
}
