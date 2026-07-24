// 处决窗第一人称左轮视模（§3.9）：每帧把持枪组钉在相机位姿上（无现成 camera-attach，逐帧拷贝最稳）。
// 开枪表现（批次3 修订二，素材版）：gunFirePulse 触发——
//   后坐：recoil=1 线性收回（~0.22s），枪身后跳+微抬+枪口上翘；
//   火光：assets/muzzlefx 星芒纹理 billboard（3 变体随机+随机 roll+缩放脉冲）+ **光锥**（沿枪管
//     向前张开的体积闪光,任意视角有形体）+ 亮白主光/暖橙补光双点光，~0.09s 快攻慢衰；
//   烟雾：7 缕斑驳像素烟（3 变体随机分配）——**错峰喷出**（每粒独立延迟）、锥形散布、
//     正弦湍流上飘、快现慢散 ~1.2-1.7s（固定粒子池,零分配）。
// ⚠ 相机跟随组内的单面片朝向双坑（GAME_SPEC §3.9）：枪组绕 Y+90° 会把默认 plane 带成侧棱对
//   相机；绕 Y+90° 修正后法线又背对相机被 FrontSide 剔除——须绕 Y **−90°** 且材质 DoubleSide。
// 素材 assets/vox/props/revolver.vox（36×24×9 格,枪口指 +x → 绕 Y +90° 对齐相机前方 −z）。
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import VoxModel, { VOXEL_SIZE } from '../voxel/VoxModel';
import revolverUrl from '../assets/vox/props/revolver.vox?url';
import { makeFlashTextures, makeSmokeTextures } from '../assets/muzzlefx';
import { smootherstep } from './aim';

const SMOKE_N = 7;
// 举枪/收枪双位姿（§3.9 开火闩锁）：有目标且未开火=举枪瞄准；开火后（火光后坐读完再收）/
// 结果窗=垂到画面右下角。位姿沿 smootherstep 插值，后坐偏移叠加在插值结果上。
const POSE_UP = { pos: [0.22, -0.18, -0.58], rotX: -0.06, rotZ: -0.02 };
const POSE_DOWN = { pos: [0.26, -0.44, -0.5], rotX: -1.2, rotZ: 0.14 };
const RAISE_S = 0.45;  // 拔枪举起时长
const LOWER_S = 0.55;  // 收枪放下时长
const FIRE_HOLD_S = 0.35; // 开火后保持举枪的读秒（后坐+火光演完再收）

