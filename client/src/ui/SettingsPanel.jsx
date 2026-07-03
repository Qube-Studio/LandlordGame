// 画质设置（反馈①）：顶栏齿轮按钮 + 下拉面板。任意阶段可开，纯点击交互（不占快捷键）。
// 面板复用 .goal-hud.hud-card 挂牌范式；仅布局/分段样式进 settings.css。

import { useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import PixelText from '../assets/pixelfont/PixelText';
import './settings.css';

// 像素齿轮（内联小 SVG，fill 走 currentColor，不动 assets/svg）
function GearIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="6" y="0" width="2" height="3" />
      <rect x="6" y="11" width="2" height="3" />
      <rect x="0" y="6" width="3" height="2" />
      <rect x="11" y="6" width="3" height="2" />
      <rect x="2" y="2" width="2" height="2" />
      <rect x="10" y="2" width="2" height="2" />
      <rect x="2" y="10" width="2" height="2" />
      <rect x="10" y="10" width="2" height="2" />
      <path fillRule="evenodd" d="M3 3 h8 v8 h-8 Z M5 5 h4 v4 h-4 Z" />
    </svg>
  );
}

const SCALE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const TOGGLES = [
  { key: 'shadows', label: '阴影' },
  { key: 'postfx', label: '光影特效', note: '泛光/暗角' },
  { key: 'lightAnim', label: '动态光效', note: '炉火/吊灯' },
];

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const settings = useSettingsStore();
  const { renderScale, setSetting } = settings;

  return (
    <div className="settings-root">
      <button
        className="btn small settings-gear"
        title="画质设置"
        aria-label="画质设置"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      ><GearIcon /></button>

      {open && (
        <div className="goal-hud hud-card settings-panel">
          <div className="goal-line hud-card-title">
            <PixelText size={2} color="var(--c-wood-900)">画质设置</PixelText>
            <button className="settings-x" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
          </div>

          <div className="settings-row">
            <span className="settings-label">
              <PixelText size={2}>渲染分辨率</PixelText>
              <PixelText size={2} color="var(--ink-dim)">卡顿请调低</PixelText>
            </span>
            <span className="settings-seg">
              {SCALE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`btn small ${renderScale === o.value ? 'primary' : ''}`}
                  onClick={() => setSetting('renderScale', o.value)}
                >{o.label}</button>
              ))}
            </span>
          </div>

          {TOGGLES.map(t => (
            <div className="settings-row" key={t.key}>
              <span className="settings-label">
                <PixelText size={2}>{t.label}</PixelText>
                {t.note && <PixelText size={2} color="var(--ink-dim)">{t.note}</PixelText>}
              </span>
              <button
                className={`btn small settings-toggle ${settings[t.key] ? 'primary' : ''}`}
                onClick={() => setSetting(t.key, !settings[t.key])}
              >{settings[t.key] ? '开' : '关'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
