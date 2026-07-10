# 游戏性参数微调手册（TUNING）

> 本文档用于**手动微调游戏性**。所有数值都集中在 `server/config.js` 的 `DEFAULT_CONFIG`，
> 是服务端权威、零硬编码（见 `CLAUDE.md` 架构原则 2）。改这里即可调整全局默认；
> 也可在建房时用 `configOverrides` 按房间覆盖（`mergeConfig` 深合并）。
>
> 规则细节以 `docs/GAME_SPEC.md` 为准；本文只讲“每个旋钮怎么拧、拧了会怎样”。

---

## 怎么改

- **改全局默认**：编辑 `server/config.js` 里 `DEFAULT_CONFIG` 对应字段，重启服务端（`npm run dev` 会自动重载）。
- **只改某局**：建房时传 `configOverrides`，例如 `{ initialBalance: { farmer: 10 }, landlordFundMultiplier: 2 }`。
- **嵌套对象**深合并：只写要改的字段即可，其余沿用默认（如只改 `timing.coinAnimMs`）。
- 改完用 `node --experimental-vm-modules` 不必要——纯逻辑可直接 `node server/test/logic.test.mjs` 跑边界测试自检（见末尾）。

---

## 初始资金

| 键 | 默认 | 说明 |
|----|------|------|
| `initialBalance.farmer` | `8` | 每个农民的开局资金。 |
| `landlordFundMultiplier` | `1.2` | 地主开局资金 = **农民总资金 × 该倍数**（向下取整，至少 1）。农民总资金 = 农民人数 × `initialBalance.farmer`。 |

> 地主资金随农民人数动态：1 农民→`floor(1.2×8)=9`；2→`19`；3→`28`；4→`38`。
> 公式集中在 `config.js` 的 `getInitialBalance(role, farmerCount, config)`，要换算法只改这一处。
> 调高 `landlordFundMultiplier` → 地主更耐打、对农民更难；调低 → 农民更易翻盘。

> **竞技档开局资金**（`competitive`，覆盖上表）：农民 `15`、投资人 `12`、暴食者 `8`；地主 = `⌊农民总资金 × 2⌋`；资本家 钱包(**动态**) = `6×农民数 + round(当前池×0.1)`（每回合按当前池重算，开局 `8×农民数`）、资金池 = `农民数 × 20`。

## 最小出资额

| 键 | 默认 | 说明 |
|----|------|------|
| `minStake.farmer` | `1` | 农民每回合至少要押的钱（也必须留出同额“保留金”）。 |
| `minStake.landlordPerFarmer` | `1` | 地主最小出资 = 活跃农民人数 × 该值。 |

> 下注约束：`minStake ≤ bet ≤ balance − minStake`；`balance < 2×minStake` 时强制全押。

## 结算

| 键 | 默认 | 说明 |
|----|------|------|
| `landlordAttrs[role].greed` | `1.5` | **贪婪**：地主胜的目标 = `round(地主下注 × greed)`（赢了拿几倍；`<1` 会赢了反亏）。 |
| `landlordAttrs[role].squeeze` | `1.5` | **盘剥**：对方填不满目标时，缺口债务的放大倍率（越大逼债越狠）。 |
| `landlordAttrs[role].rake` | `0.5` | **抽成**：桌面溢出时，地主从溢出里多拿的比例 `[0,1]`。 |
| — | — | 每个地主侧角色（`landlord`/`capitalist`）各一套；竞技档在 `competitive.landlordAttrs` 覆盖。经 `getLandlordAttrs(role, config)` 解析，缺省回落到 `landlord` 那套。 |
| `rounding` | `'round'` | 一切带小数的比例计算取整：`'round'` 四舍五入 /`'floor'`/`'ceil'`。结算三倍率、目标/罚款、资本家税全部经此（初始资金分配另走 floor，见「初始资金」）。 |
| `debtAllocation` | `'inverseBet'` | 农民补缺口的分摊权重：`'inverseBet'`（押得多摊得少）/`'equal'`/`'proportionalBet'`。 |
| `farmerSplit` | `'equal'` | 农民胜时分桌面的方式（目前仅 `'equal'`）。 |
| `surplusTieBreak` | `'highestBet'` | 最大余数法并列时余数单位归属：`'highestBet'`/`'lowestBet'`。 |
| `bankruptcyThreshold` | `0` | 余额 ≤ 此值即破产。 |

> **缺口补偿**：地主胜且桌面不足目标时，地主先拿走整个桌面，缺口（=目标−桌面）由农民用余额补，补多少地主多拿多少；
> 农民付不起的部分作废（地主收不到）。协商阶段可把债务全压给一名农民使其破产（此时地主只收到他最后的钱）。

