// 左下角 Minecraft 风格聊天：消息半透明浮现、闲置约 10s 后淡出；按 T 唤起输入，
// Esc 收起；农民可切换密谈频道（地主看不到）。开启时为完整可滚动历史。
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { isFarmerSide } from '../game/roles';

const FADE_MS = 10000;

export default function McChat() {
  const state = useGameStore(s => s.state);
  const chat = useGameStore(s => s.chat);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);
  const open = useGameStore(s => s.chatOpen);
  const setOpen = useGameStore(s => s.setChatOpen);

  const [channel, setChannel] = useState('public');
  const [text, setText] = useState('');
  const [now, setNow] = useState(0); // 0 表示尚未计时（首帧不过滤）；effect 填入真实时间
  const inputRef = useRef(null);
  const logRef = useRef(null);

  const me = state.players.find(p => p.id === playerId);
  const canFarmer = isFarmerSide(me?.role) || me?.bankrupt;
  const activeChannel = channel === 'farmer' && !canFarmer ? 'public' : channel;

  const accessible = chat.filter(m => m.channel === 'public' || (m.channel === 'farmer' && canFarmer));
  const visible = open ? accessible.slice(-50) : accessible.filter(m => now - m.ts < FADE_MS).slice(-8);

  // 关闭态下有近期消息时，定时刷新以驱动淡出
  useEffect(() => {
    if (open) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open, chat.length]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, visible.length]);

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (t) send({ type: 'chat', channel: activeChannel, text: t });
    setText('');
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { setOpen(false); setText(''); }
  };

  return (
    <div className={`mc-chat ${open ? 'open' : ''}`}>
      <div className="mc-chat-log" ref={logRef} onClick={() => !open && setOpen(true)}>
        {visible.length === 0 && !open && (
          <div className="mc-chat-line"><PixelText size={2} color="var(--ink-dim)">按 T 聊天</PixelText></div>
        )}
        {visible.map((m, i) => (
          <div key={`${m.ts}-${i}`} className={`mc-chat-line ${m.channel === 'farmer' ? 'farmer' : ''} ${!open ? 'fade' : ''}`}>
            <PixelText size={2} className="mc-from">{m.channel === 'farmer' ? `〔密〕${m.name}` : m.name}</PixelText>
            <PixelText size={2} className="mc-body">{m.text}</PixelText>
          </div>
        ))}
      </div>

      {open && (
        <>
          {canFarmer && (
            <div className="mc-chat-channel">
              <button className={`mc-chan-btn ${activeChannel === 'public' ? 'active' : ''}`} onClick={() => setChannel('public')}>公开</button>
              <button className={`mc-chan-btn ${activeChannel === 'farmer' ? 'active' : ''}`} onClick={() => setChannel('farmer')}>农民密谈</button>
            </div>
          )}
          <form className="mc-chat-input" onSubmit={submit}>
            <span className="mc-prefix"><PixelText size={2} color="var(--ink-dim)">{activeChannel === 'farmer' ? '密>' : '>'}</PixelText></span>
            <input
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={activeChannel === 'farmer' ? '密谈战术…（Esc 收起）' : '发送消息…（Esc 收起）'}
              maxLength={200}
            />
          </form>
        </>
      )}
    </div>
  );
}
