# 《地主与农民》完整重构设计书（开发提示词）

> 本文档是对原始概要的展开与精确化，是本次彻底重构的唯一依据。
> 后续所有开发、调参、补充模式（经典/竞技）都应先更新本文档，再改代码。

---

## 0. 总体原则

1. **服务端权威**：一切游戏规则、结算、校验、数据记录都发生在服务端；客户端只负责"渲染状态 + 发送意图"。客户端永远不自行计算余额/胜负。
2. **零硬编码参数**：所有可调数值（初始资金、最小出资额、结算倍率、取整方式、各阶段时长、超时策略……）集中在 `server/config.js`，房间创建时可覆盖，方便测试与调参。
3. **逻辑与表现分离**：
   - 服务端：`logic/`（纯函数，无 IO，可单测可仿真）与 `Room.js`（状态机、定时器、广播）分离。
   - 客户端：`scene/`（3D 画面层）与 `ui/`（2D UI 层）分离；两层都只读 store，不持有游戏逻辑。
4. **数据在服务端**：账号、对局历史、回合记录都持久化在服务端（`server/data/`，JSON 文件存储，留出换数据库的接口）；客户端 localStorage 只存登录 token。
5. **美术全部 SVG + 注册表**：所有美术（钱牌、硬币、玩家形象、图标、桌面纹理）以 React SVG 组件实现，统一经 `assets/registry.jsx` 引用。将来换贴图只改注册表，不改业务组件。
6. **视觉基调**：整体偏深黑（多层次：近黑底色 + 深蓝/深紫渐变 + 细微纹理/光晕，避免单调），UI 用白色（文字、线框、按钮描边），金钱用低饱和金色点缀。

---

## 1. 游戏模式

| 模式 | id | 角色 | 状态 |
|------|----|------|------|
| 快速 | `quick` | 地主 ×1，农民 ×1..4 | **本次实现** |
| 经典 | `classic` | 快速 + 银行 ×1（放贷/利息/赦免） | 预留（注册表中占位，大厅可见但禁用） |
| 竞技 | `competitive` | 地主/资本家（互斥）+ 基础农民/投资人/暴食者 | **本次开放（见 §8）** |
| 单人 | `single` | 玩家操控整队 vs 脚本 Boss；专属角色幽灵/幸运儿 | 规格定稿（§9），实装中 |

模式注册表 `server/modes/index.js`：每个模式导出描述符
`{ id, label, available, roles: [...], minFarmers, maxFarmers, description }`。
Room 构造时按 `mode` 取描述符；不可用模式拒绝创建房间。
**预留接口**：描述符将来可挂 `hooks`（如 `onRoundStart`、`extraPhases`、`settleOverride`），快速模式全部用默认实现。

---

## 2. 账号 / 在线 / 房间系统

### 2.1 账号
- 注册：用户名（1-16 字符，去首尾空格，唯一）+ 密码（≥4 位）。密码用 `crypto.scrypt` + 随机盐哈希后存 `server/data/users.json`。
- 登录：校验后签发随机 token（内存会话表）。**重复登录会顶号**：旧 token 失效、旧 WebSocket 收到 `kicked` 后断开。
- 客户端持有 token（localStorage），REST 用 `Authorization: Bearer <token>`，WebSocket 用 `?token=` 查询参数。

### 2.2 在线检查
- WebSocket 连接成功即"在线"，断开即"离线"；`GET /api/online` 返回在线人数与名单。
- 服务端每 `heartbeatSec` 发 ping，浏览器自动回 pong，超时连接被清理。
- **断线重连**：游戏中的玩家断线后保留座位，重新登录并 `join_room` 同一房间会回到原座位、原余额；离线玩家需要的"准备/确认"自动视为通过（`autoActForOffline`），避免卡住全场。`reconnectGraceSec` 默认 **0 = 永不超时（永久保座）**；若设为 >0，则断线超过该秒数会降级为观战者（仅在按房重新启用时生效）。
- **客户端活性自检**：客户端自发应用级 `ping`（服务端回 `pong`），并跟踪最近入站时间；超过约 `2×PING_MS` 无任何入站即判定连接已死、强制重连——避免浏览器迟迟不报 `onclose` 时卡死在"已死但仍 OPEN"的连接上（详见 `client/src/net/socket.js`）。

### 2.3 房间
- REST 创建（名称 + 模式），6 位房间号；大厅 REST 列表轮询（房间号、名称、模式、阶段、人数）。
- 进入房间后所有交互走单条 WebSocket。第一个进房的人是房主；房主退出则顺延。
- 全局 UI 永远提供：退出房间按钮、查看房间号入口。

### 2.4 REST 协议
```
POST /api/auth/register {username, password}      -> {ok}
POST /api/auth/login    {username, password}      -> {token, username}
POST /api/auth/logout                              -> {ok}
GET  /api/auth/me                                  -> {username}
GET  /api/online                                   -> {count, users: [...]}
GET  /api/modes                                    -> [{id, label, available, description}]
POST /api/rooms         {name, mode}               -> {roomId}
GET  /api/rooms                                    -> [{roomId, name, mode, phase, playerCount, maxPlayers}]
```

### 2.5 WebSocket 协议（客户端 → 服务端）
```
join_room          {roomId}
leave_room         {}
take_role          {role: 'landlord'|'farmer'}
start_game         {}                    // 仅房主，LOBBY 内
lobby_ready        {ready: bool}         // LOBBY 内可反复切换的准备标记：纯协调信号（viewFor 播 players[].lobbyReady），不做开局门槛，房主自行掌握时机；需先选角色
ready              {}                    // DISCUSSION 阶段点准备
place_bet          {amount}              // BETTING
confirm_reveal     {}                    // REVEAL 阶段确认
negotiate_transfer {toId, kind: 'take'|'debt', amount}   // NEGOTIATE，把自己的钱/债转给队友
negotiate_confirm  {confirmed: bool}     // NEGOTIATE 确认/撤销确认
take_payout        {}                    // FINALIZE，从桌面拿取自己的钱堆（此刻余额才入账，见 §3.8）
chat               {channel: 'public'|'farmer', text}
restart_game       {}                    // 仅房主，ENDED 内=「下一局」（回大厅重开）；默认不自动回大厅，见 §3.4
get_state          {}
voice_join / voice_leave / voice_signal  // 语音预留：服务端统一回 {type:'error', code:'NOT_IMPLEMENTED'}
```

### 2.6 WebSocket 协议（服务端 → 客户端）
```
joined   {playerId, state}
state    {state}            // 唯一的状态推送；客户端动画由状态变化驱动
chat     {channel, from, name, text, ts}
error    {message, code?}
kicked   {reason}           // 顶号或被移出
```
**单一 state 推送原则**：不再为揭牌/硬币/结算单发事件消息；客户端比较前后 state（阶段、bets、coinResult）触发动画。

---

## 3. 快速模式规则（精确定义）

### 3.1 初始资金
- 农民：`config.initialBalance.farmer`，默认 **8**。
- 地主：**农民总资金 × `config.landlordFundMultiplier`（默认 1.2）**，向下取整，至少 1。农民总资金 = 农民人数 × 农民初始资金。
  - 例：1 农民→10；2→21；3→31；4→42。
- **按人数动态**：取值经函数 `getInitialBalance(role, farmerCount, config)`——农民固定、地主按农民人数算；要换公式只改此函数。

### 3.2 最小出资额（minStake）
- 农民 = `config.minStake.farmer`（默认 1）。
- 地主 = 当前**活跃农民人数** × `config.minStake.landlordPerFarmer`（默认 1，即等于农民人数）。
- 经 `getMinStake(role, farmerCount, config)` 计算，禁止散落硬编码。

### 3.3 下注规则
- 可押任意整数金额 `bet`，约束：`minStake ≤ bet ≤ balance − minStake`（出多少都行，但必须留下最小出资额，且下注本身不低于最小出资额）。
- **强制全押**：当 `balance < 2 × minStake`（含"总资金 = 最小出资额"的情形）时，无法同时满足两条约束，必须 `bet = balance` 全押。
- 下注即把钱从余额移到桌面（`balance -= bet`），反面朝上，金额对他人保密。

