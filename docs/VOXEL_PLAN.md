# F.A.T.E. 体素化施工规划（从零 · 资产先行）

> 定稿日期：2026-07-12。本文件是**体素资产**工作的唯一施工权威，延续本项目「docs/ spec 先行、
> 美术单一真源」的规矩。前身是隔离文件夹 `voxel-render-research/` 的四里程碑规划——**其 PoC 代码已作废**
> （用户 2026-07-12 拍板「当废品晾着」），本规划**从零重写**，不移植任何 PoC 代码；其战略结论
> （体素资产 + 将来 Teardown 式体素光照、WebGPU 只做增强不做门槛、永远保留光栅兜底）作为背景参考保留。

---

## 0. 三项已定决策（2026-07-12 用户拍板）

| # | 决策 | 选择 | 影响 |
|---|---|---|---|
| 1 | 资产观感 | **高精度体素**（否掉「粗体素退回贴图」）| 角色皮肤/道具身份走**体素色**，不走贴图；靠提高分辨率保住玉佩/怀表链/钢笔/酱渍等细节 |
| 2 | 资产来源 | **程序化打底 + 手工精修** | P0 搭两套管线：程序化生成器先铺满全场，MagicaVoxel 手修覆盖重点资产；产出同一批 `.vox` |
| 3 | 渲染野心 | **只做资产，渲染保持现状** | 体素模型 = 普通顶点色网格，吃现有灯光/阴影/Bloom；体素光照（多人旋转、位图域、收敛冻结）**这轮全部不碰**，留作将来单独立项 |

**默认（可推翻）**：机器人「荧幕脸」**保留为凹进头壳的自发光贴片**，不体素化——它本就是块屏幕，平面贴片设定自洽，
且 6 表情 + CRT 抖动 + 发光零改。头壳其余高精度体素化。

## 0.1 非目标（这轮明确不做）

- **体素光照/降噪光追**（Teardown 那套）——独立后置项目，见 §7。
- **体素物理/破坏**——用户长期排除。
- **钱牌、硬币体素化**——2D/3D 单一真源 canvas（`pixelnote.js` → `noteTexture`）是招牌机制，且卡厚 0.035u 亚体素、硬币全靠 `coinSim` 旋转（与将来轴对齐位图冲突）。见 §4。
- **墙/地/顶、火焰/烛焰面片**——保留为贴图平面 + 自发光动画面片（烘死的酒瓶架/鹿角剪影是零几何特性）。

---

## 1. 观感与尺度规范（写死，后续不再决策）

- **世界尺度**：1 world unit ≈ 1 m（角色总高 ~1.95u，桌顶 y=1.0，凳面 y=0.46）。
- **全局体素尺寸**：**s ≈ 1.5 cm**（单一全局尺度，视觉一致——混用尺度在接触处露馅）。可调，是本规划**最关键的旋钮**，由截图验收定稿。
  - 角色头 0.55u → ~37 体素宽（足够高精度承载荧幕脸凹槽 + 皇冠/眼镜/徽章）。
  - 角色总高 ~130 体素。躯干 0.6u → ~40 体素宽。
  - 家具道具同尺度：黄铜嵌线 3cm=2 体素（存活）；毡面金描虚线 ~0.5cm 亚体素（**所以下注圈保留为贴花，不体素化**，见 §5）。
- **调色板 = 单一真源**：`palette.js` 仍是颜色唯一权威（`P` / `ROLE_CLOTH` / `PROP_COLORS`，唯一色 ~100，离 256 上限很宽）。体素资产**只允许**用导出的这套色；MagicaVoxel 调色板与 `voxPalette.json` 索引锁都是**生成物**。
- **材质**：顶点色 `MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:1 })`，吃现有五灯 rig + 阴影 + Bloom。
- **烘焙 AO / 描边**：贪心合并时按面朝向 + 凹陷把顶点色压暗（复刻 texlib 现有「每面最外圈压暗 25% + 顶/底面 AO」），否则体素模型在仍是贴图的墙/钱牌旁边显得发平。
- **自发光体素**（皇冠宝石、黄铜嵌线、炉膛炭床等）：单张贪心网格 + 单材质带不了逐体素 emissive → **拆一张 emissive 子网格**（保留 Bloom 观感），或后续用第二顶点属性 + 自定义 shader。首版走「拆子网格」。
- **风格定位**：**体素演员 + 贴图舞台**——角色/桌/家具体素化，墙/钱牌/硬币保留贴图。常见且成立的体素游戏观感；若日后想连墙/钱牌一起体素化，另立子项。

