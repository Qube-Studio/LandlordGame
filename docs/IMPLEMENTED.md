# 已实现文档（IMPLEMENTED）

> **定位**：把「设计意图」对照到「当前代码里到底实现了什么、在哪、是否开放」。
> 设计叙述见 [`GAME_DESIGN.md`](./GAME_DESIGN.md)，权威规则/数值见 [`GAME_SPEC.md`](./GAME_SPEC.md) / [`TUNING.md`](./TUNING.md)。
> 本文随代码更新；凡与代码不符以代码为准。最后核对：基于当前 `server/` 与 `client/` 源码。

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
| **竞技模式**（5 角色技能制） | ✅ 开放 | `competitive.available=true`、`logic/competitive.js`、`Room.js`（`_competitive` 分支） |
| 经典模式（银行角色） | ⛔ 未开放 | `modes/index.js` `classic.available=false`（仅占位，无逻辑） |
| 回合状态机 | ✅ | `Room.js`（见 §4） |
| 暗注 + 校验（最小出资/上限/强制全押） | ✅ | `logic/rules.js` `betBounds/validateBet`、`Room.placeBet` |
| 抛币（服务端定结果 + 客户端公正感动画） | ✅ | `Room.flipCoin`、`client/scene/Coin.jsx`+`coinSim.js` |
| 系统结算 / 分债 / 整数分摊 | ✅ | `logic/rules.js` `settleRound/allocateDebt`、`logic/apportion.js` |
| 农民协商（拖动钱/债 + 确认重置） | ✅ | `Room.negotiateTransfer/negotiateConfirm`、`client/ui/NegotiationBoard.jsx` |
| 正式结算 / 落账 / 破产判定 / 历史 | ✅ | `Room._finalize`、`logic/rules.js` `applyAllocation` |
| 地主资金目标 + 惩罚 | ✅ | `logic/landlordGoal.js`、`config.landlordGoal` |
| 隐私边界（per-player 视图） | ✅ | `Room.viewFor`（余额/注额/技能进度按规则裁剪） |
| 断线宽限 + 离线自动代操作 | ✅ | `Room.handleDisconnect/_scheduleGrace/_abandonPlayer/_autoActOffline`、`config.reconnectGraceSec` |
| 心跳清理 + 空房/全离线回收 | ✅ | `index.js`（`heartbeatSec`、60s 清扫） |
| 聊天：公开 + 农民密谈频道 | ✅ | `Room.chat/_canSeeChannel/chatHistoryFor`、`client/ui/McChat.jsx` |
| 头部朝向中继（看向） | ✅ | `Room.setLook` → `look` 消息、`gameStore.looks` |
| 3D 场景 / 像素美术 / 字体 / 钞票 / 硬币 | ✅ | `client/scene/*`、`assets/*` |
| 本地测试：补满假人 / 附身控制 | ✅（仅测试） | `Room.devFill/possess`，需 `LLG_TEST=1` |
| 语音联机 `voice_*` | 🅿️ 预留 | `index.js` 回 `NOT_IMPLEMENTED`、`config.voiceEnabled=false` |
| 手动表情 `set_emote` / `emote` | 🅿️ 预留 | `Room.setEmote`、`viewFor` 透传 `emote`，UI 暂未驱动 |
| 银行角色 `bank` | 🅿️ 预留 | `takeRole` 显式拒绝「银行角色尚未开放」 |

✅ 已实现　⛔ 未开放　🅿️ 预留接口

---

## 3. 竞技模式角色实现对照（默认值，权威见 `config.competitive`）

| 角色 | 实现要点 | 默认数值 | 代码 |
|---|---|---|---|
| 地主 landlord | 初始 = ⌊农民总资金 ×倍数⌋；资金目标考核 | 倍数 1.5 | `getInitialBalance`、`landlordGoal` |
| 资本家 capitalist | 个人资金=押注本金（必归还、不判破产）；资金池=血条（承盈亏、被税、耗尽破产） | 个人 = 农民数×4；池 = 农民数×10；税 10%、≥2 | `getInitialBalance`/`getInitialPool`、`logic/competitive.computeTax`、`Room` 资本家分支 |
| 基础农民 farmer | 工资滚雪球，按活跃农民数缩放 | `interval=max(2,5−(m−1))`，`amount=1+(m−1)` | `logic/competitive.computeWage/wageDueThisRound` |
| 投资人 investor | 投保 n（保费先扣）；农民输则缺口减 2n | 上限 3，倍数 2 | `logic/competitive.investorWaiver`、`Room.placeBet(pledge)` |
| 暴食者 glutton | 饭账每回合 +1（成本）；农民胜时从余额扣除并清零（可破产）；输可重掷 | +1/回合，重掷 3 次/局 | `Room._beginCompetitiveRound`/`_finalize`、`request_reflip`/`pass_reflip` |

> 工资精确规则（已对照代码核实）：`m` = 活跃农民总数；初始（m=1）每 5 回合得 1；每多 1 农民，金额 +1、间隔 −1（最低 2）。m=1..4 → 间隔 5/4/3/2、金额 1/2/3/4。

