// 3D 手牌层（BETTING · 桌面直接操作，§交互 3D 化）：
// 余额分解成真实纸牌捏在相机前。【扇形的物理结构】：所有牌严格平行于同一个「扇面」，
// 沿扇面法线一张压一张（右牌在上），旋转只发生在扇面内绕腕部枢轴——平行层几何上不可能穿模；
// 悬停 = 沿这张牌自己的长轴层内滑出一截（遮挡关系不变，读作「从手里抽牌」而非抬起）。
// 【手势】按下后：竖着拉 = 拽出这一张；横着扫 = 捋牌——只吸收指针【实际划过区段】的牌，
// 捋起的叠【立即跟随鼠标】（手牌带内贴指针悬浮、举离后过渡到桌面携带平面，尺寸随之渐变），
// 叠上挂 ¥ 合计浮字全程跟随；出过手牌带再拖回怀里 = 散回展扇（后悔药）。
// 圈里的钱堆长按 450ms = 整堆拿起变成跟手的一捋钱。短按(<260ms) = 这张牌直接飞进自己的圆圈；
// 点圈里的牌收回单张；手牌长按 450ms 拆分（140ms 起抖，与 2D 同参数）。
// 携带/暂存一律反面朝上（下注保密），姿态从手中四元数平滑翻转（无突跳）。
// 保留金摆在圈外正面朝上不可交互；投资人多一个投保圈。确认（Enter / 点圆圈浮字）后暂存牌
// 原地成为 myStack——零接力跳变，服务端协议不变（只发 place_bet）。强制全押走既有 FlyingNotes 管线。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { decompose, splitNote, SPLITS } from '../game/notes';
import { MoneyStack, ArcNote, cardMaterials, cardLocal, cardYaw, stackTopY, TABLE_TOP, CARD_W, CARD_T, CARD_D } from './cards';
import PromptFloat from './PromptFloat';
import { aimFromPointer, groundFromPointer, CarrySpring, CARRY_HEIGHT } from './carry';
import { grab } from './grab';
import KeyCap from '../assets/pixelfont/KeyCap';
import PixelText from '../assets/pixelfont/PixelText';
import { P } from '../assets/palette';

const UP = new THREE.Vector3(0, 1, 0);
const _fanTarget = new THREE.Vector3();   // 每帧即用即弃的划痕向量（单帧内同步使用，可全组件共享）
const _carryTarget = new THREE.Vector3();
const _feltPoint = new THREE.Vector3();   // 松手瞬间「指针指到毡面哪里」的落点判定用
const _sweepV = new THREE.Vector3();      // 捋牌吸收判定的投影划痕
const _rayDir = new THREE.Vector3();      // 手牌带内贴指针悬浮的射线方向划痕
const _handAim = new THREE.Vector3();
const _carryEuler = new THREE.Euler();
const _carryQuat = new THREE.Quaternion();
const LONG_PRESS_MS = 450;   // 长按拆分（与 2D MoneyHand 同参数）
const SHAKE_DELAY_MS = 140;  // 开始抖动的延迟（短按不抖）
const DRAG_START_PX = 8;     // 按下后移动超过该像素数 = 开始手势判定（否则视为长按候选）
const CLICK_MS = 260;        // 短按快放：按住不超过该时长且未拖动 = 点击直接入圈（反馈②）
const SWEEP_RATIO = 1.15;    // 横向位移 > 纵向×该系数 = 捋牌（沿扇面扫）；否则 = 拽出单张
const SWEEP_HIT_PX = 60;     // 捋牌命中半径：指针贴近牌心该像素距离即吸收（不必精确划过牌心）
const JOIN_GAP_MS = 60;      // 快速捋到多张时的最小起飞间隔——按捋的方向逐张出发，不挤成一团
const HAND_Z = -1.18, HAND_Y = -0.47;  // 扇面组在相机局部系里的位置（= 中心牌落点）
const HAND_SCALE = 0.5;      // 手里的牌比桌上的小一圈（近相机，原尺寸会占掉半个屏幕）
const HAND_THIN = 0.3;       // 手里的牌额外压薄（纯视觉）：层间距可以很小，扇形密实贴手
const FAN_TILT = Math.PI / 2 - 0.42; // 扇面朝相机的俯仰（整组统一——牌与牌绝对平行的关键）
const R_PIVOT = 0.55;        // 腕部枢轴半径：牌绕扇面内这一点做刚体旋转张开
const NSTEP = 0.0075;        // 扇面法线方向的层间距（> 压薄后的牌厚 → 平行层永不穿模）
const PULL_OUT = 0.10;       // 悬停沿牌自身长轴抽出的距离
const HAND_BAND = 0.75;      // 屏幕高度比例：此线以下为「手牌带」——捋牌吸收区 / 拖回散扇区 / 松手不判圈
const BAND_HYST_PX = 40;     // 出带/回带迟滞（防边界抖动）
const CARRY_NEAR_T = 1.05;   // 手牌带内叠贴指针悬浮的相机距离（略近于扇面，不被手牌挡住）
const BET_DROP_R = 0.85;     // 「拖到圆圈附近」的判定半径
const PLEDGE_DROP_R = 0.55;
// 扇形张角/张：牌少张得开（角标可读），牌越多越密，整扇最大 ~±0.65rad
const fanDelta = (n) => Math.min(0.22, 1.3 / Math.max(n - 1, 1));
// 按牌 id 的稳定小噪声（±0.018rad 的手持不齐感）
const jitterOf = (id) => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return ((h % 7) - 3) * 0.006;
};
// 可见牌网格不参与拾取（拾取全走静止的命中代理盒）
const noRaycast = () => null;
// 手中持牌姿态的俯仰（携带叠在手牌带内保持面朝玩家用）
const _qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(FAN_TILT, 0, 0));
const _qHand = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();

