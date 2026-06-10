import { useEffect, useState } from 'react';
import { buildHand } from '../render/moneyCards';

export default function MoneyCardSelector({ minBet, maxBet, onConfirm }) {
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

  const confirm = () => {
    if (valid) onConfirm(total);
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'e' || e.key === 'E') confirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="money-card-selector">
      <div className="money-card-total">
        ¥{total} <span className="muted">(¥{minBet} ~ ¥{maxBet})</span>
      </div>
      <div className="money-card-hand">
        {hand.map((value, i) => (
          <div
            key={i}
            className={`money-card ${selected.has(i) ? 'selected' : ''}`}
            onClick={() => toggle(i)}
          >
            {value}
          </div>
        ))}
      </div>
      <div className="money-card-confirm-row">
        <button className="btn confirm" disabled={!valid} onClick={confirm}>
          CONFIRM<span className="key-hint">[E]</span>
        </button>
      </div>
    </div>
  );
}
