// 结算事件 → 播报文案（单一真源：SettlePanel 即时播报与 LedgerBook 账本共用）。
export const EVENT_TEXT = {
  landlord_win: e => `正面朝上，地主胜！拿走目标 ${e.target}${e.surplus > 0 ? `，盈余 ${e.surplus}（地主再取 ${e.landlordExtra}，农民分 ${e.farmerPool}）` : ''}`,
  landlord_win_shortfall: e => `正面朝上，地主胜！桌面不足目标 ${e.target}，缺口 ${e.shortfall} 由农民补足${e.uncovered > 0 ? `（仍有 ${e.uncovered} 无人能付）` : ''}`,
  farmers_win: e => `反面朝上，农民胜！平分桌面全部 ${e.pot}`,
};
