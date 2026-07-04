// 结算调整步（§3.8 adjust.source）→ 桌面浮动标签文案（单一真源）。
// 未收录的新机制回落到服务端下发的 label——服务端加新 adjust 步无需改客户端也有可读文案。
export const PAYOUT_LABEL = {
  debtCollect: '补缺口',
  goalPenalty: '罚金',
  wage: '工资',
  mealAllowance: '饭账',
  capitalistPool: '资金池',
  capitalistTax: '税收',
};

export const labelForStep = (step) => PAYOUT_LABEL[step.source] ?? step.label ?? step.source ?? '';
