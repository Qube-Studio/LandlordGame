// 拍照棚顶层：Canvas（真身场景 + 自由飞行相机）+ 2D 罩层（工具栏 / 属性面板 / 帮助 / 准心）。
// 截图：preserveDrawingBuffer 保留帧缓冲，隐藏坐标轴后取 canvas.toBlob 下载——2D 罩层是 DOM，天然不入画。
import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import StudioScene from './StudioScene';
import { selectionLock } from './selectionLock';
import { interaction } from './interaction';
import { dropSelectedToFloor, focusSelection, spawnPointFor, buildMoneyStack } from './placement';
import FlyRig from './FlyRig';
import { usePhotoStore, primaryOf } from './photoStore';
import { ROLE_LABEL } from '../game/roles';

const ROLES = ['landlord', 'capitalist', 'farmer', 'investor', 'prosecutor', 'glutton', 'none'];
const DENOMS = [10, 5, 2, 1];
const KIND_NAME = { note: '钞票', coin: '硬币', char: '人物' };
const KIND_ICON = { note: '¥', coin: '◎', char: '人' };   // outliner 行首的种类图标（纯字符，扁平）
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

// 大纲行内重命名：非受控 input，Enter=提交 / Esc=取消 / 失焦=提交（IME 合成期 Enter 直通不提交）。
// done 防重入：Enter 提交后 React 卸载 input，某些浏览器仍补发 blur——双触发会压两步历史。
function RenameInput({ init, onDone }) {
  const ref = useRef();
  const done = useRef(false);
  const fire = (v) => { if (done.current) return; done.current = true; onDone(v); };
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <input
      ref={ref} className="ph-out-rn" defaultValue={init} autoFocus
      onKeyDown={(e) => {
        if (e.isComposing || e.keyCode === 229) return;   // IME 合成期直通（§0.7）
        if (e.key === 'Enter') fire(ref.current.value);
        else if (e.key === 'Escape') fire(null);          // 取消：不改名
      }}
      onBlur={() => fire(ref.current.value)}
      onPointerDown={(e) => e.stopPropagation()}          // 别把点击当成选择行
    />
  );
}

// 物体显示名：自定义名优先，空 = 种类 + id（「钞票 it3」）
const displayName = (it) => it.name || `${KIND_NAME[it.kind] ?? it.kind} ${it.id}`;

// Outliner（§2.1 左侧可折叠面板）：列表 = 视口选择模型的 UI 载体——点选/Ctrl 切换/Shift 范围（rangeSelect）、
// 双击重命名 item.name、眼睛 hidden、锁 locked、右键菜单（重命名/复制/落底/删除）。
// locked/hidden 物在这里仍可点选成「管理选择」（看属性/批量改），但 gizmo/表面拖拽/框选照样跳过它们。
function Outliner() {
  const items = usePhotoStore(s => s.items);
  const selection = usePhotoStore(s => s.selection);
  const setItemMeta = usePhotoStore(s => s.setItemMeta);
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(null);   // 正在重命名的 id
  const [menu, setMenu] = useState(null);           // 右键菜单 {x, y, id}
  const menuRef = useRef(null);
  const primary = primaryOf(selection);

  // 菜单外点击关闭（捕获阶段——先于 r3f/Interactions；点在菜单内则放行给按钮 onClick）
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(null); };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menu]);

  const st = () => usePhotoStore.getState();
  const onRowClick = (e, id) => {
    if (e.ctrlKey || e.metaKey) st().toggleSelect(id);
    else if (e.shiftKey) st().rangeSelect(id);
    else st().select(id);
  };
  const onRowMenu = (e, id) => {
    e.preventDefault();
    if (!st().selection.includes(id)) st().select(id);  // 右键未选中物 = 先单选它（Blender 语义）
    setMenu({ x: e.clientX, y: e.clientY, id });
  };
  const finishRename = (id, v) => {
    setRenaming(null);
    if (v === null) return;                             // Esc 取消
    const it = st().items.find(x => x.id === id);
    if (it && v.trim() !== it.name) setItemMeta(id, { name: v });
  };
  const menuAct = (fn) => { setMenu(null); fn(); };

  if (!open) return <button className="ph-out-toggle" onClick={() => setOpen(true)} title="大纲">☰ {items.length}</button>;
  return (
    <div className="ph-outliner" onContextMenu={(e) => e.preventDefault()}>
      <div className="ph-out-head" onClick={() => setOpen(false)} title="点此收起">
        大纲<span className="ph-dim"> · {items.length}</span><span className="ph-out-fold">▾</span>
      </div>
      <div className="ph-out-list">
        {items.length === 0 && <div className="ph-out-empty">空场 · 顶栏添加物体</div>}
        {items.map(it => (
          <div
            key={it.id}
            className={`ph-out-row ${selection.includes(it.id) ? 'sel' : ''} ${it.id === primary ? 'primary' : ''} ${it.hidden ? 'hid' : ''} ${it.locked ? 'lok' : ''}`}
            onClick={(e) => onRowClick(e, it.id)}
            onDoubleClick={() => setRenaming(it.id)}
            onContextMenu={(e) => onRowMenu(e, it.id)}
          >
            <span className="ph-out-ico">{KIND_ICON[it.kind] ?? '?'}</span>
            {renaming === it.id
              ? <RenameInput init={it.name} onDone={(v) => finishRename(it.id, v)} />
              : <span className="ph-out-name" title={displayName(it)}>{displayName(it)}</span>}
            <button
              className={`ph-out-btn ${it.hidden ? 'off' : ''}`}
              title={it.hidden ? '显示' : '隐藏（不渲染不入截图）'}
              onClick={(e) => { e.stopPropagation(); setItemMeta(it.id, { hidden: !it.hidden }); }}
            >{it.hidden ? '◌' : '◉'}</button>
            <button
              className={`ph-out-btn ${it.locked ? 'off' : ''}`}
              title={it.locked ? '解锁' : '锁定（可见但不可点选/拖拽）'}
              onClick={(e) => { e.stopPropagation(); setItemMeta(it.id, { locked: !it.locked }); }}
            >{it.locked ? '▣' : '▢'}</button>
          </div>
        ))}
      </div>
      {menu && (
        <div ref={menuRef} className="ph-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => menuAct(() => setRenaming(menu.id))}>重命名</button>
          <button onClick={() => menuAct(() => st().duplicateSelected())}>复制 <i>Shift+D</i></button>
          <button onClick={() => menuAct(() => dropSelectedToFloor())}>落底 <i>V</i></button>
          <button className="danger" onClick={() => menuAct(() => st().removeSelected())}>删除 <i>⌫</i></button>
        </div>
      )}
    </div>
  );
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

