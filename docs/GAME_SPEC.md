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
- **断线重连**：游戏中的玩家断线后座位保留 `reconnectGraceSec` 秒，期间重新登录并 `join_room` 同一房间会回到原座位、原余额；离线玩家需要的"准备/确认"自动视为通过（`autoActForOffline`），避免卡住全场。

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
ready              {}                    // DISCUSSION 阶段点准备
place_bet          {amount}              // BETTING
confirm_reveal     {}                    // REVEAL 阶段确认
negotiate_transfer {toId, kind: 'take'|'debt', amount}   // NEGOTIATE，把自己的钱/债转给队友
negotiate_confirm  {confirmed: bool}     // NEGOTIATE 确认/撤销确认
chat               {channel: 'public'|'farmer', text}
restart_game       {}                    // 仅房主，ENDED 内
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
LOBBY ──房主开始──► DISCUSSION ──全员准备──► BETTING ──全员下注──► REVEAL
   ──全员确认──► COIN_FLIP ──动画定时──► SETTLE ──定时──► NEGOTIATE
   ──全部农民确认(或超时)──► FINALIZE ──定时──► 破产判定 ──► DISCUSSION(下一回合) 或 ENDED
```
- **DISCUSSION（讨论/准备）**：游戏从讨论开始；农民可在农民频道密谈战术（频道可切公开/农民私聊；语音接口预留）。地主与农民都要点"准备"，全员准备进入下注。
- **BETTING（下注中）**：见 3.3。已下注玩家对他人显示"已下注"（反面牌），金额保密。
- **REVEAL（揭牌）**：系统播放翻牌动画展示每个人出的金额；期间允许发言；**所有活跃玩家点确认**后进入掷硬币。
- **COIN_FLIP（掷硬币）**：播放抛硬币动画；**正面 = 地主胜，反面 = 农民胜**；`coinAnimMs` 后自动进入系统结算。
  - 动画用**客户端预烘焙动画池**：`scene/coinSim.js` 以确定性**两段式平面物理**（弹跳翻飞 → 贴台衰减摇摆 → 躺平，见该文件头注释）离线模拟若干轨迹，按落定朝面分桶到正反各 `POOL_SIZE`（24）条并缓存；服务端权威决定 `coinResult` 后，客户端从对应池随机取一条回放（保证不穿桌；落定为真实翻转硬币的**平面翻滚 + 摇摆**而非陀螺式绕边打转）。**抛点高度每回合不同 + 短滞空 + 落台后较长的翻滚/摆动收尾**（约 8 次摆动）→ **落定时间 ~3–5.2s**；摇摆用平滑势 −sin(2·rx)，硬币立起后会自然倒下继续动、绝不被瞬间放平。故 `coinAnimMs` 须 ≥ 客户端 `DURATION`（6.0s）以免最长抛掷被打断。
  - **公平观感设计**（结果本就服务端 50/50，难点在让动画「看起来」公平）：① 起始朝面 50/50 随机，开局不暗示结果；② 高速自旋使滞空成「糊影」、人眼无法追踪正反 → 落定前有悬念、像真随机；③ 飞行参数对正反同分布、盲采后按落定面分桶 → 过程不泄露结果；④ 回放期叠加绕竖轴偏航 + 水平镜像（均不改变朝上的面）→ 同一条轨迹每次都不同，消除「在放固定录像」的观感。
- **分钱（四个子阶段）**：
  1. **SETTLE 系统结算**：服务端按 3.5 计算默认分配方案并展示，`settleViewMs` 后自动进入下一步。
  2. **NEGOTIATE 农民协商**：每个农民以钞票牌形式看到分给自己的钱或债务，可拖拽给队友（金额守恒，仅在农民之间转移）。任何变动会重置所有人的确认。全部活跃农民确认（或 `negotiateTimeoutMs` 超时按当前方案）后生效。若只有 1 个活跃农民、或本回合农民既无钱可分也无债可摊，则自动跳过。
  3. **FINALIZE 正式结算**：按最终方案入账（桌上的钱播放回到各家 UI 层的动画），记录回合历史，判定破产。
  4. **农民讨论**：即下一回合的 DISCUSSION——结算后回到讨论阶段，农民复盘战术、全员再点准备，形成循环。
- **ENDED**：地主破产 → 农民胜；全部农民破产 → 地主胜。展示结果，房主可"再来一局"（重置资金回到第 1 回合 DISCUSSION）。

### 3.5 结算规则（默认；全部走 config，可替换）
记地主下注 `L`，农民下注合计 `F`，桌面总额 `pot = L + F`，目标 `target = floor(L × landlordWinMultiplier)`（默认 1.5；取整保证整数钱）。

**正面（地主胜）：**
- `pot ≥ target`：地主拿走 `target`；多出的 `R = pot − target` 地主再拿 `floor(R × 0.5)`（`surplusLandlordShare`，取整方式 `rounding: 'floor'`，**预留改 ceil 或进入协商分配**），剩余归农民平分（最大余数法取整）。
- `pot < target`：地主先拿走整个 `pot`；缺口 `shortfall = target − pot` 由农民**用手里余额共同补足**（"补足不够的部分"）。
  - 债务分摊默认 **`inverseBet`（谁出的多谁补的少）**：以 `wᵢ = 1 / betᵢ` 为权重做**最大余数法**整数分摊（科学分摊、只出整数、误差最小）。可配置为 `equal`（均摊）/ `proportionalBet`（出得多摊得多）。
  - 每人实际支付 `min(份额, 余额)`；付不起的人付光破产，残余缺口在未封顶的农民间按同法递归重摊；全员都付不起则地主只拿到实际收到的部分。
  - **补偿精确入账**：地主拿到 `pot + 农民实际补偿`，补偿多少地主就多拿多少；FINALIZE 时按最终（可能经协商）的债务实收重算 `uncovered = max(0, shortfall − collected)`，使展示与入账一致。
- 协商阶段农民可以在彼此之间转移"分到的钱"（take）或"分摊的债"（debt）。
  - **债务可压垮队友**：不限制对方余额，允许把全部债务堆给一名农民使其破产；落账时该农民只付出全部余额，地主只收到这点钱，其余缺口作废。

**反面（农民胜）：**
- 农民**直接平分** `pot`（`farmerSplit: 'equal'`，最大余数法）；除不尽的余数单位默认给下注多的农民（`surplusTieBreak: 'highestBet'`，可配置），协商阶段可再调整。
- 地主本回合净损失 `L`（他下的注归入 pot 被分掉）。

**破产**：FINALIZE 后 `balance ≤ bankruptcyThreshold`（默认 0）即破产，成为观战者（可见全部信息、可聊天、不再参与回合）。

### 3.6 整数与误差原则
所有入账金额必为整数。凡是按比例分配，统一用 `logic/apportion.js` 的**最大余数法**：先地板取整，再把剩余单位按小数余量从大到小逐个分配（并列时按 `surplusTieBreak`）。保证"份额之和恰好等于被分配总额"，误差不超过每人 1。

### 3.7 地主资金目标（`config.landlordGoal`，纯函数见 `logic/landlordGoal.js`）
为地主设置一系列**检查点**：每过若干回合地主必须使资金达到一个目标，否则在**该回合 FINALIZE（押注后资金分配完成时）**受罚。检查点由 `config.landlordGoal.schedule` **显式列出**。

- **检查点序列**（记地主初始资金 `B`）：`schedule` 每项 `{interval, multiplier}` 表示「再过 `interval` 回合，目标 = `floor(B × multiplier)`」；累计回合 `R_k = Σ interval_j`。超出列表后按**最后一项**重复（维持最高目标）。
  - 默认：`2/0.6 → 2/1.0 → 3/1.5 → 3/1.8 → 5/2.0`，即检查点回合 `2, 4, 7, 10, 15`，目标 `floor(B·0.6) … floor(B·2.0)`，之后每 5 回合维持 `2.0` 倍。
- **惩罚**：检查点回合 FINALIZE 时若地主余额 < 该目标，扣除 `max(minPenalty, floor(余额·penaltyRate))`（默认 `max(2, floor(余额·0.2))`）。**惩罚资金按最大余数法平分给本回合农民**（在破产判定前入账，可能救活濒临破产的农民），可直接使地主破产 → 农民胜。
- **展示（合理显示在每个人的 UI）**：`viewFor` 下发 `landlordGoal = { goal, dueRound, roundsLeft, initial, landlordId, landlordBalance }`——目标值与到期回合对所有人可见（给农民施压、给地主紧迫感）；`landlordBalance`（进度）仅地主本人/观战者可见（隐私边界）。FINALIZE 面板播报达标/受罚。
- 默认参数与调法见 `docs/TUNING.md`。

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
| landlordGoal.* | 见下 | 地主资金目标（§3.7）：enabled/schedule（默认 `2/0.6,2/1.0,3/1.5,3/1.8,5/2.0`）/penaltyRate 0.2/minPenalty 2；惩罚平分给农民 |
| minStake.farmer / .landlordPerFarmer | 1 / 1 | 最小出资额 |
| landlordWinMultiplier | 1.5 | 地主胜目标倍数 = floor(下注 × 该倍数) |
| surplusLandlordShare | 0.5 | 盈余中地主再拿的比例 |
| rounding | 'floor' | 'floor'/'ceil'，预留协商分配 |
| debtAllocation | 'inverseBet' | 'inverseBet'/'equal'/'proportionalBet' |
| farmerSplit | 'equal' | 农民分钱方式 |
| surplusTieBreak | 'highestBet' | 余数单位归属 |
| bankruptcyThreshold | 0 | balance ≤ 此值破产 |
| minFarmers / maxFarmers | 1 / 4 | 人数 |
| timing.revealAnimMs | 2200 | 揭牌动画时长（之后等确认） |
| timing.coinAnimMs | 6000 | 硬币动画后自动进结算（须 ≥ 客户端 coinSim DURATION 6.0s；落定 ~3–5.2s：抛点高度不一 + 长摆动收尾） |
| timing.settleViewMs | 3500 | 系统结算展示时长 |
| timing.finalizeMs | 2600 | 正式结算动画时长 |
| timing.negotiateTimeoutMs | 120000 | 协商超时（0=不超时） |
| reconnectGraceSec | 60 | 断线保座 |
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
7. FINALIZE：余额变动正确（含缺口分摊、付不起破产）、钱回手动画、回合历史落盘。
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
- **农民阵营**（1–4 人，**可重复**选取，可出现多个同种角色）：`farmer` 基础农民 / `investor` 投资人 / `glutton` 暴食者。

| 阵营 | 角色 id | 初始资金 | 主动技能 | 被动 |
|------|--------|---------|---------|------|
| 农民 | `farmer` 基础农民 | 9 | — | 工资（§8.2） |
| 农民 | `investor` 投资人 | 8 | 掷币前担保 n（§8.3） | — |
| 农民 | `glutton` 暴食者 | 6 | 农民输时重掷（§8.4） | 饭账（农民胜时扣，§8.4） |
| 地主 | `landlord` 地主 | ⌊农民总资金 × 1.5⌋ | — | 资金目标考核（§8.5） |
| 地主 | `capitalist` 资本家 | 个人 农民数×4 + 资金池 农民数×10 | 押注从个人资金出、本金必归还（§8.6） | 每回合资金池税（§8.6） |

- **初始资金按花名册**：竞技模式下 `getInitialBalance` 需「按角色名册」计算——先求各农民按其角色初始资金之和 `farmerTotal`，地主 = ⌊`landlordFundMultiplier` × farmerTotal⌋，资本家个人 = 活跃农民数 × `personalPerFarmer`(4)、资金池 = 活跃农民数 × `poolPerFarmer`(10)。换公式只改此函数（保持 §0.2 扩展点）。
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
- **重掷**：当 COIN_FLIP 落定为**农民输**时进入 **REFLIP 决策窗**（仅当场上存在尚有次数的暴食者且农民输时才出现）。每个暴食者每局最多 `glutton.maxReflips`（默认 3）次：
  - 暴食者请求重掷（`request_reflip`）→ 服务端**权威重新 flipCoin**，客户端回放新动画。
  - 暴食者可主动**放弃重掷**（`pass_reflip`，不消耗次数）；**全部可重掷暴食者放弃（或离线自动放弃）即提前进入 SETTLE**，不必等满决策窗。
  - 重掷**只消耗 1 次重掷机会**，不影响饭账（饭账只在农民胜时结清）；重掷后仍为农民输则饭账继续累积，其余有次数的暴食者仍可继续请求。
  - 任一暴食者使农民转胜、或全部暴食者放弃/用尽次数、或超时 → 退出 REFLIP 窗进入 SETTLE。
- 隐私：mealAllowance 仅本人/观战可见；剩余重掷次数公开（施压）。
- **多暴食者**：各自独立计数与结清；同一次落定可被多名暴食者接力重掷。

### 8.5 地主（竞技数值）

规则同 §3.5，仅数值改用竞技档（均为待校准）：

- 初始 = ⌊农民总资金 × `competitive.landlordFundMultiplier`(1.5)⌋。
- 资金目标 `landlordGoal.schedule`（竞技档）：检查点回合 3→0.6、4→1.0、5→1.4、6→1.7、7→2.0，其后维持 2.0；未达标扣 `max(minPenalty, ⌊余额×0.2⌋)`，惩罚平分给农民（沿用 §3.7 的 `logic/landlordGoal.js`）。

### 8.6 资本家（竞技）

风险结构与地主完全不同：**个人资金只是押注用的钱包、本金永远拿回**，真正的血条是**资金池**。

- **个人资金（押注钱包）= 活跃农民数 × `capitalist.personalPerFarmer`(4)**。押注像地主一样把 L 放上桌，但**无论输赢，本金 L 在 FINALIZE 原封不动归还**（即现有「桌面→手牌」回收动画）——故个人资金恒定不变、**不决定破产**。
- **最小出资额 = `capitalist.minStake`(1)**（固定，不随农民数）。**押注边界 `L ∈ [1, 个人资金]`，可全押**（押满个人资金；因本金必归还，无需留保留金，也没有强制全押的特殊情形）。
- **资金池 = 真实钱包/血条**：初始 = 活跃农民数 × `capitalist.poolPerFarmer`(10)，承接全部**净盈亏**——FINALIZE 时 `pool += (本回合按地主口径算出的净变动)`，即 `pool += (实际收取额 − L)`（资本家胜为正、农民胜为 `−L`）。本金 L 归个人资金、盈亏归资金池，二者不重复计。
- **押注与结算结构**与地主相同（L vs F，`target = ⌊L × landlordWinMultiplier⌋`，正面 = 资本家胜）。
- **税收**：FINALIZE 时资金池 −`max(capitalist.taxMin, ⌊pool × capitalist.taxRate⌋)`（默认 `max(2, ⌊pool×10%⌋)`）。核心决策：押多大才能让池的净赢盖过税收、又不被大额回摆拖垮。
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
  initialBalance: { farmer: 9, investor: 8, glutton: 6 },
  landlordFundMultiplier: 1.5,
  capitalist: { personalPerFarmer: 4, poolPerFarmer: 10, minStake: 1, taxRate: 0.10, taxMin: 2 },
  wage:    { baseInterval: 5, minInterval: 2, perFarmerIntervalReduce: 1, baseAmount: 1, perFarmerAmountBonus: 1 },
  investor:{ maxPledge: 3, waiveMultiplier: 2 },
  glutton: { allowancePerRound: 1, maxReflips: 3 },
  landlordGoal: {
    schedule: [ { interval: 3, multiplier: 0.6 }, { interval: 1, multiplier: 1.0 },
                { interval: 1, multiplier: 1.4 }, { interval: 1, multiplier: 1.7 },
                { interval: 1, multiplier: 2.0 } ],
    penaltyRate: 0.2, minPenalty: 2,
  },
}
```

