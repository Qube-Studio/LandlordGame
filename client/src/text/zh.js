// ============================================================================
// 中文文案包（玩家可见文案的唯一真源）
// ----------------------------------------------------------------------------
// 编辑规则：
// - 改文案只改这个文件；业务代码通过 `import { T } from '../text'` 引用键名。
// - 带参数的条目是函数：`T.felt.betPlaced(3)` → 「已下注 ¥3」。改词时保留参数占位。
// - `**…**` 是富文本高亮标记（角色手册/规则面板渲染成金字），要连标记一起改。
// - PixelText 不换行：长句是否折行由容器宽度决定，改长文案后请在画廊里过一眼。
// - 本地化：未来加语言包 = 复制本文件为 en.js 等，在 text/index.js 按 locale 切换。
// - 角色文案（名称/单字章/一句话说明/角色手册）也在本文件（roles 段），
//   game/roles.js 只做再导出，老引用点不用动。
// ============================================================================

// ---- 通用 ----
// 注意：'¥' 只是码位——像素字体把它的字形画成**蜡烛**（glyphs.js CANDLE_ROWS，
// CandleMark 组件同源），全游戏的货币符视觉上都是蜡烛。改文案请保留 ¥ 字符。
const fmt = {
  money: (n) => `¥${n}`,            // 货币格式（2D/3D 钱堆标签、余额、金额处处复用）
  currency: '¥',                    // 裸货币符（右下角资金蜡烛的大字）
};

const common = {
  keySpace: '空格',                  // 2D 面板键帽文字（3D 浮字的空格键帽是图形，不经此处）
  skip: '跳过',
  on: '开',
  off: '关',
  none: '无',
  connecting: '正在连接服务器…',
  noRoleYet: '未选择角色',           // 未选角就按准备时的本地系统提示
};

// ---- 阶段名与提示（左上角阶段章 + hint 备用文案）----
const phase = {
  LOBBY: { label: '准备大厅', hint: '在招募令墙上选择角色（R 呼出/收起），准备/开始按空格' },
  DISCUSSION: { label: '战术讨论', hint: '农民可密谈；短暂喘息后自动进入下注' },
  BETTING: {
    label: '下注中',
    hint3d: '点/拖/横扫捋牌下注，捋起的叠拖回怀里可散回（手牌长按拆分，圈内钱堆长按整堆拿起），空格确认',
    hint2d: '选钱牌组成下注额（长按拆分），空格确认',
  },
  CHALLENGE: {
    label: '对质窗',
    hint3d: '农民可花 2 票指控敌方暗注「比阵营总注多/少」：悬停敌人按 Z 或用下方面板，猜对逼其多结算一次制约',
    hint2d: '农民可花 2 票指控敌方暗注「比阵营总注多/少」，猜对逼其多结算一次制约',
  },
  REVEAL: { label: '揭牌', hint: '各家下注已公开，空格确认后掷硬币' },
  SINGLE_SETUP: { label: '组建队伍', hint: '左下角点席位换角色，开局按钮开打；WASD 可在场里走动' },
  COIN_FLIP: { label: '掷硬币', hint: '正面地主阵营胜，反面农民阵营胜' },
  REFLIP: { label: '重掷决策', hint: '农民输了！暴食者可请求重掷硬币（每局次数=农民人数，每回合限 1 次）' },
  SETTLE: { label: '系统结算', hint: '桌上的钱聚拢成彩池，按规则分成几份送到各家圈里' },
  NEGOTIATE: {
    label: '农民协商',
    hint3d: '拖动圈里的钱牌/红色债务牌到队友圈重新分配（长按拆分），空格确认',
    hint2d: '农民内部重新分配钱与债务（桌面实时跟着变），空格确认',
  },
  FINALIZE: { label: '正式结算', hint: '钱还在桌上——按 F 拿取自己那份才入账（按 L 翻账本）' },
  ENDED: { label: '对局结束' },
};

