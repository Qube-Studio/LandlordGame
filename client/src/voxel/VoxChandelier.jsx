// 豪华体素吊灯(VOXEL_PLAN P2 首件预演,VoxLab 首个体素资产):
// 体素轮体/链条/铜冠 = chandelier-deluxe.vox(可进 MagicaVoxel 手修);
// 火苗 = 交叉自发光面片(体素化明确不做,VOXEL_PLAN §2.2/§5-5);琥珀吊坠 = ember 色自发光子网格。
// 吊装(吊杆+两梁横杆)沿用常规网格——房梁体系是 Room 的,不属于资产本体。
// 烛位与体素几何同源(chandelierSpec),castShadow=false 对齐现有吊灯(别给桌毡添乱影)。
import * as THREE from 'three';
import { useMemo } from 'react';
import chandUrl from '../assets/vox/chandelier-deluxe.vox?url';
import VoxModel from './VoxModel';
import { CHAND, flamePoints } from './chandelierSpec';
import { P } from '../assets/palette';
import { tex } from '../assets/texlib';

export default function VoxChandelier() {
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  const pts = useMemo(() => flamePoints(), []);
  const knotTop = CHAND.knotY + 0.14;
  return (
    <group position={[0, CHAND.mountY, 0]}>
      {/* 吊坠 emissive 0.85:1.5 会被 Bloom(阈值 0.72)打成白热,琥珀色相全丢 */}
      <VoxModel url={chandUrl} emissiveColors={[P.ember]} emissiveIntensity={0.85} castShadow={false} />
      {/* 火苗:交叉面片,帧位错开(静帧;整灯明暗交给点光闪烁,同现有吊灯手法) */}
      {pts.map((pt, i) => (
        [0, Math.PI / 2].map((ry, k) => (
          <mesh key={`${i}-${k}`} position={[pt.x, pt.y, pt.z]} rotation={[0, ry + i, 0]}>
            <planeGeometry args={[0.11, 0.17]} />
            <meshStandardMaterial
              map={frames[i % 3]} emissiveMap={frames[i % 3]} emissive={P.ink} emissiveIntensity={1.8}
              transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
            />
          </mesh>
        ))
      ))}
      {/* 吊杆 → 两梁间横杆(世界 y=6,同现有吊灯;横杆不投影) */}
      <mesh position={[0, (knotTop + (6 - CHAND.mountY)) / 2, 0]}>
        <boxGeometry args={[0.05, (6 - CHAND.mountY) - knotTop, 0.05]} />
        <meshStandardMaterial color={P.wood900} roughness={1} />
      </mesh>
      <mesh position={[0, 6 - CHAND.mountY, 0]}>
        <boxGeometry args={[0.18, 0.18, 6.2]} />
        <meshStandardMaterial color={P.beam} roughness={1} flatShading />
      </mesh>
    </group>
  );
}
