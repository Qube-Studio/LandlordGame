// VoxLab 自持状态(zustand)。刻意不依赖 gameStore/settingsStore 的游戏态——隔离区没有游戏,
// 只有:指针锁、准心目标类型、摆放的人物、资产「现有↔体素」切换开关。
// 准心的逐帧精确坐标走 aimLive(模块 ref,不进 store)——store 只存"类型变化",避免每帧重渲染 HUD。
import { create } from 'zustand';

// 逐帧准心明细(LabRig 每帧写,PlaceMarker/点击路由读;不触发 React 渲染)
export const aimLive = { current: null }; // {kind:'floor',x,z} | {kind:'char',id} | null

export const LAB_ROLES = ['landlord', 'capitalist', 'farmer', 'investor', 'glutton', 'prosecutor', 'none'];

// 可切换资产注册表:key → 两套渲染。目前一项(吊灯);后续体素资产逐个追加。
export const SWAP_KEYS = ['chandelier'];

let charSeq = 0;

export const useLabStore = create((set, get) => ({
  locked: false,
  setLocked: (v) => set({ locked: v }),
  aimKind: null,                          // 'floor' | 'char' | null(HUD 准心张开用)
  setAimKind: (k) => { if (get().aimKind !== k) set({ aimKind: k }); },

  role: 'landlord',
  cycleRole: (dir = 1) => set((s) => ({
    role: LAB_ROLES[(LAB_ROLES.indexOf(s.role) + dir + LAB_ROLES.length) % LAB_ROLES.length],
  })),

  chars: [],                              // {id, role, x, z, ry}
  placeChar: (x, z, ry) => set((s) => ({
    chars: [...s.chars, { id: `c${charSeq++}`, role: s.role, x, z, ry }],
  })),
  removeChar: (id) => set((s) => ({ chars: s.chars.filter(c => c.id !== id) })),
  clearChars: () => set({ chars: [] }),

  swaps: { chandelier: true },            // true=体素资产,false=现有资产
  toggleSwap: (key) => set((s) => ({ swaps: { ...s.swaps, [key]: !s.swaps[key] } })),

  help: true,
  toggleHelp: () => set((s) => ({ help: !s.help })),
}));