// 检查器多选态（§2.1）：数量 + 种类统计；全同类时给批量属性控件（setPropsSelected 一步撤回写全员）；
// 落底/复制/删除按钮。混合勾选框显示为未勾——点一下=全员统一到勾选值（宁简勿繁，不做三态）。
function MultiInspector() {
  const items = usePhotoStore(s => s.items);
  const selection = usePhotoStore(s => s.selection);
  const setPropsSelected = usePhotoStore(s => s.setPropsSelected);
  const removeSelected = usePhotoStore(s => s.removeSelected);
  const duplicateSelected = usePhotoStore(s => s.duplicateSelected);
  if (selection.length < 2) return null;
  const sel = selection.map(id => items.find(it => it.id === id)).filter(Boolean);
  if (sel.length < 2) return null;
  const counts = {};
  for (const it of sel) counts[it.kind] = (counts[it.kind] ?? 0) + 1;
  const stats = Object.entries(counts).map(([k, n]) => `${KIND_NAME[k] ?? k}×${n}`).join(' · ');
  const kind = Object.keys(counts).length === 1 ? sel[0].kind : null;   // 全同类才有批量属性
  const all = (fn) => sel.every(fn);                                    // 全员一致才亮 on
  const p0 = sel[0].props;

  return (
    <div className="ph-inspector">
      <div className="ph-ins-head">已选 {sel.length} 个<span className="ph-dim"> · {stats}</span></div>

      {kind === 'note' && (
        <div className="ph-prop">
          <div className="ph-ins-sub">面额（批量）</div>
          <div className="ph-chiprow">
            {DENOMS.map(d => (
              <button key={d} className={`ph-chip ${all(it => it.props.value === d) ? 'on' : ''}`} onClick={() => setPropsSelected({ value: d })}>{d}</button>
            ))}
          </div>
          <label className="ph-check"><input type="checkbox" checked={all(it => it.props.debt)} onChange={(e) => setPropsSelected({ debt: e.target.checked })} />债务（红）</label>
          <label className="ph-check"><input type="checkbox" checked={all(it => it.props.faceUp)} onChange={(e) => setPropsSelected({ faceUp: e.target.checked })} />正面朝上</label>
        </div>
      )}
      {kind === 'coin' && (
        <div className="ph-prop">
          <div className="ph-ins-sub">面（批量）</div>
          <div className="ph-chiprow">
            <button className={`ph-chip ${all(it => it.props.face === 'heads') ? 'on' : ''}`} onClick={() => setPropsSelected({ face: 'heads' })}>正面 王</button>
            <button className={`ph-chip ${all(it => it.props.face === 'tails') ? 'on' : ''}`} onClick={() => setPropsSelected({ face: 'tails' })}>反面 禾</button>
          </div>
        </div>
      )}
      {kind === 'char' && (
        <div className="ph-prop">
          <label className="ph-select"><span>角色（批量）</span>
            <select value={all(it => it.props.role === p0.role) ? p0.role : ''} onChange={(e) => e.target.value && setPropsSelected({ role: e.target.value })}>
              {!all(it => it.props.role === p0.role) && <option value="">（混合）</option>}
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
            </select>
          </label>
          <div className="ph-ins-sub">表情（批量）</div>
          <div className="ph-chiprow">
            {EXPRS.map(e => (
              <button key={e.k} className={`ph-chip ${all(it => it.props.expression === e.k) ? 'on' : ''}`} onClick={() => setPropsSelected({ expression: e.k })}>{e.label}</button>
            ))}
          </div>
          <label className="ph-check"><input type="checkbox" checked={all(it => it.props.seated)} onChange={(e) => setPropsSelected({ seated: e.target.checked })} />坐姿</label>
          <label className="ph-check"><input type="checkbox" checked={all(it => it.props.bankrupt)} onChange={(e) => setPropsSelected({ bankrupt: e.target.checked })} />破产瘫倒</label>
        </div>
      )}
      {!kind && <div className="ph-ins-sub">种类混合 · 无批量属性（变换/落底/复制/删除仍可用）</div>}

      <div className="ph-ins-actions">
        <button className="ph-btn" onClick={dropSelectedToFloor} title="V">落底</button>
        <button className="ph-btn" onClick={duplicateSelected} title="Shift+D">复制</button>
        <button className="ph-btn danger" onClick={removeSelected}>删除 ⌫</button>
      </div>
    </div>
  );
}

