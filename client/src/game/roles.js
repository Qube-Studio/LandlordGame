// 角色/阵营（表现层共享）。与服务端 config.js#factionOf 对应（§8）。
// 地主阵营 = {landlord, capitalist}，农民阵营 = {farmer, investor, glutton, prosecutor}。

export const ROLE_LABEL = {
  landlord: '地主', capitalist: '资本家',
  farmer: '农民', investor: '投资人', glutton: '暴食者', prosecutor: '检察官',
  bank: '银行', none: '未选',
};

// 单字身份章（玩家栏用，替代旧剪影图标）。多为角色名首字，暴食者取「食」而非「暴」。
export const ROLE_GLYPH = {
  landlord: '地', capitalist: '资',
  farmer: '农', investor: '投', glutton: '食', prosecutor: '检',
};

// 角色一句话说明（选角时展示）。
export const ROLE_DESC = {
  landlord: '高风险高回报，有资金目标考核',
  capitalist: '个人押注本金必归还，靠资金池续命、定期被税',
  farmer: '无主动技能，靠工资滚雪球',
  investor: '下注时投保 n（拖牌入槽），输则免阵营 2n 债务（保费先扣）',
  glutton: '每回合攒饭账（农民胜时扣除），输可重掷硬币（每局次数=农民人数）',
  prosecutor: '玻璃大炮：下注前花钱传唤敌方强制双倍结算（罚款上缴国库），费用 150% 递增',
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
      ['可下注资金', '6×农民数 + 当前池÷10（随池涨跌）'],
      ['担保资金（池）', '农民人数 × 20'],
      ['征税', '每「农民人数」回合，当前池 × 10%'],
      ['贪婪', '1.6'],
      ['盘剥', '6'],
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
      ['对质票', '3（花 2 票指控敌方暗注多/少）'],
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
      ['对质票', '0（技能集中在重掷；可受队友转赠）'],
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
      ['对质票', '2'],
    ],
  },
  prosecutor: {
    intro: [
      '手握**公诉权**的玻璃大炮，靠**传唤**逼出真相。',
      '初始资金：4（阵营最穷，钱都在权力里）。',
      '**特殊能力**：下注前可花钱**传唤**敌方——正式考核**提前开庭**：强制**双倍结算**制约（地主目标罚 / 资本家税），随后重新排期。**免猜、必然开庭**。',
      '**制约**：罚款**上缴国库**（不进农民腰包）；传唤费**每用一次 ×150%**；同回合传唤后不能再发起对质。',
    ],
    advanced: [
      ['传唤费', '农民人数 × 1.5^已传次数（进虚空）'],
      ['结算倍率', '双倍（罚款上缴国库）'],
      ['传唤后', '重定基 + 重新排期（税钟归零）'],
      ['每回合上限', '1 次（且与对质互斥）'],
      ['对质票', '4'],
    ],
  },
};

const FACTION = { landlord: 'landlord', capitalist: 'landlord', farmer: 'farmer', investor: 'farmer', glutton: 'farmer', prosecutor: 'farmer' };
export const factionOf = (role) => FACTION[role] ?? null;
export const isLandlordSide = (role) => factionOf(role) === 'landlord';
export const isFarmerSide = (role) => factionOf(role) === 'farmer';

// 竞技模式的两侧可选角色（LOBBY 选角用）。
export const LANDLORD_SIDE_ROLES = ['landlord', 'capitalist'];
export const FARMER_SIDE_ROLES = ['farmer', 'investor', 'glutton', 'prosecutor'];

// 对质票（§8.8，与服务端 config.competitive.accusation 对应）：每角色**按局**发放，农民阵营专属。
// 猜对敌方暗注「比阵营总注多/少」→ 强制敌方立刻多结算一次制约（地主目标 / 资本家税）。
export const ACCUSE_TICKETS = { farmer: 3, investor: 2, glutton: 0, prosecutor: 4 };
export const ACCUSE_COST = 2;
