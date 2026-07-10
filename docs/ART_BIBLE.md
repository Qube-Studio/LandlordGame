# 「暖光酒馆」美术大革新 · 美术圣经 + 实施规格书(v1.0)

> 产出方式:三份独立概念方案(剧场造景/材质工艺/设计系统)→ 三位评审(美术总监/性能工程师/执行工程师)全票选定剧场造景为骨架 → 合成终案。
> 骨架 = 剧场造景;嫁接 = texlib 五基材库、`--tex-*` 同源材质、三层 palette token + 别名降级、SEATS 纹理坐标校准、布告栏大厅、MOTION token、3 帧火焰轮换、16 顶点 Points 金屑。
> **本文档是唯一施工依据,施工时不再做任何设计决策。**

---

# 第一部分【美术圣经】

## 1.0 世界观一句话

**一间打烊后只留一盏吊灯的老酒馆账房:所有光引向桌心的赌局,木、黄铜、羊皮纸与烛火是仅有的四种材质。**

## 1.1 统一色板 token 总表(单一真源:`client/src/assets/palette.js`)

三层结构:**原语 → 语义 → 工具派生**。全仓禁裸 hex(canvas 内 `rgba()` 阴影除外),以 `grep -rn '#[0-9a-f]\{6\}' client/src --include='*.js*'` 自查。

**原语层**(名称 / hex / 用途):

| token | hex | 用途 |
|---|---|---|
| wood900 | `#1a100a` | 最深木/描边/HUD外框 |
| wood700 | `#2e1d11` | 面板底/桌腿暗部 |
| wood500 | `#4e3826` | 橡木框/门板中间调 |
| wood300 | `#7a5a3e` | 受光木/按钮 |
| beam | `#241708` | 房梁 |
| brass | `#b98a3f` | 黄铜基色(铭牌/包角/铆钉) |
| brassHi | `#e8c25a` | 黄铜高光=全局金(替代旧 --px-gold/--gold) |
| parchment | `#e8d5ae` | 羊皮纸底 |
| parchInk | `#3a2a18` | 羊皮纸上的墨字 |
| chalkBoard | `#2a2d28` | 饭账黑板底 |
| chalkInk | `#e6e2d4` | 粉笔白 |
| candle | `#ffd28a` | 吊灯光色 |
| key | `#ffc87d` | 主平行光色 |
| fire | `#ff8848` | 炉火光色 |
| ember | `#ff9a4a` | 炭床 emissive/警示脉冲 |
| coolFill | `#5f78a8` | 冷补光 |
| sceneBg | `#1a120b` | 场景背景 |
| sceneFog | `#2c1c10` | 雾色 |
| feltTable | `#6b3428` | 桌毡暗酒红 |
| feltLine | `#caa04e` | 毡面金描线(α0.5 使用) |
| skin | `#e8b878` | 肤色 |
| ink | `#f6ecd8` | 正文暖象牙白 |
| inkDim | `#b8a585` | 次级文字 |
| danger | `#e36262` | 扣钱/破产 |
| ok | `#8fc77a` | 加钱/达标 |

**角色布料**(shirt/pants/sleeve, 收编现值): landlord `#caa24a/#5a4424/#b8902f`; capitalist `#6e4a92/#3a2a4e/#5e3f80`; farmer `#7a9a4e/#4a5230/#6c8a44`; investor `#3f8a82/#2c4a48/#368079`; glutton `#9a6a3a/#5a3e26/#8a5e32`; none `#8a7a64/#54483a/#7a6a54`。
**面额**(bg/ink/accent, 货币=蜡烛后暖化并入烛光世界,保四色相): 10 `#d6ab4a/#3a2b0d/#f4dc8e`(蜂蜡金); 5 `#7f9a52/#26311a/#c6d69a`(暖橄榄绿); 2 `#5a8ba0/#14303a/#a8ccd7`(暖岩蓝,去冰); 1 `#c2a06e/#3a2c17/#e6cfa2`(牛脂暖褐); DEBT `#b8443c/#2e0c09/#e39a92`(火漆红); BACK `#262019/#8a795c/#37301f`(暖木背)。