export default function RevolverView() {
  const ref = useRef();
  const gunRef = useRef();
  const flashRef = useRef();
  const coneRef = useRef();
  const lightRef = useRef();
  const fillRef = useRef();
  const smokeRefs = useRef([]);
  const fx = useRef({
    seen: -1,
    recoil: 0,
    roll: 0,
    flashIdx: 0,
    flashScale: 1,
    raise: 0,   // 举枪进度 0=收枪位 → 1=瞄准位
    hold: 0,    // 开火后收枪前的读秒
    smoke: Array.from({ length: SMOKE_N }, () => ({ age: 99, life: 1, vx: 0, vy: 0, vz: 0, spin: 0, seed: 0, texIdx: 0 })),
  });
  const { camera } = useThree();
  const flashTexs = useMemo(() => makeFlashTextures(3), []);
  const smokeTexs = useMemo(() => makeSmokeTextures(3), []);

  useFrame((st, delta) => {
    if (!ref.current) return;
    ref.current.position.copy(camera.position);
    ref.current.quaternion.copy(camera.quaternion);
    const f = fx.current;
    const gs = useGameStore.getState();
    // 开枪脉冲 → 后坐 + 火光换装 + 错峰喷烟
    const pulse = gs.gunFirePulse;
    if (f.seen === -1) f.seen = pulse; // 挂载首帧吞掉历史脉冲
    else if (pulse !== f.seen) {
      f.seen = pulse;
      f.recoil = 1;
      f.hold = FIRE_HOLD_S; // 火光后坐读完再收枪
      f.roll = Math.random() * Math.PI * 2;
      f.flashIdx = Math.floor(Math.random() * flashTexs.length);
      f.flashScale = 0.85 + Math.random() * 0.4;
      for (let i = 0; i < SMOKE_N; i++) {
        const s = f.smoke[i];
        s.age = -(i * 0.06 + Math.random() * 0.05);     // 错峰：负龄=延迟喷出
        s.life = 0.85 + Math.random() * 0.35;           // 硝烟快散（一版 1.2-1.7s 糊成大云团）
        s.vx = 0.16 + Math.random() * 0.2;              // 锥形散布：主向枪口前（组局部 +x）
        s.vy = 0.05 + Math.random() * 0.08;
        s.vz = (Math.random() - 0.5) * 0.2;             // 散得更开，烟缕彼此分离不叠白
        s.spin = (Math.random() - 0.5) * 1.6;
        s.seed = Math.random() * 10;
        s.texIdx = Math.floor(Math.random() * smokeTexs.length);
      }
    }
    const r = f.recoil;
    if (r > 0) f.recoil = Math.max(0, r - delta * 4.5); // ~0.22s 收回
    // 举枪/收枪：有目标且本焦点未开火=举；开火/结果窗=收（开火后先读 hold 秒让后坐火光演完）
    const ex = gs.state?.execution;
    const wantUp = !!ex?.targetId && gs.execFiredAt !== ex.targetId;
    if (wantUp) f.raise = Math.min(1, f.raise + delta / RAISE_S);
    else if (f.hold > 0) f.hold -= delta;
    else f.raise = Math.max(0, f.raise - delta / LOWER_S);
    const e = smootherstep(f.raise);
    if (gunRef.current) {
      const lerp3 = (i) => POSE_DOWN.pos[i] + (POSE_UP.pos[i] - POSE_DOWN.pos[i]) * e;
      gunRef.current.position.set(lerp3(0), lerp3(1) + r * 0.025, lerp3(2) + r * 0.09);
      gunRef.current.rotation.set(
        POSE_DOWN.rotX + (POSE_UP.rotX - POSE_DOWN.rotX) * e - r * 0.38,
        Math.PI / 2 - 0.1,
        POSE_DOWN.rotZ + (POSE_UP.rotZ - POSE_DOWN.rotZ) * e,
      );
    }
    // 火光（快攻慢衰 r 0.6→1）：星芒 billboard + 光锥 + 双点光
    const g = r > 0.6 ? (r - 0.6) / 0.4 : 0;
    if (flashRef.current) {
      flashRef.current.visible = g > 0;
      flashRef.current.rotation.set(0, -Math.PI / 2, f.roll);
      flashRef.current.scale.setScalar(f.flashScale * (0.8 + g * 0.45));
      flashRef.current.material.map = flashTexs[f.flashIdx];
      flashRef.current.material.opacity = Math.min(1, g * 1.4);
    }
    if (coneRef.current) {
      coneRef.current.visible = g > 0;
      coneRef.current.material.opacity = g * 0.5;
      coneRef.current.scale.set(1, 0.85 + g * 0.3, 1);
    }
    if (lightRef.current) lightRef.current.intensity = g * 22;
    if (fillRef.current) fillRef.current.intensity = g * 7;
    // 烟雾粒子池：错峰出现 → 锥形前散 + 湍流上飘 + 长大 + 慢旋 + 快现慢散
    for (let i = 0; i < SMOKE_N; i++) {
      const s = f.smoke[i];
      const m = smokeRefs.current[i];
      if (!m) continue;
      s.age += delta;
      const alive = s.age > 0 && s.age < s.life;
      m.visible = alive;
      if (!alive) continue;
      const t = s.age / s.life;
      m.position.set(
        0.17 + s.vx * s.age,
        0.01 + s.vy * s.age + t * t * 0.08 + Math.sin(s.age * 3 + s.seed) * 0.008,
        s.vz * s.age + Math.cos(s.age * 2.6 + s.seed) * 0.006,
      );
      const grow = 1 - (1 - t) * (1 - t); // easeOut 长大
      m.scale.setScalar(0.05 + grow * 0.13); // 体量克制（一版 0.36m 巨型云团把屏幕糊住）
      m.rotation.set(0, -Math.PI / 2, s.spin * s.age);
      m.material.map = smokeTexs[s.texIdx];
      const rise = Math.min(1, t / 0.12); // 快现
      m.material.opacity = rise * Math.pow(1 - t, 1.6) * 0.4; // 稀薄（叠加也不刷白）
    }
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__gunFx = { pulse, seen: f.seen, recoil: f.recoil, smokeAges: f.smoke.map(s => +s.age.toFixed(2)) };
  });

  return (
    <group ref={ref} userData={{ voxBakeSkip: true }}>
      {/* 右下持枪位（相机局部系）：位姿由 useFrame 按后坐量逐帧写 */}
      <group ref={gunRef} position={[0.22, -0.18, -0.58]} rotation={[-0.06, Math.PI / 2 - 0.1, -0.02]}>
        <VoxModel url={revolverUrl} scale={VOXEL_SIZE * 0.5} anchor="center" castShadow={false} />
        {/* 星芒火光 billboard（法线经 −90° 修正朝相机；变体/roll/缩放每发随机） */}
        <mesh ref={flashRef} position={[0.19, 0.01, 0]} visible={false}>
          <planeGeometry args={[0.22, 0.22]} />
          <meshBasicMaterial map={flashTexs[0]} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {/* 光锥：尖端在枪口、口向前张开（绕 Z +90° 把锥轴 +y 转向 −x……再上下颠倒=尖朝枪口）——
            体积闪光，从侧面/俯视也有形体 */}
        <mesh ref={coneRef} position={[0.235, 0.01, 0]} rotation={[0, 0, Math.PI / 2]} visible={false}>
          <coneGeometry args={[0.05, 0.13, 8, 1, true]} />
          <meshBasicMaterial color="#ffb35a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {/* 双点光：亮白主光（硬闪）+ 暖橙补光（照亮枪身与桌面一瞬） */}
        <pointLight ref={lightRef} position={[0.2, 0.02, 0]} intensity={0} distance={2.2} decay={2} color="#fff0d0" />
        <pointLight ref={fillRef} position={[0.24, 0, 0]} intensity={0} distance={4.5} decay={2} color="#ff9838" />
        {/* 枪口烟雾（3 变体斑驳像素烟,错峰喷出；billboard 同款朝向修正） */}
        {Array.from({ length: SMOKE_N }, (_, i) => (
          <mesh key={i} ref={(el) => { smokeRefs.current[i] = el; }} position={[0.17, 0.01, 0]} visible={false}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={smokeTexs[0]} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
