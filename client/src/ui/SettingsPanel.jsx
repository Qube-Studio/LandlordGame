// 设置面板：顶栏齿轮按钮 + 下拉面板。任意阶段可开，纯点击交互（不占快捷键）。
// 内容 = 房间信息（HUD 精简⑥：左上角房间牌收编于此，含复制房间号）+ 画质设置（反馈①）。
// 面板复用 .goal-hud.hud-card 挂牌范式；仅布局/分段样式进 settings.css。
// 开合走全局 gameStore.panel('settings')：与规则面板/桌沿抽屉互斥（开一个自动关其它）；
// 无关闭钮，点面板与按钮以外任意处收起（window pointerdown 捕获阶段，同 RoleWall 范式）。

import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import './settings.css';

// 像素齿轮（内联小 SVG，fill 走 currentColor，不动 assets/svg）
function GearIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
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

// bare = 无底化按钮（3D 输入模式/PC）：半透明纯符号；面板本体不变。
export default function SettingsPanel({ bare = false }) {
  const panel = useGameStore(s => s.panel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const setPanel = useGameStore(s => s.setPanel);
  const open = panel === 'settings';
  const settings = useSettingsStore();
  const { renderScale, setSetting } = settings;
  const state = useGameStore(s => s.state);
  const showToast = useGameStore(s => s.showToast);

  // 点面板/按钮以外任意处收起（捕获阶段；开面板那下的 pointerdown 早于本 effect 挂载，不会自关）
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest('.settings-root')) return;
      setPanel(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, setPanel]);

  const copyId = async () => {
    try { await navigator.clipboard.writeText(state.roomId); showToast('房间号已复制', 'ok'); }
    catch { showToast(`房间号：${state.roomId}`, 'ok'); }
  };

  return (
    <div className="settings-root">
      <button
        className={bare ? 'hud-icon-btn' : 'btn small settings-gear'}
        title="设置"
        aria-label="设置"
        aria-expanded={open}
        onClick={() => togglePanel('settings')}
      ><GearIcon /></button>

      {open && (
        <div className="goal-hud hud-card settings-panel">
          <div className="goal-line hud-card-title">
            <PixelText size={2} color="var(--px-gold)">设置</PixelText>
          </div>

          {state?.roomId && (
            <div className="settings-row">
              <span className="settings-label">
                <PixelText size={2}>{state.roomName}</PixelText>
                <PixelText size={2} color="var(--ink-dim)">{`房间号 ${state.roomId}`}</PixelText>
              </span>
              <button className="btn small" onClick={copyId}>复制</button>
            </div>
          )}

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