### 3.4 回合阶段（状态机）
```
LOBBY ──房主开始──► DISCUSSION ──短喘息定时──► BETTING ──全员下注──► CHALLENGE(竞技·对质窗)
   ──指控落定/全员跳过/超时/无票自动跳过──► REVEAL ──全员确认──► COIN_FLIP ──动画定时──► SETTLE
   ──定时──► NEGOTIATE ──全部农民确认(或超时)──► FINALIZE ──定时──► 破产判定 ──► DISCUSSION(下一回合) 或 ENDED
```
- **DISCUSSION（讨论/准备）**：游戏从讨论开始；农民可在农民频道密谈战术（频道可切公开/农民私聊；语音接口预留）。地主与农民都要点"准备"，全员准备进入下注。
- **BETTING（下注中）**：见 3.3。已下注玩家对他人显示"已下注"（反面牌），金额保密。
- **CHALLENGE（对质窗，竞技专属，§8.11）**：下注后、揭牌前插入。农民阵营可花对质票指控敌方暗注「比阵营总注多/少」，猜对则强制敌方立刻多结算一次制约（地主目标/资本家税）。默认 30s 决定窗（可指控/投票跳过，浮字显示倒计时）；有人指控则开 ≤120s 交流窗。快速模式或无农民凑得齐票时跳过本阶段。
- **REVEAL（揭牌）**：系统播放翻牌动画展示每个人出的金额；期间允许发言；**所有活跃玩家点确认**后进入掷硬币。
- **COIN_FLIP（掷硬币）**：播放抛硬币动画；**正面 = 地主胜，反面 = 农民胜**；`coinAnimMs` 后自动进入系统结算。
  - 动画用**客户端预烘焙动画池**：`scene/coinSim.js` 以确定性**两段式平面物理**（弹跳翻飞 → 贴台衰减摇摆 → 躺平，见该文件头注释）离线模拟若干轨迹，按落定朝面分桶到正反各 `POOL_SIZE`（24）条并缓存；服务端权威决定 `coinResult` 后，客户端从对应池随机取一条回放（保证不穿桌；落定为真实翻转硬币的**平面翻滚 + 摇摆**而非陀螺式绕边打转）。**抛点高度每回合不同 + 短滞空 + 落台后较长的翻滚/摆动收尾**（约 8 次摆动）→ **落定时间 ~3–5.2s**；摇摆用平滑势 −sin(2·rx)，硬币立起后会自然倒下继续动、绝不被瞬间放平。故 `coinAnimMs` 须 ≥ 客户端 `DURATION`（6.0s）以免最长抛掷被打断。
  - **公平观感设计**（结果本就服务端 50/50，难点在让动画「看起来」公平）：① 起始朝面 50/50 随机，开局不暗示结果；② 高速自旋使滞空成「糊影」、人眼无法追踪正反 → 落定前有悬念、像真随机；③ 飞行参数对正反同分布、盲采后按落定面分桶 → 过程不泄露结果；④ 回放期叠加绕竖轴偏航 + 水平镜像（均不改变朝上的面）→ 同一条轨迹每次都不同，消除「在放固定录像」的观感。
- **分钱（四个子阶段，全部在桌面上显式演出，见 §3.8）**：
  1. **SETTLE 系统结算**：服务端按 3.5 计算默认分配方案，并生成**编导脚本**：桌上各家下注堆**聚拢成彩池 → 按方案分成几份 → 各份滑进每人面前的圆圈**；缺口债务以红色债务牌出现在欠款农民圈内。`settleViewMs` 后自动进入下一步。
  2. **NEGOTIATE 农民协商**：每个农民以钞票牌形式看到分给自己的钱或债务，可拖拽给队友（金额守恒，仅在农民之间转移）；**桌面钱堆实时镜像协商结果**（钱牌在圆圈间飞移）。任何变动会重置所有人的确认。全部活跃农民确认（或 `negotiateTimeoutMs` 超时按当前方案）后生效。若只有 1 个活跃农民、或本回合农民既无钱可分也无债可摊，则自动跳过。
  3. **FINALIZE 正式结算（收账 + 调整 + 拿取）**：确认后**钱不入账、留在桌上**——先播放收账（债务补偿从欠款者手中飞向地主堆）与**调整步**（技能/机制逐条改变钱堆：地主目标罚金、工资、饭账、资金池换算、税收…每条带浮动标签），然后每个有钱堆的玩家的堆上浮现「**拿取 (F)**」：按 F（或点击）钱堆才飞回手中、余额此刻入账。**显示时序**：按下拿取即冻结右下余额显示（`gameStore.balanceFreeze`），钱牌飞行落到资金蜡烛的那一刻才放开——数字跳动/动画恰在「钱碰到数字」时播，此前数字不变。全员拿取完成后记录回合历史、判定破产。
  4. **农民讨论**：即下一回合的 DISCUSSION——结算后回到讨论阶段，农民复盘战术、全员再点准备，形成循环。
- **ENDED**：地主破产 → 农民胜；全部农民破产 → 地主胜。**终局演出**（§阶段七，客户端 `VictoryOverlay`，仅 3D 输入模式）：按阵营区分文案（胜方「胜利！」金/绿、败方「败北」冷灰、观战「X 胜利」）逐字机甲组装式砸入 → 组装完成爆金色粒子 → 驻留 → 收尾淡出（罩层不含高斯模糊，pointer-events:none 不挡转视角）。**淡出后不自动进下一局：留在终局对局、露出桌面，浮现操作行——房主见「下一局」按钮（`restart_game`）、其余见「等待房主开下一局」；移动端不显示「按 L 查看战绩」（无键盘，账本仍走桌沿 Dock）。** `timing.endedToLobbyMs` 默认 **0=不自动回**；仅 >0 才在到点后服务端自动回大厅（`viewFor().endedReturnAt` 给客户端对齐收尾）。2D 输入模式（`?input=2d`）仍用带按钮的 `EndedPanel`。移动端另有触觉反馈：有人破产→短震、终局→脉冲震动（Vibration API，Android 支持）。

### 3.5 结算规则（默认；全部走 config，可替换）

**地主阵营角色属性（三杠杆，`config.landlordAttrs[role]`，经 `getLandlordAttrs(role, config)` 解析）**——每个地主侧角色（地主/资本家/未来角色）各一套，差异化其「赢法」：

| 属性 | 键 | 作用 | 触发 | 默认 |
|---|---|---|---|---|
| **贪婪** | `greed` | 地主胜的目标倍率 `target = round(L × greed)`（赢了拿几倍；`<1` 会赢了反亏） | 地主胜，总是先划目标线 | 1.5 |
| **盘剥** | `squeeze` | 对方填不满目标时，缺口债务的放大倍率（越大逼债越狠） | 地主胜且 `pot < target` | 1.5 |
| **抽成** | `rake` | 对方溢出时，地主从溢出里多拿的比例 `[0,1]` | 地主胜且 `pot ≥ target` | 0.5 |

结构：贪婪定目标线，再看对方够不够——**不够走盘剥、有余走抽成**（二者互斥）。

> **竞技档差异化**（`competitive.landlordAttrs`）：地主 `greed 2 / squeeze 1.5 / rake 0.8`（厚资本、赢面凶）；资本家 `greed 1.6 / squeeze 6 / rake 0.4`（**专家向**：低贪婪压「躺赢地板」、高盘剥抬「骗押技巧天花板」）。快速档基础地主沿用上表默认 `1.5 / 1.5 / 0.5`。

记地主下注 `L`，农民下注合计 `F`，桌面总额 `pot = L + F`，目标 `target = round(L × greed)`。**所有带小数的比例计算（三倍率 / 目标 / 罚款 / 税）统一走四舍五入 `config.rounding: 'round'`**；不做零头账（被舍去的小数不累积）。

**正面（地主胜）：**
- `pot ≥ target`：地主拿走 `target`；多出的 `R = pot − target` 地主再拿 `round(R × rake)`（**抽成**，取整方式 `rounding: 'round'`），剩余归农民平分（最大余数法取整）。
- `pot < target`：地主先拿走整个 `pot`；缺口**按盘剥倍率放大后**由农民**用手里余额共同补足**。
  - 基础缺口 `base = target − pot`；**实际债 `shortfall = round(base × squeeze)`**（缺口再乘一次**盘剥**——农民桌面押得越少、补窟窿越狠，惩罚消极下注；地主最终可拿到超过 `target`）。
  - 债务分摊默认 **`inverseBet`（谁出的多谁补的少）**：以 `wᵢ = 1 / betᵢ` 为权重做**最大余数法**整数分摊（科学分摊、只出整数、误差最小）。可配置为 `equal`（均摊）/ `proportionalBet`（出得多摊得多）。
  - 每人实际支付 `min(份额, 余额)`；付不起的人付光破产，残余缺口在未封顶的农民间按同法递归重摊；全员都付不起则地主只拿到实际收到的部分。
  - 竞技投资人减债 `debtWaiver` **作用于乘后债额**：`waived = min(shortfall, debtWaiver)`，再按 `inverseBet` 分摊 `shortfall − waived`。
  - **补偿精确入账**：地主拿到 `pot + 农民实际补偿`，补偿多少地主就多拿多少；FINALIZE 时按最终（可能经协商）的债务实收重算 `uncovered = max(0, shortfall − collected)`，使展示与入账一致。
- 协商阶段农民可以在彼此之间转移"分到的钱"（take）或"分摊的债"（debt）。
  - **债务可压垮队友**：不限制对方余额，允许把全部债务堆给一名农民使其破产；落账时该农民只付出全部余额，地主只收到这点钱，其余缺口作废。

**反面（农民胜）：**
- 农民**直接平分** `pot`（`farmerSplit: 'equal'`，最大余数法）；除不尽的余数单位默认给下注多的农民（`surplusTieBreak: 'highestBet'`，可配置），协商阶段可再调整。
- 地主本回合净损失 `L`（他下的注归入 pot 被分掉）。

**破产**：FINALIZE 后 `balance ≤ bankruptcyThreshold`（默认 0）即破产，成为观战者（可见全部信息、可聊天、不再参与回合）。

### 3.6 整数与误差原则
所有入账金额必为整数。凡是按比例分配，统一用 `logic/apportion.js` 的**最大余数法**：先地板取整，再把剩余单位按小数余量从大到小逐个分配（并列时按 `surplusTieBreak`）。保证"份额之和恰好等于被分配总额"，误差不超过每人 1。

