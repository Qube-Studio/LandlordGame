// 硬币：低面数圆柱 + 像素贴图（像素感圆形，任务 2）。
// mode='flip'：从预烘焙动画池取一条匹配服务端 result 的轨迹回放（任务 1）——空中明显自旋、
// 落地多次弹跳、沿边缘倒平落定，全程不穿桌（碰撞下界见 coinSim.js）。
// mode='rest'：平放展示最终朝面。
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { coinFaceTexture } from './textures';
import { pickFlip, COIN_R, COIN_H, COIN_SEGMENTS } from './coinSim';

export default function Coin({ result = 'heads', mode = 'flip', tableTop = 1.0 }) {
  const ref = useRef();
  const rest = tableTop + COIN_H; // 平放时圆心高度（最低点恰好贴桌面）
  const startRef = useRef(null);

  const mats = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: '#a89058', roughness: 0.55, metalness: 0.35, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ map: coinFaceTexture('heads'), roughness: 0.45, metalness: 0.25, flatShading: true });
    const bottom = new THREE.MeshStandardMaterial({ map: coinFaceTexture('tails'), roughness: 0.45, metalness: 0.25, flatShading: true });
    return [side, top, bottom];
  }, []);

  // flip 模式：组件按 round 重挂，useMemo 每次随机取一条匹配 result 的已烘焙动画。
  const anim = useMemo(() => (mode === 'flip' ? pickFlip(result, tableTop) : null), [mode, result, tableTop]);

  useFrame((st) => {
    const c = ref.current;
    if (!c) return;

    if (mode === 'rest' || !anim) {
      c.position.set(0, rest + Math.sin(st.clock.elapsedTime * 2) * 0.01, 0);
      c.rotation.set(result === 'heads' ? 0 : Math.PI, 0, 0);
      return;
    }

    if (startRef.current == null) startRef.current = st.clock.elapsedTime;
    const t = st.clock.elapsedTime - startRef.current;
    const { frames, dt } = anim;
    const fpos = t / dt;
    const i0 = Math.min(frames.length - 1, Math.max(0, Math.floor(fpos)));
    const i1 = Math.min(frames.length - 1, i0 + 1);
    const f = fpos - i0;
    const a = frames[i0], b = frames[i1];
    const lerp = (u, v) => u + (v - u) * f;
    c.position.set(lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2]));
    c.rotation.set(lerp(a.r[0], b.r[0]), lerp(a.r[1], b.r[1]), lerp(a.r[2], b.r[2]));
  });

  return (
    <mesh ref={ref} position={[0, rest, 0]} material={mats} castShadow>
      <cylinderGeometry args={[COIN_R, COIN_R, COIN_H * 2, COIN_SEGMENTS]} />
    </mesh>
  );
}