// ---- 玩家条状态字（PlayerRail 展开详情）----
const status = {
  bankrupt: '破产',
  spectator: '观战',
  offline: '离线',
  ready: '已准备',
  discussing: '讨论中',
  betted: '已下注',
  thinking: '思考中',
  onTrial: '受审',
  noTickets: '票不足',
  skipped: '已跳过',
  accusing: '对质中',
  confirmed: '已确认',
  viewing: '查看中',
  waiting: '等待',
  negotiating: '协商中',
  canReflip: '可重掷',
  noReflip: '无次数',
  taken: '已拿取',
  pendingTake: '待拿取',
};

// ---- 玩家条技能小标（PlayerRail）----
const skill = {
  gluttonMeal: (n) => ` 饭账¥${n}`,
  glutton: (reflips, meal) => `重${reflips}${meal}`,
  pledgeActive: ' 生效',
  pledgeInactive: ' 未生效',
  investor: (pledge, eff) => `保¥${pledge}${eff}`,
  capitalist: (pool) => `池¥${pool}`,
};

// ---- 顶栏 / 横幅 / 玩家栏 ----
const topbar = {
  exitConfirm: '游戏进行中，退出将视为弃局。确定退出？',
  exit: '退出',
};
const banner = {
  round: (n) => `第 ${n} 回合`,
};
const rail = {
  online: '在线',
  offline: '离线',
  noRole: '未选',
  balance: (n) => `¥${n}`,
  balanceHidden: '¥??',
};

// ---- 机制 HUD（左上角制约卡）----
const hud = {
  goal: {
    summonedTag: '被传唤：',
    summonedWarn: '⚠强制双倍结算',
    accusedTag: '被对质：',
    accusedWarn: '⚠强制结算',
    farmerLabel: '地主目标：',
    dueNow: '本回合结算',
    dueIn: (n) => `${n}回合后结算`,
    selfLabel: '目标：',
    spectatorLabel: '地主目标：',
    penalty: '罚款：',
  },
  capitalist: {
    taxNow: '本回合征税：',
    taxIn: (n) => `征税(${n}回合后)：`,
    pool: '担保资金：',
    summonedTag: '被传唤：',
    summonedWarn: '⚠强制双倍税',
    accusedTag: '被对质：',
    accusedWarn: '⚠强制扣税',
  },
  wage: {
    label: '工资：',
    amount: (n) => `+${n}`,
  },
  glutton: {
    meal: '伙食费：',
    reflips: '可重掷：',
    reflipCount: (left, total) => `${left}/${total}`,
    noReflip: '不可重掷',
  },
};

// ---- 全局提示（useGameKeys / useWaitHints）----
const hints = {
  betWaiting: '已下注，等待其他玩家...',
  negotiateWaiting: '等待对方协商...',
};

// ---- 圈上浮字（FeltPrompts，3D 输入模式的主交互文案）----
const felt = {
  countdown: (s) => `还剩 ${s}s`,
  enemyBet: '敌注',
  factionTotal: '己方总注',
  totalMoney: (t) => `¥${t ?? '?'}`,
  confirmAgain: '再点一次确认',
  waitFor: (name, roleLabel) => `等待 ${name}（${roleLabel ?? '?'}）操作`,
  cancelNoRefund: '取消（票不退）',
  readyWithRole: (roleLabel) => `已准备（${roleLabel}）`,
  ready: '准备！',
  changeRole: '改选角色',
  chooseRole: '选择角色',
  startGame: '开始游戏',
  nextRound: '下一回合…',
  betPlaced: (n) => `已下注 ¥${n}`,
  summonBtn: (cost) => `传唤（¥${cost}）`,
  summoned: '已传唤 · 强制双倍结算',
  beingAccused: '你正被指控！',
  accusingYou: '农民正在指控你…',
  factionTotalLine: (t) => `阵营总注 ¥${t ?? '?'}`,
  accuseEnemy: '指控敌方',
  summonedNoAccuse: '已传唤 · 不可对质',
  notEnoughTickets: '对质票不足',
  skippedCount: (k, n) => `已跳过 ${k}/${n}`,
  decidingAccuse: '农民正在决定是否对质你…',
  confirmedCount: (c, a) => `已确认 ${c}/${a}`,
  revealGo: '看清了，掷硬币！',
};

