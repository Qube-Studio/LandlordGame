# 编辑器大翻修施工计划 v2（EDITOR_OVERHAUL）

> 2026-07-17 定稿（v1 经三镜头设计评审修订）。本文档是两款开发工具翻修的**施工权威**。
> 目标：打造两款适合本游戏的、专业、高质量工具——① UI/重文本编辑器（教程内容）② 游戏自由截图 3D 摄影棚。

---

## 0. 总原则（两款共用）

1. **单一真源**：所见即所得靠**复用游戏真组件/真 CSS**，不靠手抄镜像。
2. **现代编辑器基本功**：多选、框选/批量、复制粘贴、右键菜单、完整快捷键、撤回/重做覆盖一切、
   自动草稿+崩溃恢复、状态可见（按钮灰显/状态栏/toast）、键盘可达。
3. **宁简勿繁**：扁平 chrome（严禁立体浮雕 inset 双向 bevel）、像素字体、密度紧凑。
4. DEV-only、不进生产构建。**禁止 git commit**。**禁止任何测试写真 tutorial.json / 真图库**。
5. 撤回范式**不共享代码**：photoStore.js 的 past/future 栈 + coalesceKey/700ms + HIST_MAX=100 +
   undo 时置空 coalesceKey 是权威参考实现，T 轨照抄改快照形状。
6. 所有新交互必须有 headless E2E（Playwright，`--use-angle=swiftshader --enable-unsafe-swiftshader`）；
   **断言一律轮询**（SwiftShader ~2fps，固定等待必闪断）；整页截图用 CDP `Page.captureScreenshot`。
7. 键盘纪律（两款通用）：`e.isComposing || e.keyCode === 229` 时结构性快捷键一律直通（IME 合成期）；
   焦点在 input/textarea/select 时除 Ctrl+S/Z/Y 外全部直通（重命名态 Enter=提交、Esc=取消）。

## 1. 文本编辑器 2.0

### 1.1 架构

- **新家**：`client/tutorial-editor.html` + `client/src/tutorial-editor/`（React，DEV-only 守卫照抄 photo/main.jsx）。
  跑法：根 `npm run tutorial:new`（= 仅起 client vite，无需游戏服）或 `npm run dev` 后开 `/tutorial-editor.html`。
- **入口 import 序写死**（照抄 src/main.jsx，缺一不可——pixel.css 消费 palette/texlib 注入的 --c-*/--tex-* 与
  theme.css 变量）：`assets/palette` → `assets/texlib` → `theme.css` → `App.css` → `pixel.css` → 最后 `editor.css`。
- **chrome 隔离**：编辑器 chrome 类名全走 `.ted-*` 命名空间，**禁止**复用 .btn/.toast/.modal/.panel 等游戏类名
  （pixel.css 里它们是立体浮雕皮肤）。editor.css 显式反污染：body 背景/滤镜重置、编辑区 `user-select: text`
  （pixel.css 有 body 级 user-select:none）、`.ted-preview :is(.goal-hud,.rules-panel){animation:none!important}`
  （关掉 ui-drift/入场动画）。E2E 断言编辑器按钮 computedStyle 无 inset box-shadow。
