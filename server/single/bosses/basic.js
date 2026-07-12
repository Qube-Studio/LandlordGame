// Boss 脚本（GAME_SPEC §9）：单人模式的敌方不是通用 AI，而是**按脚本出注的对手**。
// 现阶段只有一个 Boss（玩法优先，用户裁决 2026-07-12：先不做人格三选）——
// { id, attrsTier, betFrac(state) }：attrsTier 查 config.single.boss.attrs，
// betFrac 返回本回合押注占余额比例（SingleTable 负责夹到合法边界）。
// 将来战役关卡 = 在这里加对象 + 关卡引用 id / 覆盖初始资金。

export const BOSS = {
  id: 'boss',
  attrsTier: 'base',
  betFrac: () => 0.35,
};

export function getPersona() {
  return BOSS;
}