// ---- 3D 手牌（HandLayer，下注操作浮字）----
const hand3d = {
  forceAllIn: (balance) => `资金不足 · 必须全押 ¥${balance}`,
  selected: (total, min, max, premium) =>
    `已选 ¥${total} · 可下注 ${min}-${max}${premium > 0 ? ` · 投保 ¥${premium}` : ''}`,
  betted: '已下注',
  allIn: '全押',
  confirmBet: '确认下注',
  pickHint: '点或拖手牌下注',
  overMax: '超出上限',
  reserve: '保留金',
  pledge: (premium, max) => `投保 ¥${premium}/${max}`,
};

// ---- 3D 结算/协商（PayoutLayer 浮字）----
const payout3d = {
  autoEffect: (s) => `${s}s 后自动生效`,
  confirmed: '已确认',
  confirmedWaiting: '已确认 · 等待其他农民',
  dragHint: '拖钱牌/债务牌/对质票到队友圈',
  dragHintSingle: '拖钱牌/债务牌到队友圈',   // 单人模式无对质票
  undoConfirm: '撤销确认',
  confirmAlloc: '确认分配',
  take: '拿取',
};

// ---- 各阶段底部面板（多数仅 ?input=2d 渲染）----
const lobbyPanel = {
  myRole: (roleLabel) => `我的角色：${roleLabel}（改选 R）`,
  chooseRole: '选择角色 (R)',
  unready: '取消准备',
  ready: '准备',
  start: '开始游戏',
};
const discussionPanel = {
  spectating: '正在观战。',
  nextRound: '下一回合即将开始…',
};
const bettingPanel = {
  spectating: '观战中：等待玩家下注…',
  waiting: '已下注，等待其他玩家…',
};
const revealPanel = {
  confirmed: (c, a) => `已确认 ${c}/${a}`,
  confirmedWaiting: '已确认，等待其他玩家…',
  go: '看清了，掷硬币！',
};
const reflipPanel = {
  farmersLost: '正面朝上，农民阵营输了！',
  waiting: '等待暴食者决定是否重掷…',
  passed: '已放弃重掷，等待其他暴食者…',
  reflip: (left) => `重掷（剩 ${left}）`,
  pass: '不重掷',
  exhausted: '重掷次数已用尽',
  note: '重掷仅消耗 1 次机会，不影响饭账（饭账于农民胜时结清）',
};
const challengePanel = {
  enemyFallback: '敌方',
  accusedIntro: (name, total) => `你已对质 ${name}！赌他的暗注比农民阵营总注（${total}）——`,
  more: '更多',
  less: '更少',
  cancel: '取消（票不退）',
  autoCancelSuffix: '后自动取消',
  targetOfAccuse: (who) => `你正被 ${who} 对质！`,
  watching: (who, target) => `${who} 正在对质 ${target}…`,
  resolveSuffix: '内落定',
  decidingYou: '农民正在决定是否对质你…',
  autoRevealSuffix: '后自动揭牌',
  waitingFarmers: (skipped, total) => `对质窗：等待农民决定…（已跳过 ${skipped}/${total}）`,
  intro: (total) => `暗注仍藏面额。农民阵营总注 ${total}。`,
  canAccuse: '花 2 票对质敌方暗注比它多/少——猜对可使其额外结算一次制约。',
  summonedNoAccuse: '本回合已传唤，不可发起对质。',
  notEnoughTickets: '票不足 2，无法发起对质。',
  accuseBtn: (name) => `对质 ${name}（−2 票）`,
  skippedCount: (k, n) => `已跳过 ${k}/${n}`,
  skipBtn: '跳过对质',
  ticketLabel: '对质票',
  giveTicket: (name) => `给 ${name} +1`,
};
const settlePanel = {
  landlordTake: (n) => `地主拿走 ${n}`,
  farmerTake: (name, v) => `${name} 分得 ${v}`,
  farmerOwe: (name, v) => `${name} 需补 ${v}`,
};
const negotiatePanel = {
  landlordWaiting: '农民正在协商分配，请稍候…',
};
const finalizePanel = {
  waitingTake: (names) => `等待 ${names} 拿取桌上的钱…`,
  deltaRound: '本回合 ',
  goalMiss: (goal, penalty) => `地主未达目标 ${goal}，扣除惩罚 ${penalty}（平分给农民）！`,
  landlordFallback: '地主',
  goalMet: (goal) => `达成目标 ${goal}`,
  waiver: (n) => `投资人担保免除了 ${n} 债务`,
  wagePrefix: '发工资：',
  wageItem: (name, v) => `${name} +${v}`,
  allowancePrefix: '扣伙食费：',
  allowanceItem: (name, v) => `${name} −${v}`,
  poolDelta: (delta) => `资金池 ${delta >= 0 ? `+${delta}` : delta}`,
  poolTax: (tax, pool) => `，扣税 ${tax} → ${pool}`,
  uncovered: (n) => `仍有 ${n} 缺口无人能补，地主收不到`,
  bankrupt: (names) => `${names} 破产了！`,
};
const endedPanel = {
  farmersWin: '🌾 农民阵营胜利！',
  landlordWin: (roleLabel) => `👑 ${roleLabel}胜利！`,
  balanceLine: (name, balance) => `${name}：${balance ?? '?'}`,
  bankruptSuffix: '（破产）',
  again: '再来一局',
  ledger: '查看账本',
  leave: '离开房间',
  waitHost: '等待房主开启「再来一局」(重选角色重新开局),或自行离开',
};
const coinPanel = {
  flipping: '掷硬币中…',
};