function Inspector() {
  // 检查器单选态（多选态见 MultiInspector；两者同壳类名，互斥非空）
  const item = usePhotoStore(s => (s.selection.length === 1 ? s.items.find(it => it.id === s.selection[0]) : null));
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
  const snapOn = usePhotoStore(s => s.snap);
  const toggleSnap = usePhotoStore(s => s.toggleSnap);
  const requestPreset = usePhotoStore(s => s.requestPreset);
  const addItem = usePhotoStore(s => s.addItem);
  const clearAll = usePhotoStore(s => s.clearAll);
  const undo = usePhotoStore(s => s.undo);
  const redo = usePhotoStore(s => s.redo);
  const canUndo = usePhotoStore(s => s.past.length > 0);
  const canRedo = usePhotoStore(s => s.future.length > 0);
  const addMoneyStack = usePhotoStore(s => s.addMoneyStack);
  const sceneFileRef = useRef();
  const [role, setRole] = useState('landlord');
  const [noteOpt, setNoteOpt] = useState({ debt: false, faceUp: true });
  const [stackN, setStackN] = useState(8);     // 钱堆张数（1-40，buildMoneyStack 双重钳制）
  const [stackV, setStackV] = useState(1);     // 钱堆面额

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
          <button key={d} className="ph-btn sm" onClick={() => addItem('note', { value: d, ...noteOpt }, spawnPointFor('note'))}>+{d}</button>
        ))}
        <button className={`ph-chip ${noteOpt.debt ? 'on' : ''}`} onClick={() => setNoteOpt(o => ({ ...o, debt: !o.debt }))}>债务</button>
        <button className={`ph-chip ${!noteOpt.faceUp ? 'on' : ''}`} onClick={() => setNoteOpt(o => ({ ...o, faceUp: !o.faceUp }))}>反面</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">钱堆</span>
        <input className="ph-nin" type="number" min="1" max="40" value={stackN}
          onChange={(e) => setStackN(Math.max(1, Math.min(40, Math.floor(Number(e.target.value)) || 1)))} />
        <span className="ph-glabel">张</span>
        <select value={stackV} onChange={(e) => setStackV(Number(e.target.value))}>
          {DENOMS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="ph-btn sm" title="cardLocal/cardYaw 与游戏内钱堆同源槽位；生成后整组全选可拖"
          onClick={() => addMoneyStack(buildMoneyStack(stackN, { value: stackV }))}>+钱堆</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">人物</span>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
        </select>
        <button className="ph-btn sm" onClick={() => addItem('char', { role }, spawnPointFor('char'))}>+加</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">硬币</span>
        <button className="ph-btn sm" onClick={() => addItem('coin', {}, spawnPointFor('coin'))}>+加</button>
      </div>

      <div className="ph-group">
        <span className="ph-glabel">坐标轴</span>
        <button className={`ph-btn sm ${gizmo === 'translate' ? 'on' : ''}`} onClick={() => setGizmo('translate')} title="G">移动</button>
        <button className={`ph-btn sm ${gizmo === 'rotate' ? 'on' : ''}`} onClick={() => setGizmo('rotate')} title="R">旋转</button>
        <button className={`ph-btn sm ${gizmo === 'scale' ? 'on' : ''}`} onClick={() => setGizmo('scale')} title="T">缩放</button>
        <button className="ph-btn sm" onClick={toggleSpace} title="L">{space === 'world' ? '世界' : '本地'}</button>
        <button className={`ph-btn sm ${snapOn ? 'on' : ''}`} onClick={toggleSnap} title="X · 平移0.1 / 旋转15° / 缩放0.1">吸附</button>
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
      <div><b>摆放</b>：Tab 切到摆放 → 点选（Ctrl 加选），拖坐标轴移动/旋转/缩放；右侧数值精调</div>
      <div><b>框选</b>：空白处拖矩形（Ctrl 拖=加选）· <b>拖物体本体</b>=贴着表面移动（多选整组跟随）</div>
      <div><b>大纲</b>（左侧）：双击重命名 · ◉ 隐藏 · ▢ 锁定 · 右键菜单 · Shift 范围选 / Ctrl 加选</div>
      <div><b>机位</b>：1 顶 · 2 前 · 3 后 · 4 左 · 5 右 · 6 透视 · <b>F 聚焦选中</b></div>
      <div><b>坐标轴</b>：G 移动 · R 旋转 · T 缩放 · L 世界/本地 · <b>X 吸附</b> · <b>V 落底</b></div>
      <div><b>截图</b> P · <b>隐藏UI</b> H · <b>藏顶</b> C（吊灯/横梁，不动灯光） · <b>泛光</b> B</div>
      <div><b>删除</b> ⌫ · <b>复制</b> Shift+D · <b>全选</b> Ctrl+A · <b>撤回</b> Ctrl+Z · <b>重做</b> Ctrl+Shift+Z</div>
      <div><b>导出/导入</b>：顶栏「场景」组把整个场景（含相机机位）存成文件 / 从文件恢复（Ctrl+S 导出）</div>
    </div>
  );
}

