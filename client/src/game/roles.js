// 角色/阵营（表现层共享）。与服务端 config.js#factionOf 对应（§8）。
// 地主阵营 = {landlord, capitalist}，农民阵营 = {farmer, investor, glutton}。

export const ROLE_LABEL = {
  landlord: '地主', capitalist: '资本家',
  farmer: '农民', investor: '投资人', glutton: '暴食者',
  bank: '银行', none: '未选',
};

// 角色一句话说明（选角时展示）。
export const ROLE_DESC = {
  landlord: '高风险高回报，有资金目标考核',
  capitalist: '个人押注本金必归还，靠资金池续命、每回合被税',
  farmer: '无主动技能，靠工资滚雪球',
  investor: '下注时投保 n（拖牌入槽），输则免阵营 2n 债务（保费先扣）',
  glutton: '每回合攒饭账（农民胜时扣除），输可重掷硬币（每局 3 次）',
};

const FACTION = { landlord: 'landlord', capitalist: 'landlord', farmer: 'farmer', investor: 'farmer', glutton: 'farmer' };
export const factionOf = (role) => FACTION[role] ?? null;
export const isLandlordSide = (role) => factionOf(role) === 'landlord';
export const isFarmerSide = (role) => factionOf(role) === 'farmer';

// 竞技模式的两侧可选角色（LOBBY 选角用）。
export const LANDLORD_SIDE_ROLES = ['landlord', 'capitalist'];
export const FARMER_SIDE_ROLES = ['farmer', 'investor', 'glutton'];