---

## 2. 资产账本

### 2.1 体素化（这轮目标）

| 资产 | 现状 | 备注 |
|---|---|---|
| **角色 6 分件**（头/身/双臂/双腿）| `MinecraftPlayer.jsx` box-stack + 16²/面贴图皮肤 | 高精度体素；**必须 6 分件**保留骨架，见 §3.1 |
| 头戴道具 ×6 角色 | `headProps.js#buildHeadProp`（皇冠/礼帽/草帽/眼镜/制帽/厨师帽）| 双消费者：桌边人 + 招募令半身像同步换 |
| 手持件 | 投资人算盘、暴食者鸡腿 | 小 `.vox` 挂进臂组 |
| **桌子** | `Scene3D#Table`（毡+框+黄铜+腿+撑）| **桌顶必守 y=1.0**；下注圈保留贴花；双尺寸 6.0/8.6 |
| 吊灯 | `Scene3D#Chandelier`（~40 primitive 八角轮）| **中心留空**（硬币抛物线过顶，apex ~y4.3）；烛焰面片保留 |
| 壁炉 | `Scene3D#Fireplace`（石拱+壁炉台+柴）| 火焰面片保留 |
| 椅 / 酒桶 / 房梁 / 阵营护栏 | `Chair`/`Barrels`/beams/`FactionBarriers` | 简单资产，可复用实例 |
| 杂项装饰 | `Scene3D#Decor`（门/搁板/凳/飞镖靶/板条箱等）| 批量；**保留其自发光子件**（窗玻璃/菜单板/铜币牌/壁灯焰）为面片 |

### 2.2 保留不动（贴图/面片）

墙/地/顶贴图平面、火焰/烛焰/窗/菜单/铜币牌自发光面片、**钱牌**（`cards.jsx` + `noteTexture` 单一真源）、
**硬币**（`Coin.jsx` + `coinSim` 冻结物理）、圆毯、下注圈（毡面贴花）、票据 `Tickets3D`、
HUD 全部 2D。

### 2.3 特例：荧幕脸

`texlib#screenFace`（32² 屏 + emissiveMap + A/B 抖动 + 6 表情）**整套不动**，作为凹进头壳 +z 面的自发光贴片。
头壳 `.vox` 必须**挖出凹槽**承接贴片，避免 z-fighting。`expression.js#expressionFor` 逻辑层零改，仍选贴片显示哪个表情。

---

## 3. 分期施工

> 每期独立可跑、可截图验收；`?art=box` 开关随时回退到现有 box-stack（沿用 `?input=2d`「保留不删」先例）。
> 每期并入前设计者看画廊对比图放行。

### P0 · 体素地基（无可见变化）

1. `client/tools/exportVoxPalette.mjs`（npm script）：读 `palette.js`（`P`+`DERIVED`+`ROLE_CLOTH`+`PROP_COLORS`，按 hex 去重语义别名）→ 冻结 256 索引 → 产出 ①`fate.palette.png`（MagicaVoxel `Palette>Open` 用）②`client/src/assets/voxPalette.json`（token→index **append-only 锁**，新增只追加、绝不重排，否则已建 `.vox` 静默变色）。
2. `client/src/assets/voxload.js`（**从零写，纯函数、可 node 单测**）：`.vox` 解析（z-up→y-up）+ 贪心合并 + 烘焙 AO → 缓存 `BufferGeometry`（positions/normals/顶点色）。
3. `client/src/assets/voxgen.mjs`（**程序化打底管线**）：从参数化部件定义（不止拉伸现有 16² 皮肤，可加浮雕/凹槽/细节）确定性生成每个资产的 `.vox` → 写入 `client/src/assets/vox/`。种子 PRNG，禁 `Math.random`。**手修 = 直接在 MagicaVoxel 里编辑同一批 `.vox` 覆盖**。
4. `client/src/scene/VoxModel.jsx` + `registry.jsx` 注册 `voxModel` 键 + `?art=box` 回退。`getArt` 对未注册键抛错 → 键上线前回退必须先通。
5. 单测：`voxload` round-trip、贪心合并法线/绕序、AO 烘焙。

