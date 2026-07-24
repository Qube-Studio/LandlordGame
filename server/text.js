// ============================================================================
// 服务端玩家可见文案（唯一真源）
// ----------------------------------------------------------------------------
// 这里的每一句都会下发到客户端展示：错误提示（{error:…} → toast）、系统聊天播报
// （_systemChat）、结算 adjust 步骤的 label、角色名、模式名/描述。改文案只改这里。
// ⚠ 标注「测试断言」的条目被 server/test/payout.test.mjs 逐字断言——改动请连测试一起改。
// 本地化注意：服务端文案是按房间广播的（无 per-viewer 语言概念）；将来要做多语言，
// 需改为下发 key+参数、客户端查表渲染（协议改动，另行设计），当前先集中可编辑。
// ============================================================================

// ---- 角色名（系统播报/传唤播报用）----
export const ROLE_LABEL = {
  landlord: '地主', capitalist: '资本家',
  farmer: '农民', investor: '投资人', glutton: '暴食者', prosecutor: '检察官', bank: '银行',
};

// ---- 错误提示（{ error: ERR.xxx }）----
export const ERR = {
  // 进出房间 / 大厅
  joinStarted: '游戏已开始，无法加入',
  roomFull: '房间已满',
  notInRoom: '不在房间中',
  roleOnlyLobby: '只能在大厅阶段选择角色',
  roleNotInMode: '该模式不支持此角色',
  bankNotOpen: '银行角色尚未开放',
  invalidRole: '无效角色',
  landlordTaken: '地主阵营已有玩家（地主/资本家互斥）',
  farmersFull: '农民人数已满',
  gameInProgress: '游戏已在进行中',
  hostOnlyStart: '只有房主可以开始游戏',
  someoneNoRole: '还有玩家未选择角色',
  someoneNotReady: '还有玩家未准备',
  needOneLandlord: '需要恰好 1 名地主阵营玩家（地主或资本家）',
  needFarmers: (n) => `至少需要 ${n} 名农民`,
  tooManyFarmers: (n) => `农民最多 ${n} 名`,
  gameNotEnded: '游戏尚未结束',
  hostOnlyRestart: '只有房主可以重新开始',
  // 测试辅助
  devFillLobbyOnly: '只能在大厅补充测试玩家',
  devExecInGameOnly: '只能在对局中强制处决窗',
  devExecutionDisabled: '请先在本地设置中开启处决测试，再新建房间',
  possessNoTarget: '目标玩家不存在',
  testModeOff: '测试模式未开启',
  // 准备 / 表情
  badEmote: '不支持的表情',
  notDiscussion: '当前不是准备阶段',
  spectatorNoReady: '观战者无需准备',
  lobbyReadyOnly: '只能在大厅准备',
  pickRoleFirst: '先选择角色再准备',
  // 下注
  notBetting: '当前不是下注阶段',
  spectatorNoBet: '观战者不能下注',
  alreadyBet: '已经下过注了',
  // 传唤（§8.9）
  summonCompetitiveOnly: '仅竞技模式可传唤',                       // ⚠ 测试断言
  summonBettingOnly: '只能在下注阶段传唤',
  summonProsecutorOnly: '只有检察官可以传唤',                       // ⚠ 测试断言
  notInRound: '本回合未参与',
  summonBeforeBet: '请在自己下注前传唤',                            // ⚠ 测试断言
  summonUsed: '本回合已传唤',                                       // ⚠ 测试断言
  summonExists: '本回合已有传唤',
  summonBadTarget: '传唤目标无效',
  summonNoFunds: (cost) => `资金不足（传唤费 ¥${cost}，还需留出下注额）`, // ⚠ 测试断言「资金不足」前缀
  // 对质（§8.8）
  notChallenge: '当前不是对质阶段',
  accuseInProgress: '已有指控进行中',
  accuseFarmersOnly: '只有农民阵营可以指控',
  summonBlocksAccuse: '本回合已传唤，不能再发起对质',               // ⚠ 测试断言
  noTickets: '对质票不足',                                          // ⚠ 测试断言（指控与转赠共用）
  accuseBadTarget: '指控目标无效',
  noActiveAccuse: '你没有进行中的指控',                             // ⚠ 测试断言
  badAccuseDir: '无效的指控方向',                                   // ⚠ 测试断言
  skipBlocked: '指控进行中，无法跳过',
  skipFarmersOnly: '只有农民阵营可以跳过',
  // 重掷 / 揭牌
  notReflip: '当前不是重掷阶段',
  gluttonOnly: '只有暴食者可以操作',
  gluttonOnlyReflip: '只有暴食者可以重掷',
  notInRoundReflip: '本回合未参与，不能重掷',
  reflipExhausted: '重掷次数已用尽',
  notReveal: '当前不是揭牌阶段',
  spectatorNoConfirm: '观战者无需确认',
  // 协商
  notNegotiate: '当前不是协商阶段',
  transferNotPositive: '转移金额必须是正整数',
  transferSelf: '不能转给自己',
  transferRoundFarmersOnly: '只能在本回合参与的农民之间转移',
  transferInsufficient: '可转移的数额不足',
  ticketNotPositive: '转赠张数必须是正整数',
  ticketRoundFarmersOnly: '只能在本回合参与的农民之间转赠',
  ticketFarmersOnly: '只有农民阵营之间可以转赠对质票',
  confirmRoundFarmersOnly: '只有本回合参与的农民可以确认',
  // 拿取（§3.8）
  notTakePhase: '当前不是拿取阶段',
  nothingToTake: '没有可拿取的钱',                                  // ⚠ 测试断言
  alreadyTaken: '已经拿过了',                                       // ⚠ 测试断言
  // 处决窗（§3.9）
  notExecution: '当前不是处决阶段',
  notExecutioner: '你不是行刑者',
  pardonCantAfford: (cost) => `资金不足，无法赦免（需赔偿 ¥${cost}）`, // ⚠ 测试断言
  // 聊天
  chatInvalid: '消息无效',
  chatTooFast: '发言太快了，稍等片刻',
  chatSpectateOnly: '只有观战者可以使用观战频道',
  chatNoChannel: '频道不存在',
  chatFarmersOnly: '只有农民阵营可以使用农民频道',
  // 连接 / 鉴权 / 分发（index.js / auth.js）
  authExpired: '未登录或登录已过期',
  dupLogin: '账号在其他位置登录',
  unknownMode: '未知的游戏模式',
  modeUnavailable: (label) => `${label}尚未开放`,
  notLoggedIn: '未登录',
  roomNotFound: '房间不存在',
  noRoomJoined: '未加入房间',
  voiceNotImplemented: '语音功能尚未开放',
  unknownMsgType: (type) => `未知消息类型: ${type}`,
  usernameLen: '用户名需为 1-16 个字符',
  passwordLen: '密码至少 4 位',
  usernameTaken: '用户名已被注册',
  badCredentials: '用户名或密码错误',
  // 下注校验（logic/rules.js validateBet → placeBet 直达客户端）
  betNotPositive: '下注必须是正整数',
  betForceAllIn: (balance) => `资金不足，只能全押 ${balance}`,
  betBelowMin: (min) => `下注不能低于最小出资额 ${min}`,
  betKeepMinStake: (minStake) => `必须留下最小出资额 ${minStake}`,
};