// ---- 聊天（McChat）----
const chat = {
  tabSystem: '系统',
  tabSpectate: '观战',
  tabFaction: '阵营',
  tabAll: '全部',
  sender: (name, roleLabel) => `${name}（${roleLabel}）`,
  spectateTag: '〔观战〕',
  switchChannel: '切换频道 (Tab)',
  readonly: '无法在该频道发送消息',
};

// ---- 酒馆账本（LedgerBook）----
const ledger = {
  landlordWin: '地主胜',
  farmersWin: '农民胜',
  pot: (n) => `彩池 ¥${n}`,
  my: (v) => `我 ${v >= 0 ? `+${v}` : v}`,
  tagPenalty: '罚',
  tagBankrupt: '破产',
  betLine: (name, b) => `${name} 押 ${b}`,
  goalMiss: (goal, penalty) => `地主未达目标 ${goal}，罚 ${penalty} 平分给农民`,
  goalMet: (goal) => `地主达成目标 ${goal}`,
  waiver: (n) => `投资人担保免除了 ${n} 债务`,
  wagePrefix: '发工资：',
  wageItem: (name, v) => `${name} +${v}`,
  allowancePrefix: '扣饭账：',
  allowanceItem: (name, v) => `${name} −${v}`,
  uncovered: (n) => `仍有 ${n} 缺口无人能补`,
  bankrupt: (names) => `${names} 破产了`,
  balanceLine: (name, b) => `${name}：${b}`,
  title: (rounds) => `酒馆账本 · 已记 ${rounds} 轮`,
  privacy: '他人余额保密',
  empty: '还没有账——第一轮结算后,这里会记下每一笔。',
};

