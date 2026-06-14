// 真 3D 场景层（react-three-fiber）：赌桌 + 围桌而立的方块人 + 桌面钱堆 + 单独建模的硬币。
// 相机随鼠标小幅转动视角（带阻尼回中）。只读 store，无任何游戏逻辑。
// useFrame 内逐帧改写相机是 r3f 既定用法，关闭对应的不可变性规则。
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { decompose } from '../game/notes';
import MinecraftPlayer from './MinecraftPlayer';
import Coin from './Coin';
import { noteTexture } from './textures';
import { setProjector } from './projection';
import PixelText from '../assets/pixelfont/PixelText';

const TABLE_TOP = 1.0;
const PAYOUT_PHASES = ['SETTLE', 'NEGOTIATE', 'FINALIZE'];

// 对手座位（仅对手；自己≈相机视角，不建模）：{x,z} 桌外环绕，朝向桌心
const SEATS = {
  0: [],
  1: [{ x: 0, z: -2.8 }],
  2: [{ x: -2.2, z: -2.6 }, { x: 2.2, z: -2.6 }],
  3: [{ x: -3.4, z: -1.0 }, { x: 0, z: -2.8 }, { x: 3.4, z: -1.0 }],
  4: [{ x: -3.6, z: -0.4 }, { x: -1.7, z: -2.7 }, { x: 1.7, z: -2.7 }, { x: 3.6, z: -0.4 }],
};

function expressionFor(p, state) {
  if (p.bankrupt) return 'bankrupt';
  if (state.phase === 'DISCUSSION') return p.ready ? 'ready' : 'idle';
  if (state.phase === 'BETTING' || state.phase === 'REVEAL') return p.hasBet ? 'bet' : 'idle';
  if (PAYOUT_PHASES.includes(state.phase) && state.coinResult) {
    const farmersWin = state.coinResult === 'tails';
    if (p.role === 'farmer') return farmersWin ? 'win' : 'lose';
    if (p.role === 'landlord') return farmersWin ? 'lose' : 'win';
  }
  if (state.phase === 'ENDED' && state.winnerSide) {
    const won = (state.winnerSide === 'farmers') === (p.role === 'farmer');
    return won ? 'win' : 'lose';
  }
  return 'idle';
}

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
      {/* 桌面毡布 */}
      <mesh position={[0, TABLE_TOP - 0.06, 0]} receiveShadow>
        <boxGeometry args={[6.6, 0.12, 4.0]} />
        <meshStandardMaterial color="#2c6b3f" roughness={1} flatShading />
      </mesh>
      {/* 木框 */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[7.0, 0.34, 4.4]} />
        <meshStandardMaterial color="#3a2a18" roughness={1} flatShading />
      </mesh>
      {/* 桌腿 */}
      {[[-3.2, -1.9], [3.2, -1.9], [-3.2, 1.9], [3.2, 1.9]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]}>
          <boxGeometry args={[0.32, 0.8, 0.32]} />
          <meshStandardMaterial color="#2c2014" roughness={1} flatShading />
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
// 单张牌在钱堆内的局部坐标/偏转（飞行落点与静态钱堆共用，保证无缝接力）
const cardLocal = (i) => [((i % 3) - 1) * 0.05, TABLE_TOP + 0.03 + i * 0.02, Math.sin(i * 1.7) * 0.05];
const cardYaw = (i) => ((i * 37) % 30 - 15) * Math.PI / 180;

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

function MoneyStack({ notes, faceUp, position, label }) {
  const shown = notes.slice(0, 12);
  const topY = TABLE_TOP + 0.03 + shown.length * 0.02;
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
      {faceUp && label != null && (
        <Html position={[0, topY + 0.3, 0]} center distanceFactor={11} zIndexRange={[20, 0]}>
          <div className="money-3d-amount"><PixelText size={2} color="#e2c044">{`¥${label}`}</PixelText></div>
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

function SceneContents({ look }) {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const betFlight = useGameStore(s => s.betFlight);
  const myStack = useGameStore(s => s.myStack);

  const players = state.players;
  const meIdx = Math.max(0, players.findIndex(p => p.id === playerId));
  const opponents = [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];
  const layout = SEATS[Math.min(opponents.length, 4)] ?? [];
  const me = players.find(p => p.id === playerId);

  const betsVisible = !['LOBBY', 'DISCUSSION', 'BETTING'].includes(state.phase);
  const showFlip = state.phase === 'COIN_FLIP';
  const showRest = PAYOUT_PHASES.includes(state.phase) && state.coinResult;

  // 自己钱堆：飞行中先不渲染静态堆（由 FlyingNotes 接管）；落定后用 myStack（即飞出去那批牌）
  const flightActive = betFlight && betFlight.round === state.round;
  const selfNotes = (myStack && myStack.round === state.round)
    ? myStack.notes
    : (me?.bet != null ? decompose(me.bet) : null);
  const selfBet = state.me?.bet ?? me?.bet ?? null;

  return (
    <>
      <color attach="background" args={['#0a0b0f']} />
      <fog attach="fog" args={['#0a0b0f', 9, 20]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 9, 6]} intensity={1.0} castShadow />
      <pointLight position={[0, 4, 0]} intensity={18} distance={12} color="#ffe9b0" />

      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#14161c" roughness={1} />
      </mesh>

      <Table />
      <CameraRig look={look} />
      <Projector />

      {/* 对手 */}
      {opponents.map((p, i) => {
        const seat = layout[i];
        if (!seat) return null;
        const ry = Math.atan2(-seat.x, -seat.z);
        return (
          <group key={p.id} position={[seat.x, 0, seat.z]} rotation={[0, ry, 0]}>
            <MinecraftPlayer player={p} expression={expressionFor(p, state)} seed={i * 1.7} />
          </group>
        );
      })}

      {/* 对手桌面钱堆 */}
      {opponents.map((p, i) => {
        const seat = layout[i];
        if (!seat || !p.hasBet) return null;
        return (
          <MoneyStack
            key={`m-${p.id}`}
            notes={betsVisible ? decompose(p.bet) : decompose(2)}
            faceUp={betsVisible}
            label={betsVisible ? p.bet : null}
            position={[seat.x * 0.42, 0, seat.z * 0.42 + 0.1]}
          />
        );
      })}

      {/* 下注飞行中的牌（手牌→桌面，弧线落位） */}
      {flightActive && <FlyingNotes betFlight={betFlight} />}

      {/* 自己桌面钱堆（近边）：飞行中隐藏，落定后即飞出去那批牌 */}
      {me?.hasBet && !flightActive && selfNotes && (
        <MoneyStack notes={selfNotes} faceUp={betsVisible} label={betsVisible ? selfBet : null} position={SELF_STACK} />
      )}

      {/* 硬币 */}
      {showFlip && (
        <Coin key={`flip-${state.round}`} mode="flip" result={state.coinResult ?? 'heads'} durationMs={state.config.timing.coinAnimMs} tableTop={TABLE_TOP} />
      )}
      {showRest && <Coin key={`rest-${state.round}`} mode="rest" result={state.coinResult} tableTop={TABLE_TOP} />}
    </>
  );
}

export default function Scene3D() {
  const look = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e) => {
      look.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      look.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <div className="r3f-scene">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2.7, 6.4], fov: 50, near: 0.1, far: 100 }}
        gl={{ antialias: false }}
      >
        <SceneContents look={look} />
      </Canvas>
    </div>
  );
}
