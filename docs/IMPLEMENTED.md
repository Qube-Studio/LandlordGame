# 已实现文档（IMPLEMENTED）

> **定位**：把「设计意图」对照到「当前代码里到底实现了什么、在哪、是否开放」。
> 设计叙述见 [`GAME_DESIGN.md`](./GAME_DESIGN.md)，权威规则/数值见 [`GAME_SPEC.md`](./GAME_SPEC.md) / [`TUNING.md`](./TUNING.md)。
> 本文随代码更新；凡与代码不符以代码为准。**最后核对：2026-07-21，基于当前 `server/` 与 `client/` 源码（处决实现保留但改为生产硬关闭、仅本地测试房可显式开启）。**

---

## 1. 总体架构（已落地）

- **服务端权威**：所有规则/结算/校验在 `server/`；客户端只渲染 `state`、只发意图。
- **单一状态推送**：每次变更后 `Room._broadcastState()` 给每位玩家推送其 `viewFor(playerId)` 私有视图；客户端动画由状态 diff 驱动，无定制事件（`look` 高频中继除外）。
- **逻辑/表现分离**：`server/logic/` 纯函数；`Room.js` 持有状态机；客户端 `scene/`（3D）+ `ui/`（HUD）只读 zustand store。
- **数据持久化**：`server/storage.js` → `server/data/`（gitignored JSON）。账号 `users.json`；每局结束记录 `records/*.json`。

---

## 2. 功能实现状态总览

| 功能 | 状态 | 代码位置 |
|---|---|---|
| 注册/登录/会话（scrypt+盐） | ✅ 已实现 | `server/auth.js`、`client/src/store/authStore.js` |
| 单会话强制（重复登录顶号） | ✅ | `auth.login`/`bindSocket`、`index.js`（REST + WS 两条踢人路径） |
| 在线状态 | ✅ | `auth.js`（`onlineSockets`）、`GET /api/online` |
| 大厅：建房/列表/加入/选角 | ✅ | `index.js` REST、`Room.addPlayer/takeRole`、`client/screens/LobbyScreen` |
| **快速模式**（地主/农民） | ✅ 开放 | `modes/index.js` `quick.available=true`、`Room.js` 默认实现 |
| **竞技模式**（6 角色技能制） | ✅ 开放 | `competitive.available=true`、`logic/competitive.js`、`Room.js`（`_competitive` 分支） |
| **单人模式**（vs 脚本 Boss） | ⛔ 未开放（代码端到端可玩） | `modes/index.js` `single.available=false`；`server/single/*`、`index.js` `single_start`/`single_quit`；客户端 `DEV` 专属入口。见 §10 |
| 经典模式（银行角色） | ⛔ 未开放 | `modes/index.js` `classic.available=false`（仅占位，无逻辑） |
| 回合状态机 | ✅ | `Room.js`（见 §4） |
| 暗注 + 校验（最小出资/上限/强制全押） | ✅ | `logic/rules.js` `betBounds/validateBet`、`Room.placeBet` |
| **对质/指控**（竞技 CHALLENGE 窗） | ✅ 开放 | `Room.js`（`accuse`/`accusePick`/`accuseResolve`/`accuseCancel`/`challengeSkip`）；见 §8 |
| **检察官·传唤**（竞技，BETTING 下注前） | ✅ 开放 | `Room.summon`、`config.summonCost`；见 §8 |
| 抛币（服务端定结果 + 客户端公正感动画） | ✅ | `Room.flipCoin`、`client/scene/Coin.jsx`+`coinSim.js` |
| 系统结算 / 分债 / 整数分摊 | ✅ | `logic/rules.js` `settleRound/allocateDebt`、`logic/apportion.js` |
| 桌面显式结算编导脚本 | ✅ | `logic/payout.js`（`buildSettleScript`/`createLedger`/`flowsFromParts`）、`client/scene/PayoutLayer.jsx` |
| 农民协商（拖动钱/债 + 确认重置） | ✅ | `Room.negotiateTransfer/negotiateConfirm`；默认 3D 拖拽 `client/scene/PayoutLayer.jsx`（`?input=2d` 走旧版 `ui/NegotiationBoard.jsx`） |
| 正式结算 / 落账 / 破产判定 / 历史 | ✅ | `Room._finalize`、`logic/rules.js` `applyAllocation` |
| **处决窗**（EXECUTION，破产者生死判决） | 🧪 仅本地测试 | `Room.js`（`_maybeEnterExecution`/`execute`/`pardon`/`_advanceExecution`）、`config.execution`；生产硬关闭，见 §9 |
| 地主资金目标 + 惩罚 | ✅ | `logic/landlordGoal.js`、`config.landlordGoal` |
| 隐私边界（per-player 视图） | ✅ | `Room.viewFor`（余额/注额/技能进度/对质/处决按规则裁剪） |
| 断线宽限 + 离线自动代操作 | ✅ | `Room.handleDisconnect/_scheduleGrace/_abandonPlayer/_autoActOffline`、`config.reconnectGraceSec` |
| 心跳清理 + 空房/全离线回收 | ✅ | `index.js`（`heartbeatSec`、60s 清扫） |
| 聊天：公开 + 农民密谈 + 观战频道 | ✅ | `Room.chat/_canSeeChannel/chatHistoryFor`、`client/ui/McChat.jsx`；`config.channels=['public','farmer','spectator']` |
| 头部朝向中继（看向） | ✅ | `Room.setLook` → `look` 消息、`gameStore.looks` |
| 3D 场景 / 像素美术 / 字体 / 钞票 / 硬币 | ✅ | `client/scene/*`、`assets/*` |
| 本地测试：补满假人 / 附身控制 | ✅（仅测试） | `Room.devFill/possess`，需 `LLG_TEST=1` |
| 语音联机 `voice_*` | 🅿️ 预留 | `index.js` 回 `NOT_IMPLEMENTED`、`config.voiceEnabled=false` |
| 手动表情 `set_emote` / `emote` | 🅿️ 预留 | `Room.setEmote`、`viewFor` 透传 `emote`，UI 暂未驱动 |
| 银行角色 `bank` | 🅿️ 预留 | `takeRole` 显式拒绝「银行角色尚未开放」 |
| 音频系统（音乐/音效/枪声） | ❌ 未开始 | 全客户端无任何 `Audio`/音频依赖；处决窗「枪声」等演出缺口皆源于此 |