// ---- 招募令墙（RoleWall）----
const roleWall = {
  applied: '已应征',
  apply: '应征',
  shiftHint: '按住 Shift 查看高级信息',
  factionFull: '阵营已满',
  manualTitle: '角色手册',
  recruitTitle: '招募令 · 选择你的角色',
  headcount: (landlords, farmers, max) => `地主 ${landlords}/1 · 农民 ${farmers}/${max}`,
  landlordGroup: '地主阵营 · 1 人',
  farmerGroup: (max) => `农民阵营 · 1–${max} 人,可重复`,
};

// ---- 新手即时讲解卡（PhaseCoachmark）----
const guide = {
  LOBBY: {
    title: '地主 vs 农民（一场不公平的较量）',
    body: '一人坐庄当地主，其余都是农民，两边规则故意不对称：地主钱包更鼓，但得「以一敌众」赢过所有农民，头上还顶着一份资金目标考核（KPI）。谁先破产谁出局——地主破产，农民翻身；农民全灭，地主通吃。',
  },
  DISCUSSION: {
    title: '准备阶段（农民可密谈）',
    body: '农民们可以凑一起合计合计，开个「密谈频道」地主偷听不到——当然，盟约能撑几回合是另一回事了。短暂喘息后自动开打。',
  },
  BETTING: {
    title: '暗注：只露张数，不露金额',
    body: '你押的钱通通扣着放，别人只数得清你出了「几张牌」，看不见面额。3 张可能值 3，也可能是 1+1+1——张数 ≠ 金额，正好拿来虚张声势，把对手唬得睡不着觉。',
  },
  CHALLENGE: {
    title: '对质：抓住敌方的虚张',
    body: '揭牌前，农民阵营可花对质票指控敌方——赌他的暗注比农民阵营总注「更多还是更少」。猜对了，敌方立刻被迫多结算一次制约（地主的目标 / 资本家的税）；猜错了只是白花票。悬停敌人按 Z（或用下方面板）即可发起。',
  },
  REVEAL: {
    title: '亮牌见真章',
    body: '憋了半天的底牌一起翻开，谁在虚张声势、谁是真有钱，当场见分晓。确认后，命运的硬币就要起飞了。',
  },
  COIN_FLIP: {
    title: '硬币是公平的',
    body: '大量测试表明：这枚硬币绝对公平，正反各 50%，童叟无欺、概不作弊。正面地主胜，反面农民胜——剩下的就交给天意吧。',
  },
  SETTLE: {
    title: '该分钱了（数学时间）',
    body: '地主赢的目标 = ⌊地主下注 × 1.5⌋。要是桌上的钱不够付，差的那部分会「按乘数放大」再由农民拿余额补——押得越少、补得越肉疼。下注前先掂量掂量钱包。',
  },
  NEGOTIATE: {
    title: '农民分账（与甩锅）',
    body: '系统先给了个默认分法，农民们可以互相拖动，重新分配「到手的钱」和「要背的债」。狠一点，债能全压给一个倒霉蛋直接把他送走——同舟共济还是过河拆桥，你们自己掂量。',
  },
  FINALIZE: {
    title: '入账时刻',
    body: '这一回合的盈亏正式记进余额，顺便点名今天有没有人光荣破产。结清之后，下一回合接着来。',
  },
  ENDED: {
    title: '尘埃落定',
    body: '有人被打到破产，胜负就此分晓。房主点「再来一局」可重选角色，给翻盘（或再输一次）一个机会。',
  },
  skipHint: '按任意键跳过',
  ok: '知道了',
};

// ---- 2D 协商板（NegotiationBoard，仅 ?input=2d）----
const nego2d = {
  countdown: (s) => `超时自动生效：${s}s`,
  empty: '无',
  dragSplitTitle: '拖到队友列转移；长按拆分成小面额',
  dragTitle: '拖到队友列转移',
  negotiating: '农民正在协商分配…',
  headHint: '把自己的钱或债务拖给队友（长按拆分成小面额），全部农民确认后生效',
  meSuffix: '（我）',
  confirmed: '已确认',
  pending: '协商中',
  take: (n) => `得 ${n}`,
  debt: (n) => `债 ${n}`,
  undoConfirm: '撤销确认',
  confirm: '确认当前分配',
};

