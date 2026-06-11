import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { buildHand, splitDenomination } from '../render/moneyCards';
import { CONFIRM_BUTTON } from '../uiAssets';
import {
  computeTableShape,
  drawTable,
  computeHandLayout,
  computeBalancePosition,
  computeConfirmButtonPosition,
  computeTotalPosition,
  CARD_SIZE,
} from '../render/gameRenderer';

function useContainerSize() {
  const [el, setEl] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return [setEl, size];
}

export default function BettingScene() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);

  const [containerRef, { width, height }] = useContainerSize();
  const canvasRef = useRef(null);

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
        <div className="scene-layer scene-layer-opponents" />
        <div className="scene-layer scene-layer-table">
          <canvas ref={canvasRef} />
          <div className="scene-status-text">
            {myPlayer?.bankrupt ? '已破产 — 观战中' : phase !== 'BETTING' ? '等待下一回合下注…' : '观战中'}
          </div>
        </div>
        <div className="scene-layer scene-layer-hand">
          {!myPlayer?.bankrupt && (
            <div className="scene-balance" style={{ right: balancePos.right, bottom: balancePos.bottom }}>
              ${myBalance}
            </div>
          )}
        </div>
      </div>
    );
  }

  const minBet = myPlayer.role === 'landlord' ? config.minBetLandlord : config.minBetFarmer;
  const maxBet = myBalance - minBet;
  const alreadyBet = bets?.[playerId] !== undefined;

  if (alreadyBet) {
    return (
      <div className="betting-scene" ref={containerRef}>
        <div className="scene-layer scene-layer-opponents" />
        <div className="scene-layer scene-layer-table">
          <canvas ref={canvasRef} />
          <div className="scene-status-text">已下注 ¥{bets[playerId]} — 等待其他玩家…</div>
        </div>
        <div className="scene-layer scene-layer-hand">
          <div className="scene-balance" style={{ right: balancePos.right, bottom: balancePos.bottom }}>
            ${myBalance}
          </div>
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
        onDecompose={() => {}}
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
  const [hand, setHand] = useState(() => buildHand(maxBet));
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

  const decomposeCard = (index) => {
    const replacement = splitDenomination(hand[index]);
    if (!replacement) return;

    setHand(prev => [...prev.slice(0, index), ...replacement, ...prev.slice(index + 1)]);
    setSelected(prev => {
      const next = new Set();
      const shift = replacement.length - 1;
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i + shift);
        else for (let k = 0; k < replacement.length; k++) next.add(index + k);
      }
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
      onDecompose={decomposeCard}
      valid={valid}
      onConfirm={onConfirm}
      minBet={minBet}
      maxBet={maxBet}
    />
  );
}

const HOLD_DECOMPOSE_MS = 2000;

function BettingSceneInner({
  containerRef, canvasRef, width, height, myBalance,
  statusText, confirmLabel, total, hand, selected, onToggle, onDecompose, valid, onConfirm, minBet, maxBet,
}) {
  const [pressed, setPressed] = useState(false);
  const [holdingIndex, setHoldingIndex] = useState(null);
  const holdTimerRef = useRef(null);
  const justDecomposedRef = useRef(false);

  const startHold = (i) => {
    if (!selected.has(i) || !splitDenomination(hand[i])) return;
    setHoldingIndex(i);
    holdTimerRef.current = setTimeout(() => {
      onDecompose(i);
      justDecomposedRef.current = true;
      setHoldingIndex(null);
    }, HOLD_DECOMPOSE_MS);
  };

  const cancelHold = () => {
    clearTimeout(holdTimerRef.current);
    setHoldingIndex(null);
  };

  const handleCardClick = (i) => {
    if (justDecomposedRef.current) {
      justDecomposedRef.current = false;
      return;
    }
    onToggle(i);
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        setPressed(true);
        if (valid) onConfirm();
      }
    };
    const onKeyUp = (e) => {
      if (e.key === 'e' || e.key === 'E') setPressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [valid, onConfirm]);

  const balancePos = computeBalancePosition();
  const confirmPos = computeConfirmButtonPosition(width, height);
  const totalPos = computeTotalPosition(width, height);
  const handLayout = width > 0 && height > 0
    ? computeHandLayout({ count: hand.length, containerWidth: width, containerHeight: height })
    : [];

  return (
    <div className="betting-scene" ref={containerRef}>
      <div className="scene-layer scene-layer-opponents" />

      <div className="scene-layer scene-layer-table">
        <canvas ref={canvasRef} />

        <div className="scene-total" style={{ left: totalPos.x, top: totalPos.y }}>
          ¥{total} <span className="scene-total-range">(¥{minBet} ~ ¥{maxBet})</span>
        </div>

        {statusText && <div className="scene-status-text">{statusText}</div>}
      </div>

      <div className="scene-layer scene-layer-hand">
        {hand.map((value, i) => {
          const pos = handLayout[i];
          if (!pos) return null;
          return (
            <div
              key={i}
              className="poker-card-wrapper"
              style={{
                left: pos.x,
                top: pos.y,
                width: CARD_SIZE.width,
                height: CARD_SIZE.height,
                zIndex: pos.zIndex,
                transform: `rotate(${pos.rotationDeg}deg) translateY(${selected.has(i) ? -16 : 0}px)`,
              }}
              onMouseDown={() => startHold(i)}
              onMouseUp={cancelHold}
              onMouseLeave={cancelHold}
              onClick={() => handleCardClick(i)}
            >
              <div className={`poker-card ${selected.has(i) ? 'selected' : ''} ${holdingIndex === i ? 'shaking' : ''}`}>
                {value}
              </div>
            </div>
          );
        })}

        <button
          className="scene-confirm-btn"
          style={{
            left: confirmPos.x,
            bottom: confirmPos.bottom,
            backgroundImage: `url(${pressed ? CONFIRM_BUTTON.pressed : CONFIRM_BUTTON.normal})`,
          }}
          disabled={!valid}
          aria-label={confirmLabel}
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          onClick={onConfirm}
        >
          <span className="scene-confirm-key">[E]</span>
        </button>

        <div className="scene-balance" style={{ right: balancePos.right, bottom: balancePos.bottom }}>
          ${myBalance}
        </div>
      </div>
    </div>
  );
}
