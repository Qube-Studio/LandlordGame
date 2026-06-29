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
import { decompose } from '../game/notes';
import MinecraftPlayer from './MinecraftPlayer';
import Coin from './Coin';
import { noteTexture } from './textures';
import { setProjector } from './projection';
import { expressionFor } from './expression';
import PixelText from '../assets/pixelfont/PixelText';

const TABLE_TOP = 1.0;
const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];

// 任务③：仅本地测试（import.meta.env.DEV）才暴露的辅助开关。
const DEV = import.meta.env.DEV;

// 对手座位（仅对手；自己≈相机视角，不建模）：{x,z} 桌外环绕，朝向桌心。
// 桌框约 ±3.5(x)/±2.2(z)，座位需留身体+手臂余量(~0.6)，否则人物会扎进桌子（穿模）。
const SEATS = {
  0: [],
  1: [{ x: 0, z: -3.0 }],
  2: [{ x: -2.8, z: -2.8 }, { x: 2.8, z: -2.8 }],
  3: [{ x: -4.1, z: -1.2 }, { x: 0, z: -3.0 }, { x: 4.1, z: -1.2 }],
  4: [{ x: -4.3, z: -0.9 }, { x: -2.1, z: -2.9 }, { x: 2.1, z: -2.9 }, { x: 4.3, z: -0.9 }],
};
const SELF_SEAT = { x: 0, z: 3.0 }; // 自由相机下渲染自己用的近端座位

function CameraRig({ look }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 1.05, 0));
  useFrame(() => {
    const mx = look.current.x, my = look.current.y;
    target.current.x += (mx * 1.6 - target.current.x) * 0.06;
    target.current.y += (1.15 - my * 0.8 - target.current.y) * 0.06;
    camera.position.x += (mx * 0.7 - camera.position.x) * 0.05;
    camera.position.y += (2.7 - my * 0.3 - camera.position.y) * 0.05;
    camera.lookAt(target.current);
  });
  return null;
}

