import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

export default function Lobby() {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [rooms, setRooms] = useState([]);
  const connect = useGameStore(s => s.connect);
  const error = useGameStore(s => s.error);
  const clearError = useGameStore(s => s.clearError);

  useEffect(() => {
    fetch('/api/rooms').then(r => r.json()).then(setRooms).catch(() => {});
  }, []);

  const createRoom = async () => {
    if (!name.trim()) return;
    try {
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(`服务器错误 ${res.status}`);
      const data = await res.json();
      if (!data.roomId) throw new Error('未获取到房间号');
      connect(data.roomId, name.trim());
    } catch (e) {
      useGameStore.setState({ error: e.message });
    }
  };

  const joinRoom = () => {
    if (!name.trim() || !roomId.trim()) return;
    connect(roomId.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="lobby">
      <h1>地主与农民</h1>
      <p className="subtitle">破产竞赛 · 认知博弈 · 全公开对抗</p>

      <div className="card">
        <input
          className="input"
          placeholder="你的名字"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      <div className="card">
        <h3>创建新房间</h3>
        <button className="btn primary" onClick={createRoom} disabled={!name.trim()}>
          创建房间
        </button>
      </div>

      <div className="card">
        <h3>加入房间</h3>
        <input
          className="input"
          placeholder="房间号 (6位)"
          value={roomId}
          onChange={e => { setRoomId(e.target.value.toUpperCase()); clearError(); }}
          maxLength={6}
        />
        <button className="btn" onClick={joinRoom} disabled={!name.trim() || roomId.length < 4}>
          加入
        </button>
      </div>

      {rooms.length > 0 && (
        <div className="card">
          <h3>现有房间</h3>
          {rooms.map(r => (
            <div key={r.roomId} className="room-row">
              <span>{r.roomId} · {r.phase} · {r.playerCount}人</span>
              <button className="btn small" onClick={() => { setRoomId(r.roomId); }}>选择</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
