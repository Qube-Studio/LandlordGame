// 新手引导状态：记录哪些一次性讲解已看过，持久化到 localStorage（仿 authStore 范式）。
import { create } from 'zustand';

const KEY = 'llg_onboarding';
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export const useOnboardingStore = create((set, get) => ({
  seen: load(),
  enabled: true, // 总开关（将来可接设置项）

  hasSeen(key) { return !!get().seen[key]; },

  markSeen(key) {
    if (get().seen[key]) return;
    const seen = { ...get().seen, [key]: 1 };
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch { /* 隐私模式写入失败可忽略 */ }
    set({ seen });
  },

  reset() { // 重看全部引导（供测试 / 将来设置项）
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ seen: {} });
  },
}));