- **共享渲染器**：从 RulesPanel.jsx 抽 `client/src/ui/TutorialContent.jsx` ——含 `.tut-content` 容器、
  章节标题（.tut-content-title + PixelText）、全部段落渲染（文本/字号/金字/列表/空行/图片/属性条）。
  RulesPanel 只留壳。**纯净性硬约束**：TutorialContent 只准 import `game/richtext`(parseRuns) 与 PixelText，
  禁止 import text/*、gameStore（否则编辑器模块图触达 tutorial.json → 每次保存自我 full-reload）。
  可选 props：`renderEmptyImg`（游戏不传=null，编辑器传占位框）、`blockRef/blockProps`（滚动锚点，游戏不传=DOM 零变化）。
- **预览骨架**：编辑器预览挂完整 `.rules-panel.goal-hud.hud-card → .tut-split → nav 占位列(200px) → TutorialContent`，
  内容列宽与游戏一致（字距修正 `.rules-panel .pixel-text{gap:1px}` 依赖祖先类名）。
- **编辑器侧文档模型**：载入时每块包 `{uid, data}`（uid 单调递增；撤回快照保留 uid；serialize 剥掉）。
  React key/多选/剪贴板/定位一律用 uid。**逐字节兼容三规则**：m 档字号存纯字符串（非 {text,size:'m'}）、
  alt 空时删键、旧式属性条 {value,max} 仅在用户编辑该块时固化为 {width,fill}。
  验收：真 tutorial.json 载入→不动→保存→`git diff` 为空。
- **文件 IO：vite 插件** `client/tools/tutorial-api.vite.mjs`（主线已预落，T 轨只改此文件本体）：
  - `apply:'serve'`（构建物理不存在）；**Host 头白名单** `^(localhost|127\.0\.0\.1)(:\d+)?$` 否则 403
    （allowedHosts 有 cpolar 公网隧道，且隧道流量源 IP=127.0.0.1，只能靠 Host 辨）。
  - `GET /__tutorial-api/doc` → `{data, hash, mtime}`；`PUT /__tutorial-api/doc` 带 `baseHash`，
    不符 → 409（前端出「磁盘已被修改」对话：重载/强制覆盖）；写盘 tmp+rename 原子替换；
    落盘 `JSON.stringify(data,null,2)+'\n'`。
  - `POST /__tutorial-api/upload?name=` → 入库（safeName 消毒照抄 legacy server.mjs）；`GET /__tutorial-api/images` 列表。
  - body 手动 chunk 收集，上限 doc 2MB / 图 20MB。**路径可被 env 覆盖**：`TUTORIAL_DOC_FILE`/`TUTORIAL_IMG_DIR`
    （绝对路径，E2E 隔离用；禁止 URL 参数改路径）。
  - vite config 已加 `server.watch.ignored: ['**/public/tutorial/**']`（防上传触发全页 reload）与
    `cacheDir: process.env.VITE_CACHE_DIR`（双轨 E2E 各用独立缓存）。
- **旧版处置**：`scripts/tutorial-editor-web/` 保留（`npm run tutorial`），启动 banner 标 legacy 指路新版。

### 1.2 功能清单

**T②a 存量等价**（必须全数迁移，缺一不收——出口标准=能端到端编辑真文档）：
树拖拽（前/后/子 + root-drop 提升顶层）、搜索过滤+祖先展开+命中绿高亮、全开全收、复制章节、
Enter 拆段/行首 Backspace 并段（**必须查 isComposing**——legacy 有 IME bug，此处修复不复刻）、
多行粘贴拆段（首尾空行去、中间空行留）、**金字**/列表/四档字号、属性条（width/fill/color/fade + 旧式惰性折算）、
空行、图片（上传/图库/Ctrl+V 贴图（pasteName 时间戳防覆盖）/拖文件/块内缩略图+失败占位）、
块头 hover 快速插入（+段/+条/+空行/+图）、撤回重做（合并 + 按钮灰显联动）、Ctrl+S/Ctrl+F、
重新载入（confirm）、未保存守卫、保存失败恢复（按钮重启用+状态栏）、空态引导文案、Esc 链（模态→搜索）。

**T②b 新增**：
- 多选：树/块 Ctrl 点、Shift 范围；**祖先吸收后代**归一化后再拖/复制/删；中栏恒显主选；
  批删默认不 confirm（撤回兜底），仅含 ≥5 子章时 confirm。
- 剪贴板：text/plain 哨兵信封 `{"fmt":"fate-tutorial-blocks","blocks":[…]}`（章节同理 fmt:"…-chapters"）；
  **粘贴裁决顺序：图片文件 > 哨兵 JSON > 含换行文本拆段 > 普通文本入光标**。
- 右键菜单：树（新建子/前后插/复制/删/重命名）、块（各类型插入/复制/剪切/粘贴/删除）。
- 键盘：树容器持焦时 ↑↓ 走可见序、←→ 收展、F2 行内重命名、Del、Ctrl+D；块 Alt+↑↓ 移动。
  程序化选中一律 scrollIntoView({block:'nearest'})（树+编辑列+预览三处）。