### 3.7 地主资金目标（相对制，`config.landlordGoal`，纯函数见 `logic/landlordGoal.js`）
为地主设置一连串**动态检查点**：每过**随机 interval 回合**一个检查点，地主须使资金较上一检查点**增长一定比例**，否则在**该回合 FINALIZE（押注后资金分配完成时）**受罚。目标随余额浮动（相对制），不再是固定的绝对数列。**目标/间隔是有状态的，由 `Room` 逐检查点推进；`logic/landlordGoal.js` 只提供无状态计算件**（目标额 `relativeGoal`、惩罚额 `goalPenalty`、间隔抽取 `drawGoalInterval`）。

- **目标**：检查点目标 = `round(基准余额 × goalMultiplier)`（默认 `1.1`，即较上一检查点/开局涨 10%）。**基准 = 上一检查点（或开局）时的地主余额**。
- **检查点间隔**：`interval` 每次**正态随机**（`{min, max, mean, sd}`，四舍五入后 clamp 到 `[min,max]`，默认 `2..5`）。由**按局种子的 PRNG**（`Room.goalSeed` → mulberry32）抽取，保证可复现。
- **惩罚**：检查点回合 FINALIZE 时若地主余额 < 目标，扣除 `max(minPenalty, round(余额 × penaltyRate))`（默认 `max(2, round(余额 × 0.1))`）。**惩罚资金按最大余数法平分给本回合农民**（在破产判定前入账，可能救活濒临破产的农民），可直接使地主破产 → 农民胜。**达标无奖励。**
- **重定基**：每个检查点结算（含罚款）后，按**（罚后）当前余额**重新定下一个目标 `round(当前 × goalMultiplier)` 与下一个随机检查点回合。
- **展示（合理显示在每个人的 UI）**：`viewFor` 下发 `landlordGoal = { goal, dueRound, roundsLeft, interval, baseline, initial, landlordId, landlordBalance }`——**到期回合（倒计时）对所有人可见**（给农民施压、给地主紧迫感）；**`goal/baseline/initial/landlordBalance` 仅地主本人/观战者可见**（隐私边界，§8.11：农民只知「X 回合后结算」、不知具体 KPI 数字，对质靠读牌而非直接看 KPI）。FINALIZE 面板播报达标/受罚。
- **资本家**无此考核（`goalNextRound=0`）；快速档地主与竞技地主同吃该相对制。默认参数与调法见 `docs/TUNING.md`。

### 3.8 桌面显式结算（编导脚本 + 拿取；`logic/payout.js`）
钱是桌上的实体：结算不再是「数字瞬间入账 + 面板播报」，而是钱堆在桌面上的连续演出。**金额算法（§3.5–3.7、§8）一个数都不变，只重新定义"何时写 balance"**。

**入账时刻**：
- 下注扣款：`place_bet` 时（不变）。
- **手上支出**（债务补偿、超出钱堆部分的技能扣款）：FINALIZE 进入时一次性入账——钱可视地离开手。
- **桌上收入**（自己的钱堆）：玩家 `take_payout` 时**逐人入账**。恒等式：`pile[id] = max(0, after[id] − (balanceNow[id] − handDebit[id]))`，全员拿完后每人余额 === 旧算法的 `after[id]`，分毫不差。
- 破产判定、回合收尾（→ 下一回合 / ENDED）：**全员拿取完成后**（`finalizeMs` 收尾间隔）。回合历史仍在 FINALIZE 进入时写入（供播报/账本）。
- **不丢钱兜底**：若在 FINALIZE 中途对局被迫结束（弃局/降级），先把所有未拿取的钱堆静默入账再进 ENDED。

**服务端模型**（`Room.payout`，随 `viewFor().payout` 下发）：
```
payout: {
  script:   [step...],      // 编导脚本：追加式、带自增 id；客户端只播放没见过的 id
  piles:    {playerId: n},  // 当前各家圆圈里的钱（权威值；客户端播完脚本后与它对账）
  taken:    [playerId...],  // 已拿取
  eligible: [playerId...],  // FINALIZE 时有钱可拿的人（pile > 0）
  deadline: ts|null,        // 拿取超时（takeTimeoutMs）
}
step 词汇（可扩展）：
  {id, t:'gather', from:[{id,amount}], pot}          // 各家下注堆 → 彩池
  {id, t:'split',  shares:[{id,amount}]}             // 彩池重新数钱、分成几份、滑进各家圆圈
  {id, t:'adjust', source, label, flows:[{from:{kind,id?}, to:{kind,id?}, amount}]}
      // kind ∈ pile(圆圈钱堆)/hand(手中)/pool(资本家资金池)/void(凭空出现或消失)
```
**`adjust` 是唯一扩展点**：债务收账（`debtCollect`）、地主目标罚金（`goalPenalty`）、工资（`wage`）、饭账（`mealAllowance`）、资本家本金/池换算（`capitalistPool`）、税收（`capitalistTax`）全部是一条 `adjust`。**将来新机制 = 服务端多推一条 adjust（新的 source + flows），客户端通用动画自动生效，零客户端改动**；客户端本地文案表未收录的 source 回落显示服务端 `label`。台账（`createLedger`）保证 flows 的 pile/hand 归属与最终 `after` 恒等（扣款先扣堆、不足再扣手；进账进堆）。

**各情况的演出**：
- 农民胜：gather(全部下注) → split(农民均分) → NEGOTIATE 镜像 → adjust(工资/饭账/罚金…) → 各农民拿取；地主无堆自动完成。
- 地主胜·盈余：gather → split(地主 target+盈余份 / 农民盈余份) → (农民份>0 且 >1 农民才协商) → adjust → 拿取。
- 地主胜·缺口：gather → split(全池归地主圈) + 农民圈出现红色债务牌 → NEGOTIATE 拖债 → adjust:debtCollect(实付从欠款者飞向地主堆、付不起的红牌熄灭=uncovered) → adjust… → 地主拿取，农民无堆自动完成。
- 竞技资本家：本金 L 由恒等式自然成为他的堆；`capitalistPool` flows 把堆与 L 的差额在 堆↔池 间搬运（池为私密血条，动画只显差额——该值本就可由公开信息推出）；税收 pool→void。
- 离线/AFK：进入拿取阶段 `takeAutoDelayMs` 后自动代离线者拿取；`takeTimeoutMs` 超时全员自动拿取（0=不超时）。断线重连/中途加入观战：客户端**冷挂载直接摆出 `piles` 终态**，不重播动画。
- 观战者：看到全部钱堆与动画，无拿取交互。

**隐私边界**：script/piles 里的金额（下注、takes、debts、工资、罚金、饭账、池差额）在结算阶段本就全部公开（见 §5.1 与 history 公开字段），无新增泄露。唯一例外：**NEGOTIATE 期间地主看到的 `piles` 冻结在系统方案**（协商过程仍是农民私密，与 `allocation` 的可见性一致），FINALIZE 进入时地主的桌面用一次快速对账动画追平最终方案。

**客户端**（`scene/PayoutLayer.jsx`，纯表现）：SETTLE 起接管全部桌面钱渲染（自己的堆沿用下注飞行那批牌模型，零跳变）；顺序播放脚本步骤（每步 = 一组世界坐标贝塞尔弧飞牌 + 落定重组，错峰 80ms）；播完与 `payout.piles` 对账、差额自动飞牌追平——协商实时镜像与地主的 FINALIZE 追平共用这一机制。拿取 = 自己的堆飞向手牌区（反投影）、他人的堆飞向其身体收拢。

---

## 4. 客户端架构

### 4.1 双层结构
- **场景层（scene/）**：CSS 3D（`perspective` + `rotateX` 平面）实现第一视角——玩家坐在矩形赌桌近边正中，能看到其他玩家（按真实环桌座位顺序排在远边/侧边，近大远小由真实 3D 变换产生）以及他们摆在桌上的牌。
- **UI 层（ui/）**：2D DOM。**同一时间只展示当前阶段需要的 UI** + 全局常驻 UI（退出房间、房间号入口、聊天）。阶段切换由 `state.phase` 驱动，UI 自解释（每个阶段顶部有一句话说明现在该干什么）。

### 4.2 玩家形象
偏真人的身体（SVG 简化人形：肩/躯干/手臂）+ **大号正方体头套**（SVG 画出正面 + 顶面 + 侧面的伪立体），头套正面绘表情。表情随状态切换：等待(平静)、已准备(点头)、已下注(自信)、赢(笑)、输(哭)、破产(X 眼)。组件 `CubeAvatar({expression, role, accent})`。

### 4.3 钱牌系统（核心交互）
- 面额 **10、5、2、1**，由余额**动态贪心分解**生成，从大到小排列，像扑克手牌一样扇形拿着。
- **保留金**：必须留下的最小出资额对应的钱单独放在手牌旁边（锁定区，置灰 + 锁图标），不可选、不可拖。强制全押时锁定区为空。
- **长按拆分**：长按一张钱牌拆成小面额（10→5+5，5→2+2+1，2→1+1）。拆分是纯客户端表现，不发服务端。
- 点选若干张钱牌组成下注额，点确认 → 服务端校验 → 钱牌从 2D UI **无缝飞入 3D 桌面**（FLIP 动画：记录起点矩形，落到桌面投影槽位），反面朝上落在自己面前的桌面上。
- 分钱/结算同样围绕桌上的钱：揭牌时翻面、结算时桌面的钱飞向获益者，FINALIZE 时有"从桌面回到 UI 层手牌"的动画。
- 协商阶段：每个农民的"分到的钱/债务"以钞票牌（债务用红色负面额牌）显示，拖拽到队友头像/卡片上即转移 1 张（即该面额金额）。

