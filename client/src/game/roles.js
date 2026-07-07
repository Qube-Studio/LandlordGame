// 角色/阵营（表现层共享）。与服务端 config.js#factionOf 对应（§8）。
// 地主阵营 = {landlord, capitalist}，农民阵营 = {farmer, investor, glutton}。

export const ROLE_LABEL = {
  landlord: '地主', capitalist: '资本家',
  farmer: '农民', investor: '投资人', glutton: '暴食者',
  bank: '银行', none: '未选',
};

// 单字身份章（玩家栏用，替代旧剪影图标）。多为角色名首字，暴食者取「食」而非「暴」。
export const ROLE_GLYPH = {
  landlord: '地', capitalist: '资',
  farmer: '农', investor: '投', glutton: '食',
};

// 角色一句话说明（选角时展示）。
export const ROLE_DESC = {
  landlord: '高风险高回报，有资金目标考核',
  capitalist: '个人押注本金必归还，靠资金池续命、每回合被税',
  farmer: '无主动技能，靠工资滚雪球',
  investor: '下注时投保 n（拖牌入槽），输则免阵营 2n 债务（保费先扣）',
  glutton: '每回合攒饭账（农民胜时扣除），输可重掷硬币（每局 3 次）',
};

// 招募令角色手册（选角墙 RoleWall 悬停展开）：
// intro = 简介段落，段内 **…** 标记高亮（面板里渲染成金黄，其余为白）。
// advanced = 高级信息表 [栏目, 值]，默认折叠、点击「高级信息」展开。
// 注：这里的数值是当前的目标设计值；初始资金/税等仍在挂起批次，未必与 config 同步。
export const ROLE_SHEET = {
  capitalist: {
    intro: [
      '掌握**稳定投资筹码**的精明人，但长期受**税务**困扰。',
      '初始资金由**农民人数**决定。',
      '**特殊能力**：背靠由**农民人数**决定的**担保资金**池，盈利时利润**归入担保金额**，亏损时损失由**担保金额补足**。',
      '**制约**：长期稳定地缴纳**税务**并保持**不破产**。',
    ],
    advanced: [
      ['初始资金', '农民人数 × 5'],
      ['担保资金', '农民人数 × 15'],
      ['贪婪', '1.5'],
      ['盘剥', '3'],
      ['抽成', '40%'],
    ],
  },
  landlord: {
    intro: [
      '拥有**巨量资金**的个人富商，需要保持**经济增长**来**规避**地方征收。',
      '初始资金由**农民总资金**决定。',
      '**制约**：上方发放基于**目前资金**的**目标**。若未达成则需支付**罚款**并**分给农民**，作为“社会公平”的一部分。',
    ],
    advanced: [
      ['初始资金', '农民总资金 × 2'],
      ['目标倍率', '110%'],
      ['罚款', '10%'],
      ['贪婪', '2'],
      ['盘剥', '1.5'],
      ['抽成', '80%'],
    ],
  },
  farmer: {
    intro: [
      '基础角色，拥有**稳定收入**，受**团队规模**影响。',
      '初始资金：15。',
      '**特殊能力**：每 **5** 回合获得 **1** 工资。',
      '团队人数、农民人数增长时，获取工资效率提升。',
    ],
    advanced: [
      ['团队人数 +1', '获取工资所需回合 −1（最多 −3）'],
      ['农民人数 +1', '单次获取工资 +1'],
    ],
  },
  glutton: {
    intro: [
      '难以控制自己的欲望，然而这样的人有时受到**不寻常的包容**。',
      '初始资金：6。',
      '**特殊能力**：硬币**正面朝上**时可申请一次重掷。',
      '**制约**：不断积累伙食费，只在硬币**反面朝上**时支付。',
    ],
    advanced: [
      ['单局最多重掷申请数', '农民人数'],
      ['每回合最多申请数', '1'],
      ['每回合伙食费', '1'],
    ],
  },
  investor: {
    intro: [
      '**风险厌恶者**，总是最小化自己的损失。',
      '初始资金：12。',
      '**特殊能力**：可通过**提前投保**在需要额外赔偿时免除一定的**债务**。保金**不会返还**。',
    ],
    advanced: [
      ['投保金额上限', '农民人数 × 3'],
    ],
  },
};

const FACTION = { landlord: 'landlord', capitalist: 'landlord', farmer: 'farmer', investor: 'farmer', glutton: 'farmer' };
export const factionOf = (role) => FACTION[role] ?? null;
export const isLandlordSide = (role) => factionOf(role) === 'landlord';
export const isFarmerSide = (role) => factionOf(role) === 'farmer';

// 竞技模式的两侧可选角色（LOBBY 选角用）。
export const LANDLORD_SIDE_ROLES = ['landlord', 'capitalist'];
export const FARMER_SIDE_ROLES = ['farmer', 'investor', 'glutton'];
