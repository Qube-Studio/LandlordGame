# 路线图：移动端适配 + 新手引导

> 由设计者拍板、AI 实施。本文件是这两条线的权威计划；动工前先更新本文件，再改代码。

## 决策（2026-06-27 与设计者确认）

- **推进方式**：两条线**交错**进行。
- **移动朝向**：**横屏锁定**（竖屏给"请旋转"提示）。**硬性要求：必须保证全屏 / 浏览器 UI（地址栏等）不干扰游戏**——提供全屏按钮 + 动态视口高度 + 安全区适配 +（可选）PWA standalone。
- **移动实现**：**响应式同一套代码**（CSS 断点 + 共享 pointer 输入层），不做移动专属分支。
- **引导范围**：**先 quick 模式**；竞技角色技能"选用时再教"。

## 现状（recon 结论，2026-06-27）

- 几乎无响应式：仅 viewport meta（index.html）+ 一条 `prefers-reduced-motion`（pixel.css:186）。
- **头号阻塞**：两处 HTML5 拖拽在触屏完全失效——投保槽（MoneyHand.jsx:164-189）、协商板（NegotiationBoard.jsx:50-68）。投保与协商是核心玩法。
- 写死像素宽度撑爆窄屏：`hud-bottom padding:0 200px`（pixel.css:304）、player-rail 188px、mc-chat 360px、各 HUD `min-width:150px`、phase-panel `min-width:320px`。
- **好消息**：相机视角、长按拆分**已走 pointer 事件**，且 `.r3f-scene{touch-action:none}`（pixel.css:108）已就位 → 触屏基本可用，只需调灵敏度。重头戏是"拖拽改造 + 布局响应式"，非重写交互层。
- 引导现状：PHASE_META 阶段提示（UiLayer.jsx:18-29）、ROLE_DESC、skillTag、四类 HUD、结算 EVENT_TEXT 已有；缺**首次"为什么"、结算/协商规则讲解、练习场**。

## 移动端（M）

### M0 视口与响应式地基
- **全屏 / 浏览器 UI 不干扰**（硬性要求）：
  - 支持处提供"进入全屏"按钮（Fullscreen API，须用户手势触发；进游戏时引导点一下）。
  - iPhone Safari 无 Fullscreen API → 用 `100dvh`（动态视口高度）+ `viewport-fit=cover` + `env(safe-area-inset-*)` 兜底，HUD 边距全部走安全区变量。
  - 提供 PWA `manifest`（`display:standalone`）以"添加到主屏"获得无浏览器 UI 的全屏体验。
- **朝向**：横屏锁定（`screen.orientation.lock('landscape')` 尽力而为，仅全屏内有效）；竖屏显示"请横屏"覆盖层。
- **断点体系**（建议 ≤600 / ≤380）；修最毁灭性写死宽度：hud-bottom、player-rail、mc-chat、phase-panel、corner-stack；固定 vw/vh 换 `clamp()`。

### M1 触屏交互解锁
- 用 pointer 版自定义拖拽替换两处 HTML5 DnD，并提供**"点选→选目标→确认"按钮兜底**（投保、协商）。
- 触屏相机灵敏度调参（pointermove 已可用）。
- 长按拆分加移动容差（~10px）+ 禁系统长按/右键菜单（`touch-callout`/`contextmenu`）。
- 加**聊天按钮**替代 `T` 键；自定义确认弹窗替代 `window.confirm`。

### M2 打磨
- 48px 触控目标；字号 `clamp()` 缩放；3D 性能（降桌面倾角、弱机按 `deviceMemory` 关硬币动画）；可选震动反馈。

## 引导（O，先 quick）

- **O0**：onboarding 状态（localStorage）+ JIT 阶段教学（首次进入某阶段弹一次性讲解，扩展 PHASE_META）。最便宜、马上见效。
- **O1**：首次进房浮层（不对称 / 胜负条件 / 地主考核）+ 结算&协商首次 JIT 讲解（缺口×乘数、协商囚徒困境）。
- **O2**：★ **人机练习场**——服务端新增"练习房"类型，复用 `devFill` + `autoActForOffline`；客户端加入口。**同时是移动交互的测试沙盒**。
- **O3**：竞技角色技能引导 + 策略提示。

## 冲刺排序（交错）

| Sprint | 内容 | 说明 |
|---|---|---|
| **1（地基）** | **M0 + O0** | ✅ 已落地 + 模拟验证通过（2026-06-27）：viewport-fit/dvh/安全区、PWA manifest、ViewportGuard（全屏按钮+竖屏提示）、responsive.css 断点、onboardingStore + PhaseCoachmark（quick 阶段一次性讲解）。build/eslint 干净；Playwright 手机视口截图核对了横屏布局/讲解卡/竖屏覆盖/全屏按钮。**待真机确认**：安全区刘海、真·Fullscreen、orientation.lock、iPhone「添加到主屏」提示。**M2 跟进**：竞技 4 HUD + 玩家栏在极短横屏（≤360px 高）右侧偏挤。 |
| **2** | **M1** | 触屏拖拽替换是重点 |
| **3** | **O1 + 启动 O2 练习场** | 练习场受益于 M1 的移动交互 |
| **4** | **M2 打磨 + O3 竞技引导** | 收尾 |

## 关联

- 练习场（O2）是移动交互的最佳测试沙盒，且与"离线托管/投票"基础设施同源（见 memory `offline-autoact-notify-gap`）。
- 全部改动遵守架构铁律：服务器权威、客户端只渲染 `viewFor` 快照。