function Table() {
  return (
    <group>
      {/* 桌面毡布：暖酒红毡（金色筹码/钱牌压在暗红上对比最佳） */}
      <mesh position={[0, TABLE_TOP - 0.06, 0]} receiveShadow>
        <boxGeometry args={[6.6, 0.12, 4.0]} />
        <meshStandardMaterial color="#7a4a3a" roughness={0.95} flatShading />
      </mesh>
      {/* 木框：暖橡木 */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[7.0, 0.34, 4.4]} />
        <meshStandardMaterial color="#5a3d26" roughness={1} flatShading />
      </mesh>
      {/* 桌腿 */}
      {[[-3.2, -1.9], [3.2, -1.9], [-3.2, 1.9], [3.2, 1.9]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]}>
          <boxGeometry args={[0.32, 0.8, 0.32]} />
          <meshStandardMaterial color="#412c1a" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// 双面钞票卡材质：+y(顶)=正面值，-y(底)=反面；正/反由 rotation.x（0 / π）决定。按面额缓存。
const CARD_W = 0.42, CARD_T = 0.05, CARD_D = 0.58;
const SELF_STACK = [0, 0, 1.5]; // 自己桌面钱堆的组原点
const CARD_MATS = new Map();
function cardMaterials(value) {
  if (CARD_MATS.has(value)) return CARD_MATS.get(value);
  const face = new THREE.MeshStandardMaterial({ map: noteTexture({ value }), roughness: 0.85, flatShading: true });
  const back = new THREE.MeshStandardMaterial({ map: noteTexture({ faceDown: true }), roughness: 0.85, flatShading: true });
  const edge = new THREE.MeshStandardMaterial({ color: '#d9c9a0', roughness: 1, flatShading: true });
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
        <Html position={[0, topY + 0.3, 0]} center distanceFactor={11} zIndexRange={[20, 0]}>
          <div className="money-3d-amount"><PixelText size={2} color="#e2c044">{`¥${amount}`}</PixelText></div>
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
    // 正面朝相机(≈1.15) → 反面朝上(π)；附带轻微自旋与摆动
    m.rotation.set(1.15 + (Math.PI - 1.15) * e, item.yaw * e + e * 0.6, Math.sin(t * Math.PI * 2) * (1 - t) * 0.3);
    if (t >= 1 && !done.current) { done.current = true; onDone(); }
  });
  return (
    <mesh ref={ref} material={cardMaterials(item.value)} castShadow>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

function FlyingNotes({ betFlight }) {
  const { camera, size } = useThree();
  const finalize = useGameStore(s => s.finalizeBetFlight);
  const startRef = useRef(null);
  const doneCount = useRef(0);

  useEffect(() => { startRef.current = null; doneCount.current = 0; }, [betFlight]);

  const items = useMemo(() => betFlight.items.map((it, i) => {
    const ndcX = (it.fromScreen.x / size.width) * 2 - 1;
    const ndcY = -(it.fromScreen.y / size.height) * 2 + 1;
    const s = new THREE.Vector3(ndcX, ndcY, 0.86).unproject(camera);   // 手牌屏幕点→世界
    const lp = cardLocal(i);
    const end = new THREE.Vector3(SELF_STACK[0] + lp[0], lp[1], SELF_STACK[2] + lp[2]);
    const c = new THREE.Vector3((s.x + end.x) / 2, Math.max(s.y, end.y) + 1.3, (s.z + end.z) / 2); // 弧顶
    return { id: it.id, value: it.value, s, end, c, yaw: cardYaw(i) };
  }), [betFlight, camera, size]);

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
  useHeadReport(look);

  const players = state.players;
  const meIdx = Math.max(0, players.findIndex(p => p.id === playerId));
  const opponents = [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];
  const layout = SEATS[Math.min(opponents.length, 4)] ?? [];
  const me = players.find(p => p.id === playerId);

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
      {/* 暖光酒馆：暖棕背景 + 远雾把墙根融进暖色，消灭黑虚空 */}
      <color attach="background" args={['#2a1d14']} />
      <fog attach="fog" args={['#3a2817', 8, 28]} />
      {/* 三点暖光：压低环境染暖 + 暖金主光(投影) + 冷补光提暗部 + 暖白逆光勾边 + 桌心吊灯热点 */}
      <ambientLight intensity={0.36} color="#5a4636" />
      <directionalLight
        position={[5, 8.5, 4]} intensity={1.5} color="#ffcf8a"
        castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1} shadow-camera-far={30}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-6, 4, -5]} intensity={0.4} color="#6f86b8" />
      <directionalLight position={[0, 6, -7]} intensity={0.55} color="#ffe6c0" />
      <pointLight position={[0, 4.2, 0]} intensity={20} distance={11} decay={2} color="#ffd28a" />

      {/* 地面：暖木地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#3d2c1c" roughness={1} />
      </mesh>

      <Table />
      {/* 柔和接触阴影：把角色/桌腿"坐落"在地上，体量感的关键 */}
      <ContactShadows position={[0, 0.02, 0]} scale={18} blur={2.6} opacity={0.5} far={4.5} color="#1c0f06" />

      {/* 远景：角落炉火微光(动机光，推进暖雾里) + 暗色家具剪影，去掉空旷感 */}
      <mesh position={[-7.0, 0.4, -8.8]}>
        <boxGeometry args={[1.0, 0.7, 0.4]} />
        <meshStandardMaterial color="#3a2414" emissive="#ff7a2a" emissiveIntensity={0.6} roughness={1} flatShading />
      </mesh>
      <pointLight position={[-6.2, 0.9, -7.8]} intensity={5} distance={8} decay={2} color="#ff8a3a" />
      {[[-8.2, -3.5, 1.3, 1.6], [8.0, -4.0, 1.4, 1.4], [-8.6, 3.0, 1.2, 1.2], [8.4, 2.2, 1.3, 1.8]].map(([x, z, w, h], i) => (
        <mesh key={`far${i}`} position={[x, h / 2, z]}>
          <boxGeometry args={[w, h, w]} />
          <meshStandardMaterial color="#2e2014" roughness={1} flatShading />
        </mesh>
      ))}
      {freeCam ? <OrbitControls target={[0, 1.05, 0]} makeDefault /> : <CameraRig look={look} />}
      <Projector />

      {/* 对手 */}
      {opponents.map((p, i) => {
        const seat = layout[i];
        if (!seat) return null;
        const ry = Math.atan2(-seat.x, -seat.z);
        return (
          <group key={p.id} position={[seat.x, 0, seat.z]} rotation={[0, ry, 0]}>
            <MinecraftPlayer player={p} expression={expressionFor(p, state)} seed={i * 1.7} look={looks[p.id]} />
          </group>
        );
      })}

      {/* 自由相机下额外渲染自己（正常视角里自己≈相机，不建模） */}
      {freeCam && me && (
        <group position={[SELF_SEAT.x, 0, SELF_SEAT.z]} rotation={[0, Math.atan2(-SELF_SEAT.x, -SELF_SEAT.z), 0]}>
          <MinecraftPlayer player={me} expression={expressionFor(me, state)} seed={7} />
        </group>
      )}

      {/* 对手桌面钱堆 */}
      {opponents.map((p, i) => {
        const seat = layout[i];
        if (!seat || !p.hasBet) return null;
        return (
          <MoneyStack
            key={`m-${p.id}`}
            notes={betsVisible ? decompose(p.bet) : blankNotes(p.betCount)}
            amount={betsVisible ? p.bet : null}
            faceUp={betsVisible}
            position={[seat.x * 0.42, 0, seat.z * 0.42 + 0.1]}
          />
        );
      })}

      {/* 下注飞行中的牌（手牌→桌面，弧线落位） */}
      {flightActive && <FlyingNotes betFlight={betFlight} />}

      {/* 自己桌面钱堆（近边）：飞行中隐藏，落定后即飞出去那批牌 */}
      {me?.hasBet && !flightActive && (selfNotes?.length || selfBetCount > 0) && (
        <MoneyStack notes={selfNotes ?? []} amount={selfBet} faceUp={betsVisible} position={SELF_STACK} />
      )}

      {/* 硬币 */}
      {showFlip && (
        <Coin key={`flip-${state.round}`} mode="flip" result={state.coinResult ?? 'heads'} tableTop={TABLE_TOP} />
      )}
      {showRest && <Coin key={`rest-${state.round}`} mode="rest" result={state.coinResult} tableTop={TABLE_TOP} />}

      {/* 后处理：吊灯/金皇冠/金色¥微微发光 + 画面暗角，营造围炉灯火气 */}
      <EffectComposer disableNormalPass>
        <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  );
}

export default function Scene3D() {
  const look = useRef({ x: 0, y: 0 });
  const [freeCam, setFreeCam] = useState(false);

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
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2.7, 6.4], fov: 50, near: 0.1, far: 100 }}
        gl={{ antialias: false }}
      >
        <SceneContents look={look} freeCam={freeCam} />
      </Canvas>
      {DEV && (
        <div className="dev-hud">测试模式 · B 补满玩家 · V 切换操控角色 · C 自由相机({freeCam ? '开' : '关'})</div>
      )}
    </div>
  );
}