// 框选矩形 overlay（§2.1）：纯 HTML div 读 store.marquee 画（pointer-events:none，不挡事件流）；
// 矩形几何/命中判定全在 Interactions/pick.js，这里只是显示。
function Marquee() {
  const m = usePhotoStore(s => s.marquee);
  if (!m) return null;
  const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2);
  const w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
  return <div className="ph-marquee" style={{ left: x, top: y, width: w, height: h }} />;
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

  // 全局热键（§2.2⑦ 快捷键总表；数字机位 / 坐标轴 / 截图 / 隐藏UI / 删除 …）。移动键在 FlyRig 内处理。
  // 键盘纪律（§0.7）：IME 合成期结构性快捷键一律直通；焦点在输入框时除 Ctrl+S/Z/Y 外全部直通
  // （大纲重命名态的 Enter=提交、Esc=取消由输入框自己处理）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.isComposing || e.keyCode === 229) return;   // IME 合成期直通
      const el = document.activeElement;
      const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      const st = usePhotoStore.getState();
      const k = e.key;
      if (e.ctrlKey || e.metaKey) {                 // Ctrl 组合：撤回/重做/全选/导出
        const lk = k.toLowerCase();
        if (lk === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); }
        else if (lk === 'y') { e.preventDefault(); st.redo(); }
        else if (lk === 'a' && !inField) { e.preventDefault(); st.selectAll(); } // 全选（输入框里让给文本全选）
        else if (lk === 's') { e.preventDefault(); exportScene(); }
        return;                                     // 不落到单键快捷键（避免 Ctrl+C 触发藏顶等）
      }
      if (inField) return;                          // 输入框豁免：单键快捷键全部直通
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
      else if (low === 'v') dropSelectedToFloor();   // 落底（B 已被泛光占用）
      else if (low === 'x') st.toggleSnap();         // 网格吸附
      else if (low === 'f') focusSelection();        // F 聚焦选中集（合并 Box3 → FlyRig 退距反解）
      else if (low === 'd' && e.shiftKey) st.duplicateSelected();
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); st.removeSelected(); }
      else if (k === '/' || k === '?') st.toggleHelp();
      // Esc 优先级链（§2.1）：框选进行中=仅取消框选 → arrange=清选 → fly 不动（指针锁由浏览器自己解）
      else if (k === 'Escape') {
        if (interaction.cancelBox?.()) return;
        if (st.mode === 'arrange') st.select(null);
      }
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

      <Marquee />
      <Toast />
      {!uiHidden && (
        <>
          <Toolbar />
          <Outliner />
          <Inspector />
          <MultiInspector />
          <HelpCard />
          {mode === 'fly' && <div className="ph-crosshair" />}
        </>
      )}
    </div>
  );
}