// ---- 2D 手牌（MoneyHand，仅 ?input=2d）----
const hand2d = {
  forceAllIn: (balance) => `资金不足，本回合必须全押 ${balance}`,
  selected: (total, min, max, premium) =>
    `已选 ${total}（可下注 ${min} ~ ${max}${premium > 0 ? `，已投保 ${premium}` : ''}）`,
  allInBtn: (balance) => `全押 ${balance}`,
  confirmBet: '确认下注',
  pledgeLabel: (premium, max) => `投保 ${premium}/${max}`,
  pledgeTitle: (max) => `把手牌拖进来投保（保费先扣，输则免阵营 2× 债务；上限 ${max}）`,
  takeBack: '点击取回',
  dropHint: '拖牌入槽',
  noteTitleSplit: '点击选择，长按拆分',
  noteTitle: '点击选择',
  empty: '没有可支配的钱',
  reservedTitle: (minStake) => `必须留下的最小出资额 ${minStake}，不可下注`,
  reserve: '保留金',
};

// ---- 设置面板（SettingsPanel）----
const settings = {
  scaleAuto: '自动',
  scaleLow: '低',
  scaleMid: '中',
  scaleHigh: '高',
  shadows: '阴影',
  postfx: '光影特效',
  postfxNote: '泛光/暗角',
  lightAnim: '动态光效',
  lightAnimNote: '炉火/吊灯',
  copied: '房间号已复制',
  copyFallback: (roomId) => `房间号：${roomId}`,
  title: '设置',
  roomId: (roomId) => `房间号 ${roomId}`,
  copy: '复制',
  renderScale: '渲染分辨率',
  renderScaleNote: '卡顿请调低',
};

// ---- 规则面板（RulesPanel；**…** 为高亮标记）----
const rules = {
  title: '游戏规则',
  items: [
    { t: '游戏分为**农民阵营**和**地主阵营**。每回合开始后，玩家可以自由**下注**，其他玩家不可见。**下注**后，系统会进行**揭牌**，展示每个人**下注**的多少。随后，通过**抛硬币**决定本回合的**胜负**：正面向上则**地主阵营**胜利，反面向上则**农民阵营**胜利，随后进行结算。' },
    { t: '若**地主阵营**胜利，则会根据**贪婪**程度获取基于下注额的**赢资**（如下注额为**10**，贪婪指数为**2**，则会得到**20**的赢资）。' },
    { t: '若桌上的钱不足以支付**赢资**，农民阵营需要**赔偿差额**，差额会被对方的**盘剥**放大（如差额为**10**，盘剥指数为**3**，则需要支付高达**30**的**赔偿**）', li: true },
    { t: '若桌上的钱支付完**赢资**还有剩余，地主阵营会额外**抽成**（如剩余为**10**，提成指数为**50%**，则地主阵营会额外拿走**5**）', li: true },
    { t: '若**农民阵营**胜利，则**阵营**获得地主阵营下注的**全部资金**。' },
    { t: '（这意味着，**无论始终出最少的金额还是全部梭哈都不一定是最优解**。）' },
    { t: '结算完成后，桌上的**资金**或需要的**赔偿**由农民阵营所有玩家**平分**（若无法恰好平分，下注多者会优先拿取多出的资金）。农民阵营可自由分配**资金**和**赔偿**，若某名玩家无法支付被分配到的**赔偿**，则宣告破产（玩家的剩余资金不影响其承担赔偿的多少。若承担了超出支付范围的赔偿并提前破产，地主阵营收到的赔偿金可能少于预期）。同时，地主阵营的角色必须完成自身的**制约**（如税收），若无法完成，可能导致地主阵营破产。' },
    { t: '若一方阵营完全破产，则对方阵营取得游戏胜利。否则继续下一轮下注，直至决出胜负。' },
  ],
};

