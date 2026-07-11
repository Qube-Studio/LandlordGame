// 游戏模式注册表（见 docs/GAME_SPEC.md §1）。
// 每个模式是一个描述符；将来经典/竞技通过 hooks 扩展回合流程与结算，
// 快速模式全部使用 Room.js 的默认实现。

import { MODE_TEXT } from '../text.js';

export const MODES = {
  quick: {
    id: 'quick',
    label: MODE_TEXT.quick.label,
    available: true,
    roles: ['landlord', 'farmer'],
    description: MODE_TEXT.quick.description,
    // hooks 预留：onRoundStart(room)、extraPhases、settleOverride(ctx) 等
    hooks: {},
  },
  classic: {
    id: 'classic',
    label: MODE_TEXT.classic.label,
    available: false,
    roles: ['landlord', 'farmer', 'bank'],
    description: MODE_TEXT.classic.description,
    hooks: {},
  },
  competitive: {
    id: 'competitive',
    label: MODE_TEXT.competitive.label,
    available: true,
    // 地主阵营：landlord / capitalist（互斥，恰 1 人）；农民阵营：farmer / investor / glutton / prosecutor（可重复）。
    roles: ['landlord', 'capitalist', 'farmer', 'investor', 'glutton', 'prosecutor'],
    description: MODE_TEXT.competitive.description,
    hooks: {},
  },
  // 单人模式（GAME_SPEC §9）：玩家操控整队 vs 脚本 Boss；队伍化结算（logic/settleSingle.js）。
  // 占位直至可玩（队伍化重构完成前不开放创建房间）；无对质系统；资本家暂不加入。
  single: {
    id: 'single',
    label: MODE_TEXT.single.label,
    available: false,
    roles: ['landlord', 'farmer', 'investor', 'glutton', 'prosecutor', 'ghost', 'lucky'],
    description: MODE_TEXT.single.description,
    hooks: {},
  },
};

export function getMode(id) {
  return MODES[id] ?? null;
}

export function listModes() {
  return Object.values(MODES).map(({ id, label, available, description }) => ({ id, label, available, description }));
}