**语义层**: `surface=wood700`、`accent=brassHi`、`gold=brassHi`、`panelLine=wood900`。
**工具层**: `shade(hex,±pct)`、`alpha(hex,a)` — bevel/阴影/暗边一律派生,不另设 token。

**三路注入机制**:
1. **CSS**: `main.jsx` 最先调 `injectPalette()`——遍历 token `document.documentElement.style.setProperty('--c-<kebab>', v)`;旧变量**别名降级**写进 theme.css/pixel.css:`--px-gold: var(--c-brass-hi); --gold: var(--c-brass-hi); --px-panel: var(--c-wood-700); --px-darker: var(--c-wood-900); --ink: var(--c-ink); --danger/--ok/--landlord/--farmer` 同理。类名零改动,smoke 零风险。
2. **three**: `import { P } from '../assets/palette'` → `color={P.feltTable}`。
3. **canvas**: pixelnote 的 DENOM 表、textures.js、texlib 全部 `import { P }`。
4. **材质 CSS 变量**: texlib 烘好后 `injectTextures()` 把 `wood(wood700).toDataURL()`、`parchment()`、`chalk()` 写入 `--tex-wood / --tex-parchment / --tex-chalk`,HUD 用 `background-image: var(--tex-*)` ——HUD 面板与 3D 桌框**字面同一张纹理**。

## 1.2 灯光 rig 终案(共 5 盏,与现状持平:删暖轮廓 dir,换入炉火)

| 灯 | 参数 |
|---|---|
| ambient | 0.30 `#4a3828` |
| 主平行光 | pos `[4,9,3]`, 1.35, `#ffc87d`, castShadow, mapSize 1024, bias −0.0004(阴影相机沿用现值) |
| 吊灯 point(唯一光池) | pos `[0,3.6,0]`, **i=26**, dist=10, decay=2, `#ffd28a` |
| 炉火 point | pos `[0,1.7,-10.5]`, `#ff8848`, dist=9, decay=2, 无影;每帧 `i = 7 + sin(t*2.3)*1.2 + sin(t*5.1)*0.6` |
| 冷补 dir | pos `[-6,4,6]`, 0.30, `#5f78a8`(相机侧提人物暗面) |

背景 `color=#1a120b`;雾 `#2c1c10, near 10, far 26`(墙落进雾里,黑虚空消失)。Bloom intensity 0.5 / threshold 0.72 / smoothing 0.2 + Vignette offset 0.28 darkness 0.62 **全部不动**。

## 1.3 程序化纹理库清单(`client/src/assets/texlib.js`)

mulberry32 种子 PRNG,全部 NearestFilter、按参数 key 缓存、永不逐帧重画;每张最外圈像素压暗 25% 烘成描边。

| 纹理 | 尺寸 | 绘制要点 | 缓存 key |
|---|---|---|---|
| `wood(tone,plankW=8)` | 128² | 竖板条+板间明度 ±6%+1px 蛇形木纹+疖疤点 | `wood\|tone\|plankW` |
| `felt(color)` | 128² | 逐像素噪声 ±4%+四角压暗 −12% | `felt\|color` |
| `fabric(color,pattern)` | 32² | 2×2 织纹 ±5%;pattern∈stripe/patch/damask | `fabric\|color\|pattern` |
| `brassTex(patina=0)` | 64² | 横向拉丝+边缘铜绿斑(patina>0) | `brass\|patina` |
| `parchment()` | 128² | 纤维划痕+毛边+ ±3% 噪声 | `parchment` |
| `chalk()` | 64² | 黑板底+粉笔擦痕 | `chalk` |
| `tavernWall()` | 256²(repeat 3×1) | 下1/3 石墙裙(`shade(wood900,+15)` 砌块+勾缝)、上2/3 竖木板;**酒瓶架/画框/鹿角剪影烘进纹理**(比墙暗30%) | `wall` |
| `plankFloor()` | 128²(repeat 6×6) | 地板条+钉点 | `floor` |
| `rug()` | 128² | 圆形织毯纹+边穗 | `rug` |
| `barrel()` | 64×128 | 桶板+两道铁箍 | `barrel` |
| `tableFelt(oppCount)` | 512² | 见 1.4 | `tableFelt\|0..4`(≤5张) |
| `flameFrames()` | 3×(32×48) | 3 帧火舌,400ms `material.map` 引用轮换 | `flame\|0/1/2` |
| `skinFace(role,part,face,bankrupt)` | 16² | 见 1.5 | 四元组 |
| `coinFaceTexture(face)` | **128²** | 见 1.6 | face |
| `coinEdge()` | 64×8 | reeded 直齿纹 | `coinEdge` |
| 钞票(pixelnote) | 44×62 | 见 1.6,缓存键不变 | `value\|faceDown\|debt\|locked` |

