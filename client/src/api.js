// REST 封装：账号 / 大厅。游戏内交互全部走 WebSocket（net/socket.js）。

import { useAuthStore } from './store/authStore';

const API_BASE = import.meta.env.VITE_BACKEND_HOST
  ? `https://${import.meta.env.VITE_BACKEND_HOST}`
  : '';

async function request(path, { method = 'GET', body } = {}) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    // 会话失效（服务端重启/被顶号）：回到登录页
    useAuthStore.getState().clearSession();
  }
  if (!res.ok) throw new Error(data.error ?? `请求失败 (${res.status})`);
  return data;
}

export const api = {
  register: (username, password) => request('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  online: () => request('/online'),
  modes: () => request('/modes'),
  createRoom: (name, mode) => request('/rooms', { method: 'POST', body: { name, mode } }),
  listRooms: () => request('/rooms'),
};
