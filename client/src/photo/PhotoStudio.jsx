// 拍照棚顶层：Canvas（真身场景 + 自由飞行相机）+ 2D 罩层（工具栏 / 属性面板 / 帮助 / 准心）。
// 截图：preserveDrawingBuffer 保留帧缓冲，隐藏坐标轴后取 canvas.toBlob 下载——2D 罩层是 DOM，天然不入画。
import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import StudioScene from './StudioScene';
import { selectionLock } from './selectionLock';
import FlyRig from './FlyRig';
import { usePhotoStore } from './photoStore';
import { ROLE_LABEL } from '../game/roles';

const ROLES = ['landlord', 'capitalist', 'farmer', 'investor', 'prosecutor', 'glutton', 'none'];
const DENOMS = [10, 5, 2, 1];
// 人物表情（荧幕脸的五种可辨字符眼；idle/ready 同脸，取 idle）：
// 平静 ▮▮ · 下注 $$ · 胜 ^^ · 负 TT · 破产 ✕✕（破产脸=只换眼、身体不变；要灰皮歪身另勾「破产瘫倒」）
const EXPRS = [
  { k: 'idle', label: '平静' }, { k: 'bet', label: '下注' }, { k: 'win', label: '胜' },
  { k: 'lose', label: '负' }, { k: 'bankrupt', label: '破产' },
];
const PRESET_KEYS = ['top', 'front', 'back', 'left', 'right', 'persp'];
const PRESET_LABEL = { top: '顶视', front: '正前', back: '正后', left: '正左', right: '正右', persp: '透视' };
const DPR = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5);
const deg = (r) => Math.round((r * 180) / Math.PI);
const rad = (d) => (d * Math.PI) / 180;

