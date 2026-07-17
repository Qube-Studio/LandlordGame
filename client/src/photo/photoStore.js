// 拍照棚状态（zustand）：摆放物列表 + 选择集/机位/操作模式 + 撤回栈 + 场景文件存取 + 落盘持久化。
// 摆放物 = { id, kind:'note'|'char'|'coin', props, pos[3], rot[3](弧度), scale[3], seed,
//            name(自定义名，空=按种类显示), hidden(不渲染不进注册表), locked(可见但不可点选/拖拽) }。
// 选择模型（EDITOR_OVERHAUL §2.1）：selection: string[]，有序、末位=主选。
// 变换(pos/rot/scale)在拖拽/数值编辑时高频更新——落盘节流 250ms；历史合并见 pushHistory。
import { create } from 'zustand';

const KEY = 'fate.photo.scene.v1';
let idc = 1;
const freshId = () => `it${idc++}`;
// 导入/载入后把 id 计数器推过已有最大值，防新物体撞 id。
// 必须在 sanitizeItem **之前**跑：消毒会给缺 id 的条目发新号，计数器没先推过去就会撞上存量 id。
const bumpIds = (items) => { for (const it of items) { const n = Number(String(it?.id ?? '').replace(/\D/g, '')); if (n >= idc) idc = n + 1; } };

export const TABLE_TOP = 1.0;
// 实时相机位姿：FlyRig 每帧写入 → 导出场景时读取；导入时经 camRestore 回灌 FlyRig。
export const liveCamera = { pos: [5.6, 4.4, 7.8], yaw: 0.62, pitch: -0.34 };

const DEFAULTS = {
  note: { value: 10, debt: false, faceUp: true },
  char: { role: 'landlord', expression: 'idle', seated: false, bankrupt: false },
  coin: { face: 'heads' },
};
const spawnPos = (kind) => (
  kind === 'char' ? [0, 0, 2.4]
    : kind === 'coin' ? [0, TABLE_TOP + 0.04, 0]
      : [0, TABLE_TOP + 0.03, 0]
);

const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

// 摆放物消毒（导入/载入的唯一闸门：白名单重建，坏字段回落默认，不整段拒绝；
// 不在这里重建的字段一律被剥掉——加新字段必须改这里）。
function sanitizeItem(it) {
  const kind = ['note', 'char', 'coin'].includes(it?.kind) ? it.kind : 'note';
  const v3 = (a, d) => (Array.isArray(a) && a.length === 3 && a.every(n => Number.isFinite(n)) ? a.map(Number) : d);
  return {
    id: typeof it?.id === 'string' ? it.id : freshId(),
    kind,
    props: { ...DEFAULTS[kind], ...(it?.props && typeof it.props === 'object' ? it.props : {}) },
    pos: v3(it?.pos, spawnPos(kind)),
    rot: v3(it?.rot, [0, 0, 0]),
    scale: v3(it?.scale, [1, 1, 1]),
    seed: Number.isFinite(it?.seed) ? it.seed : 0,
    // 旧场景文件无以下字段 → 回落默认即兼容
    name: cleanName(it?.name),
    hidden: !!it?.hidden,
    locked: !!it?.locked,
  };
}

function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY));
    // 旧存档同样过消毒（补 name/hidden/locked 默认值）
    if (Array.isArray(arr)) { bumpIds(arr); return arr.map(sanitizeItem); }
  } catch { /* 首次/损坏 → 空场 */ }
  return [];
}
let ptimer = null;
function persistNow(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 隐私模式忽略 */ } }
function schedulePersist(get) { clearTimeout(ptimer); ptimer = setTimeout(() => persistNow(get().items), 250); }

// 主选 = 选择集末位（选择集为空 → null）
export const primaryOf = (selection) => (selection.length ? selection[selection.length - 1] : null);
// 撤回恢复时选择集按存活 id 过滤（快照后物体可能已被删）
const aliveSel = (sel, items) => sel.filter(id => items.some(it => it.id === id));

// ---- 撤回栈 ----
const HIST_MAX = 100;
let coalesceKey = null, coalesceTime = 0;
const snap = (get) => ({ items: structuredClone(get().items), selection: [...get().selection] });