✅ 已实现　🧪 仅本地测试　⛔ 未开放（有实现）　🅿️ 预留接口　❌ 未开始

---

## 3. 竞技模式角色实现对照（默认值，权威见 `config.competitive`）

> ⚠ 平衡数值仍为 `GAME_SPEC §8` 自陈的 **Draft 0.1**（§8.9 列出多组「待校准」项）。以下是**当前代码里的真实默认值**，不代表已定稿。

| 角色 | 实现要点 | 默认数值（当前代码） | 代码 |
|---|---|---|---|
| 地主 landlord | 初始 = ⌊农民总资金 × 倍数⌋；资金目标考核；三杠杆结算凶（贪婪高、抽成狠） | 倍数 **2**；greed 2 / squeeze 1.5 / rake 0.8 | `getInitialBalance`、`landlordGoal`、`landlordAttrs` |
| 资本家 capitalist | 个人钱包=押注本金（必归还、不判破产）；资金池=血条（承盈亏、被税、耗尽破产）；**钱包动态**、藏池=骗押地基；专家向（低贪婪压躺赢、高盘剥抬技巧天花板） | 池 = 农民数 **×20**；钱包 = 农民数×**6** + round(当前池×**0.1**)（开局池 20n → 钱包 8n）；税 **10%、≥2**；greed 1.6 / squeeze 6 / rake 0.4 | `getInitialPool`/`capitalistWallet`、`logic/competitive.computeTax`、`Room` 资本家分支 |
| 基础农民 farmer | 工资滚雪球，按活跃农民数缩放 | 初始 15；`interval=max(2, 5−(m−1))`，`amount=1+(m−1)` | `logic/competitive.computeWage/wageDueThisRound` |
| 投资人 investor | 投保 n（保费先扣）；农民输则缺口减 2n | 初始 12；上限 3，倍数 2 | `logic/competitive.investorWaiver`、`Room.placeBet(pledge)` |
| 暴食者 glutton | 饭账每回合 +1（成本，仅农民胜时从余额扣除并清零、可破产）；农民输可重掷硬币 | 初始 8；+1/回合；**重掷数 = 活跃农民阵营人数（硬上限 `maxReflips=4`）**，每回合至多申请 1 次 | `Room._beginCompetitiveRound`/`_finalize`、`request_reflip`/`pass_reflip` |
| 检察官 prosecutor | 独享**传唤**：BETTING 自己下注前，花 round(农民数×1.5^本局已传次数) **进虚空**，**免猜必然开庭**——强制敌方 FINALIZE 按 **2×** 结算制约、**重定基+重抽间隔**、罚款**上缴国库**（切断自供血）。另有最多对质票（4），但对质是农民阵营通用机制，见 §8 | 初始 4（玻璃大炮）；传唤费 1.5× 递增、罚款 2×；对质票 4（每次指控扣 2） | `Room.summon`、`config.summonCost`、`prosecutor.summon` |

