// 真 3D 场景层（react-three-fiber）：赌桌 + 围桌而立的方块人 + 桌面钱堆 + 单独建模的硬币。
// 相机随鼠标小幅转动视角（带阻尼回中）。只读 store，无任何游戏逻辑。
// useFrame 内逐帧改写相机是 r3f 既定用法，关闭对应的不可变性规则。
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Html } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import { decompose } from '../game/notes';
import { factionOf } from '../game/roles';
import { IS_3D_INPUT, IS_TOUCH } from '../game/inputMode';
import { grab } from './grab';
import { setFeltBounds } from './carry';
import Tickets3D from './Tickets3D';
import MinecraftPlayer from './MinecraftPlayer';
import PixelText from '../assets/pixelfont/PixelText';
import { RoleDetailBody } from '../ui/RoleWall';
import Coin from './Coin';
import CineRig from './CineRig';
import ExecutionRig from './ExecutionRig';
import RevolverView from './RevolverView';
import PayoutLayer from './PayoutLayer';
import HandLayer from './HandLayer';
import FeltPrompts from './FeltPrompts';
import { TABLE_TOP, CARD_W, CARD_T, CARD_D, cardMaterials, cardLocal, cardYaw, blankNotes, easeInOut, MoneyStack } from './cards';
import { coinFaceTexture } from './textures';
import { getCoinRest } from './coinSim';
import { setProjector } from './projection';
import { pointerNDC } from './screen';
import { rayHitsBox } from './aim';
import { clientToStage, STAGE } from '../ui/stageTransform';
import { expressionFor } from './expression';
import { P } from '../assets/palette';
import { tex } from '../assets/texlib';
import { T } from '../text';
import { SINGLE_TABLE, SINGLE_TEAM_SEATS, SINGLE_BOSS_SEAT, singleSpotOf } from './singleLayout';

const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];

// 任务③：仅本地测试（import.meta.env.DEV）才暴露的辅助开关。
const DEV = import.meta.env.DEV;
// 临时性能排查开关：?nofx=1 关后处理 / ?noshadow=1 关阴影（仅用于定位卡顿来源）。
const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const NO_FX = PARAMS.get('nofx') === '1';
const NO_SHADOW = PARAMS.get('noshadow') === '1';
// 减少动态:压光/金屑/镜头震直接跳终态或不演(CSS 侧由 pixel.css 的 media query 兜底)
const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// 自适应渲染分辨率(反馈②操作延迟多为大屏掉帧感):按像素总量预算折算 DPR。
// 2K/4K 全屏时把渲染像素压回 ≈1920×1250 量级——像素美学下低 DPR 几乎无感,帧率立涨。
const PIXEL_BUDGET = 2_400_000;
function adaptiveDpr() {
  if (typeof window === 'undefined') return 1;
  const base = Math.min(window.devicePixelRatio || 1, 1.5);
  // 桌面套参考分辨率舞台：画布恒为 STAGE.W×STAGE.H（有效参考尺寸=1920/uiScale，与窗口无关）
  // → 按参考像素折算预算，否则大屏会按窗口像素压出过低 dpr、把定尺渲染面拍糊。
  // 触屏/无舞台（gallery 等直挂页）仍按窗口。
  const rw = STAGE.active ? STAGE.W : window.innerWidth;
  const rh = STAGE.active ? STAGE.H : window.innerHeight;
  const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, rw * rh));
  return Math.max(0.75, Math.min(base, budget));
}

// 绝对座位系统(玩家反馈⑫⑮):每个玩家按 players[] 序固定坐在桌边某个位置(人人所见一致),
// 渲染时把整个场景绕 Y 旋转,让「我的座位」永远转到相机近侧——不同玩家看到自己坐在不同的桌边。
// 座位贴桌(坐凳,大腿伸进桌下),桌框 ±3.5(x)/±2.2(z)。
const SEAT_LAYOUTS = {
  1: [{ x: 0, z: 2.65 }],
  2: [{ x: 0, z: 2.65 }, { x: 0, z: -2.65 }],
  3: [{ x: 0, z: 2.65 }, { x: -1.9, z: -2.65 }, { x: 1.9, z: -2.65 }],
  // 桌子 X 收窄后侧位内收(±3.95→±3.6),仍贴桌边
  4: [{ x: 0, z: 2.65 }, { x: 0, z: -2.65 }, { x: -3.6, z: 0 }, { x: 3.6, z: 0 }],
  5: [{ x: 0, z: 2.65 }, { x: -1.9, z: -2.65 }, { x: 1.9, z: -2.65 }, { x: -3.6, z: 0 }, { x: 3.6, z: 0 }],
};
const seatOf = (count, idx) => (SEAT_LAYOUTS[Math.min(5, Math.max(1, count))] ?? [])[idx] ?? { x: 0, z: -2.65 };
// 座位前方毡面上的钱堆落点(同一公式喂 MoneyStack 摆放与 tableFelt 烘焙圆圈,保证严丝合缝)。
// 反馈⑩:所有下注圈落在同一条同心椭圆环上——θ 取座位相对桌心的规范化方位角(按桌框 3.5×2.2 归一),
// spot=(a·cosθ, b·sinθ)。a/b 满足:圈(r=0.42)到毡面缝线(x≈3.07/z≈1.86)、到中央双环(0.60)间距均 ≥0.18。
const SPOT_A = 2.05, SPOT_B = 1.24;
const spotOf = (seat) => {
  const th = Math.atan2(seat.z / 2.2, seat.x / 3.5);
  return { x: SPOT_A * Math.cos(th), z: SPOT_B * Math.sin(th) };
};
// 把「我的座位」旋到 +z 近侧的场景旋转角
const rotFor = (seat) => -Math.atan2(seat.x, seat.z);

// ---- 单人长桌（§9.6 交互 v2）：两阵营对坐,不复用多人环桌 ----
// 布局常量抽到 scene/singleLayout.js(与 voxlab 体素隔离验证区共享;fast-refresh 规则要求组件文件只导出组件)。
const singleSeatOf = (p) => (p.id === 'L' ? SINGLE_BOSS_SEAT : (SINGLE_TEAM_SEATS[p.seat] ?? SINGLE_TEAM_SEATS[0]));