// 截图：临时隐藏坐标轴 → 等两帧渲染干净帧 → 下载
async function capture() {
  const st = usePhotoStore.getState();
  st.setCapturing(true);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const canvas = document.querySelector('.photo-root canvas');
  if (!canvas) { st.setCapturing(false); return; }
  canvas.toBlob((blob) => {
    st.setCapturing(false);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `fate-photo-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

// 导出：把整份场景（物体+顶部开关+泛光+相机位姿）写成 JSON 文件下载
function exportScene() {
  const data = usePhotoStore.getState().serialize();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `fate-scene-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  usePhotoStore.getState().showToast('已导出场景文件');
}
// 导入：读 JSON 文件 → 恢复场景（含相机机位）
async function importFile(file) {
  try {
    usePhotoStore.getState().importScene(JSON.parse(await file.text()));
  } catch (e) {
    usePhotoStore.getState().showToast('导入失败：' + e.message, true);
  }
}

function NumField({ label, value, step = 0.1, onChange }) {
  return (
    <label className="ph-num">
      <span>{label}</span>
      <input type="number" value={value} step={step}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Inspector() {
  const item = usePhotoStore(s => s.items.find(it => it.id === s.selectedId));
  const setTransform = usePhotoStore(s => s.setTransform);
  const setProps = usePhotoStore(s => s.setProps);
  const removeSelected = usePhotoStore(s => s.removeSelected);
  const duplicateSelected = usePhotoStore(s => s.duplicateSelected);
  if (!item) return null;
  const p = item.props;
  const setP = (i, v) => { const pos = [...item.pos]; pos[i] = v; setTransform(item.id, { pos }); };
  const setR = (i, v) => { const rot = [...item.rot]; rot[i] = rad(v); setTransform(item.id, { rot }); };
  const setS = (i, v) => { const scale = [...item.scale]; scale[i] = v; setTransform(item.id, { scale }); };
  const setSUniform = (v) => setTransform(item.id, { scale: [v, v, v] });
  const kindLabel = item.kind === 'note' ? '钞票' : item.kind === 'coin' ? '硬币' : '人物';

  return (
    <div className="ph-inspector">
      <div className="ph-ins-head">{kindLabel}<span className="ph-dim"> · {item.id}</span></div>

      {/* 类型专属属性 */}
      {item.kind === 'note' && (
        <div className="ph-prop">
          <div className="ph-chiprow">
            {DENOMS.map(d => (
              <button key={d} className={`ph-chip ${p.value === d ? 'on' : ''}`} onClick={() => setProps(item.id, { value: d })}>{d}</button>
            ))}
          </div>
          <label className="ph-check"><input type="checkbox" checked={p.debt} onChange={(e) => setProps(item.id, { debt: e.target.checked })} />债务（红）</label>
          <label className="ph-check"><input type="checkbox" checked={p.faceUp} onChange={(e) => setProps(item.id, { faceUp: e.target.checked })} />正面朝上</label>
        </div>
      )}
      {item.kind === 'coin' && (
        <div className="ph-prop">
          <div className="ph-chiprow">
            <button className={`ph-chip ${p.face === 'heads' ? 'on' : ''}`} onClick={() => setProps(item.id, { face: 'heads' })}>正面 王</button>
            <button className={`ph-chip ${p.face === 'tails' ? 'on' : ''}`} onClick={() => setProps(item.id, { face: 'tails' })}>反面 禾</button>
          </div>
        </div>
      )}
      {item.kind === 'char' && (
        <div className="ph-prop">
          <label className="ph-select"><span>角色</span>
            <select value={p.role} onChange={(e) => setProps(item.id, { role: e.target.value })}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
            </select>
          </label>
          <div className="ph-ins-sub">表情</div>
          <div className="ph-chiprow">
            {EXPRS.map(e => (
              <button key={e.k} className={`ph-chip ${p.expression === e.k ? 'on' : ''}`} onClick={() => setProps(item.id, { expression: e.k })}>{e.label}</button>
            ))}
          </div>
          <label className="ph-check"><input type="checkbox" checked={p.seated} onChange={(e) => setProps(item.id, { seated: e.target.checked })} />坐姿</label>
          <label className="ph-check"><input type="checkbox" checked={p.bankrupt} onChange={(e) => setProps(item.id, { bankrupt: e.target.checked })} />破产瘫倒（灰皮·歪身，盖过表情）</label>
        </div>
      )}

      {/* 变换 */}
      <div className="ph-ins-sub">位置</div>
      <div className="ph-vec">
        <NumField label="X" value={+item.pos[0].toFixed(3)} onChange={(v) => setP(0, v)} />
        <NumField label="Y" value={+item.pos[1].toFixed(3)} onChange={(v) => setP(1, v)} />
        <NumField label="Z" value={+item.pos[2].toFixed(3)} onChange={(v) => setP(2, v)} />
      </div>
      <div className="ph-ins-sub">旋转（度）</div>
      <div className="ph-vec">
        <NumField label="X" value={deg(item.rot[0])} step={5} onChange={(v) => setR(0, v)} />
        <NumField label="Y" value={deg(item.rot[1])} step={5} onChange={(v) => setR(1, v)} />
        <NumField label="Z" value={deg(item.rot[2])} step={5} onChange={(v) => setR(2, v)} />
      </div>
      <div className="ph-ins-sub">缩放</div>
      <div className="ph-vec">
        <NumField label="X" value={+item.scale[0].toFixed(3)} step={0.05} onChange={(v) => setS(0, v)} />
        <NumField label="Y" value={+item.scale[1].toFixed(3)} step={0.05} onChange={(v) => setS(1, v)} />
        <NumField label="Z" value={+item.scale[2].toFixed(3)} step={0.05} onChange={(v) => setS(2, v)} />
      </div>
      <label className="ph-num ph-num-wide"><span>等比</span>
        <input type="number" value={+item.scale[0].toFixed(3)} step={0.05} onChange={(e) => setSUniform(Number(e.target.value))} />
      </label>

      <div className="ph-ins-actions">
        <button className="ph-btn" onClick={duplicateSelected}>复制</button>
        <button className="ph-btn danger" onClick={removeSelected}>删除 ⌫</button>
      </div>
    </div>
  );
}

function Toolbar() {
  const mode = usePhotoStore(s => s.mode);
  const gizmo = usePhotoStore(s => s.gizmo);
  const space = usePhotoStore(s => s.space);
  const postFx = usePhotoStore(s => s.postFx);
  const toggleMode = usePhotoStore(s => s.toggleMode);
  const setGizmo = usePhotoStore(s => s.setGizmo);
  const toggleSpace = usePhotoStore(s => s.toggleSpace);
  const togglePostFx = usePhotoStore(s => s.togglePostFx);
  const toggleOverhead = usePhotoStore(s => s.toggleOverhead);
  const hideOverhead = usePhotoStore(s => s.hideOverhead);
  const toggleUi = usePhotoStore(s => s.toggleUi);
  const requestPreset = usePhotoStore(s => s.requestPreset);
  const addItem = usePhotoStore(s => s.addItem);
  const clearAll = usePhotoStore(s => s.clearAll);
  const undo = usePhotoStore(s => s.undo);
  const redo = usePhotoStore(s => s.redo);
  const canUndo = usePhotoStore(s => s.past.length > 0);
  const canRedo = usePhotoStore(s => s.future.length > 0);
  const sceneFileRef = useRef();
  const [role, setRole] = useState('landlord');
  const [noteOpt, setNoteOpt] = useState({ debt: false, faceUp: true });

  return (
    <div className="ph-top">
      <span className="ph-title">拍照棚</span>
      <button className={`ph-btn mode ${mode}`} onClick={toggleMode} title="Tab 切换">
        {mode === 'fly' ? '✈ 飞行' : '✥ 摆放'}
      </button>

      <div className="ph-group">
        <span className="ph-glabel">机位</span>
        {PRESET_KEYS.map((k, i) => (
          <button key={k} className="ph-btn sm" onClick={() => requestPreset(k)} title={`${i + 1}`}>{PRESET_LABEL[k]}</button>
        ))}
      </div>

      <div className="ph-group">
        <span className="ph-glabel">钞票</span>
        {DENOMS.map(d => (
          <button key={d} className="ph-btn sm" onClick={() => addItem('note', { value: d, ...noteOpt })}>+{d}</button>
        ))}
        <button className={`ph-chip ${noteOpt.debt ? 'on' : ''}`} onClick={() => setNoteOpt(o => ({ ...o, debt: !o.debt }))}>债务</button>
        <button className={`ph-chip ${!noteOpt.faceUp ? 'on' : ''}`} onClick={() => setNoteOpt(o => ({ ...o, faceUp: !o.faceUp }))}>反面</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">人物</span>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
        </select>
        <button className="ph-btn sm" onClick={() => addItem('char', { role })}>+加</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">硬币</span>
        <button className="ph-btn sm" onClick={() => addItem('coin')}>+加</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">坐标轴</span>
        <button className={`ph-btn sm ${gizmo === 'translate' ? 'on' : ''}`} onClick={() => setGizmo('translate')} title="G">移动</button>
        <button className={`ph-btn sm ${gizmo === 'rotate' ? 'on' : ''}`} onClick={() => setGizmo('rotate')} title="R">旋转</button>
        <button className={`ph-btn sm ${gizmo === 'scale' ? 'on' : ''}`} onClick={() => setGizmo('scale')} title="T">缩放</button>
        <button className="ph-btn sm" onClick={toggleSpace} title="L">{space === 'world' ? '世界' : '本地'}</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">场景</span>
        <button className="ph-btn sm" onClick={undo} disabled={!canUndo} title="Ctrl+Z 撤回">↶撤回</button>
        <button className="ph-btn sm" onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z 重做">↷重做</button>
        <button className="ph-btn sm" onClick={exportScene} title="Ctrl+S 保存到文件">导出</button>
        <button className="ph-btn sm" onClick={() => sceneFileRef.current?.click()} title="从文件恢复">导入</button>
        <input ref={sceneFileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; }} />
      </div>

      <div className="ph-group">
        <button className="ph-btn sm primary" onClick={capture} title="P">截图</button>
        <button className="ph-btn sm" onClick={toggleUi} title="H">隐藏UI</button>
        <button className={`ph-btn sm ${hideOverhead ? 'on' : ''}`} onClick={toggleOverhead} title="C · 藏吊灯/横梁，不影响灯光">藏顶</button>
        <button className={`ph-btn sm ${postFx ? 'on' : ''}`} onClick={togglePostFx} title="B">泛光</button>
        <button className="ph-btn sm danger" onClick={() => { if (confirm('清空所有摆放物？')) clearAll(); }}>清空</button>
      </div>
    </div>
  );
}

function HelpCard() {
  const help = usePhotoStore(s => s.help);
  const toggleHelp = usePhotoStore(s => s.toggleHelp);
  if (!help) return <button className="ph-help-toggle" onClick={toggleHelp} title="帮助">?</button>;
  return (
    <div className="ph-help" onClick={toggleHelp}>
      <div className="ph-help-t">操作（点此收起 · 或按 /）</div>
      <div><b>飞行</b>：点画面锁鼠标 → 鼠标转视角，WASD 平移、Space 升、Shift 降，滚轮调速；Esc 释放</div>
      <div><b>摆放</b>：Tab 切到摆放 → 点选物体，拖坐标轴移动/旋转/缩放；右侧数值精调</div>
      <div><b>机位</b>：1 顶 · 2 前 · 3 后 · 4 左 · 5 右 · 6 透视</div>
      <div><b>坐标轴</b>：G 移动 · R 旋转 · T 缩放 · L 世界/本地</div>
      <div><b>截图</b> P · <b>隐藏UI</b> H · <b>藏顶</b> C（吊灯/横梁，不动灯光） · <b>泛光</b> B</div>
      <div><b>删除</b> ⌫ · <b>复制</b> Shift+D · <b>撤回</b> Ctrl+Z · <b>重做</b> Ctrl+Shift+Z</div>
      <div><b>导出/导入</b>：顶栏「场景」组把整个场景（含相机机位）存成文件 / 从文件恢复（Ctrl+S 导出）</div>
    </div>
  );
}

// 短暂提示（导入/导出反馈）。key=nonce 使每次提示重挂 → 重播 CSS 淡入淡出；无 JS 计时器/状态。不入截图。
function Toast() {
  const toast = usePhotoStore(s => s.toast);
  if (!toast) return null;
  return <div key={toast.nonce} className={`ph-toast auto ${toast.err ? 'err' : ''}`}>{toast.text}</div>;
}

export default function PhotoStudio() {
  const mode = usePhotoStore(s => s.mode);
  const uiHidden = usePhotoStore(s => s.uiHidden);
  const select = usePhotoStore(s => s.select);

  // 全局热键（数字机位 / 坐标轴 / 截图 / 隐藏UI / 删除 …）。移动键在 FlyRig 内处理。
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const st = usePhotoStore.getState();
      const k = e.key;
      if (e.ctrlKey || e.metaKey) {                 // Ctrl 组合：撤回/重做/导出
        const lk = k.toLowerCase();
        if (lk === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); }
        else if (lk === 'y') { e.preventDefault(); st.redo(); }
        else if (lk === 's') { e.preventDefault(); exportScene(); }
        return;                                     // 不落到单键快捷键（避免 Ctrl+C 触发藏顶等）
      }
      if (k === 'Tab') { e.preventDefault(); st.toggleMode(); return; }
      if (k >= '1' && k <= '6') { st.requestPreset(PRESET_KEYS[Number(k) - 1]); return; }
      const low = k.toLowerCase();
      if (low === 'g') st.setGizmo('translate');
      else if (low === 'r') st.setGizmo('rotate');
      else if (low === 't') st.setGizmo('scale');
      else if (low === 'l') st.toggleSpace();
      else if (low === 'p') { e.preventDefault(); capture(); }
      else if (low === 'h') st.toggleUi();
      else if (low === 'b') st.togglePostFx();
      else if (low === 'c') st.toggleOverhead();
      else if (low === 'd' && e.shiftKey) st.duplicateSelected();
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); st.removeSelected(); }
      else if (k === '/' || k === '?') st.toggleHelp();
      else if (k === 'Escape') { if (st.mode === 'arrange') st.select(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="r3f-scene photo-root">
      <Canvas
        shadows
        dpr={DPR}
        camera={{ position: [5.6, 4.4, 7.8], fov: 55, near: 0.1, far: 120 }}
        gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        onPointerMissed={() => {
          if (selectionLock.current) { selectionLock.current = false; return; } // 点在坐标轴上/拖拽 → 不取消选择
          if (usePhotoStore.getState().mode === 'arrange') select(null);
        }}
      >
        <StudioScene />
        <FlyRig />
      </Canvas>

      <Toast />
      {!uiHidden && (
        <>
          <Toolbar />
          <Inspector />
          <HelpCard />
          {mode === 'fly' && <div className="ph-crosshair" />}
        </>
      )}
    </div>
  );
}