## 1.4 场景与赌桌规格

**房间**: 内翻盒 24(x)×10(y)×24(z)——4 墙 plane 贴 `tavernWall`(repeat 3×1)+天花 plane 贴 `wood(wood700)`(repeat 4×4)。地面换 `plankFloor` repeat 6×6。
**中景**(共 ~34 静态 mesh): 房梁 4 根(box 0.4×0.4×24, y=6, `P.beam`, castShadow);后墙壁炉(z=−11.6:石框 3 box + 炉膛黑 box + 火焰 plane×2 交叉,材质 `emissiveIntensity=2` 走 3 帧轮换);沿墙酒桶 ×3(cylinderGeometry 8 段,贴 `barrel`,pos `[-9,0.75,-8]`/`[-10,0.75,-4]`/`[9.5,0.75,-7]`);**桌上方木轮吊灯** pos `[0,3.6,0]`(八角环=1 个 cylinderGeometry(1.1,1.1,0.12,8,1,true) 贴 wood + 4 蜡烛 box 0.08³ + 4 火苗 box 0.05³ `emissive=#ffd28a, intensity=2.2`,给点光一个形体归属);桌下圆毯 circleGeometry r=5, y=0.01 贴 `rug`;桌腿横撑 2 根。烛台/壁炉均**不配真灯**(吊灯/炉火两盏点光已在 1.2 内),emissive+Bloom 是剧场假光源。
**赌桌**: 毡面 box 6.6×0.12×4.0(顶面 y=1.0)换 `tableFelt(oppCount)`:暗酒红 felt 基材 + **金描线下注区烘死在纹理里**——中央双环硬币圈(世界半径 0.55/0.75,`feltLine` α0.5,环内王/禾对半暗纹 `shade(feltTable,-8)`)+ 每个钱堆落点一个椭圆下注位(虚线格,世界半轴 x=0.62 / z=0.50)。**纹理坐标↔世界坐标映射**:`u=(x/6.6+0.5)*512, v=(z/4.0+0.5)*512`;落点=代码同源常量:对手 `(SEATS[oppCount][i].x*0.42, SEATS[oppCount][i].z*0.42+0.1)` + 自己 `(0,1.5)`(=SELF_STACK)。MoneyStack 严丝合缝落进椭圆,零文字锚定下注区。木框贴 `wood(wood500)`;内缘一圈黄铜嵌线(4 根 box 0.06 厚,`brassTex` + `emissive=#b98a3f ×0.15`);桌腿 `wood(wood700)`。

## 1.5 角色皮肤系统(每面独立 16² canvas 路线,否决 UV 图集)