**验收**：`node` 单测全绿；`voxPalette.json` 生成且锁定；画廊无变化（尚未接消费者）。

### P1 · 角色（身份 + 最硬）

1. 6 分件体素资产（程序化打底 6 角色 × {头/身/臂/腿}，本体 + 破产变体）。
2. `MinecraftPlayer.jsx`：六个 `<mesh><boxGeometry>` → `<primitive object={voxelPart}>`，**严格保留组层级与轴心**（髋 ±0.14/y0.7、肩 ±0.41/y1.4、头 y1.675、坐姿 legRot=-1.5/baseY=-0.16）→ `useFrame` 动画（idle bob/摆臂/转头/胜负姿态/瘫倒）**零改**。
3. 荧幕脸贴片保留（§2.3）；`partMats` 的 head 分支改为「体素头壳材质 + 凹槽贴片材质」。
4. 头戴/手持道具 → `.vox` 挂件；`headProps.js` 与 `bustSnapshot` **同步切换**（同一 `.vox` 源）。
5. 破产灰化：从 canvas 烘灰改**材质级去饱和 / 预灰调色板**；保留倾身 + 藏道具 + ✕✕ + 暗 emissive 0.15。
6. **并行消费者 + 8 文件角色清单**（漏了不报错、只静默缺角色，历史已烧两次）：
   - `LobbyMascot.jsx`（独立 canvas，自带 2 灯，另实现了一份 box-stack）→ 一并体素化，否则登录页站个方块。
   - `bustSnapshot.js`（招募令/座位半身像，含顶部 `ROLES` 数组）→ 离屏渲体素件或保持合成，二选一但须与桌边人同源。
   - `gallery.jsx` `AvatarGrid` roles 数组 + `MinecraftPlayer` 挂点。
7. 投资人眼镜半透明 + `depthWrite:false`（为无背景离屏半身像特调）在体素化后须在实时与离屏两处都复现。

**验收**：画廊「角色形象」5 角色 + 破产逐张过；`?art=box` 回退可用；帧率不低于现状。

### P2 · 桌子 / 家具 / 道具

1. 三件主道具：桌（守 y=1.0、下注圈贴花、双尺寸变体）、吊灯（中空过币、烛焰面片保留）、壁炉（火焰面片保留）。
2. 次批：椅（每座实例 + yaw）、酒桶 ×3、房梁 ×4、阵营护栏、`Decor` 杂项（保留自发光子件）。
3. 拖拽 clamp `setFeltBounds` 数值须与体素桌可见范围一致，否则钱拖到错误边界。

**验收**：画廊「四类 HUD/结算/硬币」场景 2/3/4 人各一张——墙无黑虚空、下注圈与钱堆对位、吊灯形体在光池正上方、`draw call` 增幅可接受。

### P3 · 收尾 / 一致性

1. 走完 8 文件角色接入清单核对表（记忆 [[new-role-checklist]]）。
2. 顶点 AO / 描边参数调到与残留贴图美术调和。
3. 自发光子网格 Bloom 观感复核（阈值 0.72 不变）。
4. 画廊新增「体素 vs box」对比场景（`?art=box` 切换）。

---

## 4. 为何钱牌/硬币不体素化（决策记录）

- **钱牌**：`pixelnote.js#noteCanvas` 一张 canvas 同时喂 2D `<img>`（HUD：MoneyHand/LedgerBook/协商板/投保）与 3D `noteTexture`——「手牌=桌牌=HUD 票」的恒等式是架构招牌，体素化即分叉。卡厚 0.035u 亚体素（体素卡塌成 1 层薄片=又变回面片），且结算演出 12s 高峰几十张飞牌共用一张缓存材质，体素化在帧预算最紧时炸网格数。
- **硬币**：全靠 `coinSim` 的 `rotation.x`（翻滚+摇摆），16 面柱连续旋转会走样，且与将来轴对齐位图直接冲突（PoC 已被迫把体素币抛掷改纯平移）；`coinSim` 冻结不可改 → 体素化=全成本零新意。
- 二者仍是**将来体素光照的占位对象**（进位图吃 AO/软阴影），只是不做成体素**模型**。

