// 登录页吉祥物(反馈⑪,用户澄清主界面=登录页):招牌右侧一块约 300×380 的独立小 Canvas,里面站一个半身方块人。
// - 盒子尺寸与 FACE_ORDER 六面材质组装法对齐 scene/MinecraftPlayer.jsx(只读参考,不复用其组件);
//   皮肤纹理单一真源:texlib.skinTex。挂载时从 ROLE_CLOTH 随机抽一个角色(none 除外)。
// - 呼吸:身体组 y 位移 + 极轻 scaleY 正弦(~1.6);头部阻尼跟随窗口鼠标(yaw 钳 ±0.55 / pitch 钳 ±0.25)。
// - 点击:命中点爆一簇小范围像素粒子(金/火星色,0.7s 自卸载;写法参考 Scene3D 的 CoinBurst)。
// - prefers-reduced-motion:静止(demand 渲染一帧)+ 无粒子。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { P, ROLE_CLOTH } from '../assets/palette';
import { skinTex } from '../assets/texlib';

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// box 面序:[+x右, -x左, +y顶, -y底, +z前, -z后](与 MinecraftPlayer 一致)
const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'];
const MAT_CACHE = new Map();
function partMats(role, part) {
  const key = `${role}|${part}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const arr = FACE_ORDER.map((face) => new THREE.MeshStandardMaterial({
    map: skinTex({ role, part, face }),
    roughness: 1, flatShading: true,
  }));
  MAT_CACHE.set(key, arr);
  return arr;
}

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

// 半身像:身体/双臂/头(腰以下出画,不渲染腿);整体略侧对镜头
function Bust({ role, mouse, onPoke }) {
  const breath = useRef();
  const head = useRef();
  const lArm = useRef();
  const rArm = useRef();
  const headMats = useMemo(() => partMats(role, 'head'), [role]);
  const bodyMats = useMemo(() => partMats(role, 'body'), [role]);
  const armMats = useMemo(() => partMats(role, 'arm'), [role]);
  const legMats = useMemo(() => partMats(role, 'leg'), [role]);

  useFrame((st, dt) => {
    if (REDUCED) return;
    const t = st.clock.elapsedTime;
    if (breath.current) {
      const b = Math.sin(t * 1.6); // 呼吸:y 位移 + 极轻 scaleY
      breath.current.position.y = b * 0.015;
      breath.current.scale.y = 1 + b * 0.008;
    }
    if (head.current) {
      // 看向鼠标:+0.35 抵消身体侧转,鼠标居中时正对观者;阻尼跟随
      const ty = clamp(0.35 + mouse.current[0] * 0.9, -0.55, 0.55);
      const tp = clamp(mouse.current[1] * 0.35, -0.25, 0.25);
      const k = Math.min(1, dt * 6);
      head.current.rotation.y += (ty - head.current.rotation.y) * k;
      head.current.rotation.x += (tp - head.current.rotation.x) * k;
    }
    // 手臂极轻待机摆动(比场内角色收敛)
    const swing = Math.sin(t * 1.8) * 0.06;
    if (lArm.current) lArm.current.rotation.x += (swing - lArm.current.rotation.x) * 0.25;
    if (rArm.current) rArm.current.rotation.x += (-swing - rArm.current.rotation.x) * 0.25;
  });

  const setCursor = (c) => { document.body.style.cursor = c; };
  return (
    <group
      rotation={[0, -0.35, 0]}
      onPointerDown={onPoke}
      onPointerOver={(e) => { e.stopPropagation(); setCursor('pointer'); }}
      onPointerOut={() => setCursor('')}
    >
      {/* 腿(静态,只为让底部裁切落在几何上,不见悬空切面;腰以下被底框裁掉) */}
      <mesh position={[-0.14, 0.35, 0]} material={legMats}><boxGeometry args={[0.26, 0.7, 0.26]} /></mesh>
      <mesh position={[0.14, 0.35, 0]} material={legMats}><boxGeometry args={[0.26, 0.7, 0.26]} /></mesh>
      <group ref={breath}>
        <mesh position={[0, 1.05, 0]} material={bodyMats}><boxGeometry args={[0.6, 0.7, 0.3]} /></mesh>
        <group ref={lArm} position={[-0.41, 1.4, 0]}>
          <mesh position={[0, -0.35, 0]} material={armMats}><boxGeometry args={[0.22, 0.7, 0.26]} /></mesh>
        </group>
        <group ref={rArm} position={[0.41, 1.4, 0]}>
          <mesh position={[0, -0.35, 0]} material={armMats}><boxGeometry args={[0.22, 0.7, 0.26]} /></mesh>
        </group>
        <group ref={head} position={[0, 1.675, 0]}>
          <mesh material={headMats}><boxGeometry args={[0.55, 0.55, 0.55]} /></mesh>
        </group>
      </group>
    </group>
  );
}

function MascotScene({ mouse }) {
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
      <Bust role={role} mouse={mouse} onPoke={poke} />
      {bursts.map((b) => (
        <PixelBurst key={b.id} pos={b.pos} onDone={() => setBursts((s) => s.filter((x) => x.id !== b.id))} />
      ))}
    </>
  );
}

export default function LobbyMascot() {
  const wrapRef = useRef(null);
  const mouse = useRef([0, 0]); // 相对本画布中心的窗口归一化坐标
  const dpr = useMemo(() => Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5), []);

  useEffect(() => {
    if (REDUCED) return undefined;
    const onMove = (e) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      mouse.current[0] = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      mouse.current[1] = (e.clientY - (r.top + r.height * 0.35)) / (window.innerHeight / 2);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div ref={wrapRef} className="lobby-mascot">
      <Canvas
        dpr={dpr}
        frameloop={REDUCED ? 'demand' : 'always'}
        camera={{ position: [0, 1.45, 2.6], fov: 34, near: 0.1, far: 10 }}
        gl={{ antialias: false, powerPreference: 'low-power' }}
        onCreated={({ camera }) => camera.lookAt(0, 1.3, 0)}
      >
        <MascotScene mouse={mouse} />
      </Canvas>
    </div>
  );
}