// 大号靠背椅(每个入座玩家一张,反馈⑦):坐面沿用旧凳(y=0.46、0.52 见方,坐姿不用重调),
// 外侧两立柱升到 ~1.35 + 三根横板,靠背略后仰。立柱/横板都收在 |x|≤0.24、z≤-0.2,
// 与坐姿身体(背面 z=-0.15)和摆臂(|x|≥0.30)都留有间隙,不穿模。
export function Chair({ x, z, ry = 0 }) {
  const wood = tex('wood', { tone: P.wood500 });
  return (
    <group position={[x, 0, z]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0.46, 0]}>
        <boxGeometry args={[0.52, 0.08, 0.52]} />
        <meshStandardMaterial map={wood} roughness={1} flatShading />
      </mesh>
      {[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.21, lz]}>
          <boxGeometry args={[0.08, 0.42, 0.08]} />
          <meshStandardMaterial color={P.wood700} roughness={1} flatShading />
        </mesh>
      ))}
      {/* 靠背(略后仰 0.1rad;局部 -z 即背向桌面一侧;立柱顶 ~1.4,横板高过坐姿肩线才读得出) */}
      <group position={[0, 0.42, -0.235]} rotation={[-0.1, 0, 0]}>
        {[-0.22, 0.22].map((lx) => (
          <mesh key={lx} position={[lx, 0.49, 0]}>
            <boxGeometry args={[0.08, 0.98, 0.07]} />
            <meshStandardMaterial map={wood} roughness={1} flatShading />
          </mesh>
        ))}
        {[0.34, 0.62, 0.9].map((hy) => (
          <mesh key={hy} position={[0, hy, 0]}>
            <boxGeometry args={[0.5, 0.12, 0.05]} />
            <meshStandardMaterial map={wood} roughness={1} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// 第一人称落座相机(反馈⑥):相机=「我」坐在自己座位上的眼睛。
// 基准位 (0, EYE_Y, camZ)——绝对座位系统已把我的座位旋到 +z 近侧,camZ=座距+微退;
// 注视点降到桌心略上。保留鼠标环视阻尼与破产微震(视距变近,幅度较旧俯视机位略降)。
const EYE_Y = 1.98;   // 坐姿眼高(反馈⑬:再略抬高,俯视桌面更从容)
const LOOK_Y = 1.03;  // 注视点=桌心略上
const CAM_BACK = 0.82; // 相机比座位中心靠后(反馈⑬:再略退远,桌面与对家更完整)
function CameraRig({ look, shakeRef, camZ = 3.0 }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, LOOK_Y, 0));
  useFrame((st, delta) => {
    const mx = look.current.x, my = look.current.y;
    target.current.x += (mx * 1.15 - target.current.x) * 0.06;
    target.current.y += (LOOK_Y - my * 0.5 - target.current.y) * 0.06;
    // 破产瞬间:注视点 ±0.03 微震 300ms(衰减,确定性正弦抖动)
    if (shakeRef && shakeRef.current > 0) {
      shakeRef.current = Math.max(0, shakeRef.current - delta);
      const k = shakeRef.current / 0.3;
      target.current.x += Math.sin(st.clock.elapsedTime * 55) * 0.025 * k;
      target.current.y += Math.cos(st.clock.elapsedTime * 47) * 0.018 * k;
    }
    camera.position.x += (mx * 0.3 - camera.position.x) * 0.05;
    camera.position.y += (EYE_Y - my * 0.1 - camera.position.y) * 0.05;
    camera.position.z += (camZ - camera.position.z) * 0.05;
    camera.lookAt(target.current);
  });
  return null;
}

// 单人相机（§9.6 交互 v2）：两种模式，同一套阻尼收敛做自然过渡。
// - seat（附身席位）：沿用落座第一人称手感——绝对鼠标环视 + 注视桌心 + 破产微震；
//   相机每帧向「席位眼位」收敛，从走动位切过来就是一段柔和飞入。
// - walk（全局走动，MC 心智）：**指针锁定**——点击画布锁鼠标，移动鼠标直接转视角（中央准心），
//   ESC 释放后鼠标可点 UI；WASD 平移带**惯性**（加速/摩擦），行走时步伐颠簸 + 横移侧倾（Teardown 手感）。
//   准心点队友 = 附身。位置夹在己方半场（阵营线有隔离带可视化），桌+椅一个碰撞箱。
//   落座期间持续把行走位/朝向同步到当前相机 → 「起身」瞬间无跳变。
const WALK_EYE = 2.35, WALK_SPEED = 3.6;
const WALK_BOUND = { x: 10.6, zMin: 1.15, zMax: 10.6 };
const _walkDir = new THREE.Vector3();
// 场景碰撞体（与造景逐件对位,身位半径 ~0.3 已烘进尺寸;§9.6 三轮反馈①）。
// 矩形=沿最浅穿透轴推出,圆=径向推出;两轮迭代解决角落双碰撞体。走动区本身已限己方半场,
// Boss 侧/壁炉/后墙摆设无需碰撞。椅子逐把建体 → 椅子之间的缝隙可以侧身贴到桌沿。
const WALK_BOXES = [
  { x0: -4.8, x1: 4.8, z0: -4.0, z1: 2.6 },                        // 长桌桌体(框半宽 4.5/2.3 + 身位)
  ...SINGLE_TEAM_SEATS.map(s => ({ x0: s.x - 0.56, x1: s.x + 0.56, z0: 2.1, z1: 3.22 })), // 四把座椅
  { x0: -8.0, x1: -6.7, z0: 7.35, z1: 8.65 },                      // 前左角木箱
];
const WALK_CIRCLES = [
  { cx: 8.3, cz: 6.8, r: 1.05 },     // 前右角小圆桌(桌面 r0.75 + 身位)
  { cx: 7.25, cz: 5.85, r: 0.6 },    // 圆桌双椅
  { cx: 9.3, cz: 7.75, r: 0.6 },
  { cx: -8.6, cz: 7.2, r: 0.88 },    // 前左角酒桶
];
function clampWalk(p) {
  p.x = THREE.MathUtils.clamp(p.x, -WALK_BOUND.x, WALK_BOUND.x);
  p.z = THREE.MathUtils.clamp(p.z, WALK_BOUND.zMin, WALK_BOUND.zMax);
  for (let pass = 0; pass < 2; pass++) {
    for (const b of WALK_BOXES) {
      if (p.x <= b.x0 || p.x >= b.x1 || p.z <= b.z0 || p.z >= b.z1) continue;
      const dx = Math.min(p.x - b.x0, b.x1 - p.x);
      const dz = Math.min(p.z - b.z0, b.z1 - p.z);
      if (dx < dz) p.x = (p.x - b.x0 < b.x1 - p.x) ? b.x0 : b.x1;
      else p.z = (p.z - b.z0 < b.z1 - p.z) ? b.z0 : b.z1;
    }
    for (const c of WALK_CIRCLES) {
      const dx = p.x - c.cx, dz = p.z - c.cz;
      const d = Math.hypot(dx, dz);
      if (d >= c.r || d === 0) continue;
      p.x = c.cx + (dx / d) * c.r;
      p.z = c.cz + (dz / d) * c.r;
    }
  }
  p.x = THREE.MathUtils.clamp(p.x, -WALK_BOUND.x, WALK_BOUND.x);
  p.z = THREE.MathUtils.clamp(p.z, WALK_BOUND.zMin, WALK_BOUND.zMax);
}
// 射线 ∩ 轴对齐盒（slab 法）,命中返回距离、未中返回 Infinity。
// 角色命中用它替代旧锥角判定（用户五轮反馈:锥角以躯干中心点为准——身旁空隙误中、
// 头/帽/侧身等偏离中心的部位漏中;包围盒贴合坐姿模型轮廓,远近一致）。
// rayHitsBox 已抽到 scene/aim.js（多人处决准心 ExecutionRig 共用）。
// 坐姿角色包围盒:y 0.15-2.05(腿到帽顶)、xz 半宽 0.5(身体+摆臂)。取射线最近命中。
function aimBodyTarget(camera, players, { includeBoss = false } = {}) {
  const fwd = camera.getWorldDirection(_walkDir);
  let best = null;
  for (const p of players ?? []) {
    if (p.id === 'L' ? !includeBoss : p.bankrupt) continue;
    const seat = p.id === 'L' ? SINGLE_BOSS_SEAT : SINGLE_TEAM_SEATS[p.seat];
    if (!seat) continue;
    const t = rayHitsBox(camera.position, fwd, seat.x, seat.z, 0.15, 2.05, 0.5, 0.5);
    if (t < 15 && (!best || t < best.t)) best = { p, t };
  }
  return best?.p ?? null;
}
// 准心可交互目标（§9.6 交互 v3）：下注期优先毡面圈（视线∩桌面,圈半径内）,其次队友身体（附身）;
// 组队期指任意角色（含 Boss）=展示 3D 角色面板（瞄准即显,不点击、不退出指针锁）。
// v3.1 技能入口准心化：下注期瞄 Boss=监管（检察官在队且可用）、REFLIP 瞄桌上硬币=重掷决策、
// 协商期瞄队友圈=挪收益/债务——全部技能不再依赖面板/切席。
// 返回 'coin'（开掷）| 'circle:<seatId>'（±1/全押）| 'summon:<seatId>'（监管）| 'reflip'（重掷决策）
// | 'pile:<seatId>'（协商转移）| 'seat:<seatId>'（附身）| 'sheet:<playerId>'（面板）| null。
function aimTargetOf(camera, state) {
  const players = state?.players ?? [];
  const fwd = camera.getWorldDirection(_walkDir);
  if (state?.phase === 'SINGLE_SETUP') {
    const p = aimBodyTarget(camera, players, { includeBoss: true });
    return p ? `sheet:${p.id}` : null;
  }
  // 视线∩桌面交点（毡面圈类目标共用）
  let hit = null;
  if (fwd.y < -0.04) {
    const t = (TABLE_TOP - camera.position.y) / fwd.y;
    if (t > 0 && t < 16) hit = { x: camera.position.x + fwd.x * t, z: camera.position.z + fwd.z * t };
  }
  if (state?.phase === 'BETTING' && hit) {
    if (Math.hypot(hit.x, hit.z) < 0.62) return 'coin';
    for (const p of players) {
      if (p.id === 'L' || p.bankrupt) continue;
      const spot = singleSpotOf(SINGLE_TEAM_SEATS[p.seat] ?? SINGLE_TEAM_SEATS[0]);
      if (Math.hypot(hit.x - spot.x, hit.z - spot.z) < 0.55) return `circle:${p.id}`;
    }
  }
  // REFLIP:瞄停在桌上的硬币=重掷决策（左键重掷/右键认输）
  if (state?.phase === 'REFLIP' && hit) {
    const rest = getCoinRest();
    if (Math.hypot(hit.x - (rest?.x ?? 0), hit.z - (rest?.z ?? 0)) < 0.9) return 'reflip';
  }
  // 协商:瞄队友的圈=转移目标（左键送 1/右键取 1;ALT=债务;自己的圈不成目标）
  if (state?.phase === 'NEGOTIATE' && hit) {
    const meId = state?.single?.seatId;
    for (const p of players) {
      if (p.id === 'L' || p.bankrupt || p.id === meId) continue;
      if (!state.roundFarmerIds?.includes(p.id)) continue;
      const spot = singleSpotOf(SINGLE_TEAM_SEATS[p.seat] ?? SINGLE_TEAM_SEATS[0]);
      if (Math.hypot(hit.x - spot.x, hit.z - spot.z) < 0.55) return `pile:${p.id}`;
    }
  }
  // 身体类目标:下注期监管可用时 Boss 也可瞄（=监管）,队友=附身
  const su = state?.phase === 'BETTING' ? state?.single?.summon : null;
  const p = aimBodyTarget(camera, players, { includeBoss: !!su });
  if (!p) return null;
  if (p.id === 'L') return su ? `summon:${su.seatId}` : null;
  return `seat:${p.id}`;
}
function SingleRig({ mode, seat, shakeRef }) {
  const { camera, gl } = useThree();
  const pos = useRef(new THREE.Vector3(0, WALK_EYE, 6.8));
  const vel = useRef({ x: 0, z: 0 });   // 走动惯性速度（xz 平面）
  const smSpeed = useRef(0);            // 平滑速度（喂步伐颠簸,撞墙时步伐渐停不急停）
  const eyeY = useRef(WALK_EYE);        // 眼高缓动（起身 1.98→2.35 不跳）
  const yaw = useRef(0);          // 朝向:yaw=0 面向 -z(桌心);fwd=(-sinYaw,0,-cosYaw)
  const pitch = useRef(-0.16);
  const roll = useRef(0);         // 步伐/横移侧倾
  const bob = useRef(0);          // 步伐相位
  const keys = useRef({});
  const target = useRef(new THREE.Vector3(0, LOOK_Y, 0));

  // WASD（输入框聚焦让路；窗口失焦清空按键防"卡键漂移"）
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const down = (e) => { if (!typing()) keys.current[e.code] = true; };
    const up = (e) => { keys.current[e.code] = false; };
    const blur = () => { keys.current = {}; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // 模式经 ref 读活值（carry.js 铁律③:监听器只挂一次,effect 依赖 mode 会在切换瞬间打断进行中的手势）。
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const syncLockRef = useRef(() => {});   // 锁同步函数经 ref 暴露给模式/相位 effect（大 effect 只挂一次）
  const seatLook = useRef({ x: 0, y: 0 }); // 附身环视（锁定态没有绝对光标,用移动增量驱动,夹在 [-1,1]）
  // 指针锁管理（§9.6 交互 v3,全程锁定——用户裁决:进游戏就锁,期间只有两个出口）:
  // - 放开条件仅两个:**按住 CTRL**（松开自动回锁）、打开面板类 UI（设置/规则/角色墙/账本,gameStore.panel）;
  //   另加终局（ENDED,要点按钮）。协商/重掷等需要鼠标的操作=按住 CTRL 进行。ESC 不是出口——
  //   浏览器强制退锁无法拦截,但下一个输入手势（任意按键/点画布）**静默回锁**,无提示文案。
  // - 附身也保持锁定:落座环视由移动增量驱动（seatLook）,不再依赖绝对光标位置。
  // - 锁定中点按走准心路由:中央圈=开掷、下注圈=左+1/右−1/Shift全押/Alt保金、队友身体=附身
  useEffect(() => {
    if (IS_TOUCH) return undefined;
    const canvas = gl.domElement;
    const ctrl = { held: false };
    const requestLock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 忽略被浏览器拒绝 */ } };
    const isLocked = () => document.pointerLockElement === canvas;
    const shouldLock = () => {
      if (ctrl.held) return false;
      const st = useGameStore.getState();
      if (!st.state?.single) return false;
      if (st.state.phase === 'ENDED') return false;
      if (st.panel) return false;                       // 设置/规则/角色墙/账本开着 → 鼠标自由
      return true;
    };
    const sync = () => {
      if (shouldLock()) { if (!isLocked()) requestLock(); }
      else if (isLocked()) document.exitPointerLock();
    };
    syncLockRef.current = sync;
    // 首帧跳变防护:锁定建立后的第一个 mousemove 可能携带「锁前光标到画布中心」的整段位移
    // （Chrome 指针锁历史 bug,headless 下必现）——吞掉首帧,并对 >200px 的尖峰钳制。
    const spike = { skip: false };
    const onLockChange = () => {
      if (isLocked()) spike.skip = true;
      useGameStore.getState().setWalkLocked(isLocked());
    };
    const onMove = (e) => {
      if (!isLocked()) return;
      if (spike.skip) { spike.skip = false; return; }
      if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;
      if (modeRef.current === 'walk') {
        yaw.current -= e.movementX * 0.0026;
        pitch.current = THREE.MathUtils.clamp(pitch.current - e.movementY * 0.0022, -0.85, 0.6);
      } else {
        // 附身:增量驱动的环视偏移（对应旧绝对光标 [-1,1] 口径,落座相机原公式直接吃）
        seatLook.current.x = THREE.MathUtils.clamp(seatLook.current.x + e.movementX * 0.0016, -1, 1);
        seatLook.current.y = THREE.MathUtils.clamp(seatLook.current.y + e.movementY * 0.0016, -1, 1);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Control') { ctrl.held = true; if (isLocked()) document.exitPointerLock(); return; }
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (!isLocked()) sync();                          // ESC 退锁后的静默回锁:任意按键即回
    };
    const onKeyUp = (e) => { if (e.key === 'Control') { ctrl.held = false; sync(); } };
    const onDown = (e) => {
      if (modeRef.current !== 'walk') return;
      if (!isLocked()) { if (e.target === canvas) sync(); return; }   // 点画布=回锁（无提示）
      // 锁定中:准心路由
      const st = useGameStore.getState();
      const tgt = aimTargetOf(camera, st.state);
      if (!tgt) return;
      const [kind, id] = tgt.split(':');
      if (kind === 'sheet') return;                      // 组队期:面板瞄准即显（3D 空间,无点击语义）
      if (kind === 'reflip') {                           // 重掷决策:左键=重掷,右键=认输落账
        if (e.button === 0) st.send({ type: 'request_reflip' });
        else if (e.button === 2) st.send({ type: 'pass_reflip' });
        return;
      }
      if (kind === 'pile') {                             // 协商:左键送 1 给瞄准席位,右键取 1 回来;ALT=债务
        const meId = st.state?.single?.seatId;
        const alloc = st.state?.allocation;
        if (!meId || !alloc || (e.button !== 0 && e.button !== 2)) return;
        const debt = e.altKey;
        const fromId = e.button === 2 ? id : meId;
        const toId = e.button === 2 ? meId : id;
        const avail = (debt ? alloc.debts : alloc.takes)?.[fromId] ?? 0;
        if (avail >= 1) st.send({ type: 'negotiate_transfer', fromId, toId, kind: debt ? 'debt' : 'take', amount: 1 });
        return;
      }
      if (e.button === 2 && kind === 'circle') {
        st.send(e.altKey
          ? { type: 'single_pledge_adjust', seatId: id, delta: -1 }
          : { type: 'single_bet_adjust', seatId: id, delta: -1 });
      } else if (e.button === 0) {
        if (kind === 'coin') st.send({ type: 'single_flip' });
        else if (kind === 'summon') st.send({ type: 'summon', seatId: id });
        else if (kind === 'circle') {
          if (e.shiftKey) st.send({ type: 'single_bet_allin', seatId: id });
          else if (e.altKey) st.send({ type: 'single_pledge_adjust', seatId: id, delta: 1 });
          else st.send({ type: 'single_bet_adjust', seatId: id, delta: 1 });
        } else if (kind === 'seat') {
          if (id !== st.playerId) st.send({ type: 'single_seat', seatId: id });
          st.setSingleCam('seat');
        }
      }
    };
    const onCtx = (e) => { if (document.pointerLockElement) e.preventDefault(); };  // 锁定中右键=收注,不出菜单
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('contextmenu', onCtx);
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('contextmenu', onCtx);
      if (isLocked()) document.exitPointerLock();
      useGameStore.getState().setWalkLocked(false);
    };
  }, [gl, camera]);

  // 应锁状态随「模式/相位/面板」变化即时同步（附身/起身、进终局放开、关面板回锁…）。
  // 非手势上下文的回锁可能被浏览器拒绝——onKeyDown/onDown 的手势回锁兜底。
  useEffect(() => {
    if (mode === 'seat') { seatLook.current.x = 0; seatLook.current.y = 0; }  // 落座视线归中
    syncLockRef.current();
  }, [mode]);
  useEffect(() => {
    if (IS_TOUCH) return undefined;
    let prevPhase = null, prevPanel = null;
    const unsub = useGameStore.subscribe((s) => {
      const ph = s.state?.phase;
      if (ph !== prevPhase || s.panel !== prevPanel) {
        prevPhase = ph; prevPanel = s.panel;
        syncLockRef.current();
      }
    });
    return unsub;
  }, []);

  // 触屏兜底:拖动增量转视角（无指针锁可用;抓着牌/钱时让位——grab.active,碰撞铁律）。
  useEffect(() => {
    if (!IS_TOUCH) return undefined;
    const drag = { on: false, x: 0, y: 0 };
    const down = (e) => {
      if (modeRef.current !== 'walk') return;
      if (!(e.target instanceof Element) || !e.target.closest('.r3f-scene')) return;
      drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
    };
    const move = (e) => {
      if (!drag.on || modeRef.current !== 'walk') return;
      if (grab.active) { drag.x = e.clientX; drag.y = e.clientY; return; }
      yaw.current -= (e.clientX - drag.x) * 0.0042;
      pitch.current = THREE.MathUtils.clamp(pitch.current - (e.clientY - drag.y) * 0.0032, -0.7, 0.55);
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const up = () => { drag.on = false; };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  useFrame((st, delta) => {
    if (mode === 'seat' && seat) {
      const mx = seatLook.current.x, my = seatLook.current.y;
      target.current.x += (seat.x * 0.3 + mx * 1.15 - target.current.x) * 0.06;
      target.current.y += (LOOK_Y - my * 0.5 - target.current.y) * 0.06;
      target.current.z += (0 - target.current.z) * 0.06;
      if (shakeRef && shakeRef.current > 0) {
        shakeRef.current = Math.max(0, shakeRef.current - delta);
        const k = shakeRef.current / 0.3;
        target.current.x += Math.sin(st.clock.elapsedTime * 55) * 0.025 * k;
        target.current.y += Math.cos(st.clock.elapsedTime * 47) * 0.018 * k;
      }
      camera.position.x += (seat.x + mx * 0.3 - camera.position.x) * 0.05;
      camera.position.y += (EYE_Y - my * 0.1 - camera.position.y) * 0.05;
      camera.position.z += (seat.z + CAM_BACK - camera.position.z) * 0.05;
      camera.lookAt(target.current);
      // 起身无跳变:落座期间持续把行走状态钉在当前相机姿态上
      pos.current.set(camera.position.x, WALK_EYE, camera.position.z);
      clampWalk(pos.current);
      camera.getWorldDirection(_walkDir);
      yaw.current = Math.atan2(-_walkDir.x, -_walkDir.z);
      pitch.current = Math.asin(THREE.MathUtils.clamp(_walkDir.y, -1, 1));
      vel.current.x = 0; vel.current.z = 0;
      smSpeed.current = 0;
      roll.current = 0;
      eyeY.current = camera.position.y;
      return;
    }
    // 走动（Teardown 手感）:WASD 目标速度 + 指数趋近惯性(加速快/滑停慢) + 步伐颠簸 + 横移侧倾
    const dt = Math.min(delta, 0.05);         // 掉帧限步,惯性不炸
    const k = keys.current;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const sy = Math.sin(yaw.current), cy = Math.cos(yaw.current);
    let tx = 0, tz = 0;
    if (f || r) {
      const n = f && r ? Math.SQRT1_2 : 1;    // 斜向不加速
      tx = (-sy * f + cy * r) * n * WALK_SPEED;
      tz = (-cy * f - sy * r) * n * WALK_SPEED;
    }
    const kAcc = 1 - Math.exp(-(f || r ? 9 : 6.5) * dt);
    vel.current.x += (tx - vel.current.x) * kAcc;
    vel.current.z += (tz - vel.current.z) * kAcc;
    // 位移后碰撞解算（软响应,用户四轮反馈"撞墙太生硬"）:
    // ① 推出软化——不一帧弹出,按 ~20/s 的速率分几帧推出（残余穿深 ≤ 一帧位移,不可察觉）;
    // ② 速度只吸收**法向分量**,切向保留——斜着撞墙顺滑滑开,正面撞墙是"被墙接住"而非急刹;
    // ③ 步伐颠簸吃平滑速度（smSpeed）,撞墙时渐停,不再原地空转抽搐。
    const px = pos.current.x + vel.current.x * dt;
    const pz = pos.current.z + vel.current.z * dt;
    pos.current.x = px; pos.current.z = pz;
    clampWalk(pos.current);
    const cxn = pos.current.x - px, czn = pos.current.z - pz;   // 完整推出向量（=碰撞法向）
    const cl = Math.hypot(cxn, czn);
    if (cl > 1e-6) {
      const soft = Math.min(1, 20 * dt);
      pos.current.x = px + cxn * soft;
      pos.current.z = pz + czn * soft;
      const nnx = cxn / cl, nnz = czn / cl;
      const vn = vel.current.x * nnx + vel.current.z * nnz;
      if (vn < 0) { vel.current.x -= nnx * vn; vel.current.z -= nnz * vn; }
    }
    // 步伐:平滑速度驱动相位;竖向双频颠簸 + 沿相机右向的横摆（幅度温和,用户二轮反馈调低）
    const rawSpeed = Math.hypot(vel.current.x, vel.current.z);
    smSpeed.current += (rawSpeed - smSpeed.current) * Math.min(1, 9 * dt);
    const speed = smSpeed.current;
    const sf = Math.min(1, speed / WALK_SPEED);
    bob.current += speed * dt * 3.1;
    const bobY = Math.sin(bob.current * 2) * 0.017 * sf;
    const bobS = Math.sin(bob.current) * 0.012 * sf;
    // 侧倾:横移压肩 + 步伐微滚(平滑趋近,松键自动回正)
    const rollTarget = -r * 0.014 * sf + Math.sin(bob.current) * 0.006 * sf;
    roll.current += (rollTarget - roll.current) * Math.min(1, 10 * dt);
    eyeY.current += (WALK_EYE - eyeY.current) * Math.min(1, 6 * dt);
    camera.position.set(
      pos.current.x + cy * bobS,
      eyeY.current + bobY,
      pos.current.z - sy * bobS,
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, roll.current);
    // 情境准心:指向可交互目标（圈/硬币/队友/组队期角色面板）→ 十字张开（仅锁定中有准心;守卫写入）
    const gs = useGameStore.getState();
    if (gs.walkLocked) gs.setWalkAim(aimTargetOf(camera, gs.state));
    else if (gs.walkAim) gs.setWalkAim(null);
    // 本地调试探针（同 __payoutDir 先例）:E2E/截图工具读逐帧相机与准心状态
    if (DEV) window.__walkRig = { locked: gs.walkLocked, aim: gs.walkAim, yaw: yaw.current, pitch: pitch.current, pos: [pos.current.x, pos.current.z], coin: getCoinRest() };
  });
  return null;
}

// 压光控制器(§1.9 分镜):进 COIN_FLIP 吊灯 600ms 压到 0.55×——全场只剩硬币金闪;
// 离开 COIN_FLIP(落定)150ms 弹至 1.15× 再 250ms 归位。每帧只写 1 个 number。
const CHAND_I = 21;
function ChandelierLight() {
  const phase = useGameStore(s => s.state.phase);
  const lightAnim = useSettingsStore(s => s.lightAnim);
  const animOff = REDUCED || !lightAnim; // 画质设置「动态光效」关 → 走 REDUCED 同款静态路径(反馈①)
  const ref = useRef();
  const segs = useRef([]);                 // 待执行 tween 段队列 [{to, dur}]
  const cur = useRef({ from: CHAND_I, to: CHAND_I, t0: null, dur: 0 });
  const prev = useRef(phase);
  // 挂载时已处于掷币(断线重连/画廊直入):直接压光,不做过渡
  useEffect(() => {
    if (ref.current && prev.current === 'COIN_FLIP') ref.current.intensity = CHAND_I * 0.55;
  }, []);
  // 动态光效开关切换:清 tween 队列,强度直接钉到当前相位的终态
  useEffect(() => {
    if (animOff && ref.current) {
      segs.current = [];
      cur.current.t0 = null;
      ref.current.intensity = phase === 'COIN_FLIP' ? CHAND_I * 0.55 : CHAND_I;
    }
  }, [animOff, phase]);
  useEffect(() => {
    if (phase === prev.current) return;
    const was = prev.current;
    prev.current = phase;
    if (animOff) {
      if (ref.current) ref.current.intensity = phase === 'COIN_FLIP' ? CHAND_I * 0.55 : CHAND_I;
      return;
    }
    if (phase === 'COIN_FLIP') segs.current = [{ to: CHAND_I * 0.55, dur: 0.6 }];
    else if (was === 'COIN_FLIP') segs.current = [{ to: CHAND_I * 1.15, dur: 0.15 }, { to: CHAND_I, dur: 0.25 }];
  }, [phase, animOff]);
  useFrame((st) => {
    const L = ref.current;
    if (!L) return;
    const c = cur.current;
    if (c.t0 == null && segs.current.length) {
      const s = segs.current.shift();
      cur.current = { from: L.intensity, to: s.to, t0: st.clock.elapsedTime, dur: s.dur };
      return;
    }
    if (c.t0 != null) {
      const t = Math.min(1, (st.clock.elapsedTime - c.t0) / c.dur);
      L.intensity = c.from + (c.to - c.from) * easeInOut(t);
      if (t >= 1) c.t0 = null;
    }
  });
  // distance 13.5:衰减尾部擦到 ±12 的四面墙,墙面摆设有微弱轮廓光(decay=2,增量极小)
  return <pointLight ref={ref} position={[0, 3.3, 0]} intensity={CHAND_I} distance={13.5} decay={2} color={P.candle} />;
}

// （旧「金环扩散+金屑上抛」CoinBurst 已退役——升级为分镜结束后的乳白浪潮 CoinWave.jsx，§3.4）

// ---- 酒馆房间(ART_BIBLE §1.4):内翻盒 24×10×24,墙贴烘焙酒馆纹理(酒架/画框/鹿角剪影都在纹理里,零几何) ----
export function Room() {
  const wall = tex('wall', {}, 3, 1);
  const floor = tex('floor', {}, 6, 6);
  const ceil = tex('wood', { tone: P.wood700 }, 4, 4);
  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial map={floor} roughness={1} />
      </mesh>
      {/* 四墙(法线朝内) */}
      <mesh position={[0, 5, -12]}>
        <planeGeometry args={[24, 10]} />
        <meshStandardMaterial map={wall} roughness={1} />
      </mesh>
      <mesh position={[0, 5, 12]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[24, 10]} />
        <meshStandardMaterial map={wall} roughness={1} />
      </mesh>
      <mesh position={[-12, 5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[24, 10]} />
        <meshStandardMaterial map={wall} roughness={1} />
      </mesh>
      <mesh position={[12, 5, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[24, 10]} />
        <meshStandardMaterial map={wall} roughness={1} />
      </mesh>
      {/* 天花 + 房梁(梁投影,在桌面/地板上落出暗条纹的进深感) */}
      <mesh position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial map={ceil} roughness={1} />
      </mesh>
      {[-9, -3, 3, 9].map((z) => (
        <mesh key={z} position={[0, 6, z]} castShadow>
          <boxGeometry args={[24, 0.4, 0.4]} />
          <meshStandardMaterial color={P.beam} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// 壁炉(反馈⑦升级):石材拱形炉膛(stone 纹理,压暗低对比)+ 炉台木梁(摆杯/烛)+ 炉内交叉圆木
// + 双交叉火焰面片(3 帧预烘纹理做 map 引用轮换,400ms,永不重画;火焰与 FireLight 逻辑不动)
export function Fireplace() {
  const flameMat = useRef([]);
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  useFrame((st) => {
    const i = Math.floor(st.clock.elapsedTime * 2.5) % 3;
    for (const m of flameMat.current) {
      if (m && m.map !== frames[i]) { m.map = frames[i]; m.emissiveMap = frames[i]; }
    }
  });
  const stone = tex('stone');
  const mantel = tex('wood', { tone: P.wood500 });
  const log = tex('wood', { tone: P.wood700, plankW: 6 });
  const stoneMat = <meshStandardMaterial map={stone} roughness={1} flatShading />;
  return (
    <group position={[0, 0, -11.6]}>
      {/* 石拱:双柱 + 拱楣 + 拱角垫块(方块拱) */}
      <mesh position={[-1.05, 0.8, 0]}><boxGeometry args={[0.5, 1.6, 0.5]} />{stoneMat}</mesh>
      <mesh position={[1.05, 0.8, 0]}><boxGeometry args={[0.5, 1.6, 0.5]} />{stoneMat}</mesh>
      <mesh position={[0, 1.72, 0]}><boxGeometry args={[2.6, 0.36, 0.5]} />{stoneMat}</mesh>
      <mesh position={[-0.62, 1.45, 0]}><boxGeometry args={[0.36, 0.2, 0.46]} />{stoneMat}</mesh>
      <mesh position={[0.62, 1.45, 0]}><boxGeometry args={[0.36, 0.2, 0.46]} />{stoneMat}</mesh>
      {/* 炉底石台 */}
      <mesh position={[0, 0.05, 0.3]}><boxGeometry args={[2.9, 0.1, 1.1]} />{stoneMat}</mesh>
      {/* 炉膛(纯黑腔) */}
      <mesh position={[0, 0.8, -0.1]}><boxGeometry args={[1.6, 1.6, 0.24]} /><meshStandardMaterial color={P.wood900} roughness={1} /></mesh>
      {/* 炉台木梁 + 陶杯 + 蜡烛 */}
      <mesh position={[0, 1.98, 0.06]}><boxGeometry args={[3.1, 0.16, 0.56]} /><meshStandardMaterial map={mantel} roughness={1} flatShading /></mesh>
      <mesh position={[-0.9, 2.15, 0.06]}><cylinderGeometry args={[0.07, 0.08, 0.18, 6]} /><meshStandardMaterial color={P.wood300} roughness={1} flatShading /></mesh>
      <group position={[0.85, 2.06, 0.06]}>
        <mesh position={[0, 0.09, 0]}><cylinderGeometry args={[0.035, 0.045, 0.18, 6]} /><meshStandardMaterial color={P.parchment} roughness={1} flatShading /></mesh>
        <mesh position={[0, 0.26, 0]}>
          <planeGeometry args={[0.1, 0.16]} />
          <meshStandardMaterial
            map={frames[1]} emissiveMap={frames[1]} emissive={P.ink} emissiveIntensity={1.6}
            transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {/* 炉内交叉圆木 */}
      <mesh position={[0, 0.16, 0.08]} rotation={[0, 0.35, Math.PI / 2]}>
        <cylinderGeometry args={[0.09, 0.09, 1.0, 6]} /><meshStandardMaterial map={log} roughness={1} flatShading />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[0, -0.4, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.95, 6]} /><meshStandardMaterial map={log} roughness={1} flatShading />
      </mesh>
      {/* 火焰:两片交叉,emissive 走 Bloom(threshold 0.72) */}
      {[0, Math.PI / 2].map((ry, i) => (
        <mesh key={i} position={[0, 0.62, 0.08]} rotation={[0, ry, 0]}>
          <planeGeometry args={[0.9, 1.3]} />
          <meshStandardMaterial
            ref={(m) => { if (m) flameMat.current[i] = m; }}
            map={frames[0]} emissiveMap={frames[0]} emissive={'#ffffff'} emissiveIntensity={2}
            transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// 沿墙酒桶 ×3(圆柱侧面裹桶板纹理)
export function Barrels() {
  const t = tex('barrel');
  return [[-9, 0.75, -8], [-10, 0.75, -4], [9.5, 0.75, -7]].map((pos, i) => (
    <mesh key={i} position={pos} rotation={[0, i * 1.3, 0]}>
      <cylinderGeometry args={[0.55, 0.55, 1.5, 8]} />
      <meshStandardMaterial map={t} roughness={1} flatShading />
    </mesh>
  ));
}

// 新摆设(反馈⑦,满而不乱):绝对座位系统会为每个玩家旋转整间房,任何桌边座位面对的墙
// 都必须是满的——所以四面墙各自成组,不能只充实一面"后墙"。零新增动态光源,发光一律 emissive。
// 后墙(z-):壁炉(独立组件)+菜单板+月光窗+酒瓶搁板+烛台×2+木箱堆
// 前墙(z+):酒馆大门+门上硬币挂牌+衣帽钩+长凳+烛台×2
// 左墙(x-):第二扇月光窗+酒瓶搁板+烛台   右墙(x+):飞镖盘+陶杯搁板+烛台
// 地面角落:小圆桌配双椅(前右)、酒桶+木箱(前左)
export function Decor() {
  const wood7 = tex('wood', { tone: P.wood700 });
  const wood5 = tex('wood', { tone: P.wood500 });
  const crate = tex('wood', { tone: P.wood300, plankW: 5 });
  const door = tex('wood', { tone: P.wood700, plankW: 5 });
  const barrel = tex('barrel');
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  const woodMat = <meshStandardMaterial map={wood7} roughness={1} flatShading />;
  const flamePlanes = (fi, s = 1) => [0, Math.PI / 2].map((ry, k) => (
    <mesh key={k} position={[0, 0.24 * s, 0]} rotation={[0, ry, 0]}>
      <planeGeometry args={[0.1 * s, 0.16 * s]} />
      <meshStandardMaterial
        map={frames[fi]} emissiveMap={frames[fi]} emissive={P.ink} emissiveIntensity={1.7}
        transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
      />
    </mesh>
  ));
  // 墙面烛台(木托 + 蜡烛 + 交叉火苗片);ry 把 -z 朝向的木托转向所在墙
  const sconce = (key, pos, ry, fi) => (
    <group key={key} position={pos} rotation={[0, ry, 0]}>
      <mesh position={[0, -0.12, -0.08]}><boxGeometry args={[0.1, 0.34, 0.12]} />{woodMat}</mesh>
      <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.035, 0.045, 0.2, 6]} /><meshStandardMaterial color={P.parchment} roughness={1} flatShading /></mesh>
      {/* 火苗放大 1.25:烛台是暗墙上的主要可读光点,远看也要成"火把" */}
      <group position={[0, 0.12, 0]}>{flamePlanes(fi, 1.25)}</group>
    </group>
  );
  // 月光窗(冷色自发光玻璃 + 木框十字棂)
  const moonWindow = (key, pos, ry = 0) => (
    <group key={key} position={pos} rotation={[0, ry, 0]}>
      <mesh>
        <planeGeometry args={[1.3, 1.7]} />
        <meshStandardMaterial color={P.coolFill} emissive={P.coolFill} emissiveIntensity={0.85} roughness={1} />
      </mesh>
      <mesh position={[0, 0.88, 0.05]}><boxGeometry args={[1.54, 0.12, 0.12]} />{woodMat}</mesh>
      <mesh position={[0, -0.88, 0.05]}><boxGeometry args={[1.54, 0.12, 0.12]} />{woodMat}</mesh>
      <mesh position={[-0.71, 0, 0.05]}><boxGeometry args={[0.12, 1.64, 0.12]} />{woodMat}</mesh>
      <mesh position={[0.71, 0, 0.05]}><boxGeometry args={[0.12, 1.64, 0.12]} />{woodMat}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[0.08, 1.64, 0.08]} />{woodMat}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[1.54, 0.08, 0.08]} />{woodMat}</mesh>
    </group>
  );
  // 双层搁板 + 三瓶两杯(items='bottles')或一排陶杯(items='mugs')
  const shelf = (key, pos, ry = 0, items = 'bottles') => (
    <group key={key} position={pos} rotation={[0, ry, 0]}>
      {[0, 0.72].map((y) => (
        <mesh key={y} position={[0, y, 0]}><boxGeometry args={[2.0, 0.08, 0.34]} />{woodMat}</mesh>
      ))}
      {items === 'bottles' && [[-0.7, P.glassGreen], [-0.15, P.glassBrown], [0.45, P.glassGreen]].map(([bx, color], i) => (
        <group key={i} position={[bx, 0.76, 0]}>
          <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.07, 0.08, 0.3, 6]} /><meshStandardMaterial color={color} roughness={0.7} flatShading /></mesh>
          <mesh position={[0, 0.36, 0]}><cylinderGeometry args={[0.025, 0.03, 0.12, 6]} /><meshStandardMaterial color={color} roughness={0.7} flatShading /></mesh>
        </group>
      ))}
      {(items === 'bottles' ? [-0.5, 0.3] : [-0.7, -0.25, 0.2, 0.65]).map((bx) => (
        <mesh key={bx} position={[bx, items === 'bottles' ? 0.12 : 0.13, 0]}><cylinderGeometry args={[0.08, 0.09, 0.16, 6]} /><meshStandardMaterial color={P.wood300} roughness={1} flatShading /></mesh>
      ))}
      {items === 'mugs' && [-0.45, 0.45].map((bx) => (
        <mesh key={bx} position={[bx, 0.85, 0]}><cylinderGeometry args={[0.08, 0.09, 0.16, 6]} /><meshStandardMaterial color={P.wood300} roughness={1} flatShading /></mesh>
      ))}
    </group>
  );
  return (
    <group>
      {/* ================= 后墙(z-,壁炉墙) ================= */}
      {moonWindow('w-back', [-7.5, 3.7, -11.88])}
      {shelf('s-back', [-9.6, 2.85, -11.76])}
      {/* 粉笔菜单板(远墙背光,粉笔字给一点自发光才读得出;无光源,纯 emissiveMap) */}
      <group position={[5.6, 3.0, -11.86]}>
        <mesh>
          <boxGeometry args={[1.5, 1.1, 0.06]} />
          <meshStandardMaterial map={tex('menu')} emissiveMap={tex('menu')} emissive={P.ink} emissiveIntensity={0.22} roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 0.61, 0]}><boxGeometry args={[1.7, 0.12, 0.1]} />{woodMat}</mesh>
        <mesh position={[0, -0.61, 0]}><boxGeometry args={[1.7, 0.12, 0.1]} />{woodMat}</mesh>
        <mesh position={[-0.79, 0, 0]}><boxGeometry args={[0.12, 1.1, 0.1]} />{woodMat}</mesh>
        <mesh position={[0.79, 0, 0]}><boxGeometry args={[0.12, 1.1, 0.1]} />{woodMat}</mesh>
      </group>
      {sconce('sc-b1', [-3.1, 2.55, -11.72], 0, 0)}
      {sconce('sc-b2', [3.1, 2.55, -11.72], 0, 1)}
      {/* 木箱堆(后左角) */}
      <group position={[-8.4, 0, -10.3]}>
        <mesh position={[0, 0.45, 0]} rotation={[0, 0.12, 0]}><boxGeometry args={[0.9, 0.9, 0.9]} /><meshStandardMaterial map={crate} roughness={1} flatShading /></mesh>
        <mesh position={[-1.0, 0.4, 0.25]} rotation={[0, -0.3, 0]}><boxGeometry args={[0.8, 0.8, 0.8]} /><meshStandardMaterial map={crate} roughness={1} flatShading /></mesh>
        <mesh position={[-0.15, 1.28, 0.1]} rotation={[0, 0.5, 0]}><boxGeometry args={[0.75, 0.75, 0.75]} /><meshStandardMaterial map={crate} roughness={1} flatShading /></mesh>
      </group>

      {/* ================= 前墙(z+,大门墙) ================= */}
      {/* 酒馆大门:门框 + 竖板门扇 + 铁铰链 + 铜把手 */}
      <group position={[2.5, 0, 11.85]}>
        <mesh position={[-0.78, 1.55, 0]}><boxGeometry args={[0.18, 3.1, 0.24]} />{woodMat}</mesh>
        <mesh position={[0.78, 1.55, 0]}><boxGeometry args={[0.18, 3.1, 0.24]} />{woodMat}</mesh>
        <mesh position={[0, 3.14, 0]}><boxGeometry args={[1.78, 0.22, 0.24]} />{woodMat}</mesh>
        <mesh position={[0, 1.5, 0.02]}><boxGeometry args={[1.4, 2.96, 0.1]} /><meshStandardMaterial map={door} roughness={1} flatShading /></mesh>
        {[0.7, 2.3].map((hy) => (
          <mesh key={hy} position={[-0.5, hy, -0.06]}><boxGeometry args={[0.34, 0.1, 0.05]} /><meshStandardMaterial color={P.wood900} roughness={1} flatShading /></mesh>
        ))}
        <mesh position={[0.5, 1.45, -0.08]}><boxGeometry args={[0.09, 0.2, 0.06]} /><meshStandardMaterial color={P.brass} roughness={0.8} flatShading /></mesh>
      </group>
      {/* 门上硬币挂牌(复用正面王冠币纹理=店招),两条短链吊在门楣上 */}
      <group position={[2.5, 3.62, 11.8]}>
        {[-0.16, 0.16].map((cx) => (
          <mesh key={cx} position={[cx, 0.32, 0]}><boxGeometry args={[0.04, 0.42, 0.04]} /><meshStandardMaterial color={P.wood900} roughness={1} flatShading /></mesh>
        ))}
        <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.46, 0.46, 0.05, 12]} />
          <meshStandardMaterial map={wood5} roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 0, -0.02]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[0.4, 16]} />
          <meshStandardMaterial map={coinFaceTexture('heads')} emissiveMap={coinFaceTexture('heads')} emissive={P.candle} emissiveIntensity={0.18} roughness={1} />
        </mesh>
      </group>
      {/* 衣帽钩排 + 长凳(门左侧) */}
      <group position={[-2.0, 0, 11.82]}>
        <mesh position={[0, 2.1, -0.04]}><boxGeometry args={[1.7, 0.1, 0.08]} />{woodMat}</mesh>
        {[-0.6, 0, 0.6].map((px) => (
          <mesh key={px} position={[px, 2.02, -0.12]} rotation={[0.5, 0, 0]}><boxGeometry args={[0.07, 0.07, 0.22]} /><meshStandardMaterial color={P.wood900} roughness={1} flatShading /></mesh>
        ))}
        <mesh position={[0, 0.48, -0.35]}><boxGeometry args={[1.7, 0.1, 0.45]} /><meshStandardMaterial map={wood5} roughness={1} flatShading /></mesh>
        {[[-0.7, -0.5], [0.7, -0.5], [-0.7, -0.2], [0.7, -0.2]].map(([lx, lz], i) => (
          <mesh key={i} position={[lx, 0.22, lz]}><boxGeometry args={[0.09, 0.44, 0.09]} />{woodMat}</mesh>
        ))}
      </group>
      {sconce('sc-f1', [-5.4, 2.55, 11.72], Math.PI, 1)}
      {sconce('sc-f2', [6.4, 2.55, 11.72], Math.PI, 0)}

      {/* ================= 左墙(x-) ================= */}
      {moonWindow('w-left', [-11.88, 3.7, 2.5], Math.PI / 2)}
      {shelf('s-left', [-11.76, 2.85, -3.0], Math.PI / 2)}
      {sconce('sc-l1', [-11.72, 2.55, 7.5], Math.PI / 2, 1)}

      {/* ================= 右墙(x+) ================= */}
      {/* 飞镖盘:木底盘 + 同心环像素盘面 */}
      <group position={[11.86, 2.7, 1.5]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.56, 0.56, 0.07, 12]} />
          <meshStandardMaterial map={wood5} roughness={1} flatShading />
        </mesh>
        <mesh position={[-0.05, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <circleGeometry args={[0.48, 16]} />
          <meshStandardMaterial map={tex('dart')} roughness={1} />
        </mesh>
      </group>
      {shelf('s-right', [11.76, 2.85, -4.0], -Math.PI / 2, 'mugs')}
      {sconce('sc-r1', [11.72, 2.55, 6.5], -Math.PI / 2, 0)}

      {/* ================= 地面角落 ================= */}
      {/* 小圆桌配双椅(前右角):空酒馆桌,纯氛围 */}
      <group position={[8.3, 0, 6.8]}>
        <mesh position={[0, 0.86, 0]}><cylinderGeometry args={[0.75, 0.75, 0.08, 10]} /><meshStandardMaterial map={wood5} roughness={1} flatShading /></mesh>
        <mesh position={[0, 0.42, 0]}><cylinderGeometry args={[0.11, 0.13, 0.8, 6]} />{woodMat}</mesh>
        <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[0.32, 0.34, 0.07, 8]} />{woodMat}</mesh>
        {[[-0.25, 0.1], [0.2, -0.18]].map(([mx, mz], i) => (
          <mesh key={i} position={[mx, 0.98, mz]}><cylinderGeometry args={[0.08, 0.09, 0.16, 6]} /><meshStandardMaterial color={P.wood300} roughness={1} flatShading /></mesh>
        ))}
      </group>
      <Chair x={7.25} z={5.85} ry={0.85} />
      <Chair x={9.3} z={7.75} ry={-2.4} />
      {/* 酒桶 + 小木箱(前左角) */}
      <mesh position={[-8.6, 0.75, 7.2]} rotation={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 1.5, 8]} />
        <meshStandardMaterial map={barrel} roughness={1} flatShading />
      </mesh>
      <mesh position={[-7.35, 0.35, 8.0]} rotation={[0, -0.25, 0]}><boxGeometry args={[0.7, 0.7, 0.7]} /><meshStandardMaterial map={crate} roughness={1} flatShading /></mesh>
    </group>
  );
}