---

## 5. 硬约束与坑（施工时逐条对照）

1. **骨架契约**：角色**必须 6 分件**在现有轴心组装，禁止单网格导出——否则 idle bob/摆臂/转头/坐姿/胜负/瘫倒全废。
2. **桌顶 y=1.0**：`cards.jsx#TABLE_TOP=1.0` + `cardLocal` + `setFeltBounds` 三处世界坐标不可动；体素桌顶面、拖拽 clamp 矩形必须与可见体素桌**严丝合缝**。
3. **下注圈保留贴花**：圈烘在 `drawTableFelt` 的 512² 毡面贴图、坐标来自 `spotOf()`（与 `MoneyStack` 落点同源）；金描虚线亚体素 → 体素桌顶保留这张毡面贴图为 decal，别烘进体素。
4. **双桌尺寸**：多人 6.0×4.0 / 单人长桌 8.6×4.0 = 两个 `.vox` 变体（非等比缩放——会破坏方形体素、拉伸圈）。
5. **吊灯中空**：八角中心留空过币；护栏/绳索原本不投影——注意体素占位别突然挡住吊灯点光。
6. **自发光**：候选自发光 token（`crown/ruby`、`brass`、`ember/candle/fire`、`coinGlow`、`specGlass` 半透明）**扁平顶点色带不了** → 拆子网格 / 保留面片。
7. **8 文件角色清单**：`bustSnapshot.js` 顶部 `ROLES`、`gallery.jsx` `AvatarGrid` roles——加角色/资产漏填即静默缺角色（记忆已烧两次，含检察官帽子）。
8. **索引稳定**：`voxPalette.json` append-only；`.vox` 内嵌 RGBA 若被 MagicaVoxel 手改会偏离 `palette.js` → 需一条 lint/校验拒绝漂移（守住单一真源）。
9. **文档漂移**：ART_BIBLE §1.2/§1.4 的灯强/桌宽与**代码不符**（如吊灯 i=26 vs 代码 21、毡宽 6.6 vs 6.0）——**以代码为准**（`Scene3D.jsx`/`cards.jsx`/`palette.js`）生成体素尺寸与调色板。

---

## 6. 验证

- **画廊**（`preview/gallery.html`）：角色/家具/结算场景加 `?art=box` 对比；`SCENES` 追加体素对比条目。
- **截图工具链**：`tools/shoot.mjs`（端口 5175、SwiftShader）——体素**模型**可截（纯几何，无 WebGPU 依赖）；重场景预热沿用 7s/12s。
- **回退**：`?art=box` 全程可用；`getArt('voxModel')` 未就绪不得让消费者渲染。
- headless FPS 无意义，真机帧率设计者跑。

---

## 7. 明确后置：体素光照（将来单独立项）

渲染这轮不动。将来做 Teardown 式体素光照时，以下硬约束（PoC 分析已暴露，与是否复用 PoC 代码无关）**必须解**，届时另立规划：

- **位图域**要覆盖 6–8.6m 桌 + ±2.65m 座（远大于 PoC 的 ±2.56m）。
- **多人 per-player 旋转组**（`rot=-atan2(seat.x,seat.z)`，任意角）vs 轴对齐位图 DDA：把光照移进局部帧（灯按 -rot 变换）或单人 rot=0 先行。
- **收敛冻结** vs 永动动画（idle bob / 火焰轮换 / 吊灯 tween）：复用 `settingsStore.lightAnim`-off 门控。
- 与 pmndrs `EffectComposer`（Bloom/Vignette）的顺序与色彩空间（体素合成输出 sRGB，后处理要线性 HDR）。
- 画质档：`settingsStore` 加 `voxelTier`（off/low/high），off=现行光栅**永远保留**（国产浏览器/老机器兜底），WebGPU 只做增强不设门槛。

---

## 8. 立即下一步

**P0 开工**（体素地基）：`exportVoxPalette` → `voxPalette.json` 锁 → `voxload.js` + 单测 → `voxgen` 打底一个最简资产（如酒桶）→ `VoxModel` + `?art=box` 接线 → 画廊验一眼体素质感与尺度旋钮 s。

