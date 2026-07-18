// 画质设置（纯客户端表现层偏好，反馈①）：渲染分辨率 / 阴影 / 光影特效 / 动态光效。
// SettingsPanel 修改、Scene3D 消费；持久化到 localStorage（fate.settings），
// 读档 merge-parse 容错：坏 JSON / 未知键 / 类型不符一律回落默认值。

import { create } from 'zustand';

const STORAGE_KEY = 'fate.settings';

const RENDER_SCALES = ['auto', 'low', 'medium', 'high'];
export const UI_SCALES = [1, 1.15, 1.3, 1.5]; // 界面大小档位（缩小有效参考分辨率=整体等比放大，仅桌面舞台生效）

const DEFAULTS = {
  renderScale: 'auto', // 'auto' | 'low' | 'medium' | 'high' —— Canvas dpr 档位
  uiScale: 1,          // 界面大小（AppStage 舞台整体缩放倍率，UI_SCALES 之一）
  shadows: true,       // 投影灯 castShadow
  postfx: true,        // EffectComposer（泛光/暗角）
  lightAnim: true,     // 炉火闪烁 / 吊灯压光 tween
};

function load() {
  const out = { ...DEFAULTS };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (RENDER_SCALES.includes(parsed?.renderScale)) out.renderScale = parsed.renderScale;
    if (UI_SCALES.includes(parsed?.uiScale)) out.uiScale = parsed.uiScale;
    for (const k of ['shadows', 'postfx', 'lightAnim']) {
      if (typeof parsed?.[k] === 'boolean') out[k] = parsed[k];
    }
  } catch { /* 解析失败：用默认值 */ }
  return out;
}

export const useSettingsStore = create((set, get) => ({
  ...load(),

  setSetting(key, value) {
    if (!(key in DEFAULTS)) return;
    if (key === 'renderScale' && !RENDER_SCALES.includes(value)) return;
    if (key === 'uiScale' && !UI_SCALES.includes(value)) return;
    if (key !== 'renderScale' && key !== 'uiScale' && typeof value !== 'boolean') return;
    set({ [key]: value });
    const { renderScale, uiScale, shadows, postfx, lightAnim } = get();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ renderScale, uiScale, shadows, postfx, lightAnim })); }
    catch { /* 存储不可用：仅本次会话生效 */ }
  },
}));
