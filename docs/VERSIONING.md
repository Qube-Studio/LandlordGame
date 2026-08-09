# 版本与分支约定

本文是**版本号、Git 标签、分支、提交信息、更新日志**的唯一出处。改流程先改这里，再改习惯。

---

## 0. 为什么要有这份文档

前 117 个提交里出现过 **5 套互不兼容的版本命名**，同一件事换了 5 种写法：

| 时期 | 写法 | 例子 |
| --- | --- | --- |
| 6/09–6/13 | Conventional Commits，无版本号 | `feat: login system, room naming…` |
| 6/14–6/28 | `pre-alpha X.Y.Z` | `pre-alpha 0.2.3b sever` |
| 6/29–7/04 | Conventional Commits + scope，无版本号 | `feat(art-tavern): stage 3 — …` |
| 7/04–7/13 | `alpha X.Y` + 字母后缀 | `alpha 1.4MaApple`、`alpha 1.8d 0.1VT` |
| 7/15–7/24 | `pre alpha-2.0 0.X`（两级版本号） | `pre alpha-0.2 0.8` |

代价是实打实的：

- **版本号退过一次。** `pre alpha-2.0 0.4 mid` 之后的 5 个提交写成 `pre alpha-0.2`（2.0 手滑打成 0.2），没人回头改，于是历史里版本号从 2.0 倒回 0.2。
- **零标签。** 每个「版本」都只活在提交摘要的自由文本里，`git tag` 至今是空的 —— 没法 checkout 某个版本，也没法 diff 两个版本之间发生了什么。
- **`package.json` 里的版本号从没动过**，三个文件三个值（`1.0.0` / `1.0.0` / `0.0.0`），和上面任何一套命名都无关。代码里也没有任何地方读版本号。
- **提交摘要不再描述改动。** `pre alpha-0.2 0.5` 这种摘要看不出改了什么，`git log --oneline` 失去导航价值，只能靠逐个 `git show`。最极端的是 `5305382`（空摘要，35 文件）和 `main` 当前的 `temoporary commit`（75 文件 / 6000 行，把体素光照引擎、教程编辑器、处决运镜三件不相关的事捆在一起，还带着拼写错误）。
- **回归静默溜进 `main`。** 空摘要提交 `5305382` 打破了 `singleSession` 的形状对齐断言，在 `main` 上红了 6 天没人发现 —— 当时既没有 `npm test` 总入口，也没有 CI。

---

## 1. 版本号

**`MAJOR.MINOR.PATCH`，纯数字，不带 `alpha` / `pre-alpha` 这类词。**

阶段词只出现在给玩家看的更新日志标题里，不进版本号 —— 它本来就能从 MAJOR 读出来，历史上也一直是这么涨的：

| MAJOR | 阶段 | 历史 |
| --- | --- | --- |
| `0.x` | pre-alpha | `pre-alpha 0.1` → `pre-alpha 0.5.2` |
| `1.x` | alpha | `official alpha version: alpha 1.0` → `alpha 1.9` |
| `2.x` | 当前开发线 | 原先写作「pre alpha-2.0」 |

- **MAJOR** —— 阶段推进，或一次推翻重来的大改（体素化渲染就属于这一档）。
- **MINOR** —— 新模式、新角色、新机制，玩家能在更新日志里读到的东西。
- **PATCH** —— 平衡性调整、bug 修复、优化。

不要再用 `0.2.3b` / `1.4Ma` 这种字母后缀。以前 `a`/`b`/`c` 表达的「同一版本的第 N 次小修」就是 PATCH：`0.2.3` → `0.2.4`。

### 版本号存在哪

**唯一出处 = 仓库根 `package.json` 的 `version`。** `server/package.json` 和 `client/package.json` 跟着它走，三个值永远相同。

开发期挂 `-dev` 后缀（如 `2.0.0-dev`），含义是「朝 2.0.0 做，还没发」。发版提交去掉后缀，同一个提交打标签。

---

## 2. Git 标签

**每个发出去的版本都必须有一个附注标签**，格式 `v<版本号>`：

```bash
git tag -a v2.0.0 -m "2.0.0：体素化渲染 + 处决窗"
git push origin v2.0.0
```

只有发版才打标签，开发中途的进度不打。历史上那些 `pre alpha-2.0 0.1`…`0.8` 是**开发进度**而不是版本，本来就不该带号 —— 它们对应的是本文档 §4 的普通提交。

标签一旦推出去不要移动。发版发错了，就发下一个 PATCH。

---

## 3. 分支

`main` 是**可发布的主干**：任何时候 checkout 出来都应该能跑起来、`npm test` 全绿。

个人项目直推 `main` 没问题，不强制 PR。开专门分支只在两种情况下值得：

1. 改动跨多天且中途 `main` 会处于跑不起来的状态（例：渲染管线重写）；
2. 是一次可能整体废弃的实验。

开了分支就必须收尾，二选一：

```bash
git merge --no-ff voxel     # 合进 main，--no-ff 保住分支的形状
git push origin --delete voxel
```