---

## 附录 A · VoxLab 体素画风隔离验证区(2026-07-13 已建)

用户指令:先建隔离区单独验证体素画风——与主项目隔离、独立入口、仅本地;起步完全用现有资产和
渲染管线,体素资产逐个换入;保留单人模式的行走 + 准心系统;可摆放人物模型。

**入口**:`client/voxlab.html` → `/voxlab.html`(Vite dev;非构建入口自动排除,且 `import.meta.env.DEV` 双保险)。

**体素核心库**(`client/src/voxel/`,从零,P0 的实现落点——目录取代原计划的 `assets/voxload.js` 单文件):
- `vox.js` — .vox 读写(z-up⇄y-up 约定写死;RGBA 索引 i 在 (i-1)*4 官方怪癖);纯函数,node/浏览器共用。
- `greedy.js` — 贪心合并 + 烘焙 AO(0fps 三邻居;AO 进合并掩码保证大四边形内恒定)+ 面向明暗分级 + sRGB→线性顶点色 + 自发光索引拆子网格。
- `voxload.js` — fetch→解析→合并→BufferGeometry 缓存;自发光按 **hex 匹配**而非索引(手修重排调色板不脆断)。
- `VoxModel.jsx` — 通用组件;`VOXEL_SIZE=0.015` 唯一尺度旋钮在此。
- 单测 `client/tools/voxtest.mjs`(roundtrip 恒等/法线绕序/AO/拆分守恒/面积对账)。

**首个资产**:`client/src/assets/vox/chandelier-deluxe.vox`(豪华吊灯,178×150×178,12.2 万体素,~4.1 万三角)。
生成器 `client/tools/voxgen.mjs`(程序化打底轨:颜色全取 palette.js、mulberry32 确定性;**手修=把 .vox 丢进
MagicaVoxel 改完放回原路径**)。几何规格 `src/voxel/chandelierSpec.js` = 生成器与运行时组件
`src/voxel/VoxChandelier.jsx` 的单一真源(烛位/火苗点/挂点同源——火苗仍是面片,§2.3 同理)。
琥珀吊坠 = ember 色自发光子网格(验证了自发光拆分管线)。

**隔离区应用**(`client/src/voxlab/`):`Stage.jsx` 复用 Scene3D **导出的**造景组件(纯增量 export;
单人布局常量抽到 `scene/singleLayout.js` 过 fast-refresh 规则)+ 同参数灯 rig/Bloom/Vignette;
`LabRig.jsx` 复刻 SingleRig walk 态(指针锁/WASD 惯性/步伐颠簸/碰撞软推出/首帧尖峰吞帧/CTRL 放锁);
`labStore.js` 自持状态(准心逐帧坐标走模块 ref `aimLive`,store 只存类型变化——防每帧重渲染)。
操作:左键摆放、右键删、滚轮/R 换笔刷、V 切吊灯体素↔现有、X 清空、H 帮助;探针 `window.__voxlab`。

**导入素材入口**(2026-07-13):顶栏「+ 导入 .vox」按钮(按住 CTRL 释放鼠标后点)或**直接拖 .vox
文件进窗口**——文件转 ObjectURL 走与内置资产同一条 `loadVox` 管线,导入即成为当前摆放**笔刷**
(R 在「6 角色 + 已导入素材」统一循环)。MagicaVoxel 手修件可以此即改即看,不用放回仓库路径。
准心命中框按加载后的真实包围盒回填。

**持久化 + 摆放系统 v2**(2026-07-13 二轮):
- **持久化**(`voxlab/persist.js`):素材字节进 IndexedDB(`voxlab`/`imports`)、场景(摆放物/开关)进
  localStorage(`voxlab.scene`,300ms 去抖)——刷新全恢复;`hydrateLab()` 启动水合(素材先、场景后,
  素材已删的实例丢弃)。素材库管理面板(右上,CTRL 释放鼠标时可点):换笔刷/删除(连已摆实例)。
- **摆放变换**:Q/E 旋转(±15°,按住连转)、滚轮缩放(按 delta 比例,0.2×~5×;换笔刷移到 R)、
  半透明**虚影**预览(`placeTransform` 是虚影与落子共用的单一真源——所见即所得;角色虚影=逐 mesh
  克隆材质调透明,MinecraftPlayer 材质是模块级共享缓存,直接改会把全场角色改成幽灵)。
