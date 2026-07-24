// 设置面板（居中大窗，与教程面板 RulesPanel 同范式）：顶栏齿轮按钮 → 高斯模糊遮罩 + 居中大窗，
// 左侧分类导航（画面/光影/房间）+ 右侧该分类的设置项。点遮罩空白处收起；退场播完再卸载。
// 内容分组重排：画面=界面大小+渲染分辨率；光影=阴影+光影特效+动态光效；房间=房号+复制。
// 开合走全局 gameStore.panel('settings')：与规则面板/桌沿抽屉互斥。

import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, UI_SCALES } from '../store/settingsStore';
import { useGameStore } from '../store/gameStore';
import { IS_TOUCH } from '../game/inputMode';
import PixelText from '../assets/pixelfont/PixelText';
import { T } from '../text';
import './settings.css';

const DEV = import.meta.env.DEV;

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
  { value: 'auto', label: T.settings.scaleAuto },
  { value: 'low', label: T.settings.scaleLow },
  { value: 'medium', label: T.settings.scaleMid },
  { value: 'high', label: T.settings.scaleHigh },
];

const VISUAL_STYLE_OPTIONS = [
  { value: 'voxel', label: T.settings.styleVoxel },
  { value: 'classic', label: T.settings.styleClassic },
];

// 一个分段选择字段：标题 + 注脚在上，一排按钮在下
function SegField({ label, note, options, value, onPick }) {
  return (
    <div className="settings-field">
      <div className="settings-field-head">
        <PixelText size={2}>{label}</PixelText>
        {note && <PixelText size={2} color="var(--ink-dim)">{note}</PixelText>}
      </div>
      <div className="settings-seg">
        {options.map(o => (
          <button
            key={String(o.value)}
            className={`btn ${value === o.value ? 'primary' : ''}`}
            onClick={() => onPick(o.value)}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// 一个开关字段：标题 + 注脚在左，开/关药丸在右
function ToggleField({ label, note, on, onToggle }) {
  return (
    <div className="settings-field settings-field-row">
      <div className="settings-field-head">
        <PixelText size={2}>{label}</PixelText>
        {note && <PixelText size={2} color="var(--ink-dim)">{note}</PixelText>}
      </div>
      <button className={`btn settings-toggle ${on ? 'primary' : ''}`} onClick={onToggle}>
        {on ? T.common.on : T.common.off}
      </button>
    </div>
  );
}

export default function SettingsPanel({ bare = false, allowLocalExperiments = false }) {
  const panel = useGameStore(s => s.panel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const setPanel = useGameStore(s => s.setPanel);
  const roomId = useGameStore(s => s.roomId);
  const open = panel === 'settings';
  const settings = useSettingsStore();
  const { visualStyle, renderScale, uiScale, setSetting } = settings;
  const state = useGameStore(s => s.state);
  const showToast = useGameStore(s => s.showToast);

  const [cat, setCat] = useState('display');
  const dialogRef = useRef(null);

  // 现在设置也可从大厅打开：面板自行负责 Esc 与焦点闭环，不能依赖房内 useGameKeys。
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPanel(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.getClientRects().length > 0);
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, setPanel]);

  // 离场动画：open→false 时保持挂载播完退场再卸载（同 RulesPanel）。
  const [visible, setVisible] = useState(open);
  if (open && !visible) setVisible(true);
  const closing = visible && !open;

  const copyId = async () => {
    if (!roomId) return;
    try { await navigator.clipboard.writeText(roomId); showToast(T.settings.copied, 'ok'); }
    catch { showToast(T.settings.copyFallback(roomId), 'ok'); }
  };

  const CATEGORIES = [
    { id: 'display', label: T.settings.catDisplay },
    { id: 'effects', label: T.settings.catEffects },
    ...(DEV && allowLocalExperiments ? [{ id: 'local', label: T.settings.catLocal }] : []),
    ...(!allowLocalExperiments && roomId ? [{ id: 'room', label: T.settings.catRoom }] : []),
  ];
  const active = CATEGORIES.some(c => c.id === cat) ? cat : 'display';

  return (
    <div className="settings-root">
      <button
        className={bare ? 'hud-icon-btn' : 'btn small settings-gear'}
        title={T.settings.title}
        aria-label={T.settings.title}
        aria-expanded={open}
        onClick={() => togglePanel('settings')}
      ><GearIcon /></button>

      {visible && (
        // 居中大窗 + 高斯模糊遮罩；点遮罩空白处（非窗口本体）收起。closing 播退场，动画结束卸载。
        <div
          className={`settings-overlay ${closing ? 'closing' : ''}`}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setPanel(null); }}
          onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) setVisible(false); }}
        >
          <div
            ref={dialogRef}
            className="goal-hud hud-card settings-window"
            role="dialog"
            aria-modal="true"
            aria-label={T.settings.title}
            tabIndex={-1}
          >
            <div className="goal-line hud-card-title">
              <PixelText size={2} color="var(--px-gold)">{T.settings.title}</PixelText>
            </div>
            <div className="settings-split">
              <div className="settings-nav">
                {CATEGORIES.map(c => (
                  <div
                    key={c.id}
                    className={`settings-cat ${active === c.id ? 'sel' : ''}`}
                    onClick={() => setCat(c.id)}
                  >
                    <PixelText size={2} color={active === c.id ? 'var(--px-gold)' : 'var(--ink-dim)'}>{c.label}</PixelText>
                  </div>
                ))}
              </div>

              <div className="settings-body">
                {active === 'display' && (
                  <>
                    <SegField
                      label={T.settings.visualStyle}
                      note={T.settings.visualStyleNote}
                      options={VISUAL_STYLE_OPTIONS}
                      value={visualStyle}
                      onPick={(v) => setSetting('visualStyle', v)}
                    />
                    {!IS_TOUCH && (
                      <SegField
                        label={T.settings.uiScale}
                        note={T.settings.uiScaleNote}
                        options={UI_SCALES.map(v => ({ value: v, label: T.settings.uiScaleOption(v) }))}
                        value={uiScale}
                        onPick={(v) => setSetting('uiScale', v)}
                      />
                    )}
                    <SegField
                      label={T.settings.renderScale}
                      note={T.settings.renderScaleNote}
                      options={SCALE_OPTIONS}
                      value={renderScale}
                      onPick={(v) => setSetting('renderScale', v)}
                    />
                  </>
                )}

                {active === 'effects' && (
                  <>
                    <ToggleField label={T.settings.shadows} on={settings.shadows} onToggle={() => setSetting('shadows', !settings.shadows)} />
                    <ToggleField label={T.settings.postfx} note={T.settings.postfxNote} on={settings.postfx} onToggle={() => setSetting('postfx', !settings.postfx)} />
                    <ToggleField label={T.settings.lightAnim} note={T.settings.lightAnimNote} on={settings.lightAnim} onToggle={() => setSetting('lightAnim', !settings.lightAnim)} />
                  </>
                )}

                {active === 'local' && DEV && allowLocalExperiments && (
                  <ToggleField
                    label={T.settings.executionTestRooms}
                    note={T.settings.executionTestRoomsNote}
                    on={settings.executionTestRooms}
                    onToggle={() => setSetting('executionTestRooms', !settings.executionTestRooms)}
                  />
                )}

                {active === 'room' && roomId && (
                  <div className="settings-field settings-field-row">
                    <div className="settings-field-head">
                      <PixelText size={2}>{state.roomName}</PixelText>
                      <PixelText size={2} color="var(--ink-dim)">{T.settings.roomId(roomId)}</PixelText>
                    </div>
                    <button className="btn" onClick={copyId}>{T.settings.copy}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
