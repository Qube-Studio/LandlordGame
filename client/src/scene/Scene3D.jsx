// 真 3D 场景层（react-three-fiber）：赌桌 + 围桌而立的方块人 + 桌面钱堆 + 单独建模的硬币。
// 相机随鼠标小幅转动视角（带阻尼回中）。只读 store，无任何游戏逻辑。
// useFrame 内逐帧改写相机是 r3f 既定用法，关闭对应的不可变性规则。
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import { decompose } from '../game/notes';
import MinecraftPlayer from './MinecraftPlayer';
import Coin from './Coin';
import { noteTexture, coinFaceTexture } from './textures';
import { getCoinRest } from './coinSim';
import { setProjector } from './projection';
import { expressionFor } from './expression';
import PixelText from '../assets/pixelfont/PixelText';
import { P, DENOM_COLORS } from '../assets/palette';
import { tex } from '../assets/texlib';

const TABLE_TOP = 1.0;
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
  const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, window.innerWidth * window.innerHeight));
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

// 大号靠背椅(每个入座玩家一张,反馈⑦):坐面沿用旧凳(y=0.46、0.52 见方,坐姿不用重调),
// 外侧两立柱升到 ~1.35 + 三根横板,靠背略后仰。立柱/横板都收在 |x|≤0.24、z≤-0.2,
// 与坐姿身体(背面 z=-0.15)和摆臂(|x|≥0.30)都留有间隙,不穿模。
function Chair({ x, z, ry = 0 }) {
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
const EYE_Y = 1.82;   // 坐姿眼高(用户定夺:比头部略高,带一点俯视桌面的从容感)
const LOOK_Y = 1.03;  // 注视点=桌心略上
const CAM_BACK = 0.62; // 相机比座位中心靠后(后仰靠椅背;离桌更远,桌面与对家更完整)
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

// 硬币落定:金环扩散(0.5s) + 16 顶点预分配 Points 金屑上抛(0.6s),0.7s 后整体卸载
function CoinBurst({ tableTop }) {
  const ring = useRef();
  const pts = useRef();
  const t0 = useRef(null);
  const [dead, setDead] = useState(false);
  const { positions, vels } = useMemo(() => {
    const positions = new Float32Array(16 * 3);
    const vels = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      vels.push([Math.cos(a) * (0.45 + (i % 3) * 0.28), 1.5 + (i % 4) * 0.35, Math.sin(a) * (0.45 + ((i + 1) % 3) * 0.28)]);
    }
    return { positions, vels };
  }, []);
  const rest = getCoinRest();
  const cx = rest ? rest.x : 0, cz = rest ? rest.z : 0;
  useFrame((st) => {
    if (dead) return;
    if (t0.current == null) t0.current = st.clock.elapsedTime;
    const t = st.clock.elapsedTime - t0.current;
    if (t > 0.7) { setDead(true); return; }
    if (ring.current) {
      const k = Math.min(1, t / 0.5);
      ring.current.scale.setScalar(0.2 + k * 2.0);
      ring.current.material.opacity = 0.8 * (1 - k);
    }
    if (pts.current) {
      const arr = pts.current.geometry.attributes.position.array;
      const pk = Math.min(1, t / 0.6);
      for (let i = 0; i < 16; i++) {
        arr[i * 3] = cx + vels[i][0] * t;
        arr[i * 3 + 1] = tableTop + 0.05 + vels[i][1] * t - 4.5 * t * t;
        arr[i * 3 + 2] = cz + vels[i][2] * t;
      }
      pts.current.geometry.attributes.position.needsUpdate = true;
      pts.current.material.opacity = 1 - pk;
    }
  });
  if (dead) return null;
  return (
    <group>
      <mesh ref={ring} position={[cx, tableTop + 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.38, 24]} />
        <meshBasicMaterial color={P.brassHi} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <points ref={pts}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={P.brassHi} size={0.06} transparent opacity={1} depthWrite={false} sizeAttenuation />
      </points>
    </group>
  );
}

