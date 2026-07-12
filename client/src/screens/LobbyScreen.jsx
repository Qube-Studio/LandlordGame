import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import PixelText from '../assets/pixelfont/PixelText';
import { T } from '../text';

const Icon = getArt('icon');

const MODE_LABEL = T.lobby.modeLabels;

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
  const startSingle = useGameStore(s => s.startSingle); // 单人模式（§9.6 交互 v2）：直接进 3D 组队期

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
      const { roomId } = await api.createRoom(roomName.trim() || T.lobby.defaultRoomName(username), mode);
      joinRoom(roomId);
    } catch (err) {
      showToast(err.message);
    }
  };

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1><PixelText size={4} color="var(--px-gold)">F.A.T.E.</PixelText></h1>
        <div className="lobby-header-right">
          <span className="online-chip"><Icon name="users" size={15} /> {T.lobby.online(online.count)}</span>
          <span className="dim">{username}</span>
          <button className="btn ghost small" onClick={logout}><Icon name="exit" size={15} /> {T.lobby.logout}</button>
        </div>
      </header>

      {!connected && <div className="conn-banner">{T.common.connecting}</div>}

      <section className="mode-row">
        {modes.map(m => (
          <div key={m.id} className={`mode-card panel ${m.available || m.id === 'single' ? '' : 'disabled'}`}>
            <h3>{m.label}</h3>
            <p className="dim">{m.description}</p>
            {m.id === 'single' ? (
              // 单人模式不走房间 API：直接 single_start 进 3D 组队期（选角在桌边席位列，§9.6 交互 v2）
              <button className="btn primary" disabled={!connected} onClick={startSingle}>{T.single.start}</button>
            ) : m.available ? (
              <button className="btn primary" disabled={!connected} onClick={() => createRoom(m.id)}>{T.lobby.createRoom}</button>
            ) : (
              <button className="btn ghost" disabled>{T.lobby.wip}</button>
            )}
          </div>
        ))}
      </section>

      <section className="lobby-actions">
        <label className="field inline">
          <span>{T.lobby.roomName}</span>
          <input value={roomName} onChange={e => setRoomName(e.target.value)} placeholder={T.lobby.defaultRoomName(username)} maxLength={20} />
        </label>
        <div className="join-by-id">
          <input value={joinId} onChange={e => setJoinId(e.target.value.toUpperCase())} placeholder={T.lobby.joinPh} maxLength={6} />
          <button className="btn" disabled={!connected || !joinId.trim()} onClick={() => joinRoom(joinId)}>{T.lobby.join}</button>
        </div>
      </section>

      <section className="room-list panel">
        <h3>{T.lobby.roomList}</h3>
        {rooms.length === 0 && <p className="dim">{T.lobby.empty}</p>}
        {rooms.map(r => (
          <div key={r.roomId} className="room-row">
            <span className="room-id">{r.roomId}</span>
            <span className="room-name">{r.name}</span>
            <span className="dim">{MODE_LABEL[r.mode] ?? r.mode}</span>
            <span className="dim">{r.phase === 'LOBBY' ? T.lobby.waiting : T.lobby.playing}</span>
            <span className="dim">{r.playerCount}/{r.maxPlayers}</span>
            <button className="btn small" disabled={!connected} onClick={() => joinRoom(r.roomId)}>{T.lobby.enter}</button>
          </div>
        ))}
      </section>
    </div>
  );
}