### 4.4 客户端文件结构
```
client/src/
  api.js               REST 封装（带 token）
  net/socket.js        WebSocket 封装（自动重连、消息分发）
  store/authStore.js   登录态
  store/gameStore.js   大厅 + 房间 + 游戏状态（服务端 state 镜像 + 瞬态动画标记）
  theme.css            深黑主题 CSS 变量
  assets/registry.jsx  美术注册表：getArt(key) -> 组件；以后换贴图只改这里
  assets/svg/*.jsx     全部 SVG 组件（MoneyNote、Coin、CubeAvatar、图标…）
  screens/LoginScreen  登录/注册
  screens/LobbyScreen  房间列表、三模式入口（经典/竞技禁用态）、在线人数
  screens/GameScreen   场景层 + UI 层的组装
  scene/TableScene.jsx 3D 桌面、座位、桌上钱牌、硬币
  ui/*.jsx             阶段面板、手牌、协商板、聊天、全局栏
  game/notes.js        钱牌分解/拆分/选择纯函数（仅表现层用）
```

### 4.5 主题
```
--bg-0:#08090d  --bg-1:#0e1118  --bg-2:#161b26   (深黑层次，叠加深蓝紫渐变+噪点)
--ink:#f5f7fa   --ink-dim:#9aa3b2               (白色 UI)
--gold:#d8b86a  --danger:#e36262  --ok:#67c587
```
所有组件只用变量，不写死颜色。

---

## 5. 服务端文件结构

```
server/
  config.js        DEFAULT_CONFIG + getInitialBalance/getMinStake + mergeConfig
  modes/index.js   三模式注册表（quick 可用，classic/competitive 占位）
  logic/apportion.js   最大余数法整数分摊（纯函数）
  logic/rules.js       flipCoin / validateBet / settleRound / applyAllocation（纯函数）
  logic/landlordGoal.js 地主资金目标序列/惩罚（纯函数，§3.7）
  test/logic.test.mjs  纯逻辑边界测试（node 直接跑）
  auth.js          注册/登录/会话/在线表/顶号
  storage.js       JSON 文件持久化（users.json、records/*.json），可替换为 DB
  Room.js          房间状态机 + 每玩家视图 + 定时器 + 回合历史
  index.js         Express REST + ws 接入层（薄分发）
data/              运行时数据（gitignore）
```

### 5.1 每玩家视图（隐私边界）`Room.viewFor(playerId)`
- 他人余额不可见（`balance: null`），破产观战者可见全部。
- BETTING 期间他人只见 `hasBet: true/false`，金额保密；REVEAL 起公开本回合 bets。
- 协商分配方案仅农民（和观战者）可见明细，地主只见"农民协商中"。
- `myNotes` 不存在——钱牌分解是客户端表现，服务端只发整数。

### 5.2 服务端数据记录
- 每回合 FINALIZE 时把 `{round, bets, coinResult, settlement, finalAllocation, balancesAfter, bankrupts}` 追加进房间 `history`（内存）并随 state 下发精简版。
- 游戏 ENDED 时整局记录写入 `server/data/records/<日期>-<房间号>.json`。

---

## 6. 默认参数总表（config.js，全部可在创建房间时覆盖）

| 键 | 默认 | 说明 |
|----|------|------|
| initialBalance.farmer | 8 | 农民初始资金 |
| landlordFundMultiplier | 1.2 | 地主初始资金 = 农民总资金 × 该倍数（向下取整） |
| landlordGoal.* | 见下 | 地主资金目标（相对制，§3.7）：enabled/goalMultiplier 1.1/penaltyRate 0.1/minPenalty 2/interval `{min2,max5,mean3.5,sd0.9}`；目标=round(基准×1.1)、间隔正态随机、惩罚平分给农民 |
| minStake.farmer / .landlordPerFarmer | 1 / 1 | 最小出资额 |
| landlordAttrs[role].greed | 1.5 | **贪婪**：地主胜目标倍率 = round(下注 × greed) |
| landlordAttrs[role].squeeze | 1.5 | **盘剥**：对方填不满目标时缺口债务的放大倍率 |
| landlordAttrs[role].rake | 0.5 | **抽成**：对方溢出时地主从溢出里多拿的比例 [0,1] |
| rounding | 'round' | 'round' 四舍五入 / 'floor' / 'ceil'——一切带小数的比例计算（结算三倍率、目标、罚款、税）统一口径 |
| debtAllocation | 'inverseBet' | 'inverseBet'/'equal'/'proportionalBet' |
| farmerSplit | 'equal' | 农民分钱方式 |
| surplusTieBreak | 'highestBet' | 余数单位归属 |
| bankruptcyThreshold | 0 | balance ≤ 此值破产 |
| minFarmers / maxFarmers | 1 / 4 | 人数 |
| timing.betMs | 35000 | 下注倒计时：到点未下注的活跃玩家自动押最小注（强全押区间则全押），系统播报（0=不限时） |
| timing.revealAnimMs | 2200 | 揭牌动画时长（之后等确认） |
| timing.revealConfirmMs | 6000 | 揭牌确认倒计时：到点未确认的自动确认、直接进掷币（0=不限时） |
| timing.coinAnimMs | 6000 | 硬币动画后自动进结算（须 ≥ 客户端 coinSim DURATION 6.0s；落定 ~3–5.2s：抛点高度不一 + 长摆动收尾） |
| timing.settleViewMs | 5200 | 系统结算展示时长（须容纳聚拢→分堆→派送三拍演出，见 §3.8） |
| timing.finalizeMs | 2600 | 全员拿取完成后 → 下一回合的收尾间隔 |
| timing.negotiateTimeoutMs | 30000 | 协商超时（0=不超时） |
| timing.takeTimeoutMs | 45000 | FINALIZE 拿取超时，到点全员自动拿取（0=不超时） |
| timing.takeAutoDelayMs | 2600 | 进入拿取阶段后，代离线玩家自动拿取的延迟（让观众看完演出） |
| reconnectGraceSec | 0 | 断线保座；0=永久保座（永不超时降级），>0=超时降级观战 |
| autoActForOffline | true | 离线玩家自动准备/确认 |
| heartbeatSec | 30 | 心跳 |

---

## 7. 验收清单

1. 注册→登录→大厅→建房（快速）→双开加入→选角色→开始。
2. DISCUSSION：农民频道密聊不泄露给地主；全员准备进入下注。
3. BETTING：手牌按面额生成、保留金锁定、长按拆分、选牌确认、钱飞上桌反面朝上；对手只见"已下注"。
4. REVEAL：翻牌显金额，可聊天，全员确认进硬币。
5. COIN_FLIP：动画后正/反对应地主/农民胜。
6. SETTLE→NEGOTIATE：>1 农民时可拖拽转移钱/债，全员确认生效；1 农民自动跳过。
7. FINALIZE：余额变动正确（含缺口分摊、付不起破产）；钱留在桌上、技能调整逐条演出、按 F 拿取后余额才入账（§3.8）；回合历史落盘。
8. 循环回 DISCUSSION，round+1；地主或全部农民破产 → ENDED，房主可重开。
9. 断线重连回原座位；顶号踢旧连接；大厅在线人数正确。
10. `npm run build` 与 `npm run lint` 通过；经典在大厅显示但禁用（竞技见 §8）。

---

## 8. 竞技模式（`competitive`，本次开放）

> 竞技模式 = 快速模式全部规则 + **角色技能系统**。原 §1 占位的「轮换坐庄银行制」概念作废，由本节角色设计取代。
> 角色技能仅作用于竞技模式；快速模式完全不变。
> 本节数值多为 Draft 0.1，§8.9 标注的「待校准」项依赖实测——先实现机制、再调参（与 `docs/TUNING.md` 同步）。
> 仍遵守 §0：服务端权威、零硬编码（参数集中在 `config.competitive`）、逻辑/表现分离。

### 8.1 阵营与角色

两大阵营，角色在 LOBBY 选定、`start_game` 时锁定并据此计算初始资金：

- **地主阵营**（恰 1 人，二者互斥）：`landlord` 地主 / `capitalist` 资本家。
- **农民阵营**（1–4 人，**可重复**选取，可出现多个同种角色）：`farmer` 基础农民 / `investor` 投资人 / `glutton` 暴食者 / `prosecutor` 检察官。

| 阵营 | 角色 id | 初始资金 | 主动技能 | 被动 |
|------|--------|---------|---------|------|
| 农民 | `farmer` 基础农民 | 15 | — | 工资（§8.2） |
| 农民 | `investor` 投资人 | 12 | 掷币前担保 n（§8.3） | — |
| 农民 | `glutton` 暴食者 | 8 | 农民输时重掷（§8.4） | 饭账（农民胜时扣，§8.4） |
| 农民 | `prosecutor` 检察官 | 4 | 下注前传唤：强制双倍结算（§8.12） | 玻璃大炮（阵营最穷）；对质票 4 |
| 地主 | `landlord` 地主 | ⌊农民总资金 × 2⌋ | — | 资金目标考核（§8.5） |
| 地主 | `capitalist` 资本家 | 钱包(动态) 6n+round(池÷10) + 资金池 农民数×20 | 押注从钱包出、本金必归还（§8.6） | 每「max(2,农民数)」回合按当前池征税（§8.6） |

