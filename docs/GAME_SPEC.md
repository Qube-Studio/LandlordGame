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
| 竞技 | `competitive` | 轮换坐庄银行制 | 预留（同上） |

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
- 地主：`config.initialBalance.landlord`，默认 **23**。
- **预留按人数动态**：取值经函数 `getInitialBalance(role, farmerCount, config)`，当前忽略 `farmerCount` 直接返回配置值，将来在此函数内改公式即可。

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
- **分钱（四个子阶段）**：
  1. **SETTLE 系统结算**：服务端按 3.5 计算默认分配方案并展示，`settleViewMs` 后自动进入下一步。
  2. **NEGOTIATE 农民协商**：每个农民以钞票牌形式看到分给自己的钱或债务，可拖拽给队友（金额守恒，仅在农民之间转移）。任何变动会重置所有人的确认。全部活跃农民确认（或 `negotiateTimeoutMs` 超时按当前方案）后生效。若只有 1 个活跃农民、或本回合农民既无钱可分也无债可摊，则自动跳过。
  3. **FINALIZE 正式结算**：按最终方案入账（桌上的钱播放回到各家 UI 层的动画），记录回合历史，判定破产。
  4. **农民讨论**：即下一回合的 DISCUSSION——结算后回到讨论阶段，农民复盘战术、全员再点准备，形成循环。
- **ENDED**：地主破产 → 农民胜；全部农民破产 → 地主胜。展示结果，房主可"再来一局"（重置资金回到第 1 回合 DISCUSSION）。

### 3.5 结算规则（默认；全部走 config，可替换）
记地主下注 `L`，农民下注合计 `F`，桌面总额 `pot = L + F`，目标 `target = 2L`（`landlordWinMultiplier`，默认 2）。

**正面（地主胜）：**
- `pot ≥ target`：地主拿走 `target`；多出的 `R = pot − target` 地主再拿 `floor(R × 0.5)`（`surplusLandlordShare`，取整方式 `rounding: 'floor'`，**预留改 ceil 或进入协商分配**），剩余归农民平分（最大余数法取整）。
- `pot < target`：地主先拿走整个 `pot`；缺口 `shortfall = target − pot` 由农民**用手里余额共同补足**——这就是"双倍承担不够的部分"。
  - 债务分摊默认 **`inverseBet`（谁出的多谁补的少）**：以 `wᵢ = 1 / betᵢ` 为权重做**最大余数法**整数分摊（科学分摊、只出整数、误差最小）。可配置为 `equal`（均摊）/ `proportionalBet`（出得多摊得多）。
  - 每人实际支付 `min(份额, 余额)`；付不起的人付光破产，残余缺口在未封顶的农民间按同法递归重摊；全员都付不起则地主只拿到实际收到的部分。
- 协商阶段农民可以在彼此之间转移"分到的钱"（take）或"分摊的债"（debt）。

**反面（农民胜）：**
- 农民**直接平分** `pot`（`farmerSplit: 'equal'`，最大余数法）；除不尽的余数单位默认给下注多的农民（`surplusTieBreak: 'highestBet'`，可配置），协商阶段可再调整。
- 地主本回合净损失 `L`（他下的注归入 pot 被分掉）。

**破产**：FINALIZE 后 `balance ≤ bankruptcyThreshold`（默认 0）即破产，成为观战者（可见全部信息、可聊天、不再参与回合）。

### 3.6 整数与误差原则
所有入账金额必为整数。凡是按比例分配，统一用 `logic/apportion.js` 的**最大余数法**：先地板取整，再把剩余单位按小数余量从大到小逐个分配（并列时按 `surplusTieBreak`）。保证"份额之和恰好等于被分配总额"，误差不超过每人 1。

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
| initialBalance.farmer / .landlord | 8 / 23 | 初始资金（预留按人数动态） |
| minStake.farmer / .landlordPerFarmer | 1 / 1 | 最小出资额 |
| landlordWinMultiplier | 2 | 地主胜目标倍数 |
| surplusLandlordShare | 0.5 | 盈余中地主再拿的比例 |
| rounding | 'floor' | 'floor'/'ceil'，预留协商分配 |
| debtAllocation | 'inverseBet' | 'inverseBet'/'equal'/'proportionalBet' |
| farmerSplit | 'equal' | 农民分钱方式 |
| surplusTieBreak | 'highestBet' | 余数单位归属 |
| bankruptcyThreshold | 0 | balance ≤ 此值破产 |
| minFarmers / maxFarmers | 1 / 4 | 人数 |
| timing.revealAnimMs | 2200 | 揭牌动画时长（之后等确认） |
| timing.coinAnimMs | 2800 | 硬币动画后自动进结算 |
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
10. `npm run build` 与 `npm run lint` 通过；经典/竞技在大厅显示但禁用。