// ---- 系统聊天播报（_systemChat）----
export const SYS = {
  challengeSkipped: '本回合无农民能发起对质（票不足/已传唤），跳过对质窗',
  betTimeout: (names) => `${names} 超时未下注，自动押上最小注`,
  summon: (name, cost, target, roleLabel) =>
    `${name} 花 ¥${cost} 传唤 ${target}（${roleLabel}）——本回合强制双倍结算，罚款上缴国库`,
  accuse: (name, cost, target, roleLabel) =>
    `${name} 花 ${cost} 票发起对质，指向 ${target}（${roleLabel}）`,
  accuseHit: (target) => `对质命中！${target} 将被强制结算一次制约`,
  accuseMiss: (name) => `对质落空，${name} 未能命中`,
  accuseCancel: '指控取消，虚惊一场',
  bankrupt: (name, roleLabel) => `${name}（${roleLabel}）已破产`,
  // 处决窗（§3.9）
  executionStart: (judge, jRole, target, tRole) =>
    `${target}（${tRole}）破产伏地——${judge}（${jRole}）拿起左轮，处决还是赦免？`,
  executed: (judge, target) => `${judge} 扣下扳机——${target} 被处决出局`,
  pardoned: (judge, target, cost) => `${judge} 对空鸣枪赦免了 ${target}，自掏 ¥${cost} 补偿其本回合损失`,
  executionTimeout: (judge) => `${judge} 迟迟未决——默认处决`,
  executionNoEnemy: (target) => `${target} 的敌对阵营已无活人行刑——维持出局`,
};

// ---- 结算 adjust 步骤 label（客户端 payoutSteps 未收录的 source 直接展示这些）----
export const STEP_LABEL = {
  debtCollect: '补偿地主',
  summonPenalty: '传唤双倍罚款上缴国库',
  goalPenalty: '地主未达标罚金',
  poolSurplus: '盈余入池',
  poolCover: '资金池垫付本金',
  summonTax: '传唤双倍税',
  capitalistTax: '税收',
  wage: '发工资',
  mealAllowance: '结饭账',
};

// ---- 模式名/描述（modes/index.js，大厅模式卡展示）----
export const MODE_TEXT = {
  quick: { label: '快速模式', description: '地主对农民的纯下注对决，破产竞速。' },
  classic: { label: '经典模式', description: '在快速模式基础上加入银行角色：放贷、利息与赦免。（开发中）' },
  competitive: { label: '竞技模式', description: '角色技能制：地主/资本家 对阵 基础农民/投资人/暴食者/检察官，各有专属技能。' },
  single: { label: '单人模式', description: '指挥你的整支队伍对抗 Boss：角色搭配与技能耦合，专属角色幽灵/幸运儿。' },
};

// ---- 单人模式（§9）：席位名 / Boss 名 / 会话错误 ----
export const SINGLE = {
  seatName: (roleLabel, idx) => `${roleLabel}·${idx}号`,   // 玩家队席位显示名
  bossName: '老地主',                                       // 单 Boss（先不做人格三选，玩法优先）
  roomName: '单人牌局',
  errNoSession: '没有进行中的单人牌局',
  errBadSeat: '席位无效',
  errBadTeam: '队伍配置无效（1-4 个单人模式角色）',
  errNotSetup: '牌局已开始，不能再改队伍',
  errNotStarted: '牌局尚未开始',
  errBadSlot: '席位槽无效',
  errEmptyTeam: '至少安排一个席位再开局',
};

// ---- 杂项（默认名/兜底词）----
export const MISC = {
  defaultRoomName: '未命名房间',
  devPlayerPrefix: '测试',       // devFill 测试玩家用户名前缀（'测试'+序号）
  landlordFallback: '地主',      // 播报里角色名查不到时的兜底
  enemyFallback: '敌方',
  accuserFallback: '指控者',
  playerFallback: '玩家',
};