- **初始资金按花名册**：竞技模式下 `getInitialBalance` 需「按角色名册」计算——先求各农民按其角色初始资金之和 `farmerTotal`，地主 = ⌊`landlordFundMultiplier` × farmerTotal⌋，资本家钱包 = `capitalistWallet`（动态 = 6×农民数 + round(当前池 × `personalPoolShare`0.1)，每回合重算）、资金池 = 活跃农民数 × `poolPerFarmer`(20)。换公式只改这些函数（保持 §0.2 扩展点）。
- 角色身份（哪一种）与现有 landlord/farmer 一样**公开**（座位、头顶名牌显示），用于施压与配合；**技能进度**的隐私见 §8.7。

### 8.2 工资（基础农民被动）

体现「多农民熬死地主」：基础农民越多，滚雪球越快。仅 `farmer` 计发工资（投资人/暴食者有各自机制）。记当前**活跃农民总数**（含投资人/暴食者）为 `m`：

- **发薪间隔** `interval = max(wage.minInterval, wage.baseInterval − (m−1)·wage.perFarmerIntervalReduce)`，默认 `max(2, 5−(m−1))` → m=1..4 得 5 / 4 / 3 / 2。
- **每次工资额** `amount = wage.baseAmount + (m−1)·wage.perFarmerAmountBonus`，默认 `1+(m−1)` → m=1..4 得 1 / 2 / 3 / 4。
- **FINALIZE** 时若 `round % interval === 0`，每个**存活的基础农民**入账 `+amount`（在破产判定前，可救活濒死农民）。

### 8.3 投资人技能：投保（保费制，手牌下保）

- **投保**：投资人**仅在 BETTING、下注确认前**，把手牌拖入「投保槽」（手牌左侧）累积保费 `n ∈ [1, min(investor.maxPledge, 余额)]`（默认上限 3）。**与下注一并提交**（`place_bet` 携带 `pledge`），**下注完成后不可再投保、本回合一次性**。
- **保费即扣**：提交时先扣保费 `n`、再以扣后余额校验下注。表现：确认下注后，下注牌飞上桌、投保槽里的保单牌**一张张掉出屏幕（不上桌）**。农民赢则白付 n、农民输则减债。
- **效果**：若本回合**农民阵营输**（地主胜且 `pot < target` 产生缺口 `shortfall`），把缺口**先减去 `investor.waiveMultiplier × Σn`（默认 2×Σ保费；多名投资人累加，封顶到 shortfall）**，再按 §3.5 的 `inverseBet` 分摊剩余缺口；地主据实少收对应金额（`COIN_FLIP` 时汇总减债总额）。
- 隐私：他人 BETTING 期不可见 n，REVEAL 起公开（与 bets 一致）。右侧玩家列展示投保额与「生效/未生效」状态。

### 8.4 暴食者技能：饭账 + 重掷

主题呼应「暴食」——每回合不停吃饭累积**饭账（成本）**，赢钱时才结清，但能强行干预掷币。

- **饭账 mealAllowance**：每回合 +`glutton.allowancePerRound`（默认 1），是累积的**待扣成本**而非收益。**仅农民阵营赢时**于 FINALIZE 把当前累积额从该暴食者余额**扣除**（记为 `allowanceCharged`），随后清零；扣除在破产判定前，**允许直接扣到破产**（囤饭账有风险）。农民输则饭账继续累积（不结算）。
- **重掷**：当 COIN_FLIP 落定为**农民输**时进入 **REFLIP 决策窗**（仅当场上存在尚有次数的暴食者且农民输时才出现）。**每个暴食者每局重掷次数 = 活跃农民阵营人数**（开局定，`min(农民数, glutton.maxReflips)`；`maxReflips` 默认 4 = 最大农民数、仅作硬上限），且**每回合最多申请 1 次**：
  - 暴食者请求重掷（`request_reflip`）→ 服务端**权威重新 flipCoin**，客户端回放新动画；请求后该暴食者**本回合不再获得决策窗**（`usedReflipThisRound`）。
  - 暴食者可主动**放弃重掷**（`pass_reflip`，不消耗次数）；**全部可重掷暴食者放弃（或离线自动放弃）即提前进入 SETTLE**，不必等满决策窗。
  - 重掷**只消耗 1 次重掷机会**，不影响饭账（饭账只在农民胜时结清）；重掷后仍为农民输则饭账继续累积——但该暴食者本回合已用满 1 次、退出可重掷集，其余**尚未申请**的暴食者仍可继续请求。
  - 任一暴食者使农民转胜、或全部暴食者放弃/用尽本回合机会/用尽次数、或超时 → 退出 REFLIP 窗进入 SETTLE。
- 隐私：mealAllowance 仅本人/观战可见；剩余/总重掷次数（`reflipsLeft`/`reflipsMax`）公开（施压）。
- **多暴食者**：各自独立计数与结清；同一次落定可被多名暴食者接力重掷（但每人本回合限 1 次）。

### 8.5 地主（竞技数值）

规则同 §3.5，仅数值改用竞技档（均为待校准）：

- 初始 = ⌊农民总资金 × `competitive.landlordFundMultiplier`(2)⌋（初始资金仍向下取整）。
- 资金目标沿用顶层**相对制**（§3.7）：目标=round(基准×1.1)、随机 2–5 回合一个检查点、未达标扣 `max(2, round(余额×0.1))` 平分给农民。竞技档不再单独 schedule 覆盖。

### 8.6 资本家（竞技）

风险结构与地主完全不同：**个人资金只是押注用的钱包、本金永远拿回**，真正的血条是**资金池**。

- **个人资金（押注钱包，动态）= `personalPerFarmer`(6)×花名册农民数 + `round(当前池 × personalPoolShare(0.1))`**，**每回合按当前池重算**（`capitalistWallet`，见 Room._beginCompetitiveRound；开局吃开局池 = 6n+round(20n×0.1)=**8n**）。押注把 L 放上桌，但**无论输赢，本金 L 在 FINALIZE 原封不动归还**——故它只是「本回合能押多少」的额度、**不决定破产**。**藏池（农民看不到资金池）+ 动态钱包 → 农民猜不准 L 上限**，是资本家「读牌/骗押」技巧的地基（见下平衡设计）。
- **最小出资额 = `capitalist.minStake`(1)**（固定，不随农民数）。**押注边界 `L ∈ [1, 本回合钱包]`，可全押**（因本金必归还，无需留保留金，也没有强制全押的特殊情形）。
- **资金池 = 真实钱包/血条**：初始 = 活跃农民数 × `capitalist.poolPerFarmer`(20)，承接全部**净盈亏**——FINALIZE 时 `pool += (本回合按地主口径算出的净变动)`，即 `pool += (实际收取额 − L)`（资本家胜为正、农民胜为 `−L`）。本金 L 归钱包、盈亏归资金池，二者不重复计。
- **押注与结算结构**与地主相同（L vs F，`target = round(L × greed)`，正面 = 资本家胜）；`landlordAttrs.capitalist` = **贪婪 1.6 / 盘剥 6 / 抽成 0.4**。**专家向调参**：低贪婪(1.6，仍低于盈亏平衡 g=2)压低「躺赢地板」，高盘剥(6)放大「逼农民填不起→按当前余额巨额罚债」的技巧收益＝高天花板。模拟(真实结算)：菜鸟平push被农民读死 ~30%、高手骗押 ~55%+；技巧空间由盘剥主导（贪婪定高度、盘剥定坡度）。
- **税收**：**每「max(2, 活跃农民阵营人数)」回合征一次**（间隔制，`taxDueThisRound(round, farmerCount)` = `round % max(2,farmerCount) === 0`，`round≥1`；征税回合 FINALIZE 时扣，非征税回合不扣），税额 = `max(capitalist.taxMin, round(当前池 × capitalist.taxRate))`——**按当前池计**（越亏扣越少、给失血的资本家喘息；下限 `taxMin`=2 兜底），单次至多扣到池空，池 ≤ 0 不再扣。间隔随农民数放缓（n≤2 每 2 回合、n=4 每 4 回合；下限 2——1 农民不退化成每回合抽血，2026-07-13）。核心决策：押多大才能让池的净赢盖过周期税、又不被大额回摆拖垮。（版本沿革：2026-07-05 曾改「按开局池恒定、每回合扣」；2026-07-08 定为「间隔=农民数、按当前池」——减轻长期税压、配合资本家偏弱的现状。）
- **无资金目标考核**。**破产**：FINALIZE 后资金池 ≤ 0。**FINALIZE 顺序**：本金 L 归还个人资金 → 净盈亏入资金池 → 扣税 → 破产判定。

### 8.7 阶段 / 协议 / 视图增量

