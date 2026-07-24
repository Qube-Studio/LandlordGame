// 登录页吉祥物(反馈⑪,用户澄清主界面=登录页):招牌右侧一块约 300×380 的独立小 Canvas。
// - 角色直接复用 PlayerModel:默认体素人,?art=box 回退旧盒子人,与桌边角色保持同源。
//   挂载时从 ROLE_CLOTH 随机抽一个角色(none 除外)。
// - 待机动画由角色真身负责;头部跟随窗口鼠标(yaw 钳 ±0.55 / pitch 钳 ±0.25)。
// - 点击:命中点爆一簇小范围像素粒子(金/火星色,0.7s 自卸载;写法参考 Scene3D 的 CoinBurst)。
// - prefers-reduced-motion:静止(demand 渲染一帧)+ 无粒子。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { P, ROLE_CLOTH } from '../assets/palette';
import PlayerModel from './PlayerModel';

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 点击粒子:十几颗 Points 从命中点小范围炸开(轻抛物线 + 渐隐),0.7s 自卸载
const BURST_N = 14;
const BURST_LIFE = 0.7;
function PixelBurst({ pos, onDone }) {
  const pts = useRef();
  const t0 = useRef(null);
  const { positions, colors, vels } = useMemo(() => {
    const positions = new Float32Array(BURST_N * 3);
    const colors = new Float32Array(BURST_N * 3);
    const gold = new THREE.Color(P.brassHi);
    const spark = new THREE.Color(P.ember);
    const vels = [];
    for (let i = 0; i < BURST_N; i++) {
      const a = (i / BURST_N) * Math.PI * 2;
      vels.push([
        Math.cos(a) * (0.3 + (i % 3) * 0.14),
        0.5 + (i % 4) * 0.2,
        0.22 + Math.abs(Math.sin(a)) * (0.16 + ((i + 1) % 3) * 0.08), // 火星全部向镜头外溅,不钻进身体被挡
      ]);
      positions[i * 3] = pos[0]; positions[i * 3 + 1] = pos[1]; positions[i * 3 + 2] = pos[2];
      const c = i % 2 ? spark : gold;
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    return { positions, colors, vels };
  }, [pos]);
  useFrame((st) => {
    if (t0.current == null) t0.current = st.clock.elapsedTime;
    const t = st.clock.elapsedTime - t0.current;
    if (t > BURST_LIFE) { onDone(); return; }
    const g = pts.current;
    if (!g) return;
    const arr = g.geometry.attributes.position.array;
    for (let i = 0; i < BURST_N; i++) {
      arr[i * 3] = pos[0] + vels[i][0] * t;
      arr[i * 3 + 1] = pos[1] + vels[i][1] * t - 2.4 * t * t; // 重力衰减,物理感
      arr[i * 3 + 2] = pos[2] + vels[i][2] * t;
    }
    g.geometry.attributes.position.needsUpdate = true;
    g.material.opacity = 1 - t / BURST_LIFE;
  });
  return (
    <points ref={pts}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={0.09} transparent opacity={1} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function MascotActor({ role, look, onPoke }) {
  const setCursor = (c) => { document.body.style.cursor = c; };
  return (
    <group
      rotation={[0, -0.35, 0]}
      onPointerDown={onPoke}
      onPointerOver={(e) => { e.stopPropagation(); setCursor('pointer'); }}
      onPointerOut={() => setCursor('')}
    >
      <PlayerModel
        player={{ id: 'mascot', name: '', role, bankrupt: false, online: true }}
        expression="idle"
        look={look}
        label=""
      />
    </group>
  );
}

function MascotScene({ look }) {
  const [role] = useState(() => {
    const keys = Object.keys(ROLE_CLOTH).filter((k) => k !== 'none');
    return keys[Math.floor(Math.random() * keys.length)];
  });
  const [bursts, setBursts] = useState([]);
  const nextId = useRef(0);
  const poke = (e) => {
    e.stopPropagation();
    if (REDUCED) return;
    const id = ++nextId.current;
    setBursts((b) => [...b.slice(-2), { id, pos: [e.point.x, e.point.y, e.point.z + 0.05] }]);
  };
  return (
    <>
      {/* 暖色双灯,与酒馆一致:环境 + 一盏平行光 */}
      <ambientLight intensity={0.55} color={P.candle} />
      <directionalLight position={[1.6, 2.6, 2.2]} intensity={1.6} color={P.key} />
      <MascotActor role={role} look={look} onPoke={poke} />
      {bursts.map((b) => (
        <PixelBurst key={b.id} pos={b.pos} onDone={() => setBursts((s) => s.filter((x) => x.id !== b.id))} />
      ))}
    </>
  );
}

export default function LobbyMascot() {
  const wrapRef = useRef(null);
  const look = useMemo(() => ({ yaw: 0.35, pitch: 0 }), []);
  const dpr = useMemo(() => Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5), []);

  useEffect(() => {
    if (REDUCED) return undefined;
    const onMove = (e) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 相对画布自身半宽/半高归一（分子分母同处视觉空间 → 舞台缩放/留黑边下尺度无关，倾摆手感恒定）
      const mx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1);
      const my = (e.clientY - (r.top + r.height * 0.35)) / (r.height / 2 || 1);
      look.yaw = clamp(0.35 + mx * 0.9, -0.55, 0.55);
      look.pitch = clamp(my * 0.35, -0.25, 0.25);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [look]);

  return (
    <div ref={wrapRef} className="lobby-mascot">
      <Canvas
        dpr={dpr}
        frameloop={REDUCED ? 'demand' : 'always'}
        resize={{ offsetSize: true }} /* app-stage 舞台下量布局尺寸,避免视觉 rect 被二次缩放（同 Scene3D） */
        camera={{ position: [0, 1.45, 2.6], fov: 34, near: 0.1, far: 10 }}
        gl={{ antialias: false, powerPreference: 'low-power' }}
        onCreated={({ camera }) => camera.lookAt(0, 1.3, 0)}
      >
        <MascotScene look={look} />
      </Canvas>
    </div>
  );
}
