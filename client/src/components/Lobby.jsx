import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

export default function Lobby() {
  const [step, setStep] = useState('choose'); // 'choose' | 'create' | 'join'
  const [roomName, setRoomName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [rooms, setRooms] = useState([]);
  const username = useGameStore(s => s.username);
  const connect = useGameStore(s => s.connect);
  const logout = useGameStore(s => s.logout);
  const error = useGameStore(s => s.error);
  const clearError = useGameStore(s => s.clearError);

  useEffect(() => {
    if (step === 'join') {
      fetch('/api/rooms').then(r => r.json()).then(setRooms).catch(() => {});
    }
  }, [step]);

  useEffect(() => {
    if (step === 'create') setRoomName(`${username}的房间`);
  }, [step, username]);

  const createRoom = async () => {
    if (!roomName.trim()) return;
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomName.trim() }),
      });
      if (!res.ok) throw new Error(`服务器错误 ${res.status}`);
      const data = await res.json();
      if (!data.roomId) throw new Error('未获取到房间号');
      connect(data.roomId, username);
    } catch (e) {
      useGameStore.setState({ error: e.message });
    }
  };

  const joinRoom = (id) => {
    const rid = (id ?? roomId).trim().toUpperCase();
    if (!rid) return;
    connect(rid, username);
  };

  const phaseLabel = (p) => ({ LOBBY: '等待', BETTING: '游戏中', ENDED: '已结束' }[p] ?? p);

  return (
    <div className="lobby">
      <h1>地主与农民</h1>
      <p className="subtitle">破产竞赛 · 认知博弈 · 全公开对抗</p>
      <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
        用户：<strong style={{ color: 'var(--text)' }}>{username}</strong>
        <button className="btn small" style={{ marginLeft: 10 }} onClick={logout}>退出登录</button>
      </p>

      {error && <div className="error">{error}</div>}

      {step === 'choose' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button className="btn primary large" onClick={() => { clearError(); setStep('create'); }}>
            创建房间
          </button>
          <button className="btn large" onClick={() => { clearError(); setStep('join'); }}>
            加入房间
          </button>
        </div>
      )}

      {step === 'create' && (
        <div className="card">
          <button className="btn small" style={{ marginBottom: 12 }} onClick={() => setStep('choose')}>← 返回</button>
          <h3 style={{ marginBottom: 12 }}>创建房间</h3>
          <input
            className="input"
            placeholder="房间名称"
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <button className="btn primary" onClick={createRoom} disabled={!roomName.trim()}>
            创建并进入
          </button>
        </div>
      )}

      {step === 'join' && (
        <div className="card">
          <button className="btn small" style={{ marginBottom: 12 }} onClick={() => setStep('choose')}>← 返回</button>
          <h3 style={{ marginBottom: 12 }}>加入房间</h3>

          {rooms.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {rooms.map(r => (
                <div key={r.roomId} className="room-row">
                  <span>
                    <strong>{r.roomName}</strong>
                    <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                      {r.roomId} · {phaseLabel(r.phase)} · {r.playerCount}人
                    </span>
                  </span>
                  <button className="btn small ok" onClick={() => joinRoom(r.roomId)}>加入</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              className="input"
              placeholder="手动输入房间号"
              value={roomId}
              onChange={e => { setRoomId(e.target.value.toUpperCase()); clearError(); }}
              maxLength={6}
            />
            <button className="btn" onClick={() => joinRoom()} disabled={roomId.length < 4}>加入</button>
          </div>
        </div>
      )}
    </div>
  );
}