export const usePhotoStore = create((set, get) => ({
  items: load(),
  selection: [],         // 选中 id 数组（有序，末位=主选）
  mode: 'fly',           // 'fly'（自由飞行取景）| 'arrange'（释放鼠标摆放/拖坐标轴）
  gizmo: 'translate',
  space: 'world',
  uiHidden: false,
  capturing: false,
  postFx: true,
  hideOverhead: false,
  snap: false,           // X 网格吸附（作用于 TransformControls；多选时吸附作用于 pivot）
  marquee: null,         // 框选矩形 {x1,y1,x2,y2}（屏幕 px；纯瞬态——不入历史不落盘，PhotoStudio 画 overlay）
  help: true,
  preset: null,          // 机位请求 {name, nonce}，FlyRig 消费
  camRestore: null,      // 导入时回灌相机 {pose, nonce}，FlyRig 消费
  past: [], future: [],  // 撤回/重做快照栈（只含 items+selection）
  toast: null,           // 短暂提示 {text, err, nonce}

  // 变更前把当前状态压入撤回栈；同 key 且 700ms 内 = 合并成一步（连续数值输入算一次撤回）。
  pushHistory(key = null) {
    const now = Date.now();
    if (key && key === coalesceKey && now - coalesceTime < 700) { coalesceTime = now; return; }
    const past = [...get().past, snap(get)];
    if (past.length > HIST_MAX) past.shift();
    set({ past, future: [] });
    coalesceKey = key; coalesceTime = now;
  },
  undo() {
    const past = get().past; if (!past.length) return;
    const prev = past[past.length - 1];
    coalesceKey = null;
    set({ items: prev.items, selection: aliveSel(prev.selection, prev.items), past: past.slice(0, -1), future: [...get().future, snap(get)] });
    persistNow(get().items);
  },
  redo() {
    const future = get().future; if (!future.length) return;
    const next = future[future.length - 1];
    coalesceKey = null;
    set({ items: next.items, selection: aliveSel(next.selection, next.items), future: future.slice(0, -1), past: [...get().past, snap(get)] });
    persistNow(get().items);
  },

  addItem(kind, props = {}) {
    get().pushHistory();
    const id = freshId();
    const seed = (get().items.length * 1.7 + 0.3) % 6.28;
    const item = {
      id, kind, props: { ...DEFAULTS[kind], ...props },
      pos: spawnPos(kind), rot: [0, 0, 0], scale: [1, 1, 1], seed,
      name: '', hidden: false, locked: false,
    };
    const items = [...get().items, item];
    set({ items, selection: [id], mode: 'arrange' });
    persistNow(items);
  },

  // ---- 选择 API（§2.1 选择模型；纯选择变更不进撤回历史，与现状一致） ----
  // 点选=单选；select(null)=清空
  select(id) { set({ selection: id ? [id] : [] }); },
  // Ctrl+点=切换：在选中集内 → 移出；否则追加为主选
  toggleSelect(id) {
    const sel = get().selection;
    set({ selection: sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id] });
  },
  // outliner Shift=范围：主选(锚点)到目标沿 items 顺序整段选中，目标成为新主选
  rangeSelect(id) {
    const { items, selection } = get();
    const bi = items.findIndex(it => it.id === id);
    if (bi < 0) return;
    const ai = items.findIndex(it => it.id === primaryOf(selection));
    if (ai < 0) { set({ selection: [id] }); return; }
    const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
    const range = items.slice(lo, hi + 1).map(it => it.id);
    if (ai > bi) range.reverse(); // 保持末位=本次点击目标=主选
    set({ selection: range });
  },
  // Ctrl+A：全选可交互物——hidden 不可见、locked 点选/框选/拖拽全跳过，两者都不入选（与视口语义一致）
  selectAll() {
    set({ selection: get().items.filter(it => !it.hidden && !it.locked).map(it => it.id) });
  },
  // 整组替换选择集（框选收尾 / 表面拖拽把被拖物重排成主选用；有序，末位=主选）
  setSelection(ids) { set({ selection: ids }); },

  // 单物变换（Inspector 数值精调）：同物连续输入合并成一次撤回
  setTransform(id, patch) {
    get().pushHistory('xf:' + id);
    const items = get().items.map(it => (it.id === id ? { ...it, ...patch } : it));
    set({ items }); schedulePersist(get);
  },
  // 批量写回（§2.1 pivot 拖拽范式的 store 侧接口）：**从不压历史**——
  // 调用方在拖拽开始（dragging-changed true）处自行 pushHistory() 一次，
  // 拖拽期间高频写回不进中间历史；收尾传 commit=true 立即落盘（期间只节流持久化）。
  // patches = { [id]: {pos?, rot?, scale?} }
  applyTransforms(patches, commit = false) {
    const items = get().items.map(it => {
      const p = patches[it.id];
      if (!p) return it;
      return {
        ...it,
        ...(p.pos ? { pos: p.pos } : {}),
        ...(p.rot ? { rot: p.rot } : {}),
        ...(p.scale ? { scale: p.scale } : {}),
      };
    });
    set({ items });
    if (commit) persistNow(items); else schedulePersist(get);
  },
  setProps(id, patch) {
    get().pushHistory();                // 属性点击=离散一步
    const items = get().items.map(it => (it.id === id ? { ...it, props: { ...it.props, ...patch } } : it));
    set({ items }); persistNow(items);
  },
  // 物性/命名（outliner 的 store 侧接口）：离散一步撤回。
  // 隐藏/锁定即时把该物请出选择集——隐藏物不渲染不进注册表，锁定物不该继续被坐标轴摆布。
  setItemMeta(id, patch) {
    if (!get().items.some(it => it.id === id)) return;
    get().pushHistory();
    const meta = {};
    if ('name' in patch) meta.name = cleanName(patch.name);
    if ('hidden' in patch) meta.hidden = !!patch.hidden;
    if ('locked' in patch) meta.locked = !!patch.locked;
    const items = get().items.map(it => (it.id === id ? { ...it, ...meta } : it));
    const selection = (meta.hidden || meta.locked) ? get().selection.filter(s => s !== id) : get().selection;
    set({ items, selection }); persistNow(items);
  },
  // 多删：整个选择集
  removeSelected() {
    const { items, selection } = get();
    if (!selection.length) return;
    get().pushHistory();
    const next = items.filter(it => !selection.includes(it.id));
    set({ items: next, selection: [] }); persistNow(next);
  },
  // 多复制：按选择集顺序深拷贝（structuredClone——props 是嵌套对象，浅拷贝会共享引用），
  // 整组偏移 +0.4/+0.4，副本成为新选择集（主选=原主选的副本）
  duplicateSelected() {
    const { items, selection } = get();
    const srcs = selection.map(id => items.find(it => it.id === id)).filter(Boolean);
    if (!srcs.length) return;
    get().pushHistory();
    const clones = srcs.map(src => {
      const c = structuredClone(src);
      c.id = freshId();
      c.pos = [src.pos[0] + 0.4, src.pos[1], src.pos[2] + 0.4];
      return c;
    });
    const next = [...items, ...clones];
    set({ items: next, selection: clones.map(c => c.id) }); persistNow(next);
  },
  clearAll() { get().pushHistory(); set({ items: [], selection: [] }); persistNow([]); },

  // ---- 场景文件存取 ----
  serialize() {
    return { app: 'fate-photo', version: 1, items: get().items, hideOverhead: get().hideOverhead, postFx: get().postFx, camera: { ...liveCamera } };
  },
  importScene(data) {
    if (!Array.isArray(data?.items)) { get().showToast('导入失败：不是有效的场景文件', true); return false; }
    bumpIds(data.items); // 先推 id 计数器再消毒（见 bumpIds 注释）
    const items = data.items.map(sanitizeItem);
    coalesceKey = null;
    set({
      items, selection: [], past: [], future: [],
      hideOverhead: !!data.hideOverhead, postFx: data.postFx !== false,
      camRestore: data.camera ? { pose: data.camera, nonce: (get().camRestore?.nonce ?? 0) + 1 } : get().camRestore,
    });
    persistNow(items);
    get().showToast(`已导入场景：${items.length} 个物体`);
    return true;
  },
  showToast(text, err = false) { set({ toast: { text, err, nonce: (get().toast?.nonce ?? 0) + 1 } }); },

  toggleSnap() { set({ snap: !get().snap }); },
  setMarquee(m) { set({ marquee: m }); },
  setMode(mode) { set({ mode }); },
  toggleMode() { set({ mode: get().mode === 'fly' ? 'arrange' : 'fly' }); },
  setGizmo(g) { set({ gizmo: g, mode: 'arrange' }); },
  toggleSpace() { set({ space: get().space === 'world' ? 'local' : 'world' }); },
  toggleUi() { set({ uiHidden: !get().uiHidden }); },
  setCapturing(v) { set({ capturing: v }); },
  togglePostFx() { set({ postFx: !get().postFx }); },
  toggleOverhead() { set({ hideOverhead: !get().hideOverhead }); },
  toggleHelp() { set({ help: !get().help }); },
  requestPreset(name) { set({ preset: { name, nonce: (get().preset?.nonce ?? 0) + 1 } }); },
}));

// 自动化探针（同 __voxlab 先例）：E2E/截图脚本经此驱动摆放与读状态
if (import.meta.env.DEV && typeof window !== 'undefined') window.__photoStore = usePhotoStore;