- 自动草稿：{baseHash, doc, ts} 存 localStorage（debounce）；启动时 baseHash≠磁盘 hash 且 doc≠磁盘 → 恢复条。
  多标签：BroadcastChannel('fate-tutorial-editor') 心跳，后开标签只读（可点按夺锁）。
- 校验面板：坏图（编辑器自测 new Image() 预载，不依赖真组件）、空章节、未知块字段；点击定位（滚三处）。
- 布局：三栏拖宽（persist）、状态栏（路径/章块计数/保存态/锁态）、预览滚动跟随选中块+短暂高亮。
- 历史快照记 {focusedUid, caretStart, caretEnd}，undo/redo 恢复焦点与光标。
- 性能定标：块/树节点 memo（uid 键）、预览 debounce ~100ms、**不做虚拟滚动**。

### 1.3 验收

- **RulesPanel 回归**：重构前先跑基线（/preview.html 开教程面板遍历全章抓 .tut-content innerHTML 存
  scratchpad 基线 JSON）→ 抽取后重跑逐字节 diff（有 data-* 锚点则先归一化剥除）。
  fixture 注入必须**原地变异**：`m.T.rules.chapters.splice(0, len, ...fixture)`（CHAPTERS 引用在模块求值期抓死）。
- 新编辑器：真文件 load→save→git diff 空；编辑往返（隔离副本 env 重定向）；上传/Ctrl+S 后断言**无自我 reload**
  （window 探针标记存活）；多选/剪贴板/右键/F2/Del/autosave 恢复/校验定位/409 冲突流；
  IME 合成回归（CDP Input.imeSetComposition：合成中 Enter 不拆段）；chrome 无浮雕断言。

## 2. 摄影棚 2.0

### 2.1 交互规格

- **物体常挂**（结构决策）：废除 PlainItem/SelectedItem 换挂——Item 组件统一常挂，挂载登记
  模块级注册表 `itemRegistry: Map<id, Object3D>`（selectionLock 先例的单例文件）。TransformControls
  单选 object=注册表该物 group；多选挂独立 pivot 空组。仍恪守「object= 已有 Object3D，禁 children 包裹」。
- **选择模型**：`selection: string[]`（有序，末位=主选）。点选=单选；Ctrl+点=切换；outliner Shift=范围；
  Ctrl+A 全选（preventDefault）；Esc 优先级：框选进行中=仅取消框选 → arrange=清选 → fly 不动。
- **框选**：唯一 window 捕获 pointerdown（顶层挂一次，活值经 ref）：记 downPos、按 controls.axis||dragging
  判 gizmo（沿用 selectionLock）；物体 r3f onPointerDown（冒泡在后）置 dragCandidate；window pointermove
  超 4px 才分派：gizmo→不管 / 有 candidate→表面拖拽 / canvas 起点且无 candidate→框选（HTML overlay 矩形，
  pointer-events:none）；pointerup 后凡发生过框选/物体拖拽 → selectionLock=true 吞随后的 click/onPointerMissed。
  **命中判定**：非 hidden 物的 world Box3 八角 → 相机空间近平面裁剪（视空间 z≥-near 的角点丢弃，全丢则跳过）
  → 屏幕 AABB 与矩形**相交**即选中（Blender 语义，穿透遮挡照选；点选仍取最近命中）。
- **批量变换（pivot 数学，起点快照+全量 delta）**：
  dragging-changed(true) 时：`pushHistory()` 一次（拖拽期间写入不进历史）、存 `pivotStartInv = pivot.matrixWorld.invert()`
  与各选中物 `startMat[id] = obj.matrixWorld.clone()`；objectChange 时 `delta = pivot.matrixWorld × pivotStartInv`，
  每物 `newWorld = delta × startMat[id]` → decompose → 写 live group + 写回 store（不 push 历史）；
  dragging-changed(false) 收尾一次性落账。旋转经 Quaternion 合成再 setFromQuaternion 回欧拉（禁欧拉直加）。
  **多选 scale 限等比**（three TransformControls scale 恒 local——写进硬约束）；space 切换只影响 translate/rotate。
  pivot 位置=选中集 Box3 质心，仅在选择集变化时重算（拖拽中不动）。