或者确认内容已无价值后直接删掉。**不要让分支烂在远端。**

分支名一律**小写**、`类型/主题` 形式（`voxel/lighting`、`fix/negotiate-freeze`）。历史上的 `Single` 是大写开头 —— macOS 和 Windows 的默认文件系统不区分大小写，`Single` 和 `single` 会撞车。

### 当前 4 个远端分支的状态（截至本文写作时）

| 分支 | 状态 | 该怎么办 |
| --- | --- | --- |
| `dev` | 落后 `main` 1 个提交，完全被 `main` 包含 | 删。它不是开发线，只是个过期指针 |
| `Single` | 落后 `main` 16 个提交，完全被包含 | 删（顺带消掉大小写撞车隐患） |
| `art-tavern` | 落后 `main` 68 个提交，完全被包含 | 删 |
| `voxel` | 有 2 个提交从未合进 `main` | **先抢救再删**，见下 |

`voxel` 上的 `material-sampler.vox` 素材和 `docs/VOXEL_PLAN.md` 的**附录 B（P1 烘焙混合光照）**只存在于该分支 —— `main` 版 `VOXEL_PLAN.md` 第 253 行自己写着「附录 B 在 voxel 分支的本文件里，合并时两段各归其位」。同时 P1 光照的**实现**（`client/src/voxel/light/`）已经在 `main` 上了。所以现在的状态是：代码在 `main`，它的设计文档在另一条分支上等着，而那条分支已经落后 16 个提交。这两样东西得先摘回 `main`，再删分支。

---

## 4. 提交信息

用 **Conventional Commits**：

```
<type>(<scope>): <一句话说清改了什么>

（可选）为什么这么改、取舍在哪、有什么约束。
```

`type` 取 `feat` / `fix` / `refactor` / `perf` / `docs` / `test` / `chore`。`scope` 是模块名（`payout`、`voxel`、`hud`、`single`…）。

这不是外来规范 —— 仓库自己 6/29–7/04 那段就是这么写的，`feat(art-tavern): stage 2 — 全身像素皮肤 + 纸币/硬币雕版` 这类摘要今天读起来依然一眼知道改了什么。

**摘要里不写版本号。** 版本号的位置是标签和 `package.json`，不是每一条 `git log`。

三条硬要求：

- **摘要不能为空**，也不能是 `new` / `test commit` / `normal commit` / `temoporary commit` 这类占位词。
- **一个提交一件事。** 体素光照、教程编辑器、处决运镜是三件事，就是三个提交。`git bisect` 和 `git revert` 的粒度取决于这一条。
- **提交前 `npm test` 全绿。**

---

## 5. 玩家更新日志

`更新日志.txt` 是**发给玩家的公告原文**（含试玩链接），不是给开发者的技术变更记录 —— 后者就是 `git log`。

现在它只有 2 条（`pre-alpha 0.2.3b`、`pre-alpha 0.4.0`），最后一次改动是 6/22，此后 `0.5.x` 和整个 `alpha 1.x` 都没进去。规矩：

- 每次发版**追加一条**，**新的放最上面**（现在是旧的在上，读者要滚到底才看到最新）。
- 标题用 `## v2.0.0 — 2026-07-24` 这种带版本号和日期的格式，正文照旧分【新内容】【平衡性调整】【优化和修复】。
- 版本号必须和标签、`package.json` 对得上。

---

## 6. 不该进版本库的东西

`.git` 目前 72MB，而源码本身很小。差额主要是两类误提交：

- **Vite 依赖预构建缓存**（`client/.vite/deps/`，约 20MB）。`1a4d4cc` / `7ffcf39` 两个提交已经把它移出工作区并加了忽略规则，但 **blob 永久留在历史里** —— `git rm` 删不掉过去。
- **验证截图**（`.claude-shots/`、`shots/`，22MB / 65 个文件）、文件清单转储、一次性调试探针、e2e 截图输出。这些现在已取消跟踪并写进 `.gitignore`。

规矩：**生成物一律不进库。** 截图看完就丢，探针脚本命名带 `tmp-` 前缀（已被忽略），需要长期保留的工具才落到 `client/tools/` 里正式命名。

历史里那 20MB 只能靠 `git filter-repo` 重写才能清掉。重写会改写所有 commit hash，所有克隆都得重新 clone —— 单人仓库代价可接受，但属于要单独决定的一次性操作，不在日常流程里。

## 7. 发版清单

```bash
npm test                      # 全绿
npm run lint                  # 无 error
npm run build                 # 构建通得过
```

1. 按 §1 定版本号，改三个 `package.json`（去掉 `-dev`）。
2. 给 `更新日志.txt` 追一条（新的在最上）。
3. `git commit -m "chore(release): v2.0.0"`
4. `git tag -a v2.0.0 -m "…"` && `git push origin main v2.0.0`
5. 把根 `package.json` 起下一轮的 `-dev`（如 `2.1.0-dev`）。
