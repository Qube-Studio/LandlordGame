import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';

const Icon = getArt('icon');

const MODE_LABEL = { quick: '快速', classic: '经典', competitive: '竞技' };

export default function LobbyScreen() {
  const username = useAuthStore(s => s.username);
  const logout = useAuthStore(s => s.logout);
  const connected = useGameStore(s => s.connected);
  const joinRoom = useGameStore(s => s.joinRoom);
  const showToast = useGameStore(s => s.showToast);

  const [modes, setModes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [online, setOnline] = useState({ count: 0, users: [] });
  const [roomName, setRoomName] = useState('');
  const [joinId, setJoinId] = useState('');

  useEffect(() => {
    let alive = true;
    api.modes().then(m => { if (alive) setModes(m); }).catch(() => {});
    const load = async () => {
      try {
        const [r, o] = await Promise.all([api.listRooms(), api.online()]);
        if (alive) { setRooms(r); setOnline(o); }
      } catch { /* 轮询失败静默，401 已在 api 层处理 */ }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const createRoom = async (mode) => {
    try {
      const { roomId } = await api.createRoom(roomName.trim() || `${username}的房间`, mode);
      joinRoom(roomId);
    } catch (err) {
      showToast(err.message);
    }
  };

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>地主与农民</h1>
        <div className="lobby-header-right">
          <span className="online-chip"><Icon name="users" size={15} /> 在线 {online.count}</span>
          <span className="dim">{username}</span>
          <button className="btn ghost small" onClick={logout}><Icon name="exit" size={15} /> 退出登录</button>
        </div>
      </header>

      {!connected && <div className="conn-banner">正在连接服务器…</div>}

      <section className="mode-row">
        {modes.map(m => (
          <div key={m.id} className={`mode-card panel ${m.available ? '' : 'disabled'}`}>
            <h3>{m.label}</h3>
            <p className="dim">{m.description}</p>
            {m.available ? (
              <button className="btn primary" disabled={!connected} onClick={() => createRoom(m.id)}>创建房间</button>
            ) : (
              <button className="btn ghost" disabled>开发中</button>
            )}
          </div>
        ))}
      </section>

      <section className="lobby-actions">
        <label className="field inline">
          <span>房间名</span>
          <input value={roomName} onChange={e => setRoomName(e.target.value)} placeholder={`${username}的房间`} maxLength={20} />
        </label>
        <div className="join-by-id">
          <input value={joinId} onChange={e => setJoinId(e.target.value.toUpperCase())} placeholder="输入房间号加入" maxLength={6} />
          <button className="btn" disabled={!connected || !joinId.trim()} onClick={() => joinRoom(joinId)}>加入</button>
        </div>
      </section>

      <section className="room-list panel">
        <h3>房间列表</h3>
        {rooms.length === 0 && <p className="dim">暂时没有房间，创建一个吧。</p>}
        {rooms.map(r => (
          <div key={r.roomId} className="room-row">
            <span className="room-id">{r.roomId}</span>
            <span className="room-name">{r.name}</span>
            <span className="dim">{MODE_LABEL[r.mode] ?? r.mode}</span>
            <span className="dim">{r.phase === 'LOBBY' ? '等待中' : '游戏中'}</span>
            <span className="dim">{r.playerCount}/{r.maxPlayers}</span>
            <button className="btn small" disabled={!connected} onClick={() => joinRoom(r.roomId)}>进入</button>
          </div>
        ))}
      </section>
    </div>
  );
}
