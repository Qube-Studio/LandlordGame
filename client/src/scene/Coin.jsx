// 硬币：低面数圆柱 + 像素贴图（像素感圆形，任务 2）。
// mode='flip'：从预烘焙动画池取一条匹配服务端 result 的轨迹回放（任务 1）——空中明显自旋、
// 落地多次弹跳、沿边缘倒平落定，全程不穿桌（碰撞下界见 coinSim.js）。
// mode='rest'：平放展示最终朝面。
// useFrame 内逐帧改写材质发光强度是 r3f 既定用法(与 Scene3D 同款豁免)。
/* eslint-disable react-hooks/immutability */
import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { coinFaceTexture, coinEdgeTexture } from './textures';
import { pickFlip, restTransform, setCoinRest, getCoinRest, COIN_R, COIN_H, COIN_SEGMENTS } from './coinSim';
import { PROP_COLORS } from '../assets/palette';

export default function Coin({ result = 'heads', mode = 'flip', tableTop = 1.0 }) {
  const ref = useRef();
  const rest = tableTop + COIN_H; // 平放时圆心高度（最低点恰好贴桌面）
  const startRef = useRef(null);
  const restStartRef = useRef(null); // rest 出现时刻：用于一次性金光脉冲

  const mats = useMemo(() => {
    // 全剧最亮道具(ART_BIBLE §1.6):暖金属 + 常驻微 emissive(0.25 基线,翻飞金闪被 Bloom 捕获)
    // + 落定时一次性金光脉冲。侧壁贴 reeded 直齿纹。
    const e = { emissive: PROP_COLORS.coinGlow, emissiveIntensity: 0.25 };
    const side = new THREE.MeshStandardMaterial({ map: coinEdgeTexture(), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    const top = new THREE.MeshStandardMaterial({ map: coinFaceTexture('heads'), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    const bottom = new THREE.MeshStandardMaterial({ map: coinFaceTexture('tails'), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    return [side, top, bottom];
  }, []);

  // flip 模式：组件按 round 重挂，useMemo 每次随机取一条匹配 result 的已烘焙动画。
  const anim = useMemo(() => (mode === 'flip' ? pickFlip(result, tableTop) : null), [mode, result, tableTop]);

  // 在「已提交渲染」里发布本次回放的落定变换（而非在 pickFlip 内副作用）——
  // 保证 rest 硬币读到的落点与实际回放的轨迹完全一致；StrictMode 双调用 useMemo 也不会错位。
  useLayoutEffect(() => {
    if (mode === 'flip' && anim) setCoinRest(restTransform(anim));
  }, [mode, anim]);

  useFrame((st) => {
    const c = ref.current;
    if (!c) return;

    if (mode === 'rest' || !anim) {
      // 静置硬币出现在 flip 的落定处（位置 + 偏航），与抛掷收尾无缝衔接，不再归位到桌心。
      const r = getCoinRest();
      c.position.set(r ? r.x : 0, rest + Math.sin(st.clock.elapsedTime * 2) * 0.01, r ? r.z : 0);
      c.rotation.set(result === 'heads' ? 0 : Math.PI, r ? r.ry : 0, 0);
      // 落定瞬间一次性金光脉冲（基线→峰→基线，约 0.45s），配 Bloom 出"叮"一亮
      // (emissive 换成了深金 coinGlow,峰值系数相应加大)
      if (restStartRef.current == null) restStartRef.current = st.clock.elapsedTime;
      const rt = st.clock.elapsedTime - restStartRef.current;
      const glow = rt < 0.45 ? Math.sin((rt / 0.45) * Math.PI) * 3.2 : 0;
      for (const m of mats) m.emissiveIntensity = 0.25 + glow;
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
    // mirror 翻转水平漂移、yaw 绕竖轴整体偏航：均不改变朝上的面，仅为每次回放增加视觉多样性。
    c.position.set(lerp(a.p[0], b.p[0]) * anim.mirror, lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2]));
    c.rotation.set(lerp(a.r[0], b.r[0]), lerp(a.r[1], b.r[1]) + anim.yaw, lerp(a.r[2], b.r[2]));
  });

  return (
    <mesh ref={ref} position={[0, rest, 0]} material={mats} castShadow>
      <cylinderGeometry args={[COIN_R, COIN_R, COIN_H * 2, COIN_SEGMENTS]} />
    </mesh>
  );
}
