// VoxLab 自持状态(zustand)。刻意不依赖 gameStore/settingsStore 的游戏态——隔离区没有游戏,
// 只有:指针锁、准心目标、摆放笔刷(角色+导入素材,带旋转/缩放)、摆放物、资产切换开关。
// 持久化(persist.js):导入素材字节进 IndexedDB、场景(摆放物/开关)进 localStorage——刷新不丢。
// 准心逐帧坐标走 aimLive(模块 ref,不进 store)——store 只存"类型变化",避免每帧重渲染 HUD。
import { create } from 'zustand';
import { idbPutImport, idbDeleteImport, idbAllImports, saveScene, loadScene } from './persist';

// 逐帧准心明细(LabRig 每帧写,虚影/点击路由读;不触发 React 渲染)
// {kind:'floor', surface:'floor'|'table'|'beam'|'ceiling', x, y, z} | {kind:'char', id} | null
export const aimLive = { current: null };
// 虚影的原始高度(世界 u,未乘缩放;天花板悬挂吸附用)——虚影组件加载后回填
export const ghostLive = { rawHeight: 2.0 };

export const LAB_ROLES = ['landlord', 'capitalist', 'farmer', 'investor', 'glutton', 'prosecutor', 'none'];

// 可切换资产注册表:key → 两套渲染(体素↔现有)。props 素材批次(附录 C)逐个追加。
export const SWAP_KEYS = ['chandelier', 'table', 'chairs', 'room', 'fireplace', 'barrels', 'decor', 'players'];

let charSeq = 0;
let importSeq = 0;

// 场景存盘只留可重建字段(hx/hy 是加载后回填的运行时值,存了也会被覆盖)
const sceneOf = (s) => ({
  chars: s.chars.map(({ id, kind, role, importKey, name, x, y, z, ry, scale }) =>
    ({ id, kind, role, importKey, name, x, y, z, ry, scale })),
  swaps: s.swaps,
});

export const useLabStore = create((set, get) => ({
  locked: false,
  setLocked: (v) => set({ locked: v }),
  aimKind: null,                          // 'floor' | 'char' | null(HUD 准心张开用)
  setAimKind: (k) => { if (get().aimKind !== k) set({ aimKind: k }); },

  // ---- 摆放笔刷:6 角色 + 已导入素材(R 循环);Q/E 旋转、滚轮缩放,虚影实时预览 ----
  brush: 'landlord',                      // LAB_ROLES 之一,或 imports[].key
  imports: [],                            // {key, name, url}(url=ObjectURL,启动时从 IndexedDB 重建)
  ghostRot: 0,                            // 相对"面向摆放者"的偏航偏移
  ghostScale: 1,
  rotGhost: (d) => set((s) => ({ ghostRot: s.ghostRot + d })),
  scaleGhost: (f) => set((s) => ({ ghostScale: Math.min(5, Math.max(0.2, s.ghostScale * f)) })),
  cycleBrush: (dir = 1) => set((s) => {
    const list = [...LAB_ROLES, ...s.imports.map(m => m.key)];
    const i = Math.max(0, list.indexOf(s.brush));
    return { brush: list[(i + dir + list.length) % list.length] };
  }),
  // 导入 .vox:字节存 IndexedDB(持久),ObjectURL 走与内置资产同一条 loadVox 管线;导入即设为当前笔刷
  addImport: (name, bytes) => {
    const key = `vox${importSeq++}`;
    const url = URL.createObjectURL(new Blob([bytes]));
    idbPutImport({ key, name, bytes });
    set((s) => ({ imports: [...s.imports, { key, name, url }], brush: key }));
  },
  removeImport: (key) => {
    idbDeleteImport(key);
    set((s) => {
      const imp = s.imports.find(m => m.key === key);
      if (imp) URL.revokeObjectURL(imp.url);
      return {
        imports: s.imports.filter(m => m.key !== key),
        chars: s.chars.filter(c => c.importKey !== key),   // 摆出去的实例一并撤
        brush: s.brush === key ? 'landlord' : s.brush,
      };
    });
  },

  // ---- 摆放物 ----
  // {id, kind:'role'|'vox', role?|importKey?/name?, x, y(底部锚点), z, ry, scale, hx, hy(未乘缩放)}
  chars: [],
  placeBrush: (x, y, z, ry) => set((s) => {
    const imp = s.imports.find(m => m.key === s.brush);
    const item = imp
      ? { id: `c${charSeq++}`, kind: 'vox', importKey: imp.key, name: imp.name, x, y, z, ry, scale: s.ghostScale, hx: 0.6, hy: 2.2 }
      : { id: `c${charSeq++}`, kind: 'role', role: s.brush, x, y, z, ry, scale: s.ghostScale, hx: 0.45, hy: 2.15 };
    return { chars: [...s.chars, item] };
  }),
  // 体素素材加载完成后按真实包围盒收准心命中范围(VoxModel onLoaded 回填)
  setCharExtent: (id, hx, hy) => set((s) => ({
    chars: s.chars.map(c => (c.id === id ? { ...c, hx, hy } : c)),
  })),
  removeChar: (id) => set((s) => ({ chars: s.chars.filter(c => c.id !== id) })),
  clearChars: () => set({ chars: [] }),

  // true=体素资产,false=现有资产
  swaps: { chandelier: true, table: true, chairs: true, room: true, fireplace: true, barrels: true, decor: true, players: true },
  toggleSwap: (key) => set((s) => ({ swaps: { ...s.swaps, [key]: !s.swaps[key] } })),

  help: true,
  toggleHelp: () => set((s) => ({ help: !s.help })),
}));

