# UI 素材目录

把图片素材放在这个目录下，按以下文件名（任意支持的扩展名：png/jpg/jpeg/svg/webp）放置，会被自动接入对应位置：

- `coin-heads.*` / `coin-tails.*` — FLIP 阶段硬币正反面图标
- `icon-landlord.*` / `icon-farmer.*` / `icon-bank.*` — 玩家列表角色图标
- `table-bg.*` — 牌桌区域背景装饰图
- `confirm_button_normal.*` / `confirm_button_pressed.*` — 像素下注新场景（`?scene=new` / 调试页“像素下注新场景预览”）的 CONFIRM 按钮默认/按下状态
- `money_card_1.* / money_card_2.* / money_card_5.* / money_card_10.*` — 像素下注场景手牌面额卡面图片，未提供对应面额时该手牌继续显示数字文字
- `card-back.*` — 像素下注场景"已下注"牌的反面图片，未提供时显示占位反面样式（纯色 + 边框）

未提供对应文件时，UI 会回退到现有的 emoji/文字展示，不影响正常使用。