// ---- 胜负遮罩（VictoryOverlay）----
const victory = {
  farmers: '农民',
  landlordFallback: '地主',
  neutralWin: (winnerName) => `${winnerName}胜利`,
  win: '胜利！',
  lose: '败北',
  again: '下一局',
  waitHost: '等待房主开下一局',
  ledgerHint: '按 L 查看战绩',
};

// ---- 触屏视口引导（ViewportGuard）----
const viewport = {
  fullscreenTitle: '进入全屏',
  fullscreenBtn: '⛶ 全屏',
  rotate: '请横屏游玩',
  rotateHint: 'iPhone 可「添加到主屏」获得全屏体验',
  iosHintPre: '想去掉顶部地址栏？点底部 ',
  iosHintShare: '分享',
  iosHintMid: ' → ',
  iosHintAdd: '添加到主屏幕',
  iosHintPost: '，从图标启动即全屏',
  gotIt: '知道了',
};

// ---- 桌沿抽屉页签（Dock）----
const dock = {
  roles: '角色',
  ledger: '账本',
};

// ---- 登录页（LoginScreen）----
const login = {
  pwMismatch: '两次输入的密码不一致',
  tabLogin: '登录',
  tabRegister: '注册',
  username: '用户名',
  usernamePh: '1-16 个字符',
  password: '密码',
  passwordPh: '至少 4 位',
  confirmPw: '确认密码',
  confirmPwPh: '再输入一次',
  busy: '请稍候…',
  submitLogin: '登录',
  submitRegister: '注册并登录',
  guest: '游客快速进入（本地测试）',
};

// ---- 大厅页（LobbyScreen）----
const lobby = {
  modeLabels: { quick: '快速', classic: '经典', competitive: '竞技' },
  defaultRoomName: (username) => `${username}的房间`,
  online: (n) => `在线 ${n}`,
  logout: '退出登录',
  createRoom: '创建房间',
  wip: '开发中',
  roomName: '房间名',
  joinPh: '输入房间号加入',
  join: '加入',
  roomList: '房间列表',
  empty: '暂时没有房间，创建一个吧。',
  waiting: '等待中',
  playing: '游戏中',
  enter: '进入',
};

// ---- 进房占位屏 / 顶层弹窗（GameScreen / App）----
const game = {
  entering: '正在进入房间…',
};
const app = {
  disconnected: '连接已断开',
  relogin: '重新登录',
};

// ---- 网络/请求提示（gameStore / api / authStore）----
const net = {
  reconnecting: '连接已断开，正在重连…',   // 断线横幅与断线 toast 共用
  kicked: '连接被服务器关闭',
  expired: '登录已过期，请重新登录',
  error: '发生错误',
  requestFailed: (status) => `请求失败 (${status})`,
  guestName: '游客',                       // 游客登录的用户名前缀（后接随机数，全员可见）
};

