import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';

export default function ChatBox() {
  const messages = useGameStore(s => s.chatMessages);
  const bankruptMessages = useGameStore(s => s.bankruptChat);
  const playerId = useGameStore(s => s.playerId);
  const state = useGameStore(s => s.gameState);
  const send = useGameStore(s => s.send);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  const myPlayer = state?.players?.find(p => p.id === playerId);
  const isBankruptFarmer = myPlayer?.bankrupt && myPlayer?.role === 'farmer';

  const displayMessages = isBankruptFarmer
    ? [...messages, ...bankruptMessages].sort((a, b) => 0)
    : messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length]);

  const sendChat = () => {
    if (!text.trim()) return;
    send({ type: 'chat', message: text.trim() });
    setText('');
  };

  return (
    <div className="card chat-box">
      <h3>聊天 {isBankruptFarmer && <span className="tag">破产频道</span>}</h3>
      <div className="chat-messages">
        {displayMessages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.channel === 'bankrupt' ? 'bankrupt-msg' : ''} ${m.from === playerId ? 'mine' : ''}`}>
            <span className="chat-name">{m.name}</span>
            {m.channel === 'bankrupt' && <span className="tag small">💀</span>}
            <span className="chat-text">{m.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {(!myPlayer?.bankrupt || isBankruptFarmer) && (
        <div className="chat-input-row">
          <input
            className="input"
            placeholder={isBankruptFarmer ? '仅破产农民可见…' : '发言（所有人可见）…'}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
          />
          <button className="btn" onClick={sendChat}>发送</button>
        </div>
      )}
    </div>
  );
}
