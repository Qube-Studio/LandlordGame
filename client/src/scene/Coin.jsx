// 硬币：低面数圆柱 + 像素贴图（像素感圆形）。真实尺寸 Ø5cm×6mm（coinSim 常量）。
// mode='flip'：回放 coinSim **每掷实时模拟**的 3D 刚体轨迹（位置 lerp + 姿态 slerp）——
// 空中翻转、落地弹跳、缘立进动颤摆到躺平,全程真实物理（细节见 coinSim.js 头注释）。
// mode='rest'：平放展示最终朝面。
// useFrame 内逐帧改写材质发光强度是 r3f 既定用法(与 Scene3D 同款豁免)。
/* eslint-disable react-hooks/immutability */
import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { coinFaceTexture, coinEdgeTexture } from './textures';
import { pickFlip, restTransform, setCoinRest, getCoinRest, setCoinFlightLive, consumeCoinPulse, COIN_R, COIN_H, COIN_SEGMENTS } from './coinSim';
import { useGameStore } from '../store/gameStore';
import { PROP_COLORS } from '../assets/palette';

const _wp = new THREE.Vector3(); // 每帧发布世界位姿用的临时向量（硬币在旋转组内,分镜相机要世界系）
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(); // 帧间 slerp 临时四元数（零分配）

export default function Coin({ result = 'heads', mode = 'flip', tableTop = 1.0 }) {
  const ref = useRef();
  const rest = tableTop + COIN_H; // 平放时圆心高度（最低点恰好贴桌面）
  const startRef = useRef(null);
  const restStartRef = useRef(null); // 金光脉冲起始时刻（flip 躺平后/rest 均可能承接）
  const firstRef = useRef(null);     // rest 首帧标记：无分镜在播时沿用旧行为挂载即闪

  const mats = useMemo(() => {
    // 全剧最亮道具(ART_BIBLE §1.6):暖金属 + 常驻微 emissive(0.25 基线,翻飞金闪被 Bloom 捕获)
    // + 落定时一次性金光脉冲。侧壁贴 reeded 直齿纹。
    const e = { emissive: PROP_COLORS.coinGlow, emissiveIntensity: 0.25 };
    const side = new THREE.MeshStandardMaterial({ map: coinEdgeTexture(), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    const top = new THREE.MeshStandardMaterial({ map: coinFaceTexture('heads'), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    const bottom = new THREE.MeshStandardMaterial({ map: coinFaceTexture('tails'), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    return [side, top, bottom];
  }, []);

  // flip 模式：组件按 round 重挂，useMemo 每次**现场实时模拟**一条匹配 result 的全新轨迹。
  const anim = useMemo(() => (mode === 'flip' ? pickFlip(result, tableTop) : null), [mode, result, tableTop]);

  // 在「已提交渲染」里发布本次回放的落定变换（而非在 pickFlip 内副作用）——
  // 保证 rest 硬币读到的落点与实际回放的轨迹完全一致；StrictMode 双调用 useMemo 也不会错位。
  useLayoutEffect(() => {
    if (mode === 'flip' && anim) setCoinRest(restTransform(anim));
  }, [mode, anim]);

  // 分镜相机实时通道：flip 期间每帧发布世界位姿（见 useFrame 末尾）,卸载即清空。
  useLayoutEffect(() => {
    if (mode !== 'flip') return undefined;
    return () => setCoinFlightLive(null);
  }, [mode]);

  useFrame((st) => {
    const c = ref.current;
    if (!c) return;

    if (mode === 'rest' || !anim) {
      // 静置硬币出现在 flip 的落定处（位置 + 偏航），与抛掷收尾无缝衔接，不再归位到桌心。
      const r = getCoinRest();
      c.position.set(r ? r.x : 0, rest + Math.sin(st.clock.elapsedTime * 2) * 0.002, r ? r.z : 0);
      c.rotation.set(result === 'heads' ? 0 : Math.PI, r ? r.ry : 0, 0);
      // 一次性金光脉冲（基线→峰→基线，约 0.45s），配 Bloom 出"叮"一亮。
      // 正常分镜路径里脉冲已在揭示镜由 flip 硬币播过（CineRig 点火）——这里不重播；
      // 首帧若无分镜在播（单人/减动效/直入结算的冷挂载）→ 沿用旧行为挂载即闪；
      // 分镜极晚落定（揭示镜晚于相位切换、flip 已卸载）→ 这里接棒消费点火请求。
      if (firstRef.current == null) {
        firstRef.current = true;
        if (useGameStore.getState().cine === 'off') restStartRef.current = st.clock.elapsedTime;
      }
      if (restStartRef.current == null && consumeCoinPulse()) restStartRef.current = st.clock.elapsedTime;
      const rt = restStartRef.current == null ? 9 : st.clock.elapsedTime - restStartRef.current;
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
    // 位置帧间线性插值 + 姿态帧间 slerp（每掷实时模拟,无需再叠偏航/镜像多样性）
    c.position.set(lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2]));
    _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    _qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    c.quaternion.slerpQuaternions(_qa, _qb, f);
    // 发布世界位姿 + 时间轴给分镜相机（§3.4 演出）：restAt=该轨迹的落定时刻
    c.getWorldPosition(_wp);
    setCoinFlightLive({ x: _wp.x, y: _wp.y, z: _wp.z, t, restAt: anim.restAt ?? 3.2 });
    // 末镜「闪亮一下」：揭示镜开场点火（CineRig requestCoinPulse），躺平的硬币接住光闪一下
    if (restStartRef.current == null && t > (anim.restAt ?? 9) && consumeCoinPulse()) restStartRef.current = st.clock.elapsedTime;
    if (restStartRef.current != null) {
      const rt = st.clock.elapsedTime - restStartRef.current;
      const glow = rt < 0.45 ? Math.sin((rt / 0.45) * Math.PI) * 3.2 : 0;
      for (const m of mats) m.emissiveIntensity = 0.25 + glow;
    }
  });

  return (
    <mesh ref={ref} position={[0, rest, 0]} material={mats} castShadow>
      <cylinderGeometry args={[COIN_R, COIN_R, COIN_H * 2, COIN_SEGMENTS]} />
    </mesh>
  );
}