---

## 4. 阶段机（已实现）

```
LOBBY ─► DISCUSSION ─► BETTING ─► REVEAL ─► COIN_FLIP ─┬─► SETTLE ─► NEGOTIATE ─► FINALIZE ─► DISCUSSION(下一回合)
                                                       │                                          └─► ENDED
                                          (竞技·农民输且暴食者可重掷)
                                                       └─► REFLIP ─► COIN_FLIP…
```

- 四个分钱子阶段：**SETTLE**（系统方案）/ **NEGOTIATE**（农民腾挪，任何改动重置确认；≤1 农民或无可分时跳过）/ **FINALIZE**（落账/历史/破产）/ 下一 **DISCUSSION**。
- **REFLIP**（竞技）：开出地主面且有暴食者尚有重掷次数时插入的决策窗；超时/全员放弃则进 SETTLE。
- 离线玩家由 `_autoActOffline` 自动代操作（就绪/确认/放弃），闸门不会卡死。
- 阶段时长全部可配（`config.timing`，0=不自动推进）。

---

## 5. 消息协议（已实现）

**客户端 → 服务端**（`index.js` 的 `switch`）：
`join_room`、`leave_room`、`take_role`、`start_game`、`ready`、`place_bet`（含 `pledge`）、`confirm_reveal`、`request_reflip`、`pass_reflip`、`negotiate_transfer`、`negotiate_confirm`、`chat`、`set_emote`(🅿️)、`look`、`restart_game`、`get_state`、`dev_fill`/`dev_act_as`(仅 `LLG_TEST=1`)、`voice_*`(🅿️→`NOT_IMPLEMENTED`)。

**服务端 → 客户端**：
`joined`（含 `state`+`chatHistory`）、`state`（每玩家 `viewFor`）、`chat`、`look`、`kicked`、`error`（含 `code`，如 `UNAUTHORIZED`/`NOT_IMPLEMENTED`）。

新增消息类型的步骤见 `CLAUDE.md`「Adding a new WebSocket message type」。

---

## 6. 聊天系统（实现细节）

- **频道**：`public`（所有人）、`farmer`（农民密谈）。配置 `config.channels`。
- **服务端可见性** `_canSeeChannel`：public 全可见；farmer 频道 = 农民阵营 **或** 破产观战者可见。
- **服务端发送校验** `chat()`：farmer 频道仅 `factionOf(role)==='farmer'` 可发（破产的地主不可发）。
- **客户端** `McChat.jsx`：
  - **读密谈** `canReadFarmer = 农民阵营 || 破产`（与服务端可见性一致）。
  - **发密谈** `canPostFarmer = 农民阵营`（与服务端发送校验一致）——破产的地主只读不发，不显示频道切换。
  - 闲置消息约 10s 淡出；`T` 唤起输入、`Esc` 收起；输入聚焦时屏蔽游戏快捷键（`stopPropagation` + `useGameKeys` 双重让位）。
  - 重连时 `joined` 用 `chatHistoryFor` 整体替换本地 `chat`，无重复。

---

## 7. 同步与连接（实现细节）

- **重连/顶号**：按 `username` 找回原座位/余额（`addPlayer` existing 分支）；宽限期内回来续局，超时 `_abandonPlayer` 降级观战；关键角色（地主/最后一个农民）掉线超时直接判负方阵营胜。
- **离线兜底**：`autoActForOffline=true` 时离线玩家自动就绪/确认/放弃。
- **看向中继**：`look` 高频瞬态，`setLook` 夹紧后只转发其他在线玩家，不进全量 state（`gameStore.looks`）。
- **心跳**：`heartbeatSec` 周期 ping，失联 `terminate`。
- **房间回收**：空房立即回收；全员离线超 5 分钟回收。

---

## 8. 设计 ↔ 实现差异 / 近期修正

- **暴食者「饭账」模型**：早期实现为「农民胜时**发放**收益」，已纠正为「农民胜时从余额**扣除**的成本（可扣破产），输则继续累积、不清零」。代码 `Room._finalize`（`allowanceCharged`）、`config.competitive.glutton` 注释已同步。
- **聊天读/发闸门**：曾用单一 `canFarmer = 农民阵营||破产` 同时当读和发的闸门，导致破产地主能在 UI 里切到密谈打字但被服务端静默驳回。已拆为 `canReadFarmer`（读）/ `canPostFarmer`（发），与服务端一致。
- **CLAUDE.md 模式开放状态**：其文字描述 competitive/classic 为 `available:false`，与现行 `modes/index.js` 不符——实际 **competitive 已 `available:true`**，仅 classic 仍 `false`。以代码为准。

---

## 9. 测试与验证

- 纯逻辑单测：`node server/test/logic.test.mjs`（边界用例，需常绿）。
- 客户端构建/规范：`cd client && npx eslint .`、`npx vite build`。
- 离线视觉验证：`client/preview/gallery.html`（mock 状态挂载真实组件，逐态截图）与 `client/preview.html`（按 `?phase=` 挂载 `GameScreen`）。均不进生产构建。