// ---- 角色文案（game/roles.js 再导出；**…** 为高亮标记）----
const roles = {
  label: {
    landlord: '地主', capitalist: '资本家',
    farmer: '农民', investor: '投资人', glutton: '暴食者', prosecutor: '检察官',
    lucky: '幸运儿', ghost: '幽灵',           // 单人模式专属（§9）
    bank: '银行', none: '未选',
  },
  // 单字身份章（玩家栏用）。多为角色名首字，暴食者取「食」而非「暴」。
  glyph: {
    landlord: '地', capitalist: '资',
    farmer: '农', investor: '投', glutton: '食', prosecutor: '检',
    lucky: '运', ghost: '幽',
  },
  // 角色一句话说明（选角时展示）。
  desc: {
    landlord: '高风险高回报，有资金目标考核',
    capitalist: '个人押注本金必归还，靠资金池续命、定期被税',
    farmer: '无主动技能，靠工资滚雪球',
    investor: '下注时投保 n（拖牌入槽），输则免阵营 2n 债务（保费先扣）',
    glutton: '每回合攒饭账（农民胜时扣除），输可重掷硬币（每局次数=农民人数）',
    prosecutor: '清廉的政府官员，消耗资金使纳税人接受严厉监管',
    lucky: '己方胜率 +10%；每逢败局自己 −1、下次再 +5%（约 5 回合的概率窗口）',
    ghost: '幻影注金：膨胀己方目标、分到的钱和债凭空消失，永远收回注金',
  },
  // 招募令角色手册：intro = 简介段落；advanced = 高级信息表 [栏目, 值]。
  sheet: {
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
        ['对质票数', '3'],
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
        ['对质票数', '0'],
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
        ['对质票数', '2'],
      ],
    },
    prosecutor: {
      intro: [
        '**清廉**的政府官员，**消耗资金**使纳税人接受**严厉监管**。',
        '初始资金：4。',
        '**特殊能力**：**消耗资金**，迫使地主阵营**双倍结算**一次罚款/税务等**制约**，且**重置其结算间隔**。若本回合进行了一次强迫结算，则该回合**不得使用**对质。特别地，检察官强迫的地主罚款**不会分给农民**。',
      ],
      advanced: [
        ['监管所需资金', '农民阵营人数'],
        ['监管资金增长速率', '150%'],
        ['对质票数', '4'],
      ],
    },
  },
};

// ---- 结算事件播报（game/settleText.js 再导出：SettlePanel 与账本共用）----
const settleEvents = {
  landlord_win: e => `正面朝上，地主胜！拿走目标 ${e.target}${e.surplus > 0 ? `，盈余 ${e.surplus}（地主再取 ${e.landlordExtra}，农民分 ${e.farmerPool}）` : ''}`,
  landlord_win_shortfall: e => `正面朝上，地主胜！桌面不足目标 ${e.target}，缺口 ${e.shortfall} 由农民补足${e.uncovered > 0 ? `（仍有 ${e.uncovered} 无人能付）` : ''}`,
  farmers_win: e => `反面朝上，农民胜！平分桌面全部 ${e.pot}`,
};

// ---- 结算调整步标签（game/payoutText.js 再导出）----
// 未收录的 source（如 summonPenalty/summonTax）回落到服务端下发的 label（见 server/text.js）。
const payoutSteps = {
  debtCollect: '补缺口',
  goalPenalty: '罚金',
  wage: '工资',
  mealAllowance: '饭账',
  capitalistPool: '资金池',
  capitalistTax: '税收',
};

// ---- 单人模式（§9.6，交互 v2：长桌两阵营对坐 + 自由走动/附身 + 桌边选角）----
const single = {
  start: '单人开局',
  setupHint: '点席位换角色 · 至少 1 人',
  emptySeat: '空位',
  ghostToggle: '幽灵随行',
  begin: '开局',
  seatCurrent: '操控中',
  seatDone: '已下注',
  seatDead: '破产',
  standUp: '起身 [X]',
  switchHint: 'TAB 切席 · X 起身走动',
  walkHint: 'WASD 走动 · 准心点队友附身 · ESC 放开鼠标',
  lockHint: '点击画面 · 锁定视角',
};

// ---- 开发/测试专用（仅 import.meta.env.DEV 可见）----
const dev = {
  hud: (freeCamOn) => `测试模式 · B 补满玩家 · V 切换操控角色 · K 自由相机(${freeCamOn ? common.on : common.off})`,
};

export default {
  fmt, common, phase, status, skill, topbar, banner, rail, hud, hints,
  felt, hand3d, payout3d,
  lobbyPanel, discussionPanel, bettingPanel, revealPanel, reflipPanel,
  challengePanel, settlePanel, negotiatePanel, finalizePanel, endedPanel, coinPanel,
  chat, ledger, roleWall, guide, nego2d, hand2d, settings, rules,
  victory, viewport, dock, login, lobby, game, app, net,
  roles, settleEvents, payoutSteps, single, dev,
};