> 工资精确规则（已对照代码核实）：`m` = 活跃农民总数；初始（m=1）每 5 回合得 1；每多 1 农民，金额 +1、间隔 −1（最低 2）。m=1..4 → 间隔 5/4/3/2、金额 1/2/3/4。
> 快速模式基础地主（非竞技）：初始倍数 **1.2**、greed/squeeze/rake = 1.5/1.5/0.5（`config.landlordFundMultiplier`、`config.landlordAttrs.landlord`）。

---

## 4. 阶段机（已实现）

`PHASES`（`Room.js`）：
```
LOBBY ─► DISCUSSION ─► BETTING ─►[CHALLENGE]─► REVEAL ─► COIN_FLIP ─┬─► SETTLE ─► NEGOTIATE ─► FINALIZE ─►[EXECUTION]─► DISCUSSION(下一回合)
                                                                    │                                                    └─► ENDED
                                                       (竞技·农民输且暴食者可重掷)
                                                                    └─► REFLIP ─► COIN_FLIP…
```

- **CHALLENGE**（竞技，中括号=可选）：夹在 BETTING 与 REVEAL 之间，**仅竞技且有农民凑得齐对质票时**出现的对质决定窗；农民可花票指控敌方暗注多/少，或投票跳过；到点无人指控自动揭牌。
- 四个分钱子阶段：**SETTLE**（系统方案）/ **NEGOTIATE**（农民腾挪，任何改动重置确认；≤1 农民或无可分时跳过）/ **FINALIZE**（落账/历史/破产）/ 下一 **DISCUSSION**。
- **REFLIP**（竞技）：开出地主面且有暴食者尚有重掷次数时插入的决策窗；超时/全员放弃则进 SETTLE。
- **EXECUTION**（本地实验、默认关闭）：FINALIZE 算出破产名单后、落标与终局判定前，只有测试房显式开启且本回合有新破产者时出现；默认路径直接落标并继续终局判定/下一回合。见 §9。
- 离线玩家由 `_autoActOffline` 自动代操作（就绪/确认/放弃/对质弃权/超时处决），闸门不会卡死。
- 阶段时长全部可配（`config.timing`，0=不自动推进）。

---

## 5. 消息协议（已实现）

**客户端 → 服务端**（`index.js` 的 `switch`）：
`join_room`、`leave_room`、`take_role`、`start_game`、`ready`、`place_bet`（含 `pledge`）、`confirm_reveal`、`request_reflip`、`pass_reflip`、`negotiate_transfer`、`negotiate_confirm`、`summon`、`accuse`、`accuse_pick`、`accuse_resolve`、`accuse_cancel`、`challenge_skip`、`execute`、`pardon`、`chat`、`set_emote`(🅿️)、`look`、`restart_game`、`get_state`、`single_start`/`single_quit`（单人模式独立会话）、`dev_fill`/`dev_act_as`(仅 `LLG_TEST=1`)、`voice_*`(🅿️→`NOT_IMPLEMENTED`)。

**服务端 → 客户端**：
`joined`（含 `state`+`chatHistory`）、`state`（每玩家 `viewFor`）、`chat`、`look`、`kicked`、`error`（含 `code`，如 `UNAUTHORIZED`/`NOT_IMPLEMENTED`）。

新增消息类型的步骤见 `CLAUDE.md`「Adding a new WebSocket message type」。

---

## 6. 聊天系统（实现细节）

- **频道**：`public`（所有人）、`farmer`（农民密谈）、`spectator`（观战者专属，仅观战者可读写，防上帝视角泄密）。配置 `config.channels`。
- **服务端可见性** `_canSeeChannel`：public 全可见；farmer 频道 = 农民阵营 **或** 破产观战者可见；spectator = 仅观战者。
- **服务端发送校验** `chat()`：farmer 频道仅 `factionOf(role)==='farmer'` 可发（破产的地主不可发）。
- **客户端** `McChat.jsx`：
  - **读密谈** `canReadFarmer = 农民阵营 || 破产`（与服务端可见性一致）。
  - **发密谈** `canPostFarmer = 农民阵营`（与服务端发送校验一致）——破产的地主只读不发，不显示频道切换。
  - 闲置消息约 10s 淡出；`Enter` 唤起输入、`Esc` 收起；输入聚焦时屏蔽游戏快捷键。
  - 重连时 `joined` 用 `chatHistoryFor` 整体替换本地 `chat`，无重复。
  - 服务端限速（8 条/10s）并剥离控制字符。