- **LOBBY 选角**：`take_role {role}` 扩展接受 5 种 id；校验阵营人数（地主侧恰 1 人且 landlord/capitalist 互斥；农民侧 1–4、可重复）。`start_game` 时锁定角色并按 §8.1 算初始资金。
- **WS（客户端→服务端）**：`place_bet {amount, count, pledge?}`（`pledge`=竞技投资人投保，§8.3）、`request_reflip {}`、`pass_reflip {}`。
- **新增子阶段**：COIN_FLIP 后、SETTLE 前的条件式 **REFLIP** 窗（§8.4）；无暴食者或农民未输时直接跳过（与「≤1 农民跳过 NEGOTIATE」同模式）。
- **viewFor 增量**（隐私边界）：每人见自身 `role`；按角色下发——基础农民 `wage:{interval, amount, roundsToNext}`（公开，可施压）；投资人 `pledge`（REVEAL 起公开，之前仅本人）；暴食者 `mealAllowance`（本人/观战）+ `reflipsLeft`（公开）；资本家以 `capitalist:{pool, tax, personal}` 取代 `landlordGoal`（`pool/personal` 仅本人/观战，`tax` 公开）；地主侧仍下发 `landlordGoal`。

### 8.8 config 增量（`server/config.js`）

竞技参数集中在 `DEFAULT_CONFIG.competitive`，Room 在 `mode==='competitive'` 时合并生效；`modes/index.js` 把 `competitive.available=true`、`roles` 改为 5 种、描述改为角色技能制。

```js
competitive: {
  initialBalance: { farmer: 15, investor: 12, glutton: 8 },
  landlordFundMultiplier: 2,
  capitalist: { personalPerFarmer: 6, poolPerFarmer: 20, personalPoolShare: 0.1, minStake: 1, taxRate: 0.10, taxMin: 2 }, // 钱包动态=6n+round(池×0.1)
  landlordAttrs: { capitalist: { greed: 1.6, squeeze: 6, rake: 0.4 } }, // 专家向：低贪婪压地板、高盘剥抬天花板
  wage:    { baseInterval: 5, minInterval: 2, perFarmerIntervalReduce: 1, baseAmount: 1, perFarmerAmountBonus: 1 },
  investor:{ maxPledge: 3, waiveMultiplier: 2 },
  glutton: { allowancePerRound: 1, maxReflips: 4 }, // 每局重掷 = min(农民数, maxReflips)；maxReflips=maxFarmers 仅作硬上限
  // landlordGoal 沿用顶层相对制（不再单独 schedule 覆盖）
}
```

纯逻辑（工资、担保减债、伙食费、税）放入 `server/logic/`（可单测）；REFLIP 窗与计时归 `Room.js`。

### 8.9 待校准（实测，见 `docs/TUNING.md`）

工资 interval/amount 缩放、投资人 `waiveMultiplier`、暴食者 `allowancePerRound`/`maxReflips`、地主目标 `goalMultiplier`/`interval`、资本家 `poolPerFarmer`/`taxRate` —— 全部待数值测试。原设计稿的 4 个平衡问题逐条对应这些参数：① 资本家 vs 地主的选择平衡；② 暴食者多农民局强度；③ 工资流 vs 地主考核增速的互相牵制；④ 地主目标具体数值。

### 8.10 验收增量

- 大厅竞技可建房；选角校验（地主侧互斥恰 1、农民可重复）；初始资金按花名册正确。
- 工资按活跃农民数缩放、按间隔发薪；投资人保费先扣、农民输则减债 2n；暴食者饭账仅农民胜时扣除（可扣破产）、农民输则继续累积、重掷只消耗次数不影响饭账；资本家资金池押注/税收/破产、个人资金不动。
- REFLIP 窗仅在有暴食者且农民输时出现，离线暴食者自动放弃（`autoActForOffline`）。
- 快速模式行为零变化；经典模式仍禁用。

### 8.11 对质 / 指控（2026-07 加入）

**动机**：硬币公平但「一边倒偶发局」让输方无事可做。对质给农民阵营一个**读牌反制**的主动权——不改硬币、不退钱，而是开辟第二条击杀线（KPI/税压制），与资本家「藏池骗押」技巧天然对冲。F.A.T.E. 本就有可对质的「谎」：暗注只公开**张数**、藏**面额**。

**相位**：新增 `CHALLENGE`，仅竞技、夹在 `BETTING` 与 `REVEAL` 之间。全员下注后，若有农民凑得齐票则进入，否则（快速模式/无人有票）直接揭牌。

**票**：每角色**按局**发放（农民阵营专属、非共享池）：农民 3 / 投资人 2 / 暴食者 0（检察官 4，下一步实装）。一次指控**恒扣 2 票、任何情况不返还**（猜对、猜错、取消皆然）；不满 2 票不可发起。票可在 **NEGOTIATE 阶段转赠**队友（`transfer_ticket`，任何转赠重置协商确认）。

**比较基准**：敌方暗注 vs **农民阵营本回合总注**（Σ 农民 stake，不含投资人保费）。对质窗**对农民/观战公开阵营总额**（个人注仍隐藏到揭牌），不公开给地主。

**时序**（子状态由 `Room.accusation` 是否为 null 区分）：
- **决定窗（IDLE，默认 `timing.challengeMs`=30s）**：农民可 `accuse` 或 `challenge_skip`。全体活跃农民同意跳过（离线自动满足）或到点无人指控 → 揭牌。
- **交流窗（DELIBERATING，≤`timing.accuseDeliberateMs`=25s 上限）**：发起后开，等发起者 `accuse_resolve`（选 more/less）或 `accuse_cancel`（票不退、回决定窗、重置决定窗计时）。超时 → 自动取消并直接揭牌（整段硬上限）。

**结果**（服务端在 `accuse_resolve` 即判定右/错，惩罚在 **FINALIZE** 落地，复用现有检查点数学）：
- **猜对**：置 `_forceGoalCheckpoint`（地主）/ `_forceTax`（资本家）。FINALIZE 时地主额外评估一次目标（门控 `scheduledGoalDue || _forceGoalCheckpoint`，罚金平分农民）但**不重定基**（不重置间隔）；资本家额外 `computeTax` 扣一次。同回合排期+强制 = 只评估一次、走排期重定基，**不双罚**。目标被 config 关闭 / 资本家池空 → 命中但无实质（边界，接受）。相等注 → 判错。
- **猜错**：无额外效果（丢 2 票即足够惩罚；去掉了原案「重置敌方间隔」那条会帮敌人的设定）。

**协议**：新增 `accuse` / `accuse_resolve` / `accuse_cancel` / `challenge_skip` / `transfer_ticket`；`viewFor` 新增 `challenge`（deadline/accusation/factionTotal(农民可见)/targetId）、`lastAccusation`、`players[].tickets/challengeSkip`、`me.tickets/canAccuse/myAccusation`。`betsPublic` 加 `CHALLENGE`（暗注仍藏）。离线：决定窗离线农民自动满足跳过闸门，交流窗发起者离线自动取消。

**客户端（全 3D 桌面浮字，§阶段五范式）**：整套对质走 `FeltPrompts` 桌面浮字，**底部 2D 面板仅 `?input=2d` 保留**（`ChallengePanel` 在 3D `return null`）。**指控入口即自己圈上浮字「指控敌方 [Z]」**（点浮字或按 Z=`useGameKeys`；敌方唯一无需选目标）——**不再有敌方模型描边/头顶浮字**（试过后处理 Outline〔three r184 静默失效〕、反向外壳〔深盒透视太细〕、EdgesGeometry 线框〔看穿式笼子、桌下穿帮〕，均做不出干净效果，整体去除）。发起者在自己圈上浮字用 **`敌注 [> / <] 己方总注` 选择器**（`ChallengePick`：上下紧叠大于/小于，悬停只提亮无背景块）+ 倒计时（`FloatCountdown`）+ 取消——**两段确认**：第一击 `accuse_pick` 只预选（选中符号放大、另一个略缩变暗；`pendingDir` 服务端广播、仅农民阵营/观战可见），再点已放大的那个才 `accuse_resolve` 落定，可反复改选；**队友（其他农民）同步观看该选择器（只读，含预选态）+「等待 名（身份）操作」**，无法操作；农民决定窗 `指控敌方 [Z]` / `跳过`（跳过后浮字显示 `已跳过 N/M`）+ 阵营总注 + 倒计时。**对质窗桌面所有注在场但面朝下**（`betsVisible` 排除 CHALLENGE，金额仍藏、读牌靠张数，REVEAL 才翻）；左上 `TicketHud`：**有几张画几张手绘像素票券**（`PixelTicket`，无数字；0 张则一个暗色轮廓票占位），不显示可指控次数/进度条。**票券像素画单一真源 = `assets/ticketArt.js`**（素面邮票：28×18 程序生成网格——左右粗锯齿〔2 格宽×2 格深、齿距 2 格〕+暗金边框+带纸纹的纸面〔`ticketCellColor` 逐格配色：内圈斜面高光/阴影+哈希撒点颗粒〕，无图案），2D SVG / 3D 贴图（`textures.js#ticketTexture`）/ 3D 锯齿挤出几何（`Tickets3D.jsx#ticketGeometry`，有纸厚、锯齿在**模型上**真实建模、随网格分辨率变细）三处共用。对质窗内自己圈前摆一小排 3D 票（`Tickets3D`；间距>票宽不重叠，>4 张换排；扣票即少张）。**转赠 = NEGOTIATE 拖票**（PayoutLayer：每个农民圈前一排 3D 票，自己的可重力枪拖到队友圈 = `transfer_ticket` +1，乐观票数顶显；**落手飞行**：转赠成功弧线飞进队友排末位、未落到圈弧线飞回自己排——`TicketArc`，飞行期落点排少显 1 张防重影；2D 按钮条 `TicketTransfer` 仅 `?input=2d` 保留）。**地主目标对农民只显倒计时**：`viewFor` 对非地主非观战剥离 `goal/baseline/initial/landlordBalance`，`GoalHud` 农民分支只渲染「地主目标：X 回合后结算」（对质靠读牌，不该直接看到 KPI 数字）+ 原样进度条（外环 + 进度不可知暗斜纹）；目标卡 `goal-fixed` **定宽=进度条长**，被命中多出的「⚠强制结算」换行、不拉长卡与条。**被命中反馈**：地主/资本家的左上制约卡（GoalHud/CapitalistHud）红闪+抖一下 + 持续红左条 + `⚠强制结算/扣税` 标，由 `lastAccusation.correct && targetId===本卡主` 驱动，持续到 FINALIZE 落罚（下回合 DISCUSSION 清）。**后续**：地主贿赂（为 120s 交流窗注入戏与反制）。

