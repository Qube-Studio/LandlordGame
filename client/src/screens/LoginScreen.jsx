import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { getArt } from '../assets/registry';

const Coin = getArt('coin');

export default function LoginScreen() {
  const { login, register, busy, error, clearError } = useAuthStore();
  const [tab, setTab] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [localError, setLocalError] = useState(null);

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
      <div className="auth-card panel">
        <div className="auth-brand">
          <Coin face="heads" size={56} />
          <h1>地主与农民</h1>
          <p className="dim">破产竞速 · 心理博弈</p>
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
      </div>
    </div>
  );
}