// ---- 酒馆房间(ART_BIBLE §1.4):内翻盒 24×10×24,墙贴烘焙酒馆纹理(酒架/画框/鹿角剪影都在纹理里,零几何) ----
function Room() {
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
function Fireplace() {
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
function Barrels() {
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
function Decor() {
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

// 桌上方木轮吊灯(反馈⑦升级):8 段盒子拼成的木轮圈 + 3 条小盒链收拢上吊 + 5 支蜡烛
// (蜡柱 + 3 帧火苗片)+ 中心铜毂与辐条。全部不投影(castShadow=false,上轮反馈);真灯在 ChandelierLight。
const CHAND_R = 1.05;
function Chandelier() {
  const wood = tex('wood', { tone: P.wood700 });
  const brass = tex('brass');
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  const rim = Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * Math.PI * 2);
  const candles = Array.from({ length: 5 }, (_, i) => (i / 5) * Math.PI * 2 + 0.3);
  const chains = [0, 1, 2].map(i => (i / 3) * Math.PI * 2 + 0.9);
  // 形体 y=2.8:第一人称落座相机(反馈⑥)抬头时远侧轮圈/烛光入画;点光仍在 3.3(ChandelierLight 不动)。
  // 轮心不放毂/辐条:掷币抛物线从轮圈中孔穿过(coinSim 抛点最高 ~4.3),粗件会被硬币穿模。
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
      {/* 3 条链(小盒串)从轮圈收拢到 y+1.0,再一根吊绳上 y=6 房梁 */}
      {chains.map((a) => (
        <group key={a}>
          {[0, 1, 2, 3, 4].map((j) => {
            const t = (j + 0.5) / 5;
            return (
              <mesh
                key={j}
                position={[Math.cos(a) * CHAND_R * 0.92 * (1 - t), 0.05 + t * 0.95, Math.sin(a) * CHAND_R * 0.92 * (1 - t)]}
                rotation={[0.35, a, j % 2 ? Math.PI / 4 : 0]}
              >
                <boxGeometry args={[0.045, 0.1, 0.045]} />
                <meshStandardMaterial color={P.wood900} roughness={0.8} flatShading />
              </mesh>
            );
          })}
        </group>
      ))}
      <mesh position={[0, 2.0, 0]}>
        <boxGeometry args={[0.05, 2.0, 0.05]} />
        <meshStandardMaterial color={P.wood900} roughness={1} />
      </mesh>
      {/* 5 支蜡烛:蜡柱 + 交叉火苗片(静帧,帧位错开;整灯闪烁交给 ChandelierLight) */}
      {candles.map((a, i) => (
        <group key={i} position={[Math.cos(a) * CHAND_R * 0.82, 0.05, Math.sin(a) * CHAND_R * 0.82]}>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.035, 0.045, 0.2, 6]} />
            <meshStandardMaterial color={P.parchment} roughness={1} flatShading />
          </mesh>
          {[0, Math.PI / 2].map((ry, k) => (
            <mesh key={k} position={[0, 0.29, 0]} rotation={[0, ry + a, 0]}>
              <planeGeometry args={[0.11, 0.17]} />
              <meshStandardMaterial
                map={frames[i % 3]} emissiveMap={frames[i % 3]} emissive={P.ink} emissiveIntensity={1.8}
                transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// 桌下圆毯
function Rug() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
      <circleGeometry args={[5, 24]} />
      <meshStandardMaterial map={tex('rug')} roughness={1} />
    </mesh>
  );
}

// 赌桌(ART_BIBLE §1.4):毡面烘金描线下注区(与钱堆落点同源对位)+ 橡木框 + 黄铜嵌线 + 横撑
function Table({ spots = [] }) {
  const feltTex = useMemo(() => tex('tableFelt', { spots }), [spots]);
  const frameWood = tex('wood', { tone: P.wood500 });
  const legWood = tex('wood', { tone: P.wood700 });
  const brass = tex('brass');
  return (
    <group>
      {/* 桌面毡布:下注区/硬币圈直接烘死在纹理里,零文字锚定。X 收窄一点(用户反馈):6.6→6.0 */}
      <mesh position={[0, TABLE_TOP - 0.06, 0]} receiveShadow>
        <boxGeometry args={[6.0, 0.12, 4.0]} />
        <meshStandardMaterial map={feltTex} roughness={0.95} flatShading />
      </mesh>
      {/* 木框 */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[6.4, 0.34, 4.4]} />
        <meshStandardMaterial map={frameWood} roughness={1} flatShading />
      </mesh>
      {/* 内缘黄铜嵌线(微 emissive,Bloom 下泛柔光) */}
      {[
        { pos: [0, 0.952, -2.06], args: [6.12, 0.03, 0.06] },
        { pos: [0, 0.952, 2.06], args: [6.12, 0.03, 0.06] },
        { pos: [-3.06, 0.952, 0], args: [0.06, 0.03, 4.06] },
        { pos: [3.06, 0.952, 0], args: [0.06, 0.03, 4.06] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.args} />
          <meshStandardMaterial map={brass} emissive={P.brass} emissiveIntensity={0.15} roughness={0.5} metalness={0.4} flatShading />
        </mesh>
      ))}
      {/* 桌腿 + 横撑 */}
      {[[-2.9, -1.9], [2.9, -1.9], [-2.9, 1.9], [2.9, 1.9]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]}>
          <boxGeometry args={[0.32, 0.8, 0.32]} />
          <meshStandardMaterial map={legWood} roughness={1} flatShading />
        </mesh>
      ))}
      {[-1.9, 1.9].map((z) => (
        <mesh key={z} position={[0, 0.22, z]}>
          <boxGeometry args={[5.8, 0.1, 0.14]} />
          <meshStandardMaterial map={legWood} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// 双面钞票卡材质：+y(顶)=正面值，-y(底)=反面；正/反由 rotation.x（0 / π）决定。按面额缓存。
const CARD_W = 0.42, CARD_T = 0.05, CARD_D = 0.58;
const CARD_MATS = new Map();
function cardMaterials(value) {
  if (CARD_MATS.has(value)) return CARD_MATS.get(value);
  const face = new THREE.MeshStandardMaterial({ map: noteTexture({ value }), roughness: 0.85, flatShading: true });
  const back = new THREE.MeshStandardMaterial({ map: noteTexture({ faceDown: true }), roughness: 0.85, flatShading: true });
  // 边缘按面额 accent 色带(银行捆钞感,侧看一眼识面额)
  const edge = new THREE.MeshStandardMaterial({ color: (DENOM_COLORS[value] ?? DENOM_COLORS[1]).accent, roughness: 1, flatShading: true });
  const mats = [edge, edge, face, back, edge, edge]; // px,nx,py(正),ny(反),pz,nz
  CARD_MATS.set(value, mats);
  return mats;
}
// 钱堆布局：把牌分成若干小叠聚成一小堆，比单列细塔更有「钱多」的体量感。
// 飞行落点与静态钱堆共用 cardLocal，保证无缝接力。
const STACK_CAP = 36;   // 单堆最多渲染张数（超出只影响视觉，张数标签仍显示真实值）
const COL_H = 5;        // 每小叠张数
const STACK_SPOTS = [   // 各小叠在桌面上的散布位置（相对钱堆中心），随叠数外扩
  [0, 0], [0.17, 0.07], [-0.15, 0.11], [0.07, -0.17], [-0.11, -0.15],
  [0.21, -0.08], [-0.2, -0.04], [0.04, 0.19],
];
const cardLocal = (i) => {
  const col = Math.floor(i / COL_H);
  const row = i % COL_H;
  const [sx, sz] = STACK_SPOTS[col % STACK_SPOTS.length];
  return [sx + ((row % 2) - 0.5) * 0.025, TABLE_TOP + 0.03 + row * 0.045 + col * 0.012, sz + Math.sin(row * 2.1) * 0.02];
};
const cardYaw = (i) => ((i * 37) % 34 - 17) * Math.PI / 180;
// 钱堆顶部（用于悬浮标签）：取最高小叠的高度
const stackTopY = (count) => TABLE_TOP + 0.06 + Math.min(count, COL_H) * 0.045;
// 反面占位牌（下注阶段对手只露张数，不露面额）
const blankNotes = (n) => Array.from({ length: Math.max(0, Math.min(n, STACK_CAP)) }, (_, i) => ({ id: `b${i}`, value: 1 }));

// 炉火点光:双正弦叠加闪烁(每帧只写 1 个 number,零分配)。
// 画质设置「动态光效」关 / prefers-reduced-motion → 静态强度(反馈①)。
function FireLight() {
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

function MoneyStack({ notes, faceUp, position, amount = null }) {
  const shown = notes.slice(0, STACK_CAP);
  const topY = stackTopY(shown.length);
  return (
    <group position={position}>
      {shown.map((n, i) => (
        <mesh
          key={n.id ?? i}
          material={cardMaterials(n.value)}
          position={cardLocal(i)}
          rotation={[faceUp ? 0 : Math.PI, cardYaw(i), 0]}
          castShadow
        >
          <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
        </mesh>
      ))}
      {/* 不显示张数；金额仅在可见时标注（自己的堆始终可见，他人堆揭牌后可见） */}
      {amount != null && (
        <Html position={[0, topY + 0.15, 0]} center distanceFactor={6.5} zIndexRange={[20, 0]}>
          <div className="money-3d-amount"><PixelText size={2} color={P.gold}>{`¥${amount}`}</PixelText></div>
        </Html>
      )}
    </group>
  );
}

// 一张飞行中的牌：从手牌屏幕位置（反投影到世界）沿二次贝塞尔弧线落到桌面槽位，
// 同时从「正面朝向相机」翻转为「反面朝上平躺」。
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
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
function useHeadReport(look) {
  const send = useGameStore(s => s.send);
  const playerId = useGameStore(s => s.playerId);
  const last = useRef({ yaw: 99, pitch: 99 });
  useEffect(() => {
    if (!playerId) return;
    const id = setInterval(() => {
      const yaw = -look.current.x * 0.6;   // 鼠标右→头转右（如方向反了把负号去掉即可）
      const pitch = look.current.y * 0.3;
      if (Math.abs(yaw - last.current.yaw) < 0.02 && Math.abs(pitch - last.current.pitch) < 0.02) return;
      last.current = { yaw, pitch };
      send({ type: 'look', yaw, pitch });
    }, 125);
    return () => clearInterval(id);
  }, [look, send, playerId]);
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
  useHeadReport(look);

  const players = state.players;
  const meIdx = Math.max(0, players.findIndex(p => p.id === playerId));
  const me = players.find(p => p.id === playerId);
  // 绝对座位:players[] 序 → 桌边固定位;整个场景旋转把我的座位转到相机近侧
  const N = Math.max(1, players.length);
  const seats = players.map((_, i) => seatOf(N, i));
  const mySeat = seats[meIdx] ?? { x: 0, z: 2.65 };
  // ?yaw=<弧度>:仅美术 QA 用——在座位旋转上再加偏航,便于截图核验四面墙
  const rot = rotFor(mySeat) + (parseFloat(PARAMS.get('yaw')) || 0);
  const mySpot = spotOf(mySeat);
  const spots = seats.map(spotOf);
  // 第一人称落座相机基准(反馈⑥):我的座位旋转后必在 +z 近侧,距离=座距+微退
  const camZ = Math.hypot(mySeat.x, mySeat.z) + CAM_BACK;

  // 有人破产的瞬间:镜头注视点微震 300ms(§1.9)
  const bankruptCount = players.filter(p => p.bankrupt).length;
  const shakeRef = useRef(0);
  const prevBankrupt = useRef(bankruptCount);
  useEffect(() => {
    if (bankruptCount > prevBankrupt.current && !REDUCED) shakeRef.current = 0.3;
    prevBankrupt.current = bankruptCount;
  }, [bankruptCount]);

  const betsVisible = !['LOBBY', 'DISCUSSION', 'BETTING'].includes(state.phase);
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

      {freeCam ? <OrbitControls target={[0, 1.05, 0]} makeDefault /> : <CameraRig look={look} shakeRef={shakeRef} camZ={camZ} />}
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

        <Table spots={spots} />

        {/* 全员入座(含自己的空椅;非自由相机时自己≈相机不建模,自己的椅背在相机身后不挡视野) */}
        {seats.map((seat, i) => (
          <Chair key={`chair-${i}`} x={seat.x} z={seat.z} ry={Math.atan2(-seat.x, -seat.z)} />
        ))}
        {players.map((p, i) => {
          if (p.id === playerId && !freeCam) return null;
          const seat = seats[i];
          const ry = Math.atan2(-seat.x, -seat.z);
          return (
            <group key={p.id} position={[seat.x, 0, seat.z]} rotation={[0, ry, 0]}>
              <MinecraftPlayer
                player={p}
                expression={expressionFor(p, state)}
                seed={i * 1.7}
                look={p.id === playerId ? null : looks[p.id]}
                seated
              />
            </group>
          );
        })}

        {/* 桌面钱堆(每人落在自己座位前的烘焙圆圈里;自己的堆飞行中隐藏,落定后无缝接力) */}
        {players.map((p, i) => {
          if (!p.hasBet) return null;
          const spot = spots[i];
          if (p.id === playerId) {
            if (flightActive || !(selfNotes?.length || selfBetCount > 0)) return null;
            return (
              <MoneyStack key={`m-${p.id}`} notes={selfNotes ?? []} amount={selfBet} faceUp={betsVisible} position={[spot.x, 0, spot.z]} />
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

        {/* 下注飞行中的牌（手牌屏幕位→世界→组内坐标，弧线落进自己的圆圈） */}
        {flightActive && <FlyingNotes betFlight={betFlight} target={mySpot} rot={rot} />}

        {/* 硬币 */}
        {showFlip && (
          <Coin key={`flip-${state.round}`} mode="flip" result={state.coinResult ?? 'heads'} tableTop={TABLE_TOP} />
        )}
        {showRest && <Coin key={`rest-${state.round}`} mode="rest" result={state.coinResult} tableTop={TABLE_TOP} />}
        {/* 落定瞬间的金环 + 金屑(按 回合|结果 重挂,一次性演出) */}
        {showRest && !REDUCED && (
          <CoinBurst key={`burst-${state.round}-${state.coinResult}`} tableTop={TABLE_TOP} />
        )}
      </group>

      {/* 柔和接触阴影：低分辨率(够糊)，避免每帧高分重渲拖帧 */}
      <ContactShadows position={[0, 0.02, 0]} scale={18} blur={2.6} opacity={0.5} far={4.5} resolution={256} color={P.wood900} />

      {/* 后处理：吊灯/金皇冠/金色¥微微发光 + 画面暗角，营造围炉灯火气(画质设置可关,反馈①) */}
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
  // 渲染分辨率档位(反馈①):auto=像素预算自适应;low/medium/high 固定 dpr。R3F 对 dpr 热应用。
  const renderScale = useSettingsStore(s => s.renderScale);
  const dpr = renderScale === 'low' ? 0.75
    : renderScale === 'medium' ? 1.0
      : renderScale === 'high' ? Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5)
        : adaptiveDpr();

  useEffect(() => {
    const onMove = (e) => {
      look.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      look.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // 本地测试快捷键：B 补满真实测试玩家，V 切换当前操控的角色（单人玩全部角色），C 自由相机。
  useEffect(() => {
    if (!DEV) return undefined;
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const store = useGameStore.getState();
      if (e.key === 'b' || e.key === 'B') store.send({ type: 'dev_fill' });
      else if (e.key === 'c' || e.key === 'C') setFreeCam(v => !v);
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
      <Canvas
        shadows={!NO_SHADOW}
        dpr={dpr}
        camera={{ position: [0, EYE_Y, 3.0], fov: 58, near: 0.1, far: 100 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <SceneContents look={look} freeCam={freeCam} />
      </Canvas>
      {DEV && (
        <div className="dev-hud">测试模式 · B 补满玩家 · V 切换操控角色 · C 自由相机({freeCam ? '开' : '关'})</div>
      )}
    </div>
  );
}
