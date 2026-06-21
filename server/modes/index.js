// 游戏模式注册表（见 docs/GAME_SPEC.md §1）。
// 每个模式是一个描述符；将来经典/竞技通过 hooks 扩展回合流程与结算，
// 快速模式全部使用 Room.js 的默认实现。

export const MODES = {
  quick: {
    id: 'quick',
    label: '快速模式',
    available: true,
    roles: ['landlord', 'farmer'],
    description: '地主对农民的纯下注对决，破产竞速。',
    // hooks 预留：onRoundStart(room)、extraPhases、settleOverride(ctx) 等
    hooks: {},
  },
  classic: {
    id: 'classic',
    label: '经典模式',
    available: false,
    roles: ['landlord', 'farmer', 'bank'],
    description: '在快速模式基础上加入银行角色：放贷、利息与赦免。（开发中）',
    hooks: {},
  },
  competitive: {
    id: 'competitive',
    label: '竞技模式',
    available: true,
    // 地主阵营：landlord / capitalist（互斥，恰 1 人）；农民阵营：farmer / investor / glutton（可重复）。
    roles: ['landlord', 'capitalist', 'farmer', 'investor', 'glutton'],
    description: '角色技能制：地主/资本家 对阵 基础农民/投资人/暴食者，各有专属技能。',
    hooks: {},
  },
};

export function getMode(id) {
  return MODES[id] ?? null;
}

export function listModes() {
  return Object.values(MODES).map(({ id, label, available, description }) => ({ id, label, available, description }));
}
