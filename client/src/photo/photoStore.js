// 拍照棚状态（zustand）：摆放物列表 + 选中/机位/操作模式 + 撤回栈 + 场景文件存取 + 落盘持久化。
// 摆放物 = { id, kind:'note'|'char'|'coin', props, pos[3], rot[3](弧度), scale[3], seed }。
// 变换(pos/rot/scale)在拖拽/数值编辑时高频更新——落盘节流 250ms、撤回按 key+时间窗合并成一步。
import { create } from 'zustand';

const KEY = 'fate.photo.scene.v1';
let idc = 1;
const freshId = () => `it${idc++}`;
// 导入/载入后把 id 计数器推过已有最大值，防新物体撞 id
const bumpIds = (items) => { for (const it of items) { const n = Number(String(it.id).replace(/\D/g, '')); if (n >= idc) idc = n + 1; } };

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

// 摆放物消毒（导入时把外来数据兜底成合法形状，坏字段回落默认，不整段拒绝）
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
  };
}

function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(arr)) { bumpIds(arr); return arr; }
  } catch { /* 首次/损坏 → 空场 */ }
  return [];
}
let ptimer = null;
function persistNow(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 隐私模式忽略 */ } }
function schedulePersist(get) { clearTimeout(ptimer); ptimer = setTimeout(() => persistNow(get().items), 250); }

// ---- 撤回栈 ----
const HIST_MAX = 100;
let coalesceKey = null, coalesceTime = 0;
const snap = (get) => ({ items: JSON.parse(JSON.stringify(get().items)), selectedId: get().selectedId });

export const usePhotoStore = create((set, get) => ({
  items: load(),
  selectedId: null,
  mode: 'fly',           // 'fly'（自由飞行取景）| 'arrange'（释放鼠标摆放/拖坐标轴）
  gizmo: 'translate',
  space: 'world',
  uiHidden: false,
  capturing: false,
  postFx: true,
  hideOverhead: false,
  help: true,
  preset: null,          // 机位请求 {name, nonce}，FlyRig 消费
  camRestore: null,      // 导入时回灌相机 {pose, nonce}，FlyRig 消费
  past: [], future: [],  // 撤回/重做快照栈（只含 items+selectedId）
  toast: null,           // 短暂提示 {text, err, nonce}

  // 变更前把当前状态压入撤回栈；同 key 且 700ms 内 = 合并成一步（连续拖拽/输入算一次撤回）。
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
    set({ items: prev.items, selectedId: prev.items.find(i => i.id === prev.selectedId) ? prev.selectedId : null, past: past.slice(0, -1), future: [...get().future, snap(get)] });
    persistNow(get().items);
  },
  redo() {
    const future = get().future; if (!future.length) return;
    const next = future[future.length - 1];
    coalesceKey = null;
    set({ items: next.items, selectedId: next.items.find(i => i.id === next.selectedId) ? next.selectedId : null, future: future.slice(0, -1), past: [...get().past, snap(get)] });
    persistNow(get().items);
  },

  addItem(kind, props = {}) {
    get().pushHistory();
    const id = freshId();
    const seed = (get().items.length * 1.7 + 0.3) % 6.28;
    const item = { id, kind, props: { ...DEFAULTS[kind], ...props }, pos: spawnPos(kind), rot: [0, 0, 0], scale: [1, 1, 1], seed };
    const items = [...get().items, item];
    set({ items, selectedId: id, mode: 'arrange' });
    persistNow(items);
  },
  select(id) { set({ selectedId: id }); },
  setTransform(id, patch) {
    get().pushHistory('xf:' + id);      // 连续拖拽/数值编辑合并成一次撤回
    const items = get().items.map(it => (it.id === id ? { ...it, ...patch } : it));
    set({ items }); schedulePersist(get);
  },
  setProps(id, patch) {
    get().pushHistory();                // 属性点击=离散一步
    const items = get().items.map(it => (it.id === id ? { ...it, props: { ...it.props, ...patch } } : it));
    set({ items }); persistNow(items);
  },
  removeSelected() {
    const s = get().selectedId; if (!s) return;
    get().pushHistory();
    const items = get().items.filter(it => it.id !== s);
    set({ items, selectedId: null }); persistNow(items);
  },
  duplicateSelected() {
    const src = get().items.find(it => it.id === get().selectedId); if (!src) return;
    get().pushHistory();
    const id = freshId();
    const item = { ...src, id, pos: [src.pos[0] + 0.4, src.pos[1], src.pos[2] + 0.4] };
    const items = [...get().items, item];
    set({ items, selectedId: id }); persistNow(items);
  },
  clearAll() { get().pushHistory(); set({ items: [], selectedId: null }); persistNow([]); },

  // ---- 场景文件存取 ----
  serialize() {
    return { app: 'fate-photo', version: 1, items: get().items, hideOverhead: get().hideOverhead, postFx: get().postFx, camera: { ...liveCamera } };
  },
  importScene(data) {
    if (!Array.isArray(data?.items)) { get().showToast('导入失败：不是有效的场景文件', true); return false; }
    const items = data.items.map(sanitizeItem);
    bumpIds(items);
    coalesceKey = null;
    set({
      items, selectedId: null, past: [], future: [],
      hideOverhead: !!data.hideOverhead, postFx: data.postFx !== false,
      camRestore: data.camera ? { pose: data.camera, nonce: (get().camRestore?.nonce ?? 0) + 1 } : get().camRestore,
    });
    persistNow(items);
    get().showToast(`已导入场景：${items.length} 个物体`);
    return true;
  },
  showToast(text, err = false) { set({ toast: { text, err, nonce: (get().toast?.nonce ?? 0) + 1 } }); },

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