> **竞技档差异化**（`competitive.landlordAttrs`，覆盖上表默认）：
> - **地主** `greed 2 / squeeze 1.5 / rake 0.8`——厚资本、赢面凶（目标高、抽成狠）。
> - **资本家** `greed 1.6 / squeeze 6 / rake 0.4`——**专家向**：低贪婪(1.6，低于盈亏平衡 g=2)压低「躺赢地板」、高盘剥(6)放大「逼农民填不起→巨额罚债」的骗押技巧收益（高天花板）。
>
> 快速档没有资本家，基础地主沿用上表默认 `1.5 / 1.5 / 0.5`（较温和，便于上手）。

## 地主资金目标（landlordGoal，相对制）

每过**随机 interval 回合**一个检查点：该回合 FINALIZE 时地主余额须 ≥ 目标（=`round(基准余额 × goalMultiplier)`，基准 = 上一检查点/开局的余额），
否则扣罚 `max(minPenalty, round(当前余额 × penaltyRate))`，**惩罚资金平分给本回合农民**（最大余数法，在破产判定前入账，可能救活濒临破产的农民），可直接压垮地主。
**达标无奖励。** 每个检查点后按（罚后）当前余额重定下一个目标与下一个随机检查点。资本家无此考核；快速档与竞技档地主同吃。

| 键 | 默认 | 说明 |
|----|------|------|
| `landlordGoal.enabled` | `true` | 总开关。关掉则无目标、无惩罚、UI 不显示。 |
| `landlordGoal.goalMultiplier` | `1.1` | 目标 = `round(基准余额 × 该值)`——要求较上一检查点涨 10%。 |
| `landlordGoal.penaltyRate` | `0.1` | 未达标时扣除的资金比例（`round(当前余额 × 该值)`，四舍五入）。 |
| `landlordGoal.minPenalty` | `2` | 未达标时至少扣除的资金。 |
| `landlordGoal.interval` | `{min:2,max:5,mean:3.5,sd:0.9}` | 检查点间隔：每次正态随机（`round(Box-Muller(mean,sd))` 后 clamp 到 `[min,max]`），按局种子 PRNG 可复现。 |

> 例：地主初始 30 → 首目标 `round(30×1.1)=33`；若 4 回合后（随机间隔）余额仅 28 < 33，扣 `max(2, round(28×0.1)=3)=3`，余 25 平分给农民；随后目标重定为 `round(25×1.1)=28`，再随机 2–5 回合后检查。
> 想让地主压力更大：调高 `goalMultiplier`（涨幅）或 `penaltyRate`（罚重）、或调小 `interval`（催得紧）；想更宽松反之。
> 计算件在纯函数 `server/logic/landlordGoal.js`（`relativeGoal`/`goalPenalty`/`drawGoalInterval`）；有状态推进在 `Room.js`。

## 阶段时长（毫秒；`0` = 不自动推进，调试用）

| 键 | 默认 | 说明 |
|----|------|------|
| `timing.revealAnimMs` | `2200` | 揭牌动画时长（之后等全员确认）。 |
| `timing.coinAnimMs` | `2800` | 掷硬币动画后自动进结算。**需 ≥ 硬币烘焙动画时长 2400ms**（见下）。 |
| `timing.settleViewMs` | `5200` | 系统结算展示后进协商。须容纳桌面「聚拢→分堆→派送」三拍演出（客户端约 3.4s），调小会让协商开始时演出仍在收尾（不出错，只是仓促）。 |
| `timing.finalizeMs` | `2600` | 全员拿取完成后进下一回合的收尾间隔（给最后一笔「钱飞回手」留时间）。 |
| `timing.negotiateTimeoutMs` | `120000` | 协商超时按当前方案生效（`0` = 不超时）。 |
| `timing.challengeMs` | `15000` | 对质「决定窗」（§8.11）：进 CHALLENGE 后无人指控则到点自动揭牌；`0` = 立即跳过对质。 |
| `timing.accuseDeliberateMs` | `120000` | 指控后「交流窗」上限：发起者须在此内选定 多/少，超时自动取消并揭牌（非硬控，选定即提前进）。 |
| `timing.takeTimeoutMs` | `45000` | FINALIZE 拿取（§3.8）超时：到点未按 F 的玩家自动拿取（`0` = 不超时，AFK 会卡住全场，慎用）。 |
| `timing.takeAutoDelayMs` | `2600` | 进入拿取阶段后，代**离线**玩家自动拿取的延迟——让在线观众看完收账/技能调整演出再看到该堆飞走。 |
| `timing.endedToLobbyMs` | `0` | ENDED 后自动回大厅的延时。**默认 `0` = 不自动回：留在终局对局（演出播完淡出、露出桌面），等房主手动点「下一局」（`restart_game`）才回大厅重开。** `>0` 才到点自动跑回大厅（清角色/准备回 LOBBY）；`endedReturnAt` 供客户端对齐收尾淡出。 |