- **表面放置**：直接拖物体本体（非 gizmo 轴）= 表面跟随。造景统一包 `<group ref>` 发布 envRef 单例；
  拖拽开始 traverse 一次收集候选 mesh（可见环境 mesh（含祖先 visible 过滤——藏顶横梁 visible=false）+
  非选中且非 hidden 物），拖拽期间只 intersectObjects 复用数组；**全部选中物从候选排除**（防自命中上浮）；
  底面偏移 = 拖拽开始瞬间 `item.pos.y − worldBox3.min.y` **锁死至拖拽结束**（MinecraftPlayer 呼吸每帧改 y，
  实时重算会抖）；落点 y = hit.point.y + offset；多选整组随主选平移。
- **落底 V**（B 已被泛光占用）：排除全部选中物后，从 (x, box.min.y+0.02, z) 向下射线，底面中心+4 底角采样
  取最高命中 y；若最近命中面高于 min.y（已互穿）则向上顶出；多选按 min.y **升序逐个落，落完即加回候选集**
  （保成摞关系）。newY = hitY + (pos.y − box.min.y)。
- **网格吸附 X**：TransformControls translationSnap 0.1 / rotationSnap 15° / scaleSnap 0.1。
  多选时吸附作用于 pivot（Blender 同款语义，明文接受）。
- **Outliner**（左侧可折叠面板）：列表（种类图标+名称，双击重命名 `item.name`）、点/Ctrl/Shift 选、
  眼睛=`item.hidden`（不渲染=从注册表移除 → 天然不可点/不进射线/不进框选/不进截图）、
  锁 `item.locked`（可见但点选/框选/拖拽全跳过）、右键菜单（复制/删除/落底）。
- **批量编辑**：Del 多删、Shift+D 多复制（整组偏移 +0.4,+0.4；**深拷贝** structuredClone）、
  检查器多选态=数量+种类统计+（全同类时）批量属性控件+落底/复制/删除按钮。
- **一摞钱生成器**：工具栏「+钱堆」——N 张（输入 1-40）用 `scene/cards.jsx` 的 `cardLocal(i)/cardYaw(i)`
  同源槽位生成自然错位钱堆（与游戏内钱堆像素级同款），生成为 N 个独立 note 物品并自动全选成组可拖。
- **F 聚焦**：UI 侧算选中集合并 Box3 → `focusReq {center,radius,nonce}`；FlyRig 消费：
  `dist = radius / tan(fov/2) × 1.2`，沿当前视线反方向退 dist，lookAt center 反解 yaw/pitch。
- **出生点**：addItem 从视野中心向前射线落到支撑面；失败回落桌心 + 每次 +0.15 螺旋偏移（防叠死）。
- **序列化**：sanitizeItem 加 `name`(string 裁剪) `hidden`(!!) `locked`(!!)（白名单重建是唯一闸门，
  不改它字段必被剥）；load() 也过 sanitizeItem；撤回快照存 selection 数组、恢复时按存活 id filter；
  旧场景文件无新字段 → 回落默认即兼容。

### 2.2 硬约束（violate = bug）

1. TransformControls `object={obj}` 挂已有 Object3D，禁 children 包裹；**scale 模式恒 local**。
2. 窗口级 pointer/key 监听：捕获阶段、只挂一次、活值经 ref/getState；r3f raycast 在冒泡阶段。
3. three Raycaster **不检查 visible**——hidden/藏顶物必须从候选集物理剔除或祖先 visible 过滤。
4. 帧钟调度；StrictMode 幂等；探针覆盖式写 window。
5. E2E：SwiftShader flags；断言轮询；CDP 截图；指针锁不可测→只测 arrange 路径；
   **合成鼠标拖 3D 有失败先例**——表面放置/框选的几何计算做成可探针直调的纯函数硬断言，
   鼠标全链路只作截图证据；旋转断言比矩阵/朝向向量，**禁比欧拉分量**（万向节等价跳变）。
