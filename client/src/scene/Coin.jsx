// 硬币：单独建模（圆柱体双面贴图）。mode='flip' 用「重力下落 + 衰减弹跳 + 收边摆动落定」的
// 步进模拟，物理感更自然；最终精确停在服务端判定的面（落定阶段把翻转角收敛到正确角度，结尾锁死）。
// mode='rest' 平放展示结果。
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { coinFaceTexture } from './textures';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const TWO_PI = Math.PI * 2;

export default function Coin({ result = 'heads', mode = 'flip', durationMs = 2200, tableTop = 1.0 }) {
  const ref = useRef();
  const rest = tableTop + 0.07;
  const sim = useRef(null);

  const mats = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: '#b8902f', roughness: 0.5, metalness: 0.4 });
    const top = new THREE.MeshStandardMaterial({ map: coinFaceTexture('heads'), roughness: 0.45, metalness: 0.3 });
    const bottom = new THREE.MeshStandardMaterial({ map: coinFaceTexture('tails'), roughness: 0.45, metalness: 0.3 });
    return [side, top, bottom];
  }, []);

  useFrame((st, delta) => {
    const c = ref.current;
    if (!c) return;
    const dt = Math.min(delta, 0.05);

    if (mode === 'rest') {
      c.position.set(0, rest + Math.sin(st.clock.elapsedTime * 2) * 0.01, 0);
      c.rotation.set(result === 'heads' ? 0 : Math.PI, 0, 0);
      return;
    }

    if (!sim.current) {
      sim.current = { elapsed: 0, y: rest + 3.4, vy: 0, x: 0, z: 0, vx: 0.55, vz: 0.32, spinX: 0, spinVel: 19, settle: null };
    }
    const s = sim.current;
    const dur = durationMs / 1000;
    const settleStart = dur * 0.58;
    s.elapsed += dt;

    if (s.elapsed < settleStart) {
      // 下落 + 弹跳（重力 + 恢复系数 + 触桌摩擦减速自旋）
      const G = 24;
      s.vy -= G * dt;
      s.y += s.vy * dt;
      if (s.y <= rest) {
        s.y = rest;
        if (s.vy < 0) {
          s.vy = -s.vy * 0.52;
          s.spinVel *= 0.8;
          s.vx *= 0.6; s.vz *= 0.6;
          if (Math.abs(s.vy) < 1.2) s.vy = 0;
        }
      }
      s.x += s.vx * dt; s.z += s.vz * dt;
      s.vx *= Math.pow(0.5, dt); s.vz *= Math.pow(0.5, dt);
      s.spinX += s.spinVel * dt;
      c.position.set(s.x, s.y, s.z);
      c.rotation.set(s.spinX, s.spinX * 0.35, Math.sin(s.elapsed * 22) * 0.04 * (s.spinVel / 19));
    } else {
      // 落定：把翻转角收敛到正确朝面（+ 一圈余转），叠加衰减的收边摆动
      if (!s.settle) {
        const base = result === 'heads' ? 0 : Math.PI;
        const k = Math.ceil((s.spinX - base) / TWO_PI);
        s.settle = { x0: s.spinX, target: base + k * TWO_PI + TWO_PI, px: s.x, pz: s.z };
      }
      const p = Math.min(1, (s.elapsed - settleStart) / (dur - settleStart));
      const e = easeOut(p);
      const rx = s.settle.x0 + (s.settle.target - s.settle.x0) * e;
      const wobble = Math.sin(p * Math.PI * 6) * (1 - p) * (1 - p) * 0.55;
      const hop = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p) * 0.06;
      c.position.set(s.settle.px * (1 - e), rest + hop, s.settle.pz * (1 - e));
      c.rotation.set(rx, rx * 0.2, wobble);
      if (p >= 1) {
        c.position.set(0, rest, 0);
        c.rotation.set(result === 'heads' ? 0 : Math.PI, 0, 0);
      }
    }
  });

  return (
    <mesh ref={ref} position={[0, tableTop + 3.4, 0]} material={mats} castShadow>
      <cylinderGeometry args={[0.45, 0.45, 0.12, 28]} />
    </mesh>
  );
}
