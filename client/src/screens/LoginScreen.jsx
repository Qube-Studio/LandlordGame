import { useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import PixelText from '../assets/pixelfont/PixelText';
import LobbyMascot from '../scene/LobbyMascot';

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function LoginScreen() {
  const { login, register, guestLogin, busy, error, clearError } = useAuthStore();
  const [tab, setTab] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [localError, setLocalError] = useState(null);
  const cardRef = useRef(null);

  // 反馈④:招牌只在自身区域内跟随鼠标(挂链摆动)。直写 CSS 变量,不走 state 免重渲染。
  const onCardMove = (e) => {
    const el = cardRef.current;
    if (!el || REDUCED) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5));
    el.classList.remove('settling');
    el.style.setProperty('--tilt-x', nx.toFixed(3));
  };
  const onCardLeave = () => {
    const el = cardRef.current;
    if (!el || REDUCED) return;
    el.classList.add('settling'); // 换成衰减回弹的 transition 后再归位
    el.style.setProperty('--tilt-x', '0');
  };

  const switchTab = (next) => {
    setTab(next);
    setLocalError(null);
    clearError();
  };

  const submit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (tab === 'register') {
      if (password !== password2) {
        setLocalError('两次输入的密码不一致');
        return;
      }
      await register(username, password);
    } else {
      await login(username, password);
    }
  };

  return (
    <div className="center-screen">
      {/* 反馈⑪(用户澄清:主界面=登录页):招牌左移,右侧站一个会呼吸/看鼠标的吉祥物半身像 */}
      <div className="login-duo">
      <div className="auth-card panel" ref={cardRef} onMouseMove={onCardMove} onMouseLeave={onCardLeave}>
        <div className="auth-brand">
          <h1><PixelText size={5} color="var(--px-gold)">F.A.T.E.</PixelText></h1>
        </div>
        <div className="tabs">
          <button className={tab === 'login' ? 'tab active' : 'tab'} onClick={() => switchTab('login')}>登录</button>
          <button className={tab === 'register' ? 'tab active' : 'tab'} onClick={() => switchTab('register')}>注册</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label className="field">
            <span>用户名</span>
            <input value={username} onChange={e => setUsername(e.target.value)} maxLength={16} autoFocus placeholder="1-16 个字符" />
          </label>
          <label className="field">
            <span>密码</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 4 位" />
          </label>
          {tab === 'register' && (
            <label className="field">
              <span>确认密码</span>
              <input type="password" value={password2} onChange={e => setPassword2(e.target.value)} placeholder="再输入一次" />
            </label>
          )}
          {(localError || error) && <div className="form-error">{localError ?? error}</div>}
          <button className="btn primary wide" disabled={busy || !username.trim() || !password}>
            {busy ? '请稍候…' : tab === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>
        {import.meta.env.DEV && (
          <button type="button" className="btn wide" style={{ marginTop: 8 }} disabled={busy} onClick={() => guestLogin()}>
            游客快速进入（本地测试）
          </button>
        )}
      </div>
      <LobbyMascot />
      </div>
    </div>
  );
}