6. 探针：`__photoStore/__photoRig/__photoProject/__photoControls` 保留，新增 `__photoItems()`
   （id→{worldBox3 min/max, screenAABB}）与 `__photoPick(x1,y1,x2,y2)`（框选纯函数入口）。
7. 快捷键总表（新增先查表）：Tab 模式 | 1-6 机位 | G/R/T 轴 | L 空间 | P 截图 | H 藏UI | C 藏顶 | B 泛光 |
   **V 落底** | X 吸附 | F 聚焦 | Shift+D 复制 | Del 删 | Ctrl+A 全选 | Ctrl+Z/Y | Ctrl+S 导出 | / 帮助 | Esc 见优先级。

### 2.3 验收

点选/Ctrl 加选/框选矩形命中（探针直调断言）、多选 gizmo 平移两物等 delta（矩阵比对）、
带旋转两物绕 pivot 旋转后世界位置正确、表面落点纯函数（射线+offset）断言 y≈crate 顶、V 落底（含一摞升序）、
Shift+D/Del 批量、Ctrl+A/Esc、outliner 重命名/hidden/locked 行为、钱堆生成器槽位与游戏 cardLocal 一致、
场景文件含 name/hidden/locked 且旧文件可导入、撤回链含 selection、CDP 截图目检。

## 3. 施工组织

- **双轨并行**：T 轨=client/tutorial-editor.html、client/src/tutorial-editor/、client/src/ui/TutorialContent.jsx、
  RulesPanel.jsx（抽取）、client/tools/tutorial-api.vite.mjs；P 轨=client/src/photo/*。
  **vite.config.js 与根 package.json 由主线预落并冻结**（评审裁决：双轨共享运行时）。
- 分期：T① 地基（抽取+基线回归+插件+入口）→ T②a 存量等价 → T②b 新增 → T③ E2E；
  P① store/常挂/注册表 → P② 选择/框选/批量/表面/落底 → P③ outliner/检查器/键位/钱堆 → P④ E2E。
- 端口纪律：T 轨 vite **5219** + `VITE_CACHE_DIR=node_modules/.vite-t`；P 轨 **5229** + `.vite-p`；
  E2E 即启即杀自带实例。legacy 编辑器测试 4199。
- 降级预案：T②a 完成即可用（legacy 兜底 T②b 全部）；P 轨多选可降平移-only、表面跟随可降单物。
- 后续扩展（本轮不做，留档）：对齐/分布、持久分组、高分辨率离屏截图、FOV/roll、阵列复制、
  编辑器编辑 text/zh.js 其他文案面。

## 4. 全局坑清单（进场必读）

1. pixel.css 有 body 级全局样式（扫描线背景/`user-select:none`/字体平滑关）与 .btn/.toast/.modal 浮雕皮肤
   ——编辑器 chrome 必须命名空间隔离 + 反污染重置。
2. pixel.css 消费 palette.js/texlib.js **JS 副作用注入**的 --c-*/--tex-* 变量——入口必须显式 import 两者
   （photo 页靠 StudioScene 传染带入属侥幸）。
3. PixelText 不换行、逐字符 flex；`.rules-panel .pixel-text{gap:1px}` 依赖祖先类名。
4. tutorial.json 落盘 `JSON.stringify(data,null,2)+'\n'`；形态规范化三规则见 §1.1。
5. 真 tutorial.json 有用户手存数据——测试用 env 重定向隔离副本 / 纯内存 splice 注入。
6. text/zh.js `import tutorial.json`——编辑器模块图严禁触达（自我 reload 回路）。
7. DEV 工具内联中文 OK（文案集中制只管玩家可见面）；改 RulesPanel/游戏侧要走 text/zh.js。
8. pushHistory 合并 key 规范照旧；undo 时 coalesceKey 置空。
9. Windows：Git Bash 用 C:/ 前缀路径；taskkill //F //PID；vite 缓存 rename EPERM 竞态见 §3 端口纪律。
