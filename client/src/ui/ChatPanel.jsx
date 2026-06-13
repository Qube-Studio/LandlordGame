// 聊天面板：公开频道 + 农民私聊频道（地主不可见），可折叠；语音按钮为预留接口。

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';

const Icon = getArt('icon');

export default function ChatPanel() {
  const state = useGameStore(s => s.state);
  const chat = useGameStore(s => s.chat);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);

  const [channel, setChannel] = useState('public');
  const [text, setText] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef(null);

  const me = state.players.find(p => p.id === playerId);
  const canFarmerChannel = me?.role === 'farmer' || me?.bankrupt;
  const activeChannel = channel === 'farmer' && !canFarmerChannel ? 'public' : channel;
  const messages = chat.filter(m => m.channel === activeChannel);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, collapsed]);

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send({ type: 'chat', channel: activeChannel, text: t });
    setText('');
  };

  if (collapsed) {
    return (
      <button className="chat-collapsed" onClick={() => setCollapsed(false)}>
        💬 聊天{chat.length > 0 ? ` (${chat.length})` : ''}
      </button>
    );
  }

  return (
    <div className="chat-panel panel">
      <div className="chat-head">
        <div className="tabs small">
          <button className={activeChannel === 'public' ? 'tab active' : 'tab'} onClick={() => setChannel('public')}>公开</button>
          {canFarmerChannel && (
            <button className={activeChannel === 'farmer' ? 'tab active' : 'tab'} onClick={() => setChannel('farmer')}>
              农民密谈
            </button>
          )}
        </div>
        <div className="chat-head-right">
          <button className="btn ghost tiny" disabled title="语音联机即将开放"><Icon name="mic" size={14} /></button>
          <button className="btn ghost tiny" onClick={() => setCollapsed(true)}>—</button>
        </div>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="dim chat-empty">
            {activeChannel === 'farmer' ? '农民专属频道，地主看不到这里。' : '说点什么吧…'}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={`${m.ts}-${i}`} className={`chat-msg ${m.from === playerId ? 'mine' : ''}`}>
            <span className="chat-name">{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={activeChannel === 'farmer' ? '密谈战术…' : '发送消息…'}
          maxLength={200}
        />
        <button className="btn tiny" disabled={!text.trim()}><Icon name="send" size={14} /></button>
      </form>
    </div>
  );
}