// 手里的单张牌（扇面组局部系）：真扇形 = 绕腕部枢轴的刚体旋转定位 + 沿扇面法线(+y)错层。
// 所有牌平行于扇面 → 几何上绝无穿模；悬停沿这张牌自己的长轴层内滑出一截——
// 遮挡关系保持不变（仍被右邻的下缘压着），读作「从手里抽牌」而非「抬起来」（反馈①）。
function HandCard({ note, i, mid, delta, shaking, disabled, onDown, register }) {
  const ref = useRef();
  const [hover, setHover] = useState(false);
  const a = (i - mid) * delta; // 本牌张角（扇心 0，右正左负）
  const jit = jitterOf(note.id);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const sh = shaking ? Math.sin(st.clock.elapsedTime * 55) * 0.014 : 0;
    const pull = hover && !disabled ? PULL_OUT : 0;
    // 中心 = 枢轴 + Ry(-a)·(0,0,-R)；抽出方向 = 牌自身长轴 (sin a, 0, -cos a)
    _fanTarget.set(
      Math.sin(a) * R_PIVOT + Math.sin(a) * pull + sh,
      (i - mid) * NSTEP,
      (1 - Math.cos(a)) * R_PIVOT - Math.cos(a) * pull,
    );
    m.position.lerp(_fanTarget, 0.35);
    m.rotation.set(0, -a + jit + sh * 2, 0);
  });
  return (
    <group>
      {/* 命中代理：钉死在槽位上的透明碰撞盒负责悬停/按下——抽出动画不移动命中区，
          指针骑在两张牌交界处也不会 over/out 来回振荡（鬼畜弹跳的根源） */}
      <mesh
        position={[Math.sin(a) * R_PIVOT, (i - mid) * NSTEP, (1 - Math.cos(a)) * R_PIVOT]}
        rotation={[0, -a, 0]}
        scale={[HAND_SCALE, HAND_SCALE * 3, HAND_SCALE]}
        onPointerDown={(e) => { e.stopPropagation(); onDown(note, e); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* 可见的牌：只管动画，不参与拾取 */}
      <mesh
        ref={(m) => { ref.current = m; register(note.id, m); }}
        material={cardMaterials(note.value)}
        position={[Math.sin(a) * R_PIVOT, (i - mid) * NSTEP, 0.22]}
        rotation={[0, -a, 0]}
        scale={[HAND_SCALE, HAND_SCALE * HAND_THIN, HAND_SCALE]}
        raycast={noRaycast}
      >
        <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
      </mesh>
    </group>
  );
}