---

## 7. 同步与连接（实现细节）

- **重连/顶号**：按 `username` 找回原座位/余额（`addPlayer` existing 分支）；宽限期内回来续局，超时 `_abandonPlayer` 降级观战；关键角色（地主/最后一个农民）掉线超时直接判负方阵营胜。
- **离线兜底**：`autoActForOffline=true` 时离线玩家自动就绪/确认/放弃。
- **看向中继**：`look` 高频瞬态，`setLook` 夹紧后只转发其他在线玩家，不进全量 state（`gameStore.looks`）。
- **心跳**：`heartbeatSec` 周期 ping，失联 `terminate`。
- **房间回收**：空房立即回收；全员离线超 5 分钟回收。

---

## 8. 对质 / 指控 / 传唤（竞技，CHALLENGE 阶段与 BETTING 期，已实现）

> 两条**不同**机制，别混淆：**对质=普通角色花票猜、猜对 1× 结算、不重置间隔、罚款分农民**；**传唤=检察官专属花钱、免猜必开、2× 结算、重定基重抽间隔、罚款进虚空**。

- **对质（CHALLENGE 窗，§8.8，农民阵营通用）**：农民下注后、揭牌前进入；**任何农民阵营角色**（不止检察官）可花对质票指控敌方暗注「比阵营总注多/少」，猜对则强制敌方**额外结算一次制约（1×，`mult=1`）**——`Room.js:1125`；且**不重定基、不重抽间隔**（`Room.js:1156` 只有排期/传唤才重定基）；罚款**分给本回合农民**（`Room.js:1134`，非进虚空）。
  - 票务：**按局按角色**发放（非共享池）：farmer 3 / investor 2 / glutton 0 / prosecutor 4；一次指控恒扣 `cost=2` 票，任何情况不返还；票可在 NEGOTIATE 转赠队友。（所以基础农民/投资人一局只够指控 1 次，检察官够 2 次。）
  - 两段确认交互：`accuse`（发起）→ `accuse_pick`（预选方向，队友可见）→ `accuse_resolve`（落定多/少）/ `accuse_cancel`（取消，票不退）；`challenge_skip`（投票跳过）。
  - 时序：`challengeMs=30000` 决定窗、`accuseDeliberateMs=25000` 交流窗。
- **传唤（`summon`，§8.9，检察官专属）**：检察官在 **BETTING、自己下注前**、每回合至多 1 次、不限总次数——**免猜、必然开庭**，花 `round(农民数 × 1.5^本局已传次数)` **进虚空**（150% 递增），把敌方正式考核提前开庭：FINALIZE 按 `penaltyMult=2` **倍**结算制约（`Room.js:1125/1182`），**罚款上缴国库（进虚空，不分农民）**（`Room.js:1132`），并**重定基 + 重抽间隔 / 税钟锚点归到本回合**（`Room.js:1156/1180`）。同回合传唤后不能再对质（互斥，`Room.js:746`）。
- 设计意图（数值模拟定稿 2026-07-10）：罚款进虚空 = 切断检察官自供血回路；指数费用 = 封顶单局传唤次数、让「供养刷传唤」变亏本买卖。

---

## 9. 处决窗 EXECUTION（§3.9，已实现、仅本地测试）

- **开放状态**：`config.execution.enabled` 默认 `false`；生产服务端硬钳制为关闭。开发版大厅的「设置 → 本地实验」开关只影响之后新建的本地测试房，不能中途改房间规则。
- **触发**：测试房显式开启后，quick / competitive 均生效；FINALIZE 算出破产名单后、落标与终局判定前，仅本回合有新破产者时进入（`_maybeEnterExecution`）。破产标记与回合结束**推迟**到处决全部落定后才生效。关闭时则一次性补落全部破产标记，直接进入终局判定/下一回合。
- **判决**：每个新破产者由其**敌对阵营最富活人**（资本家按资金池计）持枪定夺——
  - `execute` 处决：维持出局。
  - `pardon` 赦免：行刑者自掏「目标本回合损失」赔偿（快照回合初余额/池），目标复活回回合初财富（被赦免的地主可继续游戏）。
  - 超时/离线默认处决（`executionMs=20000` 决断、`executionResultMs=3000` 结果展示、`executionVolleyMs=1200` 超时连发间隔）。
