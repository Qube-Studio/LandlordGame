// Boss 人格脚本（GAME_SPEC §9）：单人模式的敌方不是通用 AI，而是**按卡面人格出注的脚本**。
// 每个人格 = { id, attrsTier, betFrac(state) }——attrsTier 查 config.single.boss.attrs，
// betFrac 返回本回合押注占余额比例（SingleTable 负责夹到合法边界）。
// 新 Boss = 加一个对象；战役关卡将来引用 persona id + 初始资金覆盖。

export const BOSS_PERSONAS = {
  // 稳健收租型：固定押 35%，基准难度。
  steward: {
    id: 'steward',
    attrsTier: 'base',
    betFrac: () => 0.35,
  },
  // 激进梭哈型：余额越少押得越凶（背水一战）。
  gambler: {
    id: 'gambler',
    attrsTier: 'easy',
    betFrac: ({ bossBalance, bossInitial }) => (bossBalance < bossInitial * 0.5 ? 0.6 : 0.45),
  },
  // 铁公鸡型：小注磨（难度全靠高盘剥的 hard 属性）。
  miser: {
    id: 'miser',
    attrsTier: 'hard',
    betFrac: () => 0.2,
  },
};

export function getPersona(id) {
  return BOSS_PERSONAS[id] ?? BOSS_PERSONAS.steward;
}