// 暂存在圆圈里的牌（桌面局部系，槽位与 Scene3D 的 myStack 完全一致——确认后零跳变接力）。
// spawn = 拖拽落点（世界系），落下时短促滑入槽位并翻成背面（下注保密）。
// onDown：长按整堆拿起的入口（父级计时，450ms 后把整个暂存堆变成跟手携带叠）。
function StagedCard({ note, i, spot, rot, onClick, onDown }) {
  const ref = useRef();
  const t0 = useRef(null);
  const from = useRef(note.spawn ? new THREE.Vector3(...note.spawn).applyAxisAngle(UP, -rot) : null);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const l = cardLocal(i);
    const tx = spot.x + l[0], ty = l[1], tz = spot.z + l[2];
    if (from.current) {
      if (t0.current == null) t0.current = st.clock.elapsedTime;
      const dx = tx - from.current.x, dy = ty - from.current.y, dz = tz - from.current.z;
      // 点击快放从手里飞来路程远：时长与弧顶随水平距离放大（拖拽落牌距离近，仍是原来的短滑入）
      const dist = Math.hypot(dx, dz);
      const dur = Math.min(0.5, 0.2 + dist * 0.06);
      const t = Math.min(1, (st.clock.elapsedTime - t0.current) / dur);
      const e = 1 - (1 - t) * (1 - t);
      const arc = Math.sin(e * Math.PI) * Math.min(0.5, 0.1 + dist * 0.12);
      m.position.set(from.current.x + dx * e, from.current.y + dy * e + arc, from.current.z + dz * e);
      // 起始翻转角随来源而定：拖拽携带来的已是反面(π)不再翻，点击从手里飞来的顺势扣成反面
      const rx0 = note.spawnRotX ?? 0;
      m.rotation.set(rx0 + (Math.PI - rx0) * e, cardYaw(i) * e, 0);
      if (t >= 1) from.current = null;
    } else {
      m.position.set(tx, ty, tz);
      m.rotation.set(Math.PI, cardYaw(i), 0);
    }
  });
  return (
    <mesh
      ref={ref}
      material={cardMaterials(note.value)}
      castShadow
      onPointerDown={onDown ? (e) => { e.stopPropagation(); onDown(e); } : undefined}
      onClick={(e) => { e.stopPropagation(); onClick(note); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    >
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 被重力枪抓着的牌/叠：手牌带内贴着指针悬浮（相机前固定距离——捋起立即跟手），
// 举离手牌带后平滑过渡到「指针射线 ∩ 携带高度平面」（牌钉在指针正下方），尺寸随之从手中大小渐变到桌面大小。
// 姿态从抓起瞬间的手中姿态（q0）平滑过渡到「反面朝上」携带姿态（下注保密），到位后叠加速度倾斜。
// 叠上挂 ¥ 合计浮字，携带全程跟随显示。
function CarriedStack({ carry, carryRef, ndcRef }) {
  const ref = useRef();
  const { camera } = useThree();
  useFrame((_, dt) => {
    const c = carryRef.current;
    const g = ref.current;
    if (!c || !g) return;
    const ndc = ndcRef.current;
    aimFromPointer(camera, ndc, CARRY_HEIGHT, _carryTarget);
    // 带内→带外混合系数 f：指针在手牌带深处 0（贴指针悬浮），明显举离 1（桌面携带平面）
    const f = THREE.MathUtils.clamp((ndc.y + 0.62) / 0.24, 0, 1);
    if (f < 1) {
      _rayDir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
      _handAim.copy(camera.position).addScaledVector(_rayDir, CARRY_NEAR_T);
      _carryTarget.lerpVectors(_handAim, _carryTarget, f);
    }
    c.spring.update(_carryTarget, dt);
    // 手牌带内额外硬拉贴指针：近距离下纯弹簧的滞后会读作「跟手不跟鼠标」；举向桌面后渐弱回弹簧甩感
    if (f < 1) c.spring.pos.lerp(_carryTarget, (1 - f) * Math.min(1, dt * 22));
    g.position.copy(c.spring.pos);
    // 目标姿态：手牌带内 = 手中持牌姿态（面朝玩家，实时随相机）；举离后按离手程度 f
    // 过渡到反面朝上的携带姿态（+速度倾斜）——叠还在手里时保持本来的朝向，出去了才扣反面
    _carryEuler.set(
      Math.PI + THREE.MathUtils.clamp(c.spring.vel.z * 0.11, -0.55, 0.55),
      0,
      THREE.MathUtils.clamp(-c.spring.vel.x * 0.11, -0.55, 0.55),
    );
    _carryQuat.setFromEuler(_carryEuler);
    _qHand.copy(camera.quaternion).multiply(_qTilt);
    _qTarget.copy(_qHand).slerp(_carryQuat, f);
    c.blend = Math.min(1, (c.blend ?? 0) + dt / 0.22);
    const k = 1 - (1 - c.blend) * (1 - c.blend);
    g.quaternion.slerpQuaternions(c.q0, _qTarget, k);
    c.qNow = g.quaternion; // 供在途 JoinNote 追踪落点姿态（引用，实时）
    g.scale.setScalar(HAND_SCALE + (1 - HAND_SCALE) * f); // 尺寸跟「离手程度」走：带内保持手中大小
    g.visible = true; // 首帧就位后才显形，避免在原点闪一帧
  });
  // 金额含仍在飞入途中的牌（捋到即算，落叠只是演出）
  const sum = carry.notes.reduce((s, n) => s + n.value, 0)
    + (carry.joins ?? []).reduce((s, j) => s + j.note.value, 0);
  return (
    // 初始藏到桌下：Html 浮字不受 visible=false 约束，首帧组变换未就位时会闪现在桌心
    <group ref={ref} visible={false} position={[0, -5, 0]}>
      {carry.notes.map((n, k) => (
        // 沿局部 -y 堆叠：索引 0 = 面侧（手中姿态朝玩家 / 桌面姿态贴桌），新捋进的牌 unshift 到 0
        <mesh key={n.id} material={cardMaterials(n.value)} castShadow position={[0, -k * (CARD_T + 0.004), 0]}>
          <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
        </mesh>
      ))}
      {/* 姿态翻转后局部 -y ≈ 世界上方：金额浮字悬在叠上，跟随全程（捋了多少一目了然） */}
      <Html position={[0, -(0.16 + carry.notes.length * (CARD_T + 0.004)), 0]} center distanceFactor={3.2} zIndexRange={[30, 0]}>
        <div className="felt-float"><PixelText size={2} color="#fff">{`¥${sum}`}</PixelText></div>
      </Html>
    </group>
  );
}

// 被捋到的牌：先在自己的扇位上排队（多张快速捋入按最小间隔逐张出发，先扫到先飞——
// 与展扇同款的顺序感），轮到后起飞、追着【移动中的携带叠】飞过去（每帧取叠的实时位置），
// 途中从手中姿态顺势扣成反面——钱是被拢进拇指下的，不是瞬间消失又瞬间出现。
function JoinNote({ join, carryRef, onLand }) {
  const ref = useRef();
  const t0 = useRef(null);
  const done = useRef(false);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const c = carryRef.current;
    if (!c) return; // 叠已在收尾路径合并了在途牌，本组件即将卸载
    if (t0.current == null) {
      t0.current = st.clock.elapsedTime + Math.max(0, (join.startAt - performance.now()) / 1000);
    }
    const t = Math.min(1, Math.max(0, (st.clock.elapsedTime - t0.current) / 0.16));
    const e = 1 - (1 - t) * (1 - t);
    const p = c.spring.pos;
    m.position.set(
      join.from[0] + (p.x - join.from[0]) * e,
      join.from[1] + (p.y - join.from[1]) * e + Math.sin(e * Math.PI) * 0.05,
      join.from[2] + (p.z - join.from[2]) * e,
    );
    // 落点姿态追携带叠的当前姿态（带内=面朝玩家，带外=反面）——落叠瞬间零跳变
    if (c.qNow) {
      m.quaternion.copy(join.q0).slerp(c.qNow, e);
    } else {
      _carryEuler.set(Math.PI, 0, 0);
      _carryQuat.setFromEuler(_carryEuler);
      m.quaternion.copy(join.q0).slerp(_carryQuat, e);
    }
    m.scale.setScalar(HAND_SCALE);
    m.visible = true; // 排队等待时也停在扇位上可见（被指尖压住待起飞）
    if (t >= 1 && !done.current) { done.current = true; onLand(join); }
  });
  return (
    <mesh ref={ref} material={cardMaterials(join.note.value)} visible={false}>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 落区细虚环（投保圈常驻淡显；下注圈仅拖拽时点亮——毡面本身已烘了下注圈）
function ZoneRing({ pos, r = 0.34, opacity = 0.3 }) {
  return (
    <mesh position={[pos.x, TABLE_TOP + 0.006, pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r - 0.04, r, 28]} />
      <meshBasicMaterial color={P.gold} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

export default function HandLayer({ look, rot, mySpot }) {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const chatOpen = useGameStore(s => s.chatOpen);
  const spaceHeld = useGameStore(s => s.spaceHeld); // 浮字确认行的合成按下态
  const placeTableStack = useGameStore(s => s.placeTableStack);
  const startBetFlight = useGameStore(s => s.startBetFlight);
  const { camera, size } = useThree();

  const me = state.me;
  const bounds = me.bounds ?? { minStake: 1, min: 1, max: me.balance, forceAllIn: false };
  const noReserve = bounds.forceAllIn || bounds.max >= me.balance;
  const spendable = noReserve ? me.balance : me.balance - bounds.minStake;

  const [hand, setHand] = useState(() => decompose(spendable));
  const [staged, setStaged] = useState([]);   // 圆圈里的暂存注 [{id,value,spawn}]
  const [pledged, setPledged] = useState([]); // 投保圈 [{id,value,spawn}]
  const [carry, setCarry] = useState(null);   // {notes} —— 正被重力枪抓着的牌/叠
  const [flights, setFlights] = useState([]); // 收回手中/保单下沉的过渡飞牌
  const [shakingId, setShakingId] = useState(null);
  const [sent, setSent] = useState(false);

  const carryRef = useRef(null);          // {notes, spring, q0, blend, leftBand, sweep?}——捋牌吸收状态也挂在这
  const handRef = useRef(hand);           // 供只挂一次的指针监听器读最新手牌
  const ndcRef = useRef({ x: 0, y: 0 });
  const downRef = useRef(null);
  const pressActiveRef = useRef(false);   // 真实按键是否仍按住（window pointerdown/up，可靠，不受 r3f 射线延迟影响）
  const pressTimer = useRef(null);
  const shakeTimer = useRef(null);
  const stagedTimer = useRef(null);       // 长按圈内钱堆整堆拿起的计时器
  const cardRefs = useRef(new Map());
  const handGroup = useRef();
  const handInner = useRef();
  const tuckRef = useRef(0);
  const raiseRef = useRef(0);
  const qInitRef = useRef(false);   // 手牌组朝向首帧对齐相机后才开始滞后追赶
  const sentRef = useRef(false);    // 供只挂一次的指针监听器读最新 sent（防确认后点击补进牌）
  const confirmRef = useRef(null);

  const total = staged.reduce((s, n) => s + n.value, 0);
  const premium = pledged.reduce((s, n) => s + n.value, 0);
  const effMax = Math.max(0, bounds.max - premium);
  const canConfirm = bounds.forceAllIn || (total >= bounds.min && total <= effMax);
  const insurable = me.role === 'investor' && !bounds.forceAllIn;
  const maxPledge = me.pledgeMax ?? 3;
  const interactive = !sent && !bounds.forceAllIn;

  // 桌面锚点（世界系）：我的圆圈 / 圈外右侧保留金 / 圈外左侧投保圈
  const worldSpot = useMemo(() => new THREE.Vector3(mySpot.x, 0, mySpot.z).applyAxisAngle(UP, rot), [mySpot, rot]);
  const tangent = useMemo(() => {
    const o = worldSpot.clone().setY(0);
    const L = o.length() || 1;
    o.divideScalar(L);
    return new THREE.Vector3(o.z, 0, -o.x); // 面向桌心时的右手方向
  }, [worldSpot]);
  const reservePos = useMemo(() => worldSpot.clone().addScaledVector(tangent, 0.98), [worldSpot, tangent]);
  const pledgePos = useMemo(() => worldSpot.clone().addScaledVector(tangent, -1.02), [worldSpot, tangent]);
  const reserveNotes = useMemo(() => (noReserve ? [] : decompose(bounds.minStake)), [noReserve, bounds.minStake]);

  const clearTimers = () => {
    clearTimeout(pressTimer.current);
    clearTimeout(shakeTimer.current);
    clearTimeout(stagedTimer.current);
  };

  // 手牌跟随相机——MC 持图手感（反馈④）：
  //  · 旋转滞后：手牌组朝向对相机做 slerp 追赶（≈100ms），甩视角时整扇牌带惯性摆动；
  //  · 连续收放：抬头（look.y 越小）渐收进怀里，低头（look.y 越大）牌微微举近端详——无阈值突变。
  useFrame((_, dt) => {
    grab.active = !!carryRef.current; // 触屏：握着牌时相机 swipe 让位（帧级刷新）
    const g = handGroup.current;
    if (!g) return;
    g.position.copy(camera.position);
    if (!qInitRef.current) { g.quaternion.copy(camera.quaternion); qInitRef.current = true; }
    else g.quaternion.slerp(camera.quaternion, 1 - Math.exp(-dt * 9));
    const ly = look.current.y;
    const tuckWant = sent ? 1 : THREE.MathUtils.clamp((-ly - 0.12) / 0.3, 0, 1);
    const raiseWant = sent ? 0 : THREE.MathUtils.clamp((ly - 0.15) / 0.55, 0, 1);
    tuckRef.current += (tuckWant - tuckRef.current) * Math.min(1, dt * 8);
    raiseRef.current += (raiseWant - raiseRef.current) * Math.min(1, dt * 8);
    const t = tuckRef.current, r = raiseRef.current;
    const inner = handInner.current;
    if (inner) {
      inner.position.y = -t * 0.9 + r * 0.10;
      inner.position.z = t * 0.18 + r * 0.10;
      inner.rotation.x = -t * 0.9 + r * 0.18;
    }
  });

  // 手牌前方的收拢点（世界系）：收回的牌飞向这里再插回扇中
  const handCatchPoint = () => {
    const v = new THREE.Vector3(0, HAND_Y + 0.15, HAND_Z);
    return v.applyMatrix4(camera.matrixWorld);
  };

  // rotXFrom：飞行起始翻转角——从携带/圈里收回的牌是反面(π)，要从 π 平滑转回手中姿态，
  // 不能瞬跳成正面（保单牌本来正面朝上，传 0）。
  const returnToHand = (note, fromPos, delay = 0, rotXFrom = Math.PI) => {
    const to = handCatchPoint();
    setFlights(f => [...f, {
      key: `rt-${note.id}`, value: note.value, from: fromPos, to: [to.x, to.y, to.z],
      shrinkOut: true, note, delay, rotXFrom, rotXTo: rotXFrom === 0 ? 0 : FAN_TILT,
    }]);
  };

  // 全局指针：按下=标记按住；移动=更新 NDC / 判定拖拽起步；抬起=落牌判定 + 清按住标记。
  // 按住标记走 window 事件（可靠）——r3f 的射线拾取在慢机上会延迟到 mouseup 之后才触发
  // onHandDown，若那时才盲目 arm 拆分定时器就会「明明想拖却拆了牌」。
  useEffect(() => {
    const onDown = () => { pressActiveRef.current = true; };
    // 抓起（单张 / 整叠）：起点与起始姿态取自当前网格——携带姿态从这里平滑翻成反面（无突跳）。
    // extra.sweep = {lastX}：捋牌模式，携带中继续吸收扫过的牌。
    const beginCarry = (notes, leadId, extra) => {
      const mesh = cardRefs.current.get(leadId);
      const start = new THREE.Vector3();
      const q0 = new THREE.Quaternion();
      if (mesh) { mesh.getWorldPosition(start); mesh.getWorldQuaternion(q0); }
      else { groundFromPointer(camera, ndcRef.current, start); q0.setFromEuler(new THREE.Euler(Math.PI, 0, 0)); }
      carryRef.current = { notes, joins: [], spring: new CarrySpring(start), q0, blend: 0, leftBand: false, ...extra };
      setCarry({ notes, joins: [] });
    };
    const onMove = (e) => {
      ndcRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ndcRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      const bandY = window.innerHeight * HAND_BAND;
      const c = carryRef.current;
      if (c) {
        // 捋牌吸收（离手前的捋牌阶段）：命中 = 本段实际划过的区间 ∪ 距指针 SWEEP_HIT_PX 内（容易捋到）。
        // 被捋到的牌起飞进 joins（在途），追着叠飞、落叠才转正——不瞬移。
        // 去重必须查权威的 notes+joins：handRef 是渲染后才同步的快照，指针事件比 React 提交快，
        // 同一张牌会在快照更新前被扫到多次——曾导致金额翻倍(31 变 131)和暂存堆重影。
        if (c.sweep) {
          const lo = Math.min(c.sweep.lastX, e.clientX), hi = Math.max(c.sweep.lastX, e.clientX);
          const hits = [];
          for (const n of [...handRef.current]) {
            if (c.notes.some(p => p.id === n.id) || c.joins.some(j => j.note.id === n.id)) continue;
            const mesh = cardRefs.current.get(n.id);
            if (!mesh) continue;
            mesh.getWorldPosition(_sweepV);
            const from = [_sweepV.x, _sweepV.y, _sweepV.z];
            _sweepV.project(camera);
            const sx = (_sweepV.x * 0.5 + 0.5) * window.innerWidth;
            if ((sx >= lo && sx <= hi) || Math.abs(sx - e.clientX) < SWEEP_HIT_PX) {
              hits.push({ n, from, sx, mesh });
            }
          }
          if (hits.length) {
            // 同一事件扫到多张：按捋的方向排顺序（先被扫到的先飞），最小间隔逐张出发
            hits.sort((a, b) => (e.clientX >= c.sweep.lastX ? a.sx - b.sx : b.sx - a.sx));
            const now = performance.now();
            for (const h of hits) {
              const startAt = Math.max(now, (c.lastJoinAt ?? 0) + JOIN_GAP_MS);
              c.lastJoinAt = startAt;
              setHand(hd => hd.filter(x => x.id !== h.n.id));
              c.joins.push({
                note: { id: h.n.id, value: h.n.value }, from: h.from, startAt,
                q0: h.mesh.getWorldQuaternion(new THREE.Quaternion()),
              });
            }
            setCarry({ notes: c.notes, joins: c.joins });
          }
          c.sweep.lastX = e.clientX;
        }
        // 出手牌带 = 捋牌阶段结束（此后回带是「散回」，不再吸牌）
        if (!c.leftBand && e.clientY < bandY - BAND_HYST_PX) {
          c.leftBand = true;
          c.sweep = null;
        } else if (c.leftBand && e.clientY > bandY + BAND_HYST_PX * 0.5) {
          // 拖回怀里 = 散回展扇（含仍在飞入途中的牌；单张同样适用——拽出去后悔了放回手心）。
          // 此刻叠在带内已是面朝玩家的手中姿态，回手飞行从 FAN_TILT 起，不再从反面翻。
          const all = [...c.notes, ...c.joins.map(j => j.note)];
          carryRef.current = null;
          setCarry(null);
          downRef.current = null;
          const pos = c.spring.pos;
          all.forEach((n, k) => returnToHand(n, [pos.x, pos.y + k * 0.03, pos.z], k * 0.04, FAN_TILT));
        }
        return;
      }
      const d = downRef.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      // 移动超阈值：取消长按拆分，按方向分流手势；两种手势都立即跟手（捋起即携带）
      clearTimers();
      setShakingId(null);
      setHand(h => h.filter(n => n.id !== d.note.id));
      if (Math.abs(dx) > Math.abs(dy) * SWEEP_RATIO) {
        beginCarry([{ id: d.note.id, value: d.note.value }], d.note.id, { sweep: { lastX: e.clientX } });
      } else {
        beginCarry([{ id: d.note.id, value: d.note.value }], d.note.id);
      }
    };
    const onUp = (e) => {
      pressActiveRef.current = false;
      clearTimers();
      setShakingId(null);
      const d = downRef.current;
      downRef.current = null;
      const c = carryRef.current;
      if (!c) {
        // 短按快放（反馈②）：没拖动也没按到拆分时长 = 点击，这张牌直接飞进自己的圆圈
        if (d && !sentRef.current && performance.now() - d.t < CLICK_MS) {
          const mesh = cardRefs.current.get(d.note.id);
          const v = new THREE.Vector3();
          if (mesh) mesh.getWorldPosition(v); else v.set(worldSpot.x, TABLE_TOP + 0.6, worldSpot.z);
          setHand(h => h.filter(n => n.id !== d.note.id));
          setStaged(s => [...s, { ...d.note, spawn: [v.x, v.y, v.z], spawnRotX: FAN_TILT }]);
        }
        return;
      }
      carryRef.current = null;
      setCarry(null);
      const notes = [...c.notes, ...c.joins.map(j => j.note)]; // 含仍在飞入途中的牌
      const pos = c.spring.pos;   // 叠此刻的视觉位置（作滑入圈的 spawn 起点）
      // 在手牌带内松手不判圈：指针压在手牌上时毡面射线会钳到桌近缘，会被误判成「落进圈」
      const inBand = e && e.clientY > window.innerHeight * HAND_BAND;
      // 落点判定按「指针指到毡面哪里」——与玩家所见一致（反馈③）
      const felt = groundFromPointer(camera, ndcRef.current, _feltPoint);
      const dBet = inBand ? Infinity : Math.hypot(felt.x - worldSpot.x, felt.z - worldSpot.z);
      const dPledge = insurable && !inBand ? Math.hypot(felt.x - pledgePos.x, felt.z - pledgePos.z) : Infinity;
      const sum = notes.reduce((s, n) => s + n.value, 0);
      if (dPledge < PLEDGE_DROP_R && premium + sum <= maxPledge) {
        setPledged(p => [...p, ...notes.map((n, k) => ({ ...n, spawn: [pos.x, pos.y + k * 0.03, pos.z] }))]);
        return;
      }
      if (dBet < BET_DROP_R) {
        // 携带中已是反面朝上：spawnRotX=π，落圈不再翻面
        setStaged(s => [...s, ...notes.map((n, k) => ({ ...n, spawn: [pos.x, pos.y + k * 0.03, pos.z], spawnRotX: Math.PI }))]);
        return;
      }
      // 没落进任何圈：逐张错峰飞回手里（带内松手时叠还是手中朝向，起始角随之取 FAN_TILT）
      notes.forEach((n, k) => returnToHand(n, [pos.x, pos.y + k * 0.03, pos.z], k * 0.05, inBand ? FAN_TILT : Math.PI));
    };
    // pointerdown 用【捕获阶段】：必须在 r3f 的画布拾取（onHandDown）之前把 pressActiveRef 置真，
    // 否则快机正常按下时 onHandDown 先跑、读到假、直接 return，拖拽/拆分全失效。
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      grab.active = false; // 卸载兜底（避免退出 BETTING 时残留冻结相机）
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, worldSpot, pledgePos, insurable, premium, maxPledge]);

  const onFlightDone = (f) => {
    setFlights(fs => fs.filter(x => x.key !== f.key));
    if (f.note) setHand(h => [...h, { id: f.note.id, value: f.note.value }].sort((a, b) => b.value - a.value));
  };

  // 手牌按下（r3f 射线拾取，可能因慢机延迟）：先当长按拆分候选（移动超阈值转为拖拽，见 onMove）。
  // 若此刻真实按键已松开（pressActiveRef 为假，即拾取延迟到了 mouseup 之后），忽略——否则会误拆牌。
  const onHandDown = (note, e) => {
    if (!interactive || !pressActiveRef.current) return;
    downRef.current = { note, x: e.clientX, y: e.clientY, t: performance.now() };
    if (!SPLITS[note.value]) return;
    shakeTimer.current = setTimeout(() => { if (pressActiveRef.current) setShakingId(note.id); }, SHAKE_DELAY_MS);
    pressTimer.current = setTimeout(() => {
      if (!pressActiveRef.current || carryRef.current) return; // 已松开或已转为拖拽：不拆
      setShakingId(null);
      downRef.current = null;
      setHand(h => splitNote(h, note.id));
    }, LONG_PRESS_MS);
  };

  // 点圈里的牌：收回手中（飞行过渡）。携带中 / 牌已不在圈里（如刚被整堆拿起）都不响应。
  const unstage = (note) => {
    if (sent || carryRef.current) return;
    const idx = staged.findIndex(n => n.id === note.id);
    if (idx < 0) return;
    setStaged(s => s.filter(n => n.id !== note.id));
    const l = cardLocal(idx);
    const world = new THREE.Vector3(mySpot.x + l[0], l[1], mySpot.z + l[2]).applyAxisAngle(UP, rot);
    returnToHand(note, [world.x, world.y, world.z]);
  };

  // 长按圈里的钱堆 450ms：整堆拿起变成跟手的一捋钱（重新落圈 / 拖回手 / 换地方都行）
  const onStagedDown = (e) => {
    if (sent || !pressActiveRef.current || carryRef.current || !staged.length) return;
    e.stopPropagation();
    clearTimeout(stagedTimer.current);
    stagedTimer.current = setTimeout(() => {
      if (!pressActiveRef.current || carryRef.current || !staged.length) return;
      const notes = staged.map(n => ({ id: n.id, value: n.value }));
      setStaged([]);
      const start = new THREE.Vector3(worldSpot.x, stackTopY(notes.length) + 0.1, worldSpot.z);
      carryRef.current = {
        notes, joins: [], spring: new CarrySpring(start),
        q0: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), // 堆本来就反面平躺
        blend: 1, leftBand: false,
      };
      setCarry({ notes, joins: [] });
    }, LONG_PRESS_MS);
  };

  // 捋到的牌飞抵携带叠：从在途列表转正入叠（收尾路径已合并在途牌时叠为空引用，直接忽略）。
  // 插到叠的【面侧】（索引 0 = 朝向玩家的那张，也是 JoinNote 的飞行落点），旧牌整体往后压——
  // 最后飞进来的牌是整捋里唯一能看到面额的牌（反馈：新牌贴最下面/贴脸）。
  const landJoin = (join) => {
    const c = carryRef.current;
    if (!c) return;
    c.joins = c.joins.filter(j => j.note.id !== join.note.id);
    c.notes.unshift(join.note);
    setCarry({ notes: c.notes, joins: c.joins });
  };
  const unpledge = (note) => {
    if (sent) return;
    const idx = pledged.findIndex(n => n.id === note.id);
    setPledged(p => p.filter(n => n.id !== note.id));
    const l = cardLocal(Math.max(0, idx));
    returnToHand(note, [pledgePos.x + l[0], l[1], pledgePos.z + l[2]], 0, 0); // 保单牌正面朝上,不翻
  };

  const confirm = () => {
    if (sent || carryRef.current) return; // 手势进行中不许确认（携带叠里的牌不在任何账面上）
    if (bounds.forceAllIn) {
      // 全押：手牌整批飞进圆圈（走既有 FlyingNotes 管线，起点=3D 手牌投影到屏幕）
      const items = hand.map((n, i) => {
        const mesh = cardRefs.current.get(n.id);
        const v = new THREE.Vector3();
        if (mesh) mesh.getWorldPosition(v); else v.set(0, TABLE_TOP + 0.3, 2.2);
        v.project(camera);
        return {
          id: `bn-${Date.now()}-${i}`, value: n.value,
          fromScreen: { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height },
        };
      });
      if (items.length) startBetFlight({ round: state.round, items });
      setHand([]);
      setSent(true);
      send({ type: 'place_bet', amount: me.balance, count: items.length, pledge: 0 });
      return;
    }
    if (!canConfirm) return;
    // 牌已在圆圈里：原地转正为 myStack（无飞行，服务端广播 hasBet 后由 Scene3D 无缝接管）
    placeTableStack({ round: state.round, notes: staged });
    if (pledged.length) {
      // 保单牌沉入桌下消失（不上桌不入注；金额随 place_bet.pledge 上报）
      setFlights(f => [...f, ...pledged.map((n, i) => {
        const l = cardLocal(i);
        return {
          key: `pl-${n.id}`, value: n.value,
          from: [pledgePos.x + l[0], l[1], pledgePos.z + l[2]],
          to: [pledgePos.x, TABLE_TOP - 0.7, pledgePos.z],
          shrinkOut: true,
        };
      })]);
      setPledged([]);
    }
    setSent(true);
    send({ type: 'place_bet', amount: total, count: staged.length, pledge: insurable ? premium : 0 });
  };
  useEffect(() => { confirmRef.current = confirm; });
  useEffect(() => { sentRef.current = sent; }, [sent]);
  useEffect(() => { handRef.current = hand; });

  // 空格确认（反馈⑩：回车退役；聊天/输入框聚焦时让位——与全局快捷键同规则）
  useEffect(() => {
    // 空格两段式（验收修④）：按下只进按下态（≥100ms 才显示，快速点按不闪动画），
    // 松开才确认（与鼠标松开判定一致）。BETTING 的空格完全归本层（useGameKeys 不碰）。
    const typing = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const setHeld = useGameStore.getState().setSpaceHeld;
    let down = false;
    let pressTimer = 0;
    const onKey = (e) => {
      if (e.key !== ' ' || e.repeat || chatOpen || typing()) return;
      e.preventDefault();
      down = true;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { if (down) setHeld(true); }, 100);
    };
    const onKeyUp = (e) => {
      if (e.key !== ' ' || !down) return;
      down = false;
      clearTimeout(pressTimer);
      setHeld(false);
      if (chatOpen || typing()) return;
      e.preventDefault();
      confirmRef.current?.();
    };
    const onBlur = () => { down = false; clearTimeout(pressTimer); setHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearTimeout(pressTimer);
      setHeld(false); // 卸载（下注完/换阶段）时清掉按下态，防浮字卡在按下样式
    };
  }, [chatOpen]);

  useEffect(() => () => { clearTimers(); document.body.style.cursor = ''; }, []);

  const mid = (hand.length - 1) / 2;
  const delta = fanDelta(hand.length);

  // 圆圈浮字（白字无背景板）：金额/范围 + 确认行
  const line1 = bounds.forceAllIn
    ? `资金不足 · 必须全押 ¥${me.balance}`
    : `已选 ¥${total} · 可下注 ${bounds.min}-${effMax}${premium > 0 ? ` · 投保 ¥${premium}` : ''}`;
  const line2 = sent
    ? '已下注'
    : bounds.forceAllIn
      ? '全押'
      : canConfirm
        ? '确认下注'
        : (total < bounds.min ? '点或拖手牌下注' : '超出上限');
  const line2Click = !sent && (bounds.forceAllIn || canConfirm); // 可点行才带空格键帽

  return (
    <group>
      {/* 相机跟随的手牌扇：扇面组内所有牌绝对平行（沿法线错层），几何上绝无穿模 */}
      <group ref={handGroup}>
        <group ref={handInner}>
          <group position={[0, HAND_Y, HAND_Z]} rotation={[FAN_TILT, 0, 0]}>
            {hand.map((n, i) => (
              <HandCard
                key={n.id}
                note={n}
                i={i}
                mid={mid}
                delta={delta}
                shaking={shakingId === n.id}
                disabled={sent}
                onDown={onHandDown}
                register={(id, m) => { if (m) cardRefs.current.set(id, m); else cardRefs.current.delete(id); }}
              />
            ))}
          </group>
        </group>
      </group>

      {/* 桌面侧（与场景同一旋转系）：暂存注（点=收回单张，长按=整堆拿起跟手） */}
      <group rotation={[0, rot, 0]}>
        {staged.map((n, i) => (
          <StagedCard key={n.id} note={n} i={i} spot={mySpot} rot={rot} onClick={unstage} onDown={onStagedDown} />
        ))}
      </group>

      {/* 保留金：圆圈外右侧，正面朝上，不可交互 */}
      {reserveNotes.length > 0 && (
        <>
          <MoneyStack notes={reserveNotes} faceUp amount={bounds.minStake} labelColor="var(--ink-dim)" position={[reservePos.x, 0, reservePos.z]} />
          <Html position={[reservePos.x, stackTopY(reserveNotes.length) + 0.3, reservePos.z]} center distanceFactor={5} zIndexRange={[22, 0]}>
            <div className="felt-float"><PixelText size={2} color="var(--ink-dim)">保留金</PixelText></div>
          </Html>
        </>
      )}

      {/* 投保圈（仅投资人）：拖牌进圈=投保，点圈里的保单牌收回 */}
      {insurable && (
        <>
          <ZoneRing pos={pledgePos} opacity={carry ? 0.55 : 0.3} />
          {pledged.map((n, i) => (
            <PledgedCard key={n.id} note={n} i={i} pos={pledgePos} onClick={unpledge} />
          ))}
          <Html position={[pledgePos.x, TABLE_TOP + 0.52 + Math.min(pledged.length, 5) * 0.045, pledgePos.z]} center distanceFactor={6.5} zIndexRange={[22, 0]}>
            <div className="felt-float"><PixelText size={2} color={premium > 0 ? 'var(--px-gold)' : 'var(--ink-dim)'}>{`投保 ¥${premium}/${maxPledge}`}</PixelText></div>
          </Html>
        </>
      )}

      {/* 拖拽时点亮自己的下注圈 */}
      {carry && <ZoneRing pos={worldSpot} r={0.46} opacity={0.5} />}

      {/* 被抓着的牌/叠 + 捋牌在途飞牌 + 过渡飞牌 */}
      {carry && <CarriedStack carry={carry} carryRef={carryRef} ndcRef={ndcRef} />}
      {carry && (carry.joins ?? []).map(j => (
        <JoinNote key={j.note.id} join={j} carryRef={carryRef} onLand={landJoin} />
      ))}
      {flights.map(f => (
        <ArcNote key={f.key} value={f.value} from={f.from} to={f.to} delay={f.delay ?? 0} duration={0.42} apex={0.55} rotXFrom={f.rotXFrom ?? 0} rotXTo={f.rotXTo ?? 0} shrinkOut={f.shrinkOut} onDone={() => onFlightDone(f)} />
      ))}

      {/* 圈旁浮字：白字提示（无背景板），确认行可点。PromptFloat 统一载体——BETTING 属
          「圈内可能有钱」阶段，锚定圈「西北」压低（反馈⑤），从讨论期的圈顶位置阻尼滑过来
          （验收修订②）；点击有受击动效。本层挂在世界系，传 rot 由载体转换。 */}
      <PromptFloat spot={mySpot} nw rot={rot}>
        <PixelText size={2} color="#fff">{line1}</PixelText>
        {line2 && (
          line2Click
            ? (
              <div className={`clickable prompt-line ${spaceHeld ? 'pressed' : ''}`} onClick={() => confirmRef.current?.()}>
                <PixelText size={2} color="var(--px-gold)">{line2}</PixelText>
                <KeyCap color="var(--px-gold)" />
              </div>
            )
            : <PixelText size={2} color="var(--ink-dim)">{line2}</PixelText>
        )}
      </PromptFloat>
    </group>
  );
}

// 投保圈里的保单牌：正面朝上小堆，点击收回
function PledgedCard({ note, i, pos, onClick }) {
  const ref = useRef();
  const t0 = useRef(null);
  const from = useRef(note.spawn ? new THREE.Vector3(...note.spawn) : null);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const l = cardLocal(i);
    const tx = pos.x + l[0], ty = l[1], tz = pos.z + l[2];
    if (from.current) {
      if (t0.current == null) t0.current = st.clock.elapsedTime;
      const t = Math.min(1, (st.clock.elapsedTime - t0.current) / 0.22);
      const e = 1 - (1 - t) * (1 - t);
      m.position.set(
        from.current.x + (tx - from.current.x) * e,
        from.current.y + (ty - from.current.y) * e,
        from.current.z + (tz - from.current.z) * e,
      );
      if (t >= 1) from.current = null;
    } else {
      m.position.set(tx, ty, tz);
    }
    m.rotation.set(0, cardYaw(i), 0);
  });
  return (
    <mesh
      ref={ref}
      material={cardMaterials(note.value)}
      castShadow
      onClick={(e) => { e.stopPropagation(); onClick(note); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    >
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}