- **客户端演出**：`scene/ExecutionRig.jsx`、`scene/ExecCineRig.jsx`、`scene/RevolverView.jsx`（行刑者第一人称左轮）、`ui/ExecOverlay.jsx`（黑屏红/白字判决）。
- **已知收尾缺口（`GAME_SPEC §3.9` 自陈，经核实属实）**：①枪声（项目无音频系统）；②赦免赔偿的飞钱演出（当前赔偿走直接改字段 `Room.js` 内，未走 `adjust` 步系统）。他人视角的持枪/开枪动作已由默认 `VoxPlayer` 接入；`?art=box` 回退下仍会降级为无持枪动作。

---

## 10. 单人模式（§9，代码可玩但未上线）

- **状态**：`modes/index.js` `single.available=false`；`GAME_SPEC §9` 自标「Draft 0.1」。客户端入口仅 `import.meta.env.DEV` 放行（正式构建隐藏），`GameScreen` 按 `mode==='single'` 完整分支渲染。
- **已实现**：服务端独立编排器 `server/single/SingleTable.js`（相位 `COMMAND → REFLIP? → ALLOCATE → 下一回合 | ENDED`）+ 会话适配层 `server/single/session.js`，经 `index.js` `single_start`/`single_quit` 接入 WS。玩家操控整队 vs 脚本 Boss（`single/bosses/*`，三属性梯度=难度旋钮）。复用全部纯逻辑 + `logic/settleSingle.js`（幽灵/幸运儿/召唤/工资）。参数 `config.single`。`text/zh.js` 有专属 HUD 文案。
- **未完成 / 内容缺口**：叛徒 `traitor` 角色明确搁置（对单体 Boss 结构性秒死）；资本家不参与单人；`ghost` 缺 `roles.sheet` 手册条目（仅 label/glyph/desc）；敌方 AI「意图电报」手感待实测；Boss 演出/战报回顾等待做。
- **⚠ 已知失败测试**：`server/test/singleSession.test.mjs` **当前挂红**——断言 `单机 state 缺键：reflipDeadline,execution`：`Room.viewFor()` 已新增 `reflipDeadline`/`execution` 两个顶层键（对质/处决/重掷相关），但 `SingleSession.view()` 未同步跟上。这是单人与多人 state 形状的契约漂移，属已知债务（单人模式本就未上线），非隐藏 bug。

---

## 11. 设计 ↔ 实现差异 / 近期修正

- **暴食者「饭账」模型**：早期实现为「农民胜时**发放**收益」，已纠正为「农民胜时从余额**扣除**的成本（可扣破产），输则继续累积、不清零」。
- **暴食者重掷次数**：早期文档写「固定 3 次/局」，实际是「= 活跃农民阵营人数」（`maxReflips=4` 为硬上限，正常局恒等于农民数）。
- **聊天读/发闸门**：曾用单一 `canFarmer = 农民阵营||破产` 同时当读和发的闸门，导致破产地主能在 UI 里切到密谈打字但被服务端静默驳回。已拆为 `canReadFarmer`（读）/ `canPostFarmer`（发），与服务端一致。
- **协商默认交互层**：默认已从 2D `NegotiationBoard.jsx` 迁到 3D `PayoutLayer.jsx`（重力枪拖拽）；旧 2D 组件保留在 `?input=2d` 下，未删除。
- **CLAUDE.md 模式开放状态**：其文字描述 competitive 为 `available:false`，与现行 `modes/index.js` 不符——实际 **competitive 已 `available:true`**；`single` 亦已接入 WS（CLAUDE.md 仍有一句「Not yet wired to WS」滞后表述）。以代码为准。

---

## 12. 测试与验证

- 服务端逻辑/集成测试（`node server/test/<name>.test.mjs`）：
  - `logic.test.mjs` ✅（49 断言，纯边界用例，须常绿）
  - `payout.test.mjs` ✅（真 Room 相位机集成：take 闸门/超时/离线自动拿/竞技调整步；处决关闭主流程与本地实验处决分组验证）
  - `chat.test.mjs` ✅（7 断言，频道可见性/限速）
  - `single.test.mjs` ✅（8 断言，单人整局集成）
  - `singleSession.test.mjs` ❌ **当前挂红**（`reflipDeadline`/`execution` 契约漂移，见 §10）
- 客户端构建/规范：`cd client && npx eslint .`、`npx vite build`。
- 离线视觉验证：`client/preview/gallery.html`（mock 状态挂载真实组件，逐态截图）与 `client/preview.html`（按 `?phase=` 挂载 `GameScreen`）。均不进生产构建。