// 桌上方木轮吊灯(反馈⑦升级 + 形体修正):8 段盒子拼成的木轮圈;蜡烛经黄铜托盘实站在轮面上;
// 3 条直拉绳从轮缘铜扣收拢到高处黄铜领结,一根吊绳挂上两根房梁之间的横杆——每个连接点实接。
// (旧版小盒链节间距大于链节本身、且不接轮圈不接吊绳,俯瞰/仰视都是一串悬空黑块;蜡烛也悬在轮孔里。)
// 全部不投影(castShadow=false,上轮反馈);真灯在 ChandelierLight。
const CHAND_R = 1.05;
// 轮圈是八角形(8 段直盒拼弦)不是圆:角度 a 处轮面中线到中心的距离按弦修正,
// 蜡烛/拉绳按它落位才真正踩在木头上(按圆算会浮空或悬到孔里)。
function chandChordR(a) {
  const seg = Math.PI / 4;
  const m = (((a - Math.PI / 8) % seg) + seg) % seg;
  return CHAND_R / Math.cos(m > seg / 2 ? m - seg : m);
}
export function Chandelier() {
  const wood = tex('wood', { tone: P.wood700 });
  const brass = tex('brass');
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  const rim = Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * Math.PI * 2);
  const candles = Array.from({ length: 5 }, (_, i) => (i / 5) * Math.PI * 2 + 0.3);
  const ropes = [0, 1, 2].map(i => (i / 3) * Math.PI * 2 + 0.9);
  // 领结 y+1.85(世界 4.65):掷币弧顶约 world-y 4.3(coinSim),中央通道的粗件必须让到弧顶之上;
  // 细拉绳(0.04)与旧吊绳同级,弧顶偶尔擦过可接受。
  const KNOT_Y = 1.85;
  const brassMat = <meshStandardMaterial map={brass} roughness={0.55} metalness={0.35} flatShading />;
  // 形体 y=2.8:第一人称落座相机(反馈⑥)抬头时远侧轮圈/烛光入画;点光仍在 3.3(ChandelierLight 不动)。
  // 轮心不放毂/辐条:掷币抛物线从轮圈中孔穿过,粗件会被硬币穿模。
  return (
    <group position={[0, 2.8, 0]}>
      {/* 木轮圈:八角 8 段盒子 */}
      {rim.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * CHAND_R, 0, Math.sin(a) * CHAND_R]} rotation={[0, -(a + Math.PI / 2), 0]}>
          <boxGeometry args={[0.88, 0.1, 0.14]} />
          <meshStandardMaterial map={wood} roughness={1} flatShading />
        </mesh>
      ))}
      {/* 轮圈下缘一圈铜箍毂环(压铸感点缀,不占轮心) */}
      <mesh position={[0, -0.07, 0]}>
        <cylinderGeometry args={[CHAND_R * 0.99, CHAND_R * 0.99, 0.04, 8, 1, true]} />
        <meshStandardMaterial map={brass} roughness={0.55} metalness={0.35} flatShading side={THREE.DoubleSide} />
      </mesh>
      {/* 3 条拉绳:轮缘铜扣 → 领结,直杆首尾实接 */}
      {ropes.map((a, i) => {
        const r = chandChordR(a);
        const len = Math.hypot(r, KNOT_Y - 0.05);
        return (
          <group key={i}>
            <mesh position={[Math.cos(a) * r, 0.075, Math.sin(a) * r]} rotation={[0, -a, 0]}>
              <boxGeometry args={[0.1, 0.05, 0.1]} />
              {brassMat}
            </mesh>
            <mesh
              position={[(Math.cos(a) * r) / 2, (KNOT_Y + 0.05) / 2, (Math.sin(a) * r) / 2]}
              rotation={[0, -a, Math.atan2(r, KNOT_Y - 0.05)]}
            >
              <boxGeometry args={[0.04, len, 0.04]} />
              <meshStandardMaterial color={P.wood900} roughness={0.9} flatShading />
            </mesh>
          </group>
        );
      })}
      {/* 领结 + 吊绳 + 两梁间横杆(世界 y=6,搭在 z=±3 房梁上):吊点落到实处 */}
      <mesh position={[0, KNOT_Y, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.14, 6]} />
        {brassMat}
      </mesh>
      <mesh position={[0, (KNOT_Y + 3.2) / 2, 0]}>
        <boxGeometry args={[0.05, 3.2 - KNOT_Y, 0.05]} />
        <meshStandardMaterial color={P.wood900} roughness={1} />
      </mesh>
      {/* 横杆不投影:别给桌毡再添一条竖向暗纹(房梁横纹是既定演出,见 Room) */}
      <mesh position={[0, 3.2, 0]}>
        <boxGeometry args={[0.18, 0.18, 6.2]} />
        <meshStandardMaterial color={P.beam} roughness={1} flatShading />
      </mesh>
      {/* 5 支蜡烛:黄铜托盘 + 蜡柱,实站在轮面上;交叉火苗片(静帧,帧位错开;整灯闪烁交给 ChandelierLight) */}
      {candles.map((a, i) => {
        const r = chandChordR(a);
        return (
          <group key={i} position={[Math.cos(a) * r, 0.05, Math.sin(a) * r]}>
            <mesh position={[0, 0.015, 0]}>
              <cylinderGeometry args={[0.075, 0.09, 0.03, 6]} />
              {brassMat}
            </mesh>
            <mesh position={[0, 0.13, 0]}>
              <cylinderGeometry args={[0.035, 0.045, 0.2, 6]} />
              <meshStandardMaterial color={P.parchment} roughness={1} flatShading />
            </mesh>
            {[0, Math.PI / 2].map((ry, k) => (
              <mesh key={k} position={[0, 0.32, 0]} rotation={[0, ry + a, 0]}>
                <planeGeometry args={[0.11, 0.17]} />
                <meshStandardMaterial
                  map={frames[i % 3]} emissiveMap={frames[i % 3]} emissive={P.ink} emissiveIntensity={1.8}
                  transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
                />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// 组队期 3D 角色面板（§9.6 交互 v3,用户五轮反馈）:准心指到谁,谁身旁浮出标准角色手册
// （RoleDetailBody,与招募令同格式）——写在 3D 空间、瞄准即显、移开即收,不点击、不退出指针锁。
function SetupSheet3D({ players }) {
  const walkAim = useGameStore(s => s.walkAim);
  if (!walkAim?.startsWith('sheet:')) return null;
  const pid = walkAim.slice(6);
  const p = players.find(x => x.id === pid);
  if (!p) return null;
  const seat = p.id === 'L' ? SINGLE_BOSS_SEAT : SINGLE_TEAM_SEATS[p.seat];
  if (!seat) return null;
  // 挂在角色身侧偏桌心一点,免得挡住模型本体;Boss 在对面,面板朝向由 Html 屏幕空间保证
  const toward = seat.z > 0 ? -0.5 : 0.5;
  return (
    <Html position={[seat.x, 1.9, seat.z + toward]} center distanceFactor={7} zIndexRange={[29, 0]}>
      <div className="role-detail sheet3d">
        <RoleDetailBody role={p.role} advanced single />
      </div>
    </Html>
  );
}

// 单人下注浮字层（§9.6 交互 v3）:每个队伍圈上方挂暂存注额（+投资人保金）,中央挂「开掷」。
// 锁定态由准心点击接管;未锁定/附身时中央浮字本身可点（同一条 single_flip 消息）。
function SingleBetPrompts({ players, spots }) {
  const send = useGameStore(s => s.send);
  return (
    <>
      {players.map((p, i) => {
        if (p.id === 'L' || p.bankrupt) return null;
        const s = spots[i];
        if (!s) return null;
        return (
          <Html key={`sb-${p.id}`} position={[s.x, TABLE_TOP + 0.42, s.z]} center distanceFactor={6} zIndexRange={[28, 0]}>
            <div className="felt-float">
              <PixelText size={2} color="var(--px-gold)">{`¥${p.bet ?? 0}`}</PixelText>
              {(p.pledge ?? 0) > 0 && (
                <div><PixelText size={2} color="var(--ok)">{T.single.pledgeTag(p.pledge)}</PixelText></div>
              )}
            </div>
          </Html>
        );
      })}
      <Html position={[0, TABLE_TOP + 0.5, 0]} center distanceFactor={6} zIndexRange={[28, 0]}>
        <div className="felt-float">
          <div className="clickable prompt-line" onClick={() => send({ type: 'single_flip' })}>
            <PixelText size={2} color="var(--px-gold)">{T.single.flip}</PixelText>
          </div>
        </div>
      </Html>
    </>
  );
}

// 单人重掷决策浮字（§9.6 v3.1 技能准心化）:REFLIP 期挂在停定的硬币上方——
// 准心瞄硬币 左键=重掷/右键=认输;浮字本身也可点（按住 CTRL 的鼠标用户同一条消息）。
function SingleReflipPrompts({ players }) {
  const send = useGameStore(s => s.send);
  const left = players.find(p => p.role === 'glutton' && !p.bankrupt && (p.reflipsLeft ?? 0) > 0)?.reflipsLeft ?? 0;
  const rest = getCoinRest();
  return (
    <Html position={[rest?.x ?? 0, TABLE_TOP + 0.55, rest?.z ?? 0]} center distanceFactor={6} zIndexRange={[28, 0]}>
      <div className="felt-float">
        <div className="clickable prompt-line" onClick={() => send({ type: 'request_reflip' })}>
          <PixelText size={2} color="var(--px-gold)">{T.single.reflipAim(left)}</PixelText>
        </div>
        <div className="clickable prompt-line" onClick={() => send({ type: 'pass_reflip' })}>
          <PixelText size={2} color="#fff">{T.single.reflipPass}</PixelText>
        </div>
      </div>
    </Html>
  );
}

// 单人监管提示浮字:下注期准心指向 Boss 且监管可用时,Boss 头顶浮出「监管 ¥费 [左键]」——
// 瞄准即显、移开即收（与组队期 3D 手册同一心智,不退指针锁）。
function SingleSummonPrompt() {
  const walkAim = useGameStore(s => s.walkAim);
  const su = useGameStore(s => s.state.single?.summon);
  if (!su || !walkAim?.startsWith('summon:')) return null;
  return (
    <Html position={[SINGLE_BOSS_SEAT.x, 2.45, SINGLE_BOSS_SEAT.z]} center distanceFactor={6.5} zIndexRange={[28, 0]}>
      <div className="felt-float">
        <PixelText size={2} color="var(--px-gold)">{T.single.summonAim(su.cost)}</PixelText>
      </div>
    </Html>
  );
}

// 桌下圆毯
export function Rug() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
      <circleGeometry args={[5, 24]} />
      <meshStandardMaterial map={tex('rug')} roughness={1} />
    </mesh>
  );
}

// 赌桌(ART_BIBLE §1.4):毡面烘金描线下注区(与钱堆落点同源对位)+ 橡木框 + 黄铜嵌线 + 横撑
// size 缺省=多人 6 座桌(毡面盒 6.0×4.0、纹理映射保持历史 6.6 口径不动观感);
// 单人长桌传 SINGLE_TABLE(8.6×4.0),此时纹理映射=盒尺寸,圈与钱堆严格对位。
export function Table({ spots = [], size = null }) {
  const w = size?.w ?? 6.0, d = size?.d ?? 4.0;
  const feltTex = useMemo(
    () => tex('tableFelt', size ? { spots, dims: { w, d } } : { spots }),
    [spots, size, w, d],
  );
  const frameWood = tex('wood', { tone: P.wood500 });
  const legWood = tex('wood', { tone: P.wood700 });
  const brass = tex('brass');
  return (
    <group>
      {/* 桌面毡布:下注区/硬币圈直接烘死在纹理里,零文字锚定。X 收窄一点(用户反馈):6.6→6.0 */}
      <mesh position={[0, TABLE_TOP - 0.06, 0]} receiveShadow>
        <boxGeometry args={[w, 0.12, d]} />
        <meshStandardMaterial map={feltTex} roughness={0.95} flatShading />
      </mesh>
      {/* 木框 */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[w + 0.4, 0.34, d + 0.4]} />
        <meshStandardMaterial map={frameWood} roughness={1} flatShading />
      </mesh>
      {/* 内缘黄铜嵌线(微 emissive,Bloom 下泛柔光) */}
      {[
        { pos: [0, 0.952, -(d / 2 + 0.06)], args: [w + 0.12, 0.03, 0.06] },
        { pos: [0, 0.952, d / 2 + 0.06], args: [w + 0.12, 0.03, 0.06] },
        { pos: [-(w / 2 + 0.06), 0.952, 0], args: [0.06, 0.03, d + 0.06] },
        { pos: [w / 2 + 0.06, 0.952, 0], args: [0.06, 0.03, d + 0.06] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.args} />
          <meshStandardMaterial map={brass} emissive={P.brass} emissiveIntensity={0.15} roughness={0.5} metalness={0.4} flatShading />
        </mesh>
      ))}
      {/* 桌腿 + 横撑 */}
      {[[-(w / 2 - 0.1), -(d / 2 - 0.1)], [w / 2 - 0.1, -(d / 2 - 0.1)], [-(w / 2 - 0.1), d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]}>
          <boxGeometry args={[0.32, 0.8, 0.32]} />
          <meshStandardMaterial map={legWood} roughness={1} flatShading />
        </mesh>
      ))}
      {[-(d / 2 - 0.1), d / 2 - 0.1].map((z) => (
        <mesh key={z} position={[0, 0.22, z]}>
          <boxGeometry args={[w - 0.2, 0.1, 0.14]} />
          <meshStandardMaterial map={legWood} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// 阵营隔离带(单人,§9.6 交互 v2):桌子两端各一排麻绳立柱,把 Boss 半场拦起来——
// 走动相机的 z≥ 阵营线夹紧有了可见的物理理由。纯摆设,零光源零交互。
function FactionBarriers() {
  const brass = tex('brass');
  const rope = tex('wood', { tone: P.wood300, plankW: 4 });
  const posts = [5.2, 7.0, 8.8, 10.6];
  return [1, -1].map((sx) => (
    <group key={sx} position={[0, 0, 0.62]}>
      {posts.map((x) => (
        <group key={x} position={[x * sx, 0, 0]}>
          <mesh position={[0, 0.52, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 1.04, 6]} />
            <meshStandardMaterial color={P.wood900} roughness={1} flatShading />
          </mesh>
          <mesh position={[0, 1.08, 0]}>
            <sphereGeometry args={[0.09, 6, 5]} />
            <meshStandardMaterial map={brass} roughness={0.55} metalness={0.35} flatShading />
          </mesh>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.16, 0.19, 0.1, 8]} />
            <meshStandardMaterial color={P.wood900} roughness={1} flatShading />
          </mesh>
        </group>
      ))}
      {posts.slice(0, -1).map((x, i) => (
        <mesh key={`r${x}`} position={[((x + posts[i + 1]) / 2) * sx, 0.94, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.035, 0.035, posts[i + 1] - x - 0.14, 5]} />
          <meshStandardMaterial map={rope} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  ));
}

// 钱牌材质/堆叠槽位/静态钱堆已抽到 scene/cards.jsx（与 PayoutLayer 共用，保证飞行/静堆/彩池同源）。

// 炉火点光:双正弦叠加闪烁(每帧只写 1 个 number,零分配)。
// 画质设置「动态光效」关 / prefers-reduced-motion → 静态强度(反馈①)。
export function FireLight() {
  const lightAnim = useSettingsStore(s => s.lightAnim);
  const ref = useRef();
  useFrame((st) => {
    if (!ref.current) return;
    if (REDUCED || !lightAnim) { ref.current.intensity = 7; return; }
    const t = st.clock.elapsedTime;
    ref.current.intensity = 7 + Math.sin(t * 2.3) * 1.2 + Math.sin(t * 5.1) * 0.6;
  });
  return <pointLight ref={ref} position={[0, 1.7, -10.5]} intensity={7} distance={9} decay={2} color={P.fire} />;
}

function Projector() {
  const { camera, size } = useThree();
  useEffect(() => {
    setProjector((x, y, z) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height };
    });
    return () => setProjector(null);
  }, [camera, size]);
  return null;
}

// r3f 拾取坐标改走画布视觉 rect（scene/screen.js#pointerNDC）：默认 compute 用 offsetX/size.width，
// 在 app-stage 缩放 + offsetSize 组合下两者空间不一致会拖偏射线；clientX 与 rect 恒同处视觉空间，
// 任何舞台缩放/黑边/网页缩放下都正确（触屏无舞台同样成立）。
function StagePointerCompute() {
  const setEvents = useThree(s => s.setEvents);
  useEffect(() => {
    setEvents({
      compute(event, state) {
        pointerNDC(state.gl.domElement, event, state.pointer);
        state.raycaster.setFromCamera(state.pointer, state.camera);
      },
    });
  }, [setEvents]);
  return null;
}

// 一张飞行中的牌：从手牌屏幕位置（反投影到世界）沿二次贝塞尔弧线落到桌面槽位，
// 同时从「正面朝向相机」翻转为「反面朝上平躺」。
function FlyingNote({ item, startRef, delay, duration, onDone }) {
  const ref = useRef();
  const done = useRef(false);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    if (startRef.current == null) startRef.current = st.clock.elapsedTime;
    const t = Math.min(1, Math.max(0, (st.clock.elapsedTime - startRef.current - delay) / duration));
    const e = easeInOut(t);
    const a = 1 - e;
    m.position.set(
      a * a * item.s.x + 2 * a * e * item.c.x + e * e * item.end.x,
      a * a * item.s.y + 2 * a * e * item.c.y + e * e * item.end.y,
      a * a * item.s.z + 2 * a * e * item.c.z + e * e * item.end.z,
    );
    // 正面朝相机(≈1.15) → 反面朝上(π)；附带轻微自旋与摆动。
    // yaw 必须在落定(e=1)时正好等于 cardYaw(i)，否则接力给静态钱堆的瞬间会突跳(~34°看着像左右翻转)。
    // 额外自旋用 sin(eπ) 做成中途隆起、两端归零的驼峰：保留飞行中的旋转手感，落点严丝合缝。
    m.rotation.set(1.15 + (Math.PI - 1.15) * e, item.yaw * e + Math.sin(e * Math.PI) * 0.6, Math.sin(t * Math.PI * 2) * (1 - t) * 0.3);
    // 起飞尺寸渐入:第一人称相机(反馈⑥)下起点离镜头 ~1 单位,全尺寸卡会糊满半屏——
    // 前 35% 从 0.5 长到 1(读作透视拉近);落定 punch:末段 1→1.15→1 一鼓(两端归 1,与静态堆无缝接力)
    const grow = 0.5 + 0.5 * Math.min(1, e / 0.35);
    const punch = t > 0.85 ? 1 + 0.15 * Math.sin(((t - 0.85) / 0.15) * Math.PI) : 1;
    m.scale.setScalar(grow * punch);
    if (t >= 1 && !done.current) { done.current = true; onDone(); }
  });
  return (
    <mesh ref={ref} material={cardMaterials(item.value)} castShadow>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

const UP = new THREE.Vector3(0, 1, 0);
function FlyingNotes({ betFlight, target, rot = 0 }) {
  const { camera, size } = useThree();
  const finalize = useGameStore(s => s.finalizeBetFlight);
  const startRef = useRef(null);
  const doneCount = useRef(0);

  useEffect(() => { startRef.current = null; doneCount.current = 0; }, [betFlight]);

  const items = useMemo(() => betFlight.items.map((it, i) => {
    const ndcX = (it.fromScreen.x / size.width) * 2 - 1;
    const ndcY = -(it.fromScreen.y / size.height) * 2 + 1;
    // 手牌屏幕点→世界→座位旋转组的局部坐标(本组件渲染在旋转组内)。
    // NDC z 0.86→0.80:第一人称落座相机(反馈⑥)视点变低变近,旧深度的反投影点会落进桌板内;
    // 0.80 的起点在桌沿上方(≈y1.14/z2.1),再钳到桌面之上兜底——起飞不穿模。
    const s = new THREE.Vector3(ndcX, ndcY, 0.80).unproject(camera).applyAxisAngle(UP, -rot);
    s.y = Math.max(s.y, TABLE_TOP + 0.14);
    const lp = cardLocal(i);
    const end = new THREE.Vector3(target.x + lp[0], lp[1], target.z + lp[2]);
    const c = new THREE.Vector3((s.x + end.x) / 2, Math.max(s.y, end.y) + 0.9, (s.z + end.z) / 2); // 弧顶(近机位收矮)
    return { id: it.id, value: it.value, s, end, c, yaw: cardYaw(i) };
  }), [betFlight, camera, size, target, rot]);

  return items.map((it, i) => (
    <FlyingNote
      key={it.id}
      item={it}
      startRef={startRef}
      delay={i * 0.06}
      duration={0.72}
      onDone={() => { doneCount.current += 1; if (doneCount.current >= items.length) finalize(); }}
    />
  ));
}

// 任务⑦：把自己的鼠标视角换算成头部 yaw/pitch，限频(8Hz)、仅变化时上报，服务端转发给其他玩家。
// 单人模式没有别的观众（Boss 是脚本），不上报——省一条 8Hz 消息也免得会话层吞路由。
function useHeadReport(look, disabled = false) {
  const send = useGameStore(s => s.send);
  const playerId = useGameStore(s => s.playerId);
  const last = useRef({ yaw: 99, pitch: 99 });
  useEffect(() => {
    if (!playerId || disabled) return undefined;
    const id = setInterval(() => {
      const yaw = -look.current.x * 0.6;   // 鼠标右→头转右（如方向反了把负号去掉即可）
      const pitch = look.current.y * 0.3;
      if (Math.abs(yaw - last.current.yaw) < 0.02 && Math.abs(pitch - last.current.pitch) < 0.02) return;
      last.current = { yaw, pitch };
      send({ type: 'look', yaw, pitch });
    }, 125);
    return () => clearInterval(id);
  }, [look, send, playerId, disabled]);
}

function SceneContents({ look, freeCam = false }) {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const betFlight = useGameStore(s => s.betFlight);
  const myStack = useGameStore(s => s.myStack);
  const looks = useGameStore(s => s.looks);
  // 画质设置(反馈①):阴影/光影特效由玩家档位控制;URL 排查开关仍可强制关
  const shadowsOn = useSettingsStore(s => s.shadows);
  const postfxOn = useSettingsStore(s => s.postfx);
  // 单人模式（§9.6 交互 v2）：长桌两阵营对坐 + 自由走动/附身双态相机
  const single = !!state.single;
  const setup = state.phase === 'SINGLE_SETUP';
  const singleCam = useGameStore(s => s.singleCam);
  const possessed = single && !setup && singleCam === 'seat';
  useHeadReport(look, single);

  const players = state.players;
  const meIdx = Math.max(0, players.findIndex(p => p.id === playerId));
  const me = players.find(p => p.id === playerId);
  // 绝对座位:players[] 序 → 桌边固定位;整个场景旋转把我的座位转到相机近侧。
  // 单人:槽位固定长桌两侧、场景不旋转(rot=0)——走动视角下房间恒定。
  const N = Math.max(1, players.length);
  const seats = single ? players.map(singleSeatOf) : players.map((_, i) => seatOf(N, i));
  const mySeat = seats[meIdx] ?? { x: 0, z: 2.65 };
  // ?yaw=<弧度>:仅美术 QA 用——在座位旋转上再加偏航,便于截图核验四面墙
  const rot = (single ? 0 : rotFor(mySeat)) + (parseFloat(PARAMS.get('yaw')) || 0);
  const mySpot = single ? singleSpotOf(mySeat) : spotOf(mySeat);
  const spots = seats.map(single ? singleSpotOf : spotOf);
  // 第一人称落座相机基准(反馈⑥):我的座位旋转后必在 +z 近侧,距离=座距+微退
  const camZ = Math.hypot(mySeat.x, mySeat.z) + CAM_BACK;

  // 掷币分镜演出（§3.4）：进 COIN_FLIP 即收 UI + CineRig 接管相机（多人、非自由相机、非减动效）。
  // cine 状态机其余的推进在别处：CineRig 归位完成/卸载 → 'enter'，GameScreen 计时/任意键 → 'off'。
  const cine = useGameStore(s => s.cine);
  const cineEligible = !single && !freeCam && !REDUCED;
  // 处决窗（§3.9）：我是行刑者（桌面 3D）→ ExecutionRig 接管相机（指针锁+准心+左轮）。
  const execRigOn = !single && !IS_TOUCH && state.phase === 'EXECUTION' && state.execution?.executionerId === playerId;
  useEffect(() => {
    if (state.phase === 'COIN_FLIP' && cineEligible) useGameStore.getState().setCine('hide');
  }, [state.phase, cineEligible]);

  // 单人长桌:重力枪拖拽的毡面夹紧范围放宽到长桌(模块级单例,卸载还原多人口径)
  useEffect(() => {
    if (!single) return undefined;
    setFeltBounds(SINGLE_TABLE.w / 2 - 0.1, SINGLE_TABLE.d / 2 - 0.05);
    return () => setFeltBounds(2.9, 1.95);
  }, [single]);

  // 点队友附身（走动模式;e.delta 区分拖动转视角与点选）
  const possess = (pid) => {
    const store = useGameStore.getState();
    if (pid !== playerId) store.send({ type: 'single_seat', seatId: pid });
    store.setSingleCam('seat');
  };

  // 有人破产的瞬间:镜头注视点微震 300ms(§1.9)
  const bankruptCount = players.filter(p => p.bankrupt).length;
  const shakeRef = useRef(0);
  const prevBankrupt = useRef(bankruptCount);
  useEffect(() => {
    if (bankruptCount > prevBankrupt.current && !REDUCED) shakeRef.current = 0.3;
    prevBankrupt.current = bankruptCount;
  }, [bankruptCount]);

  // 对质窗（§8.8）：指控入口全在自己圈上的浮字（FeltPrompts「指控敌方 [Z]」）+ Z 快捷键（useGameKeys）——
  // 敌方模型不再做悬停描边/头顶浮字（描边方案在本 three 版本上做不出干净效果，已整体去除）。
  // CHALLENGE 也算「未揭牌」：对质窗里桌上的注全部**在场但面朝下**（金额仍藏，读牌靠张数）——揭牌在 REVEAL。
  const betsVisible = !['LOBBY', 'DISCUSSION', 'BETTING', 'CHALLENGE'].includes(state.phase);
  // 分钱阶段桌面钱全部交给编导层（聚拢/分堆/派送/调整/拿取，§3.8），常规下注堆让位
  const payoutActive = PAYOUT_PHASES.includes(state.phase) && !!state.payout;
  const showFlip = state.phase === 'COIN_FLIP';
  // REFLIP（暴食者重掷决策窗）也保持硬币停在已落定的反面结果上，让玩家看到自己输了再决定是否重掷。
  const showRest = (PAYOUT_PHASES.includes(state.phase) || state.phase === 'REFLIP') && state.coinResult;

  // 自己钱堆：飞行中先不渲染静态堆（由 FlyingNotes 接管）；落定后用 myStack（即飞出去那批牌）
  const flightActive = betFlight && betFlight.round === state.round;
  const selfBet = state.me?.bet ?? null;            // 自己的下注额（自己始终可见）
  const selfBetCount = me?.betCount ?? 0;           // 张数：用服务端值，与他人看到的一致
  const myStackValid = myStack && myStack.round === state.round;
  // 刚本地下注 → 用飞过去的那批牌（无缝接力）；否则按张数合成（背面占位 / 揭牌后按金额分解）。
  const selfNotes = myStackValid
    ? myStack.notes
    : (betsVisible ? decompose(selfBet ?? 0) : blankNotes(selfBetCount));

  return (
    <>
      {/* 打烊后的酒馆账房:墙落进雾里,黑虚空消失(ART_BIBLE §1.2) */}
      <color attach="background" args={[P.sceneBg]} />
      <fog attach="fog" args={[P.sceneFog, 10, 26]} />
      {/* 灯 rig(5 盏):环境 + 暖金主光(投影) + 吊灯唯一光池 + 炉火(闪烁) + 冷补 */}
      <ambientLight intensity={0.38} color={P.sceneAmbient} />
      <directionalLight
        position={[4, 9, 3]} intensity={1.35} color={P.key}
        castShadow={!NO_SHADOW && shadowsOn} shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1} shadow-camera-far={30}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
      <ChandelierLight />
      <directionalLight position={[-6, 4, 6]} intensity={0.30} color={P.coolFill} />

      {freeCam
        ? <OrbitControls target={[0, 1.05, 0]} makeDefault />
        : single
          ? <SingleRig mode={possessed ? 'seat' : 'walk'} seat={possessed ? mySeat : null} shakeRef={shakeRef} />
          : execRigOn
            ? <ExecutionRig players={players} seats={seats} rot={rot} camZ={camZ} eyeY={EYE_Y} playerId={playerId} />
            : cine === 'hide'
              ? <CineRig camZ={camZ} eyeY={EYE_Y} lookY={LOOK_Y} rot={rot} tableTop={TABLE_TOP} />
              : <CameraRig look={look} shakeRef={shakeRef} camZ={camZ} />}
      {/* 处决窗行刑者的第一人称左轮（§3.9）：与 ExecutionRig 同挂同卸 */}
      {execRigOn && <RevolverView />}
      <Projector />

      {/* 场景旋转组:把「我的座位」转到 +z 近侧——不同玩家看到自己坐在桌边不同位置(反馈⑫)。
          炉火点光跟着壁炉走(在组内);主光/环境/吊灯点光留在世界系(灯光戏剧性对所有人一致)。 */}
      <group rotation={[0, rot, 0]}>
        {/* 造景:房间(墙/地/天花/梁) + 壁炉 + 酒桶 + 墙面摆设 + 吊灯 + 圆毯 */}
        <Room />
        <Fireplace />
        <FireLight />
        <Barrels />
        <Decor />
        <Chandelier />
        <Rug />

        <Table spots={spots} size={single ? SINGLE_TABLE : null} />
        {single && <FactionBarriers />}

        {/* 入座椅子(反馈⑬:第一人称不渲染自己的椅子——与不建模自己身体同理,低头/退远也不穿帮)。
            单人:四个队伍槽位+Boss 位恒有椅子(空椅=可招募的位置);附身席位的椅子隐去。 */}
        {single
          ? [...SINGLE_TEAM_SEATS, SINGLE_BOSS_SEAT].map((seat, i) => (
            (!possessed || seat !== mySeat) && <Chair key={`chair-${i}`} x={seat.x} z={seat.z} ry={Math.atan2(-seat.x, -seat.z)} />
          ))
          : seats.map((seat, i) => (
            (freeCam || i !== meIdx) && <Chair key={`chair-${i}`} x={seat.x} z={seat.z} ry={Math.atan2(-seat.x, -seat.z)} />
          ))}
        {players.map((p, i) => {
          if (p.id === playerId && !freeCam && (!single || possessed)) return null;
          const seat = seats[i];
          const ry = Math.atan2(-seat.x, -seat.z);
          // 点角色附身只开放给**走动视角**：落座下注时 r3f 射线会穿透手牌命中身后的队友,
          // 点牌会被误判成切席（E2E 抓出的真 bug）——落座时切席走 Tab/席位芯片/起身后准心。
          const clickable = single && p.id !== 'L' && !p.bankrupt && !setup && !possessed;
          return (
            <group
              key={p.id}
              position={[seat.x, 0, seat.z]}
              rotation={[0, ry, 0]}
              onClick={clickable ? (e) => {
                // 指针锁定中 r3f 射线用的是锁前的过期指针位置——准心附身由 SingleRig 负责,这里让位
                if (document.pointerLockElement) return;
                if (e.delta < 6) { e.stopPropagation(); possess(p.id); }
              } : undefined}
            >
              <MinecraftPlayer
                player={p}
                expression={expressionFor(p, state)}
                seed={i * 1.7}
                look={p.id === playerId ? null : looks[p.id]}
                seated
                label={single ? `¥${p.balance ?? 0}` : null}
              />
            </group>
          );
        })}

        {/* 桌面钱堆(每人落在自己座位前的烘焙圆圈里;自己的堆飞行中隐藏,落定后无缝接力)。
            单人（交互 v3）:无手牌层,全部席位统一按服务端口径渲染（下注期=暂存注的背面堆）。
            EXECUTION（§3.9）不渲染：不在 PAYOUT_PHASES、payout 已 null 而 hasBet 仍真——
            已被结算收走的注若按此渲染会凭空回桌（真回归点） */}
        {!payoutActive && state.phase !== 'EXECUTION' && players.map((p, i) => {
          if (!p.hasBet) return null;
          const spot = spots[i];
          if (!single && p.id === playerId) {
            if (flightActive || !(selfNotes?.length || selfBetCount > 0)) return null;
            // 3D 模式下注期：金额由圈边浮字「已下注 ¥N」承担（验收修订③），堆上标签让位
            const selfAmount = IS_3D_INPUT && !betsVisible ? null : selfBet;
            return (
              <MoneyStack key={`m-${p.id}`} notes={selfNotes ?? []} amount={selfAmount} faceUp={betsVisible} position={[spot.x, 0, spot.z]} />
            );
          }
          return (
            <MoneyStack
              key={`m-${p.id}`}
              notes={betsVisible ? decompose(p.bet) : blankNotes(p.betCount)}
              amount={betsVisible ? p.bet : null}
              faceUp={betsVisible}
              position={[spot.x, 0, spot.z]}
            />
          );
        })}

        {/* 分钱编导层：聚拢→分堆→派送→协商镜像→收账/调整→拿取（§3.8） */}
        {payoutActive && (
          <PayoutLayer players={players} seats={seats} spots={spots} playerId={playerId} rot={rot} />
        )}

        {/* 圈上提示层（反馈⑪⑫）：大厅选角/准备/开始、讨论期准备下注、下注后金额驻留、重掷决策、揭牌确认——
            底部木板面板退役；BETTING 只在已下注后有内容（下注操作中浮字由 HandLayer 负责） */}
        {IS_3D_INPUT && !single && ['LOBBY', 'DISCUSSION', 'BETTING', 'CHALLENGE', 'REFLIP', 'REVEAL', 'EXECUTION'].includes(state.phase) && (
          <FeltPrompts mySpot={mySpot} players={players} spots={spots} playerId={playerId} />
        )}

        {/* 单人下注浮字层（交互 v3）:每个队伍圈上方=暂存注额（+保金）,中央=开掷 */}
        {single && state.phase === 'BETTING' && (
          <>
            <SingleBetPrompts players={players} spots={spots} />
            <SingleSummonPrompt />
          </>
        )}

        {/* 单人重掷决策（v3.1 技能准心化）:浮字挂硬币上方,准心瞄硬币 左键重掷/右键认输 */}
        {single && state.phase === 'REFLIP' && (
          <SingleReflipPrompts players={players} />
        )}

        {/* 组队期:准心指到的角色身旁浮出 3D 角色手册（瞄准即显,不退锁） */}
        {single && setup && <SetupSheet3D players={players} />}

        {/* 对质票 3D 模型（§8.8，只在 CHALLENGE、农民本人有票时）：一小排薄卡浮在自己圈前 */}
        {IS_3D_INPUT && state.phase === 'CHALLENGE' && me && !me.spectator
          && factionOf(me.role) === 'farmer' && (me.tickets ?? 0) > 0 && (
            <Tickets3D count={me.tickets} mySeat={mySeat} mySpot={mySpot} />
          )}

        {/* 下注飞行中的牌（手牌屏幕位→世界→组内坐标，弧线落进自己的圆圈） */}
        {flightActive && <FlyingNotes betFlight={betFlight} target={mySpot} rot={rot} />}

        {/* 硬币 */}
        {showFlip && (
          <Coin key={`flip-${state.round}`} mode="flip" result={state.coinResult ?? 'heads'} tableTop={TABLE_TOP} />
        )}
        {showRest && <Coin key={`rest-${state.round}`} mode="rest" result={state.coinResult} tableTop={TABLE_TOP} />}
        {/* （落定的桌面扩散演出已裁——尝试过金环金屑/像素浪潮/扫描光三版，均不合意；
            落定的强调改由分镜揭示镜的「打光闪 + 币面金光脉冲」承担，见 CineRig/Coin） */}
      </group>

      {/* 3D 手牌层（交互 3D 化）：BETTING 期把余额捏在相机前，拖进圆圈下注。
          挂在旋转组之外（手随相机走、拖拽射线都在世界系），桌面暂存牌由它内部按 rot 对齐。 */}
      {/* 单人不挂手牌层（交互 v3）:下注全走准心 ±1/全押,手牌拖拽是多人的交互 */}
      {IS_3D_INPUT && !single && state.phase === 'BETTING' && state.me && !state.me.spectator
        && factionOf(state.me.role) && state.me.bet == null && (
          <HandLayer
            key={`hand-${state.round}-${state.me.balance}-${state.me.id}`}
            look={look}
            rot={rot}
            mySpot={mySpot}
          />
        )}

      {/* 柔和接触阴影：低分辨率(够糊)，避免每帧高分重渲拖帧 */}
      <ContactShadows position={[0, 0.02, 0]} scale={18} blur={2.6} opacity={0.5} far={4.5} resolution={256} color={P.wood900} />

      {/* 后处理：吊灯/金皇冠/金色¥微微发光 + 画面暗角，营造围炉灯火气(画质设置可关,反馈①)。
          对质白描边不再走这里（后处理 Outline 静默失效已弃用）——改由 MinecraftPlayer 的反向外壳承担。 */}
      {!NO_FX && postfxOn && (
        <EffectComposer disableNormalPass multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette eskil={false} offset={0.28} darkness={0.62} />
        </EffectComposer>
      )}
    </>
  );
}

export default function Scene3D() {
  const look = useRef({ x: 0, y: 0 });
  const [freeCam, setFreeCam] = useState(false);
  // 单人走动模式的 2D 罩层:锁定=中央准心;未锁=「点击画面锁定视角」提示（MC 心智,§9.6 交互 v2）
  const singleWalk = useGameStore(s => !!s.state?.single && s.singleCam === 'walk');
  const walkLocked = useGameStore(s => s.walkLocked);
  const walkAim = useGameStore(s => s.walkAim);
  // 处决窗行刑者的准心（§3.9）：ExecutionRig 挂载期间复用同一套 walk-crosshair 罩层
  const execCrosshair = useGameStore(s => s.state?.phase === 'EXECUTION' && s.state.execution?.executionerId === s.playerId);
  // 渲染分辨率档位(反馈①):auto=像素预算自适应;low/medium/high 固定 dpr。R3F 对 dpr 热应用。
  // 订阅 uiScale：界面大小换档改变有效参考尺寸(STAGE.W/H) → auto 档 dpr 须随之重算。
  const renderScale = useSettingsStore(s => s.renderScale);
  useSettingsStore(s => s.uiScale);
  const dpr = renderScale === 'low' ? 0.75
    : renderScale === 'medium' ? 1.0
      : renderScale === 'high' ? Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5)
        : adaptiveDpr();

  useEffect(() => {
    // 触屏（移动端）：拖动=增量转视角——点按不跳视角、与手指落点无关（绝对映射会让
    // 点屏幕左侧直接甩头）。增量系数 2.4，clamp 与桌面同界。
    if (IS_TOUCH) {
      // 拖动=增量转视角。只在触点落在 3D 画布(.r3f-scene)时启动——HUD(聊天/招募令)上的滑动
      // 各自滚动、不转视角；拖卡牌/协商钱牌时(grab.active)让位、只跟锚点不转，松手无跳。
      const drag = { on: false, x: 0, y: 0 };
      const clamp1 = (v) => Math.max(-1, Math.min(1, v));
      const down = (e) => {
        if (!(e.target instanceof Element) || !e.target.closest('.r3f-scene')) { drag.on = false; return; }
        drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
      };
      const move = (e) => {
        if (!drag.on) return;
        if (grab.active) { drag.x = e.clientX; drag.y = e.clientY; return; }
        look.current.x = clamp1(look.current.x + ((e.clientX - drag.x) / window.innerWidth) * 2.4);
        look.current.y = clamp1(look.current.y + ((e.clientY - drag.y) / window.innerHeight) * 2.4);
        drag.x = e.clientX; drag.y = e.clientY;
      };
      const up = () => { drag.on = false; };
      window.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return () => {
        window.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
    }
    // 桌面：绝对鼠标位置 → 视角目标。以舞台(参考)空间归一化——留黑边/网页缩放下 window≠可视区，
    // 直接除 innerWidth 会让环视中心偏到黑边里。STAGE.W/H 是有效参考尺寸（随 uiScale 档位变）；
    // 无舞台（gallery 直挂页）回落 window。
    const onMove = (e) => {
      const p = clientToStage(e.clientX, e.clientY);
      look.current.x = (p.x / (STAGE.active ? STAGE.W : window.innerWidth)) * 2 - 1;
      look.current.y = (p.y / (STAGE.active ? STAGE.H : window.innerHeight)) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // 本地测试快捷键：B 补满真实测试玩家，V 切换当前操控的角色（单人玩全部角色），K 自由相机
  // （原 C 让位给检察官·传唤 §8.9——开发键避让产品键）。
  useEffect(() => {
    if (!DEV) return undefined;
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const store = useGameStore.getState();
      if (e.key === 'b' || e.key === 'B') store.send({ type: 'dev_fill' });
      else if (e.key === 'k' || e.key === 'K') setFreeCam(v => !v);
      else if (e.key === 'v' || e.key === 'V') {
        const list = store.state?.players ?? [];
        if (list.length > 1) {
          const i = list.findIndex(p => p.id === store.playerId);
          const next = list[(i + 1) % list.length];
          if (next) store.send({ type: 'dev_act_as', playerId: next.id });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="r3f-scene">
      {/* resize offsetSize：r3f 默认用 getBoundingClientRect 量容器 = **视觉**尺寸（被 app-stage 缩放过），
          drei Html 会按视觉像素定位再被舞台二次缩放（浮字/名牌整体飘出圈）；offsetWidth 是**布局**尺寸
          （桌面舞台下恒 1920×1080 参考空间，触屏无舞台时两者相等）——r3f 全内部状态回到单一参考空间。 */}
      <Canvas
        shadows={!NO_SHADOW}
        dpr={dpr}
        resize={{ offsetSize: true }}
        camera={{ position: [0, EYE_Y, 3.0], fov: 58, near: 0.1, far: 100 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <StagePointerCompute />
        <SceneContents look={look} freeCam={freeCam} />
      </Canvas>
      {(singleWalk || execCrosshair) && !IS_TOUCH && walkLocked && (
        // 四条臂独立成元素:可交互时各自向外平移+微缩短(CSS 过渡出"张开"动程)。
        // data-aim 暴露目标类型（'circle:s0'/'coin'/'seat:s1'/'exec:p1'/'deny:living'）——E2E 断言用。
        // 处决窗三态（§3.9）：exec=张开、deny:*=容器旋 45° 成斜叉、null=闭合。未锁定=系统光标。
        <div
          className={`walk-crosshair ${typeof walkAim === 'string' && walkAim.startsWith('deny') ? 'deny' : walkAim ? 'aim' : ''}`}
          data-aim={walkAim ?? undefined}
        >
          <i className="ch-n" /><i className="ch-s" /><i className="ch-w" /><i className="ch-e" />
        </div>
      )}
      {DEV && (
        <div className="dev-hud">{T.dev.hud(freeCam)}</div>
      )}
    </div>
  );
}
