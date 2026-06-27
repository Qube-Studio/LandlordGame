import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useGameStore } from './store/gameStore';
import LoginScreen from './screens/LoginScreen';
import LobbyScreen from './screens/LobbyScreen';
import GameScreen from './screens/GameScreen';
import ViewportGuard from './ui/ViewportGuard';

export default function App() {
  const token = useAuthStore(s => s.token);
  const roomId = useGameStore(s => s.roomId);
  const toast = useGameStore(s => s.toast);
  const kicked = useGameStore(s => s.kicked);

  // 登录态变化驱动 WebSocket 生命周期
  useEffect(() => {
    if (token) useGameStore.getState().connect(token);
    else useGameStore.getState().disconnect();
  }, [token]);

  // 提示自动消失
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => useGameStore.getState().clearToast(), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const relogin = () => {
    useGameStore.getState().clearKicked();
    useGameStore.getState().disconnect();
    useAuthStore.getState().clearSession();
  };

  let screen;
  if (!token) screen = <LoginScreen />;
  else if (!roomId) screen = <LobbyScreen />;
  else screen = <GameScreen />;

  return (
    <>
      {screen}
      {toast && <div className={`toast ${toast.kind ?? 'error'}`}>{toast.text}</div>}
      {kicked && (
        <div className="modal-mask">
          <div className="modal panel">
            <h3>连接已断开</h3>
            <p className="dim">{kicked}</p>
            <button className="btn primary" onClick={relogin}>重新登录</button>
          </div>
        </div>
      )}
      <ViewportGuard />
    </>
  );
}
