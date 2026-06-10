import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';

const FADE_MS = 600;
const HOVER_FADE_DELAY = 3000;
const BASE_DISPLAY_MS = 3000;
const MAX_DISPLAY_MS = 12000;
const RECENT_COUNT = 5;

export default function ChatBox() {
  const messages = useGameStore(s => s.chatMessages);
  const bankruptMessages = useGameStore(s => s.bankruptChat);
  const playerId = useGameStore(s => s.playerId);
  const state = useGameStore(s => s.gameState);
  const send = useGameStore(s => s.send);
  const [text, setText] = useState('');
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});
  const seenPublicRef = useRef(messages.length);
  const seenBankruptRef = useRef(bankruptMessages.length);

  const myPlayer = state?.players?.find(p => p.id === playerId);
  const isBankruptFarmer = myPlayer?.bankrupt && myPlayer?.role === 'farmer';
  const allMessages = isBankruptFarmer ? [...messages, ...bankruptMessages] : messages;

  const clearTimers = (key) => {
    const t = timersRef.current[key];
    if (t) {
      clearTimeout(t.fade);
      clearTimeout(t.remove);
      delete timersRef.current[key];
    }
  };

  const scheduleFade = (key, delay) => {
    const fade = setTimeout(() => {
      setToasts(ts => ts.map(t => (t.key === key ? { ...t, fading: true } : t)));
      const remove = setTimeout(() => {
        setToasts(ts => ts.filter(t => t.key !== key));
        delete timersRef.current[key];
      }, FADE_MS);
      timersRef.current[key] = { ...timersRef.current[key], remove };
    }, delay);
    timersRef.current[key] = { fade };
  };

  const showToast = (msg) => {
    const key = `${Date.now()}-${Math.random()}`;
    const duration = Math.min(MAX_DISPLAY_MS, BASE_DISPLAY_MS + (msg.message?.length ?? 0) * 200);
    setToasts(ts => [...ts, { key, msg, fading: false }]);
    scheduleFade(key, duration);
  };

  useEffect(() => {
    if (messages.length > seenPublicRef.current) {
      messages.slice(seenPublicRef.current).forEach(showToast);
      seenPublicRef.current = messages.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (bankruptMessages.length > seenBankruptRef.current) {
      if (isBankruptFarmer) {
        bankruptMessages.slice(seenBankruptRef.current).forEach(showToast);
      }
      seenBankruptRef.current = bankruptMessages.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankruptMessages.length, isBankruptFarmer]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(t => {
      clearTimeout(t.fade);
      clearTimeout(t.remove);
    });
  }, []);

  const handleEnter = (key) => {
    clearTimers(key);
    setToasts(ts => ts.map(t => (t.key === key ? { ...t, fading: false } : t)));
  };

  const handleLeave = (key) => {
    clearTimers(key);
    scheduleFade(key, HOVER_FADE_DELAY);
  };

  const showRecent = () => {
    allMessages.slice(-RECENT_COUNT).forEach(showToast);
  };

  const sendChat = () => {
    if (!text.trim()) return;
    send({ type: 'chat', message: text.trim() });
    setText('');
  };

  return (
    <div className="chat-box">
      <div className="chat-toasts">
        {toasts.map(t => (
          <div
            key={t.key}
            className={`chat-toast ${t.fading ? 'fading' : ''} ${t.msg.channel === 'bankrupt' ? 'bankrupt-msg' : ''} ${t.msg.from === playerId ? 'mine' : ''}`}
            onMouseEnter={() => handleEnter(t.key)}
            onMouseLeave={() => handleLeave(t.key)}
          >
            <span className="chat-name">{t.msg.name}</span>
            {t.msg.channel === 'bankrupt' && <span className="tag small">💀</span>}
            <span className="chat-text">{t.msg.message}</span>
          </div>
        ))}
      </div>
      {(!myPlayer?.bankrupt || isBankruptFarmer) && (
        <div className="chat-input-row">
          <input
            className="input"
            placeholder={isBankruptFarmer ? '仅破产农民可见…' : '发言（所有人可见）…'}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            onFocus={showRecent}
          />
          <button className="btn" onClick={sendChat}>发送</button>
        </div>
      )}
    </div>
  );
}