`texlib.skinFace(role, part∈head/body/arm/leg, face∈front/back/left/right/top/bottom, bankrupt)`,16×16,按四元组缓存;**材质数组按 `role|bankrupt|expression` 在模块级缓存全场共享**,mesh 数不变(~10/人)。
- **通用**: fabric 基材织纹 ±5%;顶面 +8% / 底面 −10% AO;**每面最外圈像素压暗 25%**(烘焙描边,零几何);腿底 1 行 wood900=鞋。
- **机器人改肤(2026-07-08 定稿,替代人肤/头发)**: 头=方形机器头——机壳 `P.botShell`(暖调浅白,偏羊皮纸,酒馆暖光下不煞白)+面板缝/螺栓(shade 派生),**正面=独立 32² 荧幕系统 `texlib#screenFace`**(其余五面仍 16²)：24×24 荧幕 `P.botScreen`+屏顶 1px 反光;**表情=荧幕字符脸(五稿定稿:只有眼睛、没有嘴——用户拍板"所有嘴巴都不要";统一暖白 `P.chalkInk` 含哭脸,破产的灰交给整脸灰化烘焙;笔画 ≥2px 防光晕糊,眼睛大而醒目)**——idle/ready=`▮▮` 竖直长条眼(3×10)、win=7 宽双层粗 `^^`、bet=**`$$` 钱眼**、lose=粗 `TT` 长泪痕、bankrupt=`✕✕` 7×7 大叉;**荧幕效果**：字符烘焙光晕(shadowBlur 2)+隔行扫描线(α0.10)+`glow` 纯字符黑底画布作 emissiveMap(emissive `#e6e2d4` ×0.5,破产 ×0.15,暗处字符真发光)+**CRT 抖动**(A/B 双帧:B=颜文字下移 1px+扫描线错行;MinecraftPlayer 模块级 FLICKER 注册表,useFrame 9Hz 步进、不规则节拍换 texture.image,零重编译,全场同步微闪);顶面散热槽/背面检修口+四角螺栓/侧面原耳位圆盘螺栓。手=**黑色皮手套** `P.botGlove`(臂末 3 行+腕口 1px 亮缝,掌心微亮);旧 `P.skin/P.hair` 保留给遗留 faceTexture 兜底。头戴道具(皇冠/礼帽/草帽等)照戴在机器头上。
- **角色个性**: 地主=金袍绣回纹+深色腰带;资本家=紫底 1px 细条纹+白 V 领+胸前 2px 金怀表链;农民=2×3 异色补丁+草绳腰+裤脚泥点;投资人=青马甲+领带+袖套+胸袋钢笔;暴食者=围裙酱渍飞溅+条纹袖口。
- **破产**: 在 canvas 内烘灰(保留织纹层次)+衣服裂纹,替代现在的材质级 gray()。
- **道具**: 皇冠 `emissive=#f0d060 ×0.35`;资本家怀表金块 emissive 同值;草帽贴 fabric 草编纹;投资人左手算盘(1 plane 烘珠纹);暴食者右手鸡腿(2 box `#c9a36a`/`#8a5a30`)。表情系统(faceTexture 分支逻辑)并入 skinFace 的 head/front。

## 1.6 钱/币/卡

**钞票**(44×62 网格、缓存键、2D/3D 单一真源机制**不变**;**货币=蜡烛**后全面改烛本位母题,`draw()` 与 `DENOM_COLORS` 之外零结构改动): ①边框扭索波纹(accent 2px 重复纹)+四角花角;②中央大数字凸版化(ink 主体+右下 1px `shade(ink,-30)` 阴影);③**蜡烛水印**——弃旧朝代母题(城楼/麦穗/河纹/铜钱),改用货币符同一份 `CANDLE_ROWS`(`drawCandleGlyph`,cell4,`shade(bg,±8)`)框在数字后垫底;④**左上角标 `¥N`**(蜡烛符+面额,复用字体 ¥ 字形);⑤**底部烛焰计数条 `drawTally`**——N 个焰点(暗焰身+accent 亮焰尖)落在黄铜横轨上,N=面额(>5 折两行,10=两行5),照素材版式,取代旧 `YUAN`/序列号行(债务=熄灭暗桩,无亮尖);⑥背面火漆印章由「王」改**蜡烛印**(`drawCandleGlyph` cell2,暗红 `#7a2020` 圆章+压纹);⑦债务牌保留锁链纹边、锁定保留黄铜挂锁。**3D 卡边缘**: edge 材质按面额 accent 色带(银行捆钞感),CARD_MATS 缓存不变。
**硬币=全剧最亮道具**: 纹理 64→128²——王面双层明暗浮雕皇冠、禾面麦穗束、圆周 32 刻齿、字符双绘(偏移1px暗底);侧壁贴 `coinEdge`;材质 `metalness 0.55 / roughness 0.4 / emissive #6a4a10 ×0.25`(翻飞时金闪被 Bloom 捕获)。coinSim 物理烘焙**一字不动**。
**落桌反馈**: 飞牌落定 scale 1.15→1(3帧 punch);硬币落点金环 ringGeometry(0.3,0.38) scale 0→2.2 / opacity 0.8→0,500ms 后卸载。