### 8.12 检察官 / 传唤（2026-07-10 加入）

> 设计动机：对质吸收了检察官原案（花钱逼结算）后，检察官重定位为**确定性法器**——普通对质是「赌」（读牌、猜多少、可能落空），传唤是「买」（花钱、必然开庭、免猜）。数值经模拟定稿（无脑刷/噪声读/全知/供养四策略 × nF 2-4，见记忆 role-attrs-balance-design）。

- **角色**：`prosecutor` 农民阵营，初始资金 **4**（玻璃大炮——身板代价被「地主初始=农民总×2」系统性对冲，落在个人破产风险上），对质票 **4**。
- **传唤（主动技）**：**BETTING 阶段、自己下注前**、每回合至多 1 次、不限总次数。
  - **费用** = `round(本回合农民数 × 1.5^本局已传次数)`（**150% 递增**，`summonCost`），当场从检察官余额扣除、**进虚空**；须扣后仍够最小下注额。递增费是平衡核心：单局次数被指数费用封顶（~3 次）、「全队供养刷传唤」自动变亏本买卖（模拟实证：供养流反而让地主胜率回升）。
  - **效果**：正式考核**提前开庭**——本回合 FINALIZE 按 `penaltyMult`(2) 倍结算敌方制约：
    - 地主：未达标 → 罚 `2 × goalPenalty`（封顶到余额），**罚款上缴国库（进虚空，不分农民）**——切断检察官「罚金分成→付下次费」的自供血回路（模拟定稿）；随后**重定基 + 重抽间隔**（与排期检查点同构，就是那次考核提前了）。
    - 资本家：`2 × computeTax`（封顶到池）+ **税钟锚点归到本回合**（`taxAnchorRound`，下次排期税从传唤回合重新起算——传唤自带的「资敌面」）。
  - 免猜、必然开庭：对方达标则无罚（钱白花 + 帮对方重新排期），这是检察官的技巧面——**从公开信息推断对方虚实**（目标值/余额对农民隐藏）。
  - **同回合互斥**：传唤后本回合不能再发起对质（`usedSummonThisRound`）。同回合排期/对质强制/传唤并存只评估一次，传唤语义优先。
- **协议**：`summon {}`（BETTING）；错误路径：非检察官/已下注/本回合已传/资金不足/快速模式。`viewFor`：`me.canSummon/summonCost/summonsUsed/usedSummonThisRound`（门槛服务端整算直发）；`players[].summonsUsed` 公开（施压，同 reflipsLeft）；`lastSummon {byId,targetId,cost,round}` 公开（驱动被传唤方制约卡 `⚠强制双倍结算/税` 告警，下回合下注前清）。
- **演出**：adjust step `source: summonPenalty/summonTax`（label「传唤双倍罚款上缴国库/传唤双倍税」，flows→void=钱飞向虚空收缩消失，客户端零改动）；系统聊天播报传唤。客户端入口=下注期自己圈**东北副浮字「传唤（¥N）[C]」**（C 键=useGameKeys；已传显示确认态）。
- **美术**：检察制帽（深藏青帽墙+宽平顶+正面金徽，`headProps.js`）；制服（藏青对襟+白衬领+金纽扣列+左胸检徽，`texlib.js#drawBodyFront`）；配色 `palette.js` `procNavy/procNavy2` + `ROLE_CLOTH.prosecutor`。
- **模拟结论（定稿依据）**：基线（无检察官）地主胜率 nF=2/3/4 → 36/32/30%；国库版检察官在场（噪声读）→ 29/24/30%（−7~−8pp，nF=4 因费用门槛自限≈0）；检察官个人破产率 65~74%（烈士角色）；本角色**无技巧梯度**（免猜的命中率=地主线下基础概率），定位为「确定性压力阀」，技巧角色由资本家承担。

---

## 9. 单人模式（`single`，规格 Draft 0.1 · 2026-07-11 定稿）

> **设计哲学（与多人模式刻意相反的四条）**：①重点是**角色搭配与技能耦合**，不是心理博弈——猜 AI 的暗注没有乐趣；②**随机性最小化、属性可记**——砍掉一切随机间隔/动态数值，参数能印在卡面上；③**不追求公平**——PvE 允许碾压级组合（Roguelike 爽点）与更强的 Boss，平衡靠战役梯度不靠对称；④**技能应削弱硬币的影响**——单机看实力。统一设计标尺：**每个角色 = 一种对硬币方差的操作原语**（幸运儿改分布 / 暴食者重抽样 / 投资人削下行 / 幽灵贬敌胜局 / 检察官无视硬币的确定性输出）。新角色（幽灵/幸运儿）**仅单人模式可用**。

### 9.1 结构变更（相对竞技模式）

- **队伍化**：对战双方是**队伍 A/B**，可以同阵营对战（农民队 vs 农民队、地主队 vs 地主队）。硬币语义从「正=地主/反=农民」改为映射到队伍。**玩家操控己方整队**（下注/协商/技能都由玩家给每个座位下令——协商期给自己队分账天然成立）；**敌方 = 脚本 Boss**（按 Boss 卡人格出注，非通用 AI）。
- **地主阵营队伍 ≤2 人，有且仅有一位「核心人物」**（地主即核心）；核心死亡 = 队伍覆灭。多地主侧成员时**按阵营总注结算**，赢资按出资比例分、亏损同理；贪婪/盘剥/抽成一律取**核心**的那套（附属位是功能角色，无三属性）。
- **无对质系统**（对质票/CHALLENGE 相位整体不存在；检察官只保留传唤）。
- **对称结算（同阵营对战）**：双方都无三属性时，胜方按**出资比例**瓜分败方总注；无缺口、无乘数放大。投资人的减免在对称局作用于**输掉的注金本身**（返还），因此不空转。
- 敌方暗注建议做**意图电报**（Boss 本回合出注档位半明示，读牌变解题）——待实测手感定。
- 农民人数固定按 4 设计；战役进度前期只解锁 2 席、逐步放开（Boss 资金随关卡而非全局常数配平）。

### 9.2 角色数值（单人专属口径；未列出者沿用竞技）

| 角色 | 单人改动 |
|------|---------|
| 农民 | 初始 **20**；工资=每 **2** 回合 **2**，场上每多一个农民 **+1**（4 农民 → 5/人/2回合） |
| 投资人 | 保金上限固定 **6**；只要己方输，保金即减免应付款——**含输掉的注金本身**（对称局=返还） |
| 暴食者 | 饭账**每回合固定扣除、无视输赢**；重掷次数固定 **3** |
| 检察官 | 监管（传唤）费固定 **农民数×2**、**不递增**；两次监管至少间隔**农民数**回合；对质票不存在 |
| 地主 | **无资金目标考核**；可被检察官监管损失 **2×监管资金**；初始 **65**（战役分段调整，或改随农民数缩放）；三属性按 Boss 卡（见 §9.4） |
| 资本家 | **暂不加入**单人模式 |

### 9.3 新角色

- **幽灵（`ghost`，地主阵营附属位，唯一）**：初始 = 敌方农民数×4，资金随队友数动态重算。注金参与结算（计入阵营总注/彩池），但**分配到幽灵的钱和债凭空消失（进虚空）**；无论输赢**永远收回自己的注金**；敌方胜局的彩池里幽灵那份是幻影——**敌方实拿变少**。不破产，随核心死亡。**注金必须严格小于队友（核心）注金**（防无限虚张）。账目走 §3.8 的 void 流，演出零新机制。
- **幸运儿（`lucky`，双阵营可用）**：初始 **2**。被动：己方硬币胜率 **+10%**（敌我幸运儿可互相抵消）；每当敌方获胜，自己资金 **−1**、下一次己方胜率**额外 +5%**（连败累计、己方获胜清零、**封顶 +15%**；重掷继承当次概率、不重复叠加）。天然是「约 5 回合的概率窗口」消耗品。
- **叛徒（`traitor`）——搁置**：反相关对冲设计（盈亏=敌方最高收益/最低亏损、镜像收益锁定、主动牺牲兑现）保留存档；搁置原因=机制复杂度预算 + 模拟证实对单体 Boss 结构性秒死（敌方唯一成员的「最低亏损」=Boss 整注亏损，打在 6 资金身上）。