> 硬币动画是**客户端**预烘焙的（`client/src/scene/coinSim.js`），单条时长常量 `DURATION = 2.4s`。
> 若把 `coinAnimMs` 调到小于 2400，硬币会还没落定就切换阶段；要更快/更慢请同时改 `coinSim.js` 的 `DURATION`。

## 对质 / 指控（accusation，§8.11）

| 键 | 默认 | 说明 |
|----|------|------|
| `competitive.accusation.tickets` | `{ farmer: 3, investor: 2, glutton: 0, prosecutor: 4 }` | 每角色**按局**发放的对质票（农民阵营专属）。 |
| `competitive.accusation.cost` | `2` | 一次指控消耗的票数（恒扣、任何情况不返还；不满 `cost` 不可发起）。 |

> 猜对敌方暗注「比农民阵营总注多/少」→ 强制敌方 FINALIZE 多结算一次制约（地主目标**不重定基** / 资本家额外扣一次税）；猜错无额外效果。票可在 NEGOTIATE 转赠队友。**待实测**：票数/时长/强制强度，尤其「对质对硬币方差的削减」与「对地主/资本家胜率的冲击」。

## 检察官 / 传唤（prosecutor，§8.12）

| 键 | 默认 | 说明 |
|----|------|------|
| `competitive.initialBalance.prosecutor` | `4` | 检察官初始资金（玻璃大炮；模拟显示身板代价被地主资金缩放对冲、落在个人破产率 65~74% 上）。 |
| `competitive.prosecutor.summon.costGrowth` | `1.5` | 传唤费递增率：费 = round(农民数 × costGrowth^已传次数)，进虚空。**平衡核心**——封顶单局次数、让供养刷传唤自动亏本。 |
| `competitive.prosecutor.summon.penaltyMult` | `2` | 传唤结算倍率（地主目标罚 / 资本家税，封顶到余额/池）。 |

> 罚款**上缴国库**（进虚空、不分农民）是定稿决策（切断自供血回路），无独立开关——要改分配方式需动 `Room._finalize` 的 `_summonGoal` 分支。模拟基线：国库版（噪声读）地主胜率 −7~−8pp @ nF=2/3、≈0 @ nF=4；真人局验证后的候选旋钮：初始资金 4→6（若烈士体验太苦）、costGrowth（若次数过多/过少）。

## 连接与其它

| 键 | 默认 | 说明 |
|----|------|------|
| `minFarmers` / `maxFarmers` | `1` / `4` | 农民人数下限/上限。 |
| `reconnectGraceSec` | `0` | 断线保座时长；`0`=永久保座（永不超时降级），`>0`=超时降级为观战者。 |
| `autoActForOffline` | `true` | 离线玩家自动准备/下注/确认，避免卡住全场。 |
| `heartbeatSec` | `30` | 心跳间隔。 |
| `channels` | `['public','farmer','spectator']` | 聊天频道（`spectator` 仅观战者可读写，防上帝视角泄密）。 |
| `voiceEnabled` | `false` | 语音预留开关。 |

---

## 纯表现层旋钮（不影响规则，但影响手感）

> 这些不在 `config.js`，因为它们是客户端表现常量；列在此便于一并微调。

- 硬币：`client/src/scene/coinSim.js` — `DURATION`（时长）、`COIN_R`/`COIN_H`（尺寸）、`COIN_SEGMENTS`（面数，越小越“像素”）、`POOL_SIZE`（每面动画条数）、弹跳系数 `restitution`、重力 `G`。
- 钱牌长按：`client/src/ui/MoneyHand.jsx` 与 `NegotiationBoard.jsx` — `LONG_PRESS_MS`（拆分长按时长）、`SHAKE_DELAY_MS`（开始抖动延迟）。

---

## 自检

纯逻辑（分摊/结算/地主目标）有边界测试脚本：

```
node server/test/logic.test.mjs
```

会覆盖：apportion 守恒与误差、地主胜双倍补偿（含农民付不起/被压垮破产）、农民胜平分、
地主目标序列单调放缓与封顶、惩罚下限与触发。调完参数跑一遍确认没把不变量改坏。
