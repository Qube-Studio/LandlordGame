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

// 招募令结构化说明（选角墙 RoleWall 用）：每行 = [栏目, 内容]。
// competitiveLines 仅竞技模式追加（快速模式的农民没有工资，不能乱许诺）。
export const ROLE_SHEET = {
  landlord: {
    tagline: '以一敌众的庄家',
    lines: [['头寸', '开局资金约为农民总和'], ['考核', '定期资金目标,未达受罚'], ['胜负', '熬到农民全部破产']],
  },
  capitalist: {
    tagline: '真身藏在资金池里',
    lines: [['被动', '押注本金必定归还'], ['代价', '盈亏入资金池,每回合缴税'], ['胜负', '资金池耗尽即破产']],
  },
  farmer: {
    tagline: '人多势众,同舟共济',
    lines: [['同伴', '与农民阵营共进退'], ['协商', '分账时可与同伴互转钱与债'], ['胜负', '地主破产即翻身']],
    competitiveLines: [['被动', '定期领取基础工资']],
  },
  investor: {
    tagline: '风险对冲的行家',
    lines: [['主动', '下注时投保 n(拖牌入槽)'], ['生效', '阵营输时免除 2n 债务'], ['代价', '保费预先扣除']],
  },
  glutton: {
    tagline: '能吃是福,吃完再赌',
    lines: [['被动', '每回合累积饭账,胜时结清'], ['主动', '输了可重掷硬币(每局 3 次)'], ['风险', '饭账能把人吃到破产']],
  },
};

const FACTION = { landlord: 'landlord', capitalist: 'landlord', farmer: 'farmer', investor: 'farmer', glutton: 'farmer' };
export const factionOf = (role) => FACTION[role] ?? null;
export const isLandlordSide = (role) => factionOf(role) === 'landlord';
export const isFarmerSide = (role) => factionOf(role) === 'farmer';

// 竞技模式的两侧可选角色（LOBBY 选角用）。
export const LANDLORD_SIDE_ROLES = ['landlord', 'capitalist'];
export const FARMER_SIDE_ROLES = ['farmer', 'investor', 'glutton'];