// 当前笔刷对应的导入素材(HUD/虚影用;null=角色笔刷)
export const brushImport = (s) => s.imports.find(m => m.key === s.brush) ?? null;

// 摆放的最终变换(虚影与点击落子共用同一公式——虚影所见即所得):
// 朝向 = 面向摆放者 + Q/E 偏移;y = 表面点(天花板为顶部吸附,按虚影原始高度×缩放下移)
export function placeTransform(camera, aim, st) {
  const ry = Math.atan2(camera.position.x - aim.x, camera.position.z - aim.z) + st.ghostRot;
  const y = aim.surface === 'ceiling' ? aim.y - ghostLive.rawHeight * st.ghostScale : aim.y;
  return { x: aim.x, y, z: aim.z, ry };
}

// ---- 启动水合(VoxLab 挂载时调用一次):IndexedDB 素材 → localStorage 场景 ----
export async function hydrateLab() {
  const rows = await idbAllImports();
  const imports = rows.map(r => ({ key: r.key, name: r.name, url: URL.createObjectURL(new Blob([r.bytes])) }));
  for (const m of imports) {
    const n = parseInt(m.key.slice(3), 10);
    if (Number.isFinite(n) && n >= importSeq) importSeq = n + 1;
  }
  const scene = loadScene();
  const chars = (scene.chars ?? [])
    .filter(c => c.kind !== 'vox' || imports.some(m => m.key === c.importKey))   // 素材已删的实例丢弃
    .map(c => ({
      scale: 1, y: 0, ...c,
      hx: c.kind === 'vox' ? 0.6 : 0.45,
      hy: c.kind === 'vox' ? 2.2 : 2.15,
    }));
  for (const c of chars) {
    const n = parseInt(String(c.id).slice(1), 10);
    if (Number.isFinite(n) && n >= charSeq) charSeq = n + 1;
  }
  useLabStore.setState((s) => ({ imports, chars, swaps: { ...s.swaps, ...scene.swaps } }));
  // 之后每次场景变化(摆放/删除/开关)落盘,300ms 去抖
  let timer = null;
  useLabStore.subscribe((s, prev) => {
    if (s.chars === prev.chars && s.swaps === prev.swaps) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveScene(sceneOf(useLabStore.getState())), 300);
  });
}