### 9.4 Boss 三属性梯度（反龟缩 + 收敛器，模拟定稿）

人机的 G/S **不按常规数值**——上调既是难度旋钮也是对局收敛器（治超时）与反躺赢器。基准数字（4 农民初始 20、Boss 65 押 35%、玩家全员最小注「龟缩」的胜率 = 无技能地板）：

| Boss 卡 | G/S | 龟缩地板胜率 | 超时率 | 平均局长 |
|--------|-----|------------|-------|--------|
| 简单 | 2 / 1.5 | 30% | 19% | 19 回合 |
| **基准** | **2 / 2** | **22%** | **10%** | **15 回合** |
| 困难 | 2.5 / 1.5 | 11% | 9% | 14 回合 |
| 噩梦 | 2.5 / 2 | 7% | 2.5% | 10 回合 |

**结构性结论（接受不修）**：农民侧押注大小近乎无关（队伍单回合上限=Boss 注金，与己方注无关；rake 扫到 0.3 结论不变）——注金退化为门票，玩家表达全在技能与搭配，与设计哲学①自洽。其余模拟锚点：幽灵使 Boss 胜率 +11pp、局长 −7 回合；投资人把 Boss 胜率 70%→52~59%；幸运儿 +10% 全程把己方 5.6%→21.6%；幸运儿×暴食者重掷窗口内单回合胜率 84%（=1−0.4²，认证毕业组合）。

### 9.5 实现地图

- **结算独立成模块**：`server/logic/settleSingle.js` 纯函数（对称结算 / 多地主按比例分 / 幽灵幻影记账），与 `settleRound` 并列、各自测试，不魔改多人结算。
- **队伍化重构点**（多人代码的单侧假设）：`factionOf` 静态映射、`Room._landlord()` 单例、`roundFarmerIds`、`viewFor` 阵营隐私、payout 脚本的「地主」指向、硬币→阵营映射。
- 参数全走 `config.single`（工资/饭账/重掷/监管费与冷却/幸运儿概率/幽灵系数），角色升级 = per-run config 增量合并（§0.2 扩展点白嫖）。
- 模式注册 `modes/index.js`：`single`（`available: false` 占位直至可玩）。文案：`text/zh.js` 未来加 `rolesSingle` 命名空间（单人角色手册与多人数值分叉）。
- 模拟脚本：scratchpad `single-sim.mjs`（真实 settleRound + 各角色外挂，4000 局/格）——参数改动先过模拟再进 config。

### 9.6 接线与交互 v2（长桌对坐 + 自由走动/附身 + 桌边选角）

- **会话层** `server/single/session.js`：`SingleSession` 把 `SingleTable.view()` 适配成**与多人 `viewFor()` 同形的 state**——现有客户端（Scene3D/HandLayer/PayoutLayer/UiLayer）零结构改动即可渲染。相位映射：`COMMAND→BETTING`、`REFLIP→REFLIP`、`ALLOCATE→NEGOTIATE`、`ENDED→ENDED`；席位=players（Boss 挂 landlord 位）；`me`=当前操控席位。
- **组队期（SINGLE_SETUP 相位）**：`single_start`（无参）先进组队期——4 个席位槽 `single_role {slot, role|null}` 循环选角、`single_ghost {on}` 切幽灵、`single_begin` 才构造 SingleTable 开打。**槽位=桌边固定座位**（players[].seat 保留组队所选槽，Boss 恒 seat 4）。测试/脚本仍可 `single_start {teamRoles}` 直启跳过组队期。
- **WS 协议**：`single_seat {seatId}` 切换操控席位；其余**复用既有消息名**（`place_bet`/`summon`/`request_reflip`/`pass_reflip`/`negotiate_transfer`/`negotiate_confirm`），index.js 在 ws 挂着单机会话时优先路由给它（`look`/`chat`/`emote` 静默吞掉）。全部席位下注即自动 resolve（同多人 `_checkAllBet`）。
- **场景 = 单人专属长桌**（不复用多人环桌）：毡面 8.6×4.0，玩家队 4 槽沿 +z 长边一字排开、Boss 独坐 −z 对面，两阵营对坐；场景不随席位旋转（rot=0）。桌两端麻绳立柱隔离带把 Boss 半场拦起来（走动边界的可见理由）。
- **相机双态**（客户端 `singleCam`，纯表现）：**walk 全局走动（MC 心智）**——指针锁定：点击画布锁鼠标、移动鼠标直接转视角（中央准心），ESC 释放后鼠标可点 UI；WASD 平移带惯性（加速/摩擦滑停），行走步伐颠簸 + 横移侧倾（Teardown 手感）；夹在己方半场，桌椅有碰撞箱；触屏退化为拖动转视角。↔ **seat 附身席位**（沿用多人落座第一人称手感）。切换：点席位芯片/Tab=附身，走动锁定中**准心对准队友点击**=附身（未锁定也可直接点模型），X/起身按钮=回走动；两态同一套阻尼收敛，起身/落座无跳变。下注等桌面交互在附身态进行（HandLayer 只在附身时挂载）。**坑**：点模型附身只开放给走动态——落座时 r3f 射线会穿透手牌命中身后队友，点牌会被误判成切席。
- **左下角席位列**（SeatBar）双态：组队期=槽位选角+幽灵开关+开局按钮；对局期=附身/切席/起身 + 已下注/破产状态标。
- **Boss**：现阶段只有一个（`bosses/basic.js` BOSS，attrs=base 档、押 35%），不做人格三选——玩法优先（用户裁决 2026-07-12）；难度档位表留在 `config.single.boss.attrs` 供战役梯度。出注金额仍暗、张数照多人惯例可见。

#### 交互 v3（准心指挥，用户裁决 2026-07-12）

- **暂存注模型（会话层）**：COMMAND 期各席位持有暂存注（默认=保底 1，不可收回）+ 投资人暂存保金；`single_bet_adjust ±1`、`single_bet_allin`（自愿全押=合法，SingleTable 单人放行）、`single_pledge_adjust`；`single_flip` 整批落账 → 掷币。**下回合默认继承上回合注法，余额不够则夹紧尽量下注**（保金不继承）。检察官监管的时序约束随之软化为"开掷前"。
- **准心即指挥**：走动锁定中，准心指队伍下注圈=左键 +1 / 右键 −1 / Shift+左=全押 / Alt+左右=投资人保金±1；指中央硬币圈左键（或空格）=开掷；指队友身体=附身。圈上方浮字实时显示暂存注额（+保金），中央浮字「开掷」。单人**不挂 HandLayer**（拖牌下注是多人交互）。
- **全程指针锁定（用户二轮收紧）**：进游戏即锁、**任何相位不放开**（组队/协商/重掷都锁着），出口只有三个——①**按住 CTRL** 临时放开（松开回锁；组队选角、协商拖钱、重掷按钮都经此通道）②面板类 UI 打开（`gameStore.panel`：设置/规则/角色墙/账本）③终局 ENDED。附身也保持锁定：落座环视改由移动增量驱动（seatLook），不再依赖绝对光标。ESC 被浏览器强制退锁不可拦 → 任意按键/点画布**静默回锁**（无提示文案）。锁定建立后的首帧 mousemove 可能携带锁前光标整段位移（Chrome 历史 bug，headless 必现）——吞首帧 + >200px 尖峰钳制。操控席位破产 → 服务端自动切到第一个存活席位。
- **HUD 减法**：单人无右上玩家栏；所有模型头顶只挂剩余资金（¥=蜡烛字形），不显示名字；席位列只留 破产/操控中 标。

#### 交互 v3.1（技能入口准心化，2026-07-13）

三个仍依赖面板/切席的技能入口全部收编进准心文法（与下注圈 ±1 同一套心智），面板/CTRL 通道保留为兜底：

- **检察官·监管 = 瞄 Boss 左键**：下注期任一检察官席位满足门槛（未监管/冷却毕/付得起）时，`view().single.summon = {seatId, cost}` 直发可用性；准心指 Boss 身体出现 `summon:<seatId>` 目标 + Boss 头顶浮字「监管 ¥费 [左键]」（瞄准即显）。点击发 `summon {seatId}`——**无需先切席到检察官**。会话层扣费后把该席位暂存注重夹到新余额。
- **暴食者·重掷 = 瞄硬币左键/右键**：REFLIP 期硬币停在桌上（败面朝上），准心指硬币出现 `reflip` 目标，硬币上方浮字「重掷（剩 N）[左键]／认输 [右键]」。`request_reflip` 服务端**自动路由到可重掷的暴食者席位**（一人指挥全队，操控席位无需是暴食者）；ReflipPanel 走动态退役、附身态改单人分支（同样不要求操控暴食者）。
- **协商转移 = 瞄队友圈 左键送/右键取**：NEGOTIATE 期准心指队友下注圈出现 `pile:<seatId>` 目标——左键=从操控席位送 1 给他、右键=从他那取 1 回来、按 Alt=挪债务而非收益；`negotiate_transfer` 增加可选 `fromId`（缺省=操控席位，兼容 CTRL 重力枪拖拽路径）。转移动画走 PayoutLayer 既有 reconcile（服务端回包 → 差异飞牌），零编导层改动。空格=确认分配（原有）。
- 左下席位列的走动提示随相位切换（下注/重掷/协商三套文法）。