## 1.7 HUD 图形语言:「酒馆记账」

隐喻: **胡桃木板(容器)+ 黄铜(框/铭牌/铆钉)+ 羊皮纸(数据)+ 黑板(饭账)**。圆角恒 0。
- **框体范式**: 底 `var(--c-wood-700)` 叠 `var(--tex-wood)`(纹理烘 25% 透明度进 dataURL)、3px `--c-wood-900` 外框、bevel 沿用现有 inset、内 1px `alpha(brassHi,.25)` 金线;**四角铆钉 = 4 层 radial-gradient 背景**(零 DOM、不占伪元素):`radial-gradient(circle 3px at 6px 6px, var(--c-brass-hi) 0 2px, transparent 2px)` ×4 角。
- **四类角落 HUD 同构化**: 宽 188px 三段式挂牌——①标题条=黄铜横带 `linear-gradient(var(--c-brass), shade(brass,-15%))` 配 wood900 深墨字;②大数值行;③注脚行。差异化:地主目标=黄铜铭牌;资金池=铜盘;工资=羊皮纸条(`--tex-parchment` 底+parchInk 字);**饭账=黑板**(`--tex-chalk` 底+chalkInk 粉笔字)。落后/未达标=ember 边框 0.8s steps(2) 脉冲;达标=ok。
- **字级**: 自己资金=PixelText size4 金;面板核心数值=size3;标题=size2 铜;CJK 正文 13px;注脚 11px inkDim。**金色只许用于钱数,红绿只用于增减**。
- PlayerRail=缩小版同范式,行首 4px 角色色条,待行动者 1.6s 呼吸金光,我方金框。按钮:primary=黄铜渐变+wood900 字;ghost=素木。
- **昵称牌** `.mc-nameplate`:小号木瓦牌同范式(wood700 底+wood900 边+1px 金内线),角色名前保留角色色点;破产灰化。
- **类名契约(.r3f-scene .hud .conn-banner .hud-disconnect .phase-chip .round-chip)与中文按钮文案一律不动,只换皮。**

### 1.7.1 HUD 2.0 增补(dev 轮):信息三层制 + 桌沿抽屉

