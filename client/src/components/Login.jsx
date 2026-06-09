import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

export default function Login() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const setUsername = useGameStore(s => s.setUsername);

  const submit = async () => {
    const name = input.trim();
    if (!name) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? '注册失败'); return; }
      setUsername(data.username);
    } catch {
      setErr('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lobby">
      <h1>地主与农民</h1>
      <p className="subtitle">破产竞赛 · 认知博弈 · 全公开对抗</p>

      <div className="card">
        <h3>选择用户名</h3>
        <input
          className="input"
          placeholder="输入用户名"
          value={input}
          onChange={e => { setInput(e.target.value); setErr(''); }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ marginBottom: 12 }}
        />
        <button className="btn primary" onClick={submit} disabled={!input.trim() || loading}>
          {loading ? '登录中…' : '进入游戏'}
        </button>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  );
}