- **可放置面**:地面 / 桌面(y=1.0 毡区) / 横梁顶(y=6.2,中线吸附) / 天花板(y=10,**悬挂=顶部吸附**,
  按虚影原始高度×缩放下移;`ghostLive.rawHeight` 由虚影组件加载后回填)。
- **能见度**(仅隔离区):雾 (10,26)→(16,44)、环境光 0.38→0.5——验收资产要看清全屋,游戏的
  「打烊账房」氛围雾参数不动。

**E2E**:`client/tools/voxlab-e2e.mjs`(19 项:锁定/行走/桌面/悬挂/旋转缩放/换笔刷/V 开关/
导入→摆放/**刷新持久化**;`setInputFiles` 注入 .vox 验导入链路)。headless 三坑:①探针在 useFrame
逐帧刷新,SwiftShader ~2fps,断言一律轮询 waitProbe;②锁定态鼠标坐标是虚拟游标,重复 move 同一
坐标=零增量,视角操控必须记账换坐标,俯仰扫描每步等 pitch 真变化(桌面窗口仅 ~2 步宽);
③headless 行走比实时慢一个量级(2fps×dt 限步),摆下的模型挡视线后走不开——**先摆远处表面
(桌面/悬挂)后摆近处地面,多个地面件用不同偏航扇区**。截图=证据不炸断言。

**渐进换资产机制**:`labStore.SWAP_KEYS` 注册表——新体素资产 = 加一个 key + Stage 里一个三元。
新渲染系统将来同样以开关进隔离区试跑。

### A.1 · P0 渲染补课(2026-07-13,voxel 分支,已落地)

用户报三问题:阴影残留(平行光视锥 ±9 < 房间 ±12,出锥物体贴图边缘 clamp 拉残影)、
MagicaVoxel 手修发光不生效(MATL 块被丢弃)、材质质感均一(单一 roughness1 材质)。修复:
1. **阴影视锥**(Stage.jsx):灯位 [4,9,3]→[8,18,6](2×,方向不变)、视锥 ±19 盖全房间、mapSize 2048(纹素密度持平)。
2. **MATL 读写**(vox.js):DICT 编解码 + MATL 块;归一化 `{type, rough, metal, emitK=_emit×2^(_flux-1), alpha}`,
   旧字段 _weight/_trans 兼容;writeVox 可写 MATL——**生成资产与手修资产同一条运行时路径**。
3. **材质三桶**(greedy/voxload/VoxModel):main(diffuse+metal,粗糙/金属走 aRm 顶点属性,metal 钳 ≤0.75)/
   emissive(aEmit 属性,辐射=顶点色×emitK×强度——**有色发光**)/ glass(独立桶,透明+不写深度);
   玻璃可见性=邻居空或(邻居玻璃且自己非玻璃);hex 匹配保留为旧资产回退(与 MATL 并集),
   IndexedDB 旧素材/E2E 零破坏。单测 30/30,E2E 19/19。
4. **材质样板** `material-sampler.vox`(voxgen 第二资产):漫反射/金属/发光/玻璃四柱,
   拖进 VoxLab 即验四质感,也是手修时的材质面板参照物。
坑:同仓双会话共用工作区会互相切分支——voxel 工作已独立成 **voxel 分支**,冲突时用
`git worktree add ../LandlordGame-dev dev` 分离目录。

**渲染管线战略修订(2026-07-13,用户拍板)**:§7 的实时体素光照**降级为后备**——Teardown 自研
光追的根本理由是"破坏",我们没有;改走**烘焙为主混合管线**(P1):静态酒馆离线路径追踪烘焙
(GPU DDA 烘焙器,真弹射 GI;按灯分可见度通道 → 炉火闪烁/掷币压光=运行时调权重)+ 动态小物件
(shadow map + 辐照度体积采样 + 接触 AO)+ VoxLab 改场景 500ms 去抖自动重烘(<2s 渐进)。
完整设计见 `C:\Users\quberen\.claude\plans\bug-swift-unicorn.md`(P1 五步施工切法/数据结构预算/风险)。
