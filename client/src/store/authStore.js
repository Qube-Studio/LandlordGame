// 登录态：token 持久化到 localStorage（客户端只存凭证，数据都在服务端）。

import { create } from 'zustand';
import { api } from '../api';
import { T } from '../text';

const TOKEN_KEY = 'llg_token';
const NAME_KEY = 'llg_username';

export const useAuthStore = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  username: localStorage.getItem(NAME_KEY),
  busy: false,
  error: null,

  async login(username, password) {
    set({ busy: true, error: null });
    try {
      const { token, username: name } = await api.login(username, password);
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(NAME_KEY, name);
      set({ token, username: name, busy: false });
      return true;
    } catch (err) {
      set({ error: err.message, busy: false });
      return false;
    }
  },

  async register(username, password) {
    set({ busy: true, error: null });
    try {
      await api.register(username, password);
      set({ busy: false });
      return useAuthStore.getState().login(username, password);
    } catch (err) {
      set({ error: err.message, busy: false });
      return false;
    }
  },

  // 本地测试：游客一键进入（随机账号自动注册并登录）。仅在 DEV 构建里暴露入口。
  async guestLogin() {
    const name = T.net.guestName + Math.random().toString(36).slice(2, 6);
    const pw = 'guestpass';
    const ok = await useAuthStore.getState().register(name, pw);
    if (!ok) await useAuthStore.getState().login(name, pw);
  },

  async logout() {
    try { await api.logout(); } catch { /* 即使服务端失败也本地登出 */ }
    useAuthStore.getState().clearSession();
  },

  // 本地清除登录态（登出 / 被顶号 / token 失效）
  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
    set({ token: null, username: null, error: null });
  },

  clearError() { set({ error: null }); },
}));
