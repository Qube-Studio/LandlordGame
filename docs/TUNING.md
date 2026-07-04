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

## 最小出资额

| 键 | 默认 | 说明 |
|----|------|------|
| `minStake.farmer` | `1` | 农民每回合至少要押的钱（也必须留出同额“保留金”）。 |
| `minStake.landlordPerFarmer` | `1` | 地主最小出资 = 活跃农民人数 × 该值。 |

> 下注约束：`minStake ≤ bet ≤ balance − minStake`；`balance < 2×minStake` 时强制全押。

## 结算

| 键 | 默认 | 说明 |
|----|------|------|
| `landlordWinMultiplier` | `1.5` | 地主胜的目标 = `floor(地主下注 × 该倍数)`（取整保证整数钱）。同时决定缺口补偿额。 |
| `surplusLandlordShare` | `0.5` | 桌面超出目标的盈余里，地主再拿的比例。 |
| `rounding` | `'floor'` | 比例计算取整：`'floor'`/`'ceil'`。 |
| `debtAllocation` | `'inverseBet'` | 农民补缺口的分摊权重：`'inverseBet'`（押得多摊得少）/`'equal'`/`'proportionalBet'`。 |
| `farmerSplit` | `'equal'` | 农民胜时分桌面的方式（目前仅 `'equal'`）。 |
| `surplusTieBreak` | `'highestBet'` | 最大余数法并列时余数单位归属：`'highestBet'`/`'lowestBet'`。 |
| `bankruptcyThreshold` | `0` | 余额 ≤ 此值即破产。 |

> **缺口补偿**：地主胜且桌面不足目标时，地主先拿走整个桌面，缺口（=目标−桌面）由农民用余额补，补多少地主多拿多少；
> 农民付不起的部分作废（地主收不到）。协商阶段可把债务全压给一名农民使其破产（此时地主只收到他最后的钱）。

## 地主资金目标（landlordGoal）

每过若干回合地主必须达到一个资金目标，否则在**该回合 FINALIZE（押注后资金分配完成时）**扣罚，
**惩罚资金平分给本回合农民**（最大余数法，在破产判定前入账，可能救活濒临破产的农民），
可直接压垮地主导致农民胜。检查点由 `schedule` 显式给出，按列表逐项推进。

| 键 | 默认 | 说明 |
|----|------|------|
| `landlordGoal.enabled` | `true` | 总开关。关掉则无目标、无惩罚、UI 不显示。 |
| `landlordGoal.schedule` | 见下 | 显式检查点列表，每项 `{interval, multiplier}` = 「再过 interval 回合，目标 = `floor(地主初始资金 × multiplier)`」。超出列表后按**最后一项**重复。 |
| `landlordGoal.penaltyRate` | `0.2` | 未达标时扣除的资金比例（向下取整）。 |
| `landlordGoal.minPenalty` | `2` | 未达标时至少扣除的资金。 |

> 默认 `schedule`（间隔/倍数）：`2/0.6 → 2/1.0 → 3/1.5 → 3/1.8 → 5/2.0`，累计检查点回合 `2, 4, 7, 10, 15`，之后每 5 回合维持 `2.0` 倍。
> 例：地主初始 30（≈3 农民）→ 检查点回合 `2, 4, 7, 10, 15…`，目标 `18, 30, 45, 54, 60…`。
> 想让地主压力更大：把各项 `multiplier` 调高或 `interval` 调小；想更宽松反之。
> 逻辑在纯函数 `server/logic/landlordGoal.js`，可单测/仿真。

## 阶段时长（毫秒；`0` = 不自动推进，调试用）

| 键 | 默认 | 说明 |
|----|------|------|
| `timing.revealAnimMs` | `2200` | 揭牌动画时长（之后等全员确认）。 |
| `timing.coinAnimMs` | `2800` | 掷硬币动画后自动进结算。**需 ≥ 硬币烘焙动画时长 2400ms**（见下）。 |
| `timing.settleViewMs` | `5200` | 系统结算展示后进协商。须容纳桌面「聚拢→分堆→派送」三拍演出（客户端约 3.4s），调小会让协商开始时演出仍在收尾（不出错，只是仓促）。 |
| `timing.finalizeMs` | `2600` | 全员拿取完成后进下一回合的收尾间隔（给最后一笔「钱飞回手」留时间）。 |
| `timing.negotiateTimeoutMs` | `120000` | 协商超时按当前方案生效（`0` = 不超时）。 |
| `timing.takeTimeoutMs` | `45000` | FINALIZE 拿取（§3.8）超时：到点未按 F 的玩家自动拿取（`0` = 不超时，AFK 会卡住全场，慎用）。 |
| `timing.takeAutoDelayMs` | `2600` | 进入拿取阶段后，代**离线**玩家自动拿取的延迟——让在线观众看完收账/技能调整演出再看到该堆飞走。 |

> 硬币动画是**客户端**预烘焙的（`client/src/scene/coinSim.js`），单条时长常量 `DURATION = 2.4s`。
> 若把 `coinAnimMs` 调到小于 2400，硬币会还没落定就切换阶段；要更快/更慢请同时改 `coinSim.js` 的 `DURATION`。

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