- **信息三层制**: ①常驻层=边缘极简(顶左「房名+第N轮·阶段」合并场次牌、右缘玩家条、右下资金簇、左下聊天);②决策层=底部行动区(阶段提示 12px 小字 `.phase-caption` 直接压在行动面板上方——**不再有屏幕中上悬浮横幅**,`.hud-banner` 退役);③抽屉层=呼出面板。**系统级(设置/退出)留顶栏,游戏内容级(角色/账本)走桌沿抽屉**。
- **桌沿抽屉**: 屏幕正下方 `.dock` 两个木把手【角色 R】【账本 L】(激活=黄铜、新账入账脉冲+轮数角标);面板 `.drawer` 从底边升起(木板+铆钉+黄铜标题条范式,宽 ≤1060px,高 ≤66vh),R/L/Esc/把手/✕ 均可收起。**进 LOBBY 自动升起选角墙;任何阶段切换自动收抽屉**(不挡新阶段行动区)。
- **选角墙=招募令**(`RoleWall`): 每角色一张羊皮招募令(顶心铜钉同模式卡),内容=半身像(`texlib#portraitUrl`,与 3D 皮肤同源 24×30 拼绘)+ 角色名 size3 + 一句 tagline + 「栏目+正文」结构行(栏目=PixelText 深墨,正文=CJK 12px 可换行);**被占=火漆印章(`--c-wax`)+ 占用者名,阵营满=灰化**;我的=金框辉光。LOBBY 可点击应征,开局后变只读「角色手册」。
- **账本**(`LedgerBook`): 一行一轮的羊皮条(最新在上):轮号+硬币面小图标(取 3D 币面同一画布)+胜方+彩池+我的盈亏±+事件小签(罚/破产=火漆底);点击摊开暗色明细(播报文案与 SettlePanel 共用 `game/settleText.js`)。**隐私跟随服务端 viewFor**:他人余额仅观战/终局出现。
- **玩家条瘦身**: 常驻单行(阵营色签+名字+右侧一个信息位:LOBBY 显角色/游戏中显状态),悬停滑出详情卡(角色/余额/技能/在线);破产整行灰化。
- **火漆色**: `--c-wax`(P.wax,#7a2020)为 UI 印章/危险小签唯一红,与 3D 暴食者围裙酱渍同源。

### 1.7.2 货币蜡烛 + 角色图标双轨 + 选角墙 3D 半身像(dev 轮)

- **货币符 = 蜡烛(单一真源)**: `¥` 不再是日元符,而是一枚蜡烛。真源在 `pixelfont/glyphs.js` 的 `¥` 字形(蜡烛点阵 + `export CANDLE_ROWS`)——所有 PixelText 金额前缀自动变蜡烛;中文散文行里的货币符用 `pixelfont/CandleMark.jsx`(同点阵行内 SVG,继承 currentColor,故 danger 行=红蜡烛/ok 行=绿蜡烛)。**禁止**在 JSX/散文里再写裸 `¥` 字。右下资金蜡烛(BalanceHud)**按上一回合盈亏染色**:`history[-1].deltas[me] < 0 → 红,否则绿`(默认/无回合=绿)。
- **角色图标双轨(勿混)**: ①**玩家栏**=玩家自备白色剪影 PNG(`assets/ui/*_icon.png`,经 `assets/RoleIcon.jsx`);玩家栏契约=**左在线灯 / 中名字 / 右角色图标(24px)**,阶段状态只在悬停详情里、主行与详情都不再放在线状态。②**选角墙招募令**=**真 3D 模型**(`scene/RoleBust3D.jsx`,微型 `<Canvas frameloop="demand">` 复用 `MinecraftPlayer` 的 `HeadProp` 与 `skinTex` 身体材质):**保留身体、去头、头位浮标志性饰品**——身体与饰品都与桌边的人完全同源(用户明确要求一致,不许 2D 重绘)。`HeadProp`/`pmat`/`pmatGlow` 已在 MinecraftPlayer 模块级并 `export HeadProp`。
- **赌桌 X 收窄**: 毡面 6.6→6.0、木框 7.0→6.4、侧座 ±3.95→±3.6;下注圈由 `spotOf(seat)` 生成并烘进毡面纹理,改座位/桌宽不会与圈错位(圈与钱堆同源)。

- **共享底景**(body,三层 CSS): 顶部 70% 暖黄径向光池 `radial-gradient(900px 500px at 50% -10%, alpha(candle,.14), transparent)` + `--tex-wood` 板条平铺 + 四周 vignette;登录/大厅/游戏内同一变量,世界观无缝。
- **登录=悬挂木招牌**: `.auth-card` 套 1.7 范式;`::before` 画两条 1px 渐变吊链+顶部两颗铆钉(radial-gradient);标题 PixelText 金字,下加铜分隔线;硬币徽章换新浮雕币面 SVG;底部内联 SVG data-uri 酒桶/桌椅黑剪影条。入场 ui-rise 340ms + 一次 0.8° 摆动。
- **大厅=布告栏**: mode-card=钉在板上的羊皮纸(`--tex-parchment` 底、parchInk 字、顶心铜钉、各 `rotate(-1.2deg/0.8deg/-0.6deg)`,hover 转正+浮起 2px);room-list=账本(羊皮底、1px 墨线行、房号 PixelText 金字);「创建房间」等文案不改。顺带删 App.css L157-258 死代码。

## 1.9 动效语言规范

**MOTION token(与 palette 同文件导出,并由 injectPalette 写成 `--t-*`/`--e-*` CSS 变量)**:

| token | 值 | 用途 |
|---|---|---|
| t-fast | 120ms | 退场/微反馈 |
| t-ui | 240ms | 一切 UI 入场 |
| t-emph | 500ms | 强调 pop/结算跳字 |
| t-flight | 720ms | 3D 飞牌(=现值) |
| e-enter | `cubic-bezier(.2,.85,.25,1)` | 入场 |
| e-pop | `cubic-bezier(.34,1.56,.64,1)` | 强调 back-out |
| e-pixel | `steps(2)` | 像素抖动 |
| 呼吸 | sin 1.6s | 待行动/辉光 |
| 错峰 | 80ms | 同级多元素 |

**胜负演出分镜(剧场压光,状态驱动)**: ①进 COIN_FLIP:吊灯 i 26→14.3(0.55×) 600ms easeInOut——全场只剩硬币金闪;②硬币翻飞(烘焙轨迹,无预告);③落定:灯 150ms 弹至 30(1.15×) 再 250ms 归 26;同帧金环扩散 + **16 顶点预分配 Points 金屑**上抛 0.6s(拒绝 DOM 精灵);④+100ms:胜方双臂 rotation.x→−2.6(e-pop 400ms)+win 表情,败方低头 pitch 0.3+lose 表情;⑤+300ms:BalanceHud 600ms/8 步滚数+涨 ok 跌 danger 辉光 2 帧。**破产**: 灰化过渡 0.5s+瘫倒(已有)+相机 look target ±0.03 抖 300ms+名牌灰化。全部包 `prefers-reduced-motion`(压光/抖动/Points 直接跳终态)。

---

# 第二部分【实施规格书】(6 阶段)

## 阶段 0 · 基建:token 与纹理库
- **新建** `client/src/assets/palette.js`(P 三层 token+shade/alpha+MOTION+injectPalette 含旧变量别名降级)、`client/src/assets/texlib.js`(mulberry32+1.3 全部基材/合成纹理+injectTextures 写 `--tex-*`)。
- **改** `main.jsx`(最先 injectPalette/injectTextures);`theme.css`/`pixel.css` :root 改别名指向 `var(--c-*)`;`pixelnote.js` DENOM/DEBT/BACK、`textures.js`、`MinecraftPlayer.jsx` ROLE_COLORS/SKIN、`Scene3D.jsx` 全部 hex 改 import P;**删 App.css L157-258 死代码**。
- **验收**: 画廊全场景截图与基线逐张比对——**结构/布局/几何零变化;基色调按新 token 偏移属预期**(bg/雾/毡等已切新值);smoke 全绿。
- **性能核对**: 启动烘焙计时 <40ms;无每帧重画(DevTools Performance 无 canvas 2D 调用)。

## 阶段 1 · 3D 场景造景
- **改** `Scene3D.jsx`: 新组件 `Room`(五面盒+梁)、`Fireplace`(3 帧 map 轮换,useFrame 内按 `Math.floor(t*2.5)%3` 换引用)、`Barrels`、`Chandelier`、`Rug`;`Table` 重写(tableFelt(oppCount)+黄铜嵌线+横撑);灯 rig 按 1.2 替换(删 `[0,6,-7]` 轮廓光,加炉火 point+闪烁);背景/雾改 P 值;地面贴 plankFloor。
- **验收**: 画廊「四类 HUD」「硬币」「结算播报」场景截图——检查:墙不见黑虚空、下注椭圆与钱堆对位(2/3/4 人各截一张)、吊灯形体在光池正上方。
- **性能核对**: `gl.info.render.calls` 增幅 ≤ +40;帧率 ≥55(核显);阴影仅梁/吊灯 castShadow。

## 阶段 2 · 角色 + 钱币卡
- **改** `textures.js`(faceTexture 并入新 `skinFace`,coinFaceTexture 128² 重绘+coinEdge)、`MinecraftPlayer.jsx`(六面材质数组按 `role|bankrupt|expression` 模块级缓存;道具升级:算盘/鸡腿/emissive;删 gray(),破产走烘焙灰皮)、`pixelnote.js`(1.6 全项重绘,网格与 key 不变)、`Scene3D.jsx` cardMaterials(edge 改面额色带)、`Coin.jsx`(材质参数+侧壁贴图)。
- **验收**: 画廊「角色形象」(五角色+破产)、「钱牌」(四面额/债务/背面/锁定)、「硬币」;`preview.html?phase=BETTING` 确认 2D 手牌与 3D 桌牌仍完全一致。
- **性能核对**: 每玩家 mesh 数不变;皮肤 canvas 总量 ≤300 张 16²(<0.5MB),懒生成。

## 阶段 3 · HUD
- **改** `pixel.css`(框体范式+radial-gradient 铆钉+四类挂牌三段式+黑板饭账+PlayerRail 色条/呼吸+按钮黄铜化+昵称牌木瓦化+MOTION 变量接管硬编码时长)、`UiLayer.jsx`/`NegotiationBoard.jsx`/`McChat.jsx`(仅类内结构微调,不改类名)。
- **验收**: 画廊「四类 HUD」「结算播报」「投保槽状态」「暴食者重掷/放弃」「断线横幅」「观战聊天频道」;确认 .phase-chip/.round-chip 原类名仍在。
- **性能核对**: 全部 transform/opacity/filter,无 layout 动画;`--tex-*` 为静态背景。

## 阶段 4 · 登录/大厅
- **改** `App.css`(共享底景三层+auth-card 招牌+mode-card 布告栏旋转+room-list 账本)、`LoginScreen.jsx`(徽章 SVG 换新+剪影条 data-uri)、`LobbyScreen.jsx`(仅样式类,文案「注册/注册并登录/创建房间」严禁改)。
- **验收**: 手动打开 `/`(未登录)与大厅截图;smoke 登录流程全绿。
- **性能核对**: 纯 CSS,零 JS 成本。

## 阶段 5 · 动效 juice
- **改** `Scene3D.jsx`(压光控制器:读 phase 驱动吊灯 intensity tween;`CoinBurst` 组件=金环+16 顶点 Points,由 COIN_FLIP→SETTLE 状态沿触发;FlyingNote 落定 punch)、`MinecraftPlayer.jsx`(胜负手臂/低头姿态,读 expression/phase)、`UiLayer.jsx`(BalanceHud 滚数 8 步)、`pixel.css`(reduced-motion 汇总豁免)。
- **验收**: 画廊「硬币」「资金增长动画」「投保掉落动画」逐帧录屏;`preview.html?phase=COIN_FLIP→SETTLE` 全链路。
- **性能核对**: 每帧 JS 仅 火苗 sin×2+灯强度+活动 tween,O(1);Points 预分配 1 次。

---

# 第三部分【性能总账】

| 项 | 成本 | 预算核对 |
|---|---|---|
| 新静态几何(墙5+梁4+壁炉6+桶3+吊灯9+毯1+嵌线4+横撑2)≈34 mesh | +≈34 draw call(现状含 36 张/堆的钱牌已 ~100+ dc,增幅 <30%) | ✅ 简单 standard 材质,核显 <0.5ms |
| 烘焙纹理(墙256²+毡512²×≤5+地/毯/桶128²+币128²×2+皮肤≤300×16²+钞票) | <2.5MB 显存,启动+懒烘焙一次,**零每帧重画** | ✅ |
| 灯 | 5 盏持平(−轮廓 dir,+炉火 point 无影);闪烁/压光=每帧写 1 个 number | ✅ ±1-2 约束内 |
| 阴影 | 仍单主光 1024;新增仅梁/吊灯 castShadow,墙地关 receive 之外全关 | ✅ |
| 后处理 | Bloom/Vignette 参数不变,emissive 走现 threshold 0.72;multisampling 0 / dpr[1,1.5] 不动 | ✅ |
| 火焰 | 3 帧 map 引用轮换(400ms),无重绘 | ✅ |
| 金屑 | 16 顶点 Points 预分配,存活 0.6s;金环 1 mesh 存活 0.5s | ✅ |
| drei Html | +0 | ✅ |
| CSS | 全 transform/opacity/filter;`--tex-*` 静态 dataURL | ✅ |
| 估算净增 | ≤1ms/帧 | ✅ |

**降级路径**: `?nofx=1`——EffectComposer 整体关闭:烛焰/炉火/嵌线失去辉光但 emissive 自发光仍在,压光演出照常(只改灯强度),视觉可接受;`?noshadow=1`——Canvas shadows 关闭,梁/吊灯 castShadow 随之无效,ContactShadows(256)仍提供落地感;两开关下新增成本趋近于纯 draw call(~34),核显最低档仍 ≥60fps。

**基线记录(2026-07-02, SwiftShader 软渲染,仅同渲染器对比用)**: huds ≈1.7fps / coin ≈1.3fps。改造后复测不得低于基线的 80%。