纯逻辑（工资、担保减债、伙食费、税）放入 `server/logic/`（可单测）；REFLIP 窗与计时归 `Room.js`。

### 8.9 待校准（实测，见 `docs/TUNING.md`）

工资 interval/amount 缩放、投资人 `waiveMultiplier`、暴食者 `allowancePerRound`/`maxReflips`、地主竞技 `schedule`、资本家 `poolPerFarmer`/`taxRate` —— 全部待数值测试。原设计稿的 4 个平衡问题逐条对应这些参数：① 资本家 vs 地主的选择平衡；② 暴食者多农民局强度；③ 工资流 vs 地主考核增速的互相牵制；④ 地主目标具体数值。

### 8.10 验收增量

- 大厅竞技可建房；选角校验（地主侧互斥恰 1、农民可重复）；初始资金按花名册正确。
- 工资按活跃农民数缩放、按间隔发薪；投资人保费先扣、农民输则减债 2n；暴食者饭账仅农民胜时扣除（可扣破产）、农民输则继续累积、重掷只消耗次数不影响饭账；资本家资金池押注/税收/破产、个人资金不动。
- REFLIP 窗仅在有暴食者且农民输时出现，离线暴食者自动放弃（`autoActForOffline`）。
- 快速模式行为零变化；经典模式仍禁用。
