// 体素角色(VOXEL_PLAN P1 预演,仅验证区)——骨架 v2(2026-07-17 用户拍板):10 分件 .vox,
// 一级枢轴(肩/髋/头)沿用 MinecraftPlayer 动画语义,肩/髋组内再挂**肘/膝二级枢轴组**
// (上臂+前臂、大腿+小腿各自成件,常量取 charSpec.PIVOTS;比例微真人化,总高持平)。
// 肘随摆臂联动(后摆加弯)、膝静息微弯、坐姿=大腿前伸+膝弯小腿垂下。
// (验证区临时双份;P1 正式接入时并回 MinecraftPlayer,那边改动画这边要跟)。
// 荧幕 = 活的自发光贴片(texlib#screenFace 6 表情 + A/B 双帧 CRT 抖动)沉进头壳凹槽
// (§2.3:单 vox 做不了动态荧幕——壳体素化、屏保留贴片);投资人眼镜同理复用 HeadProp 半透明网格。
// 手持道具(算盘贴图面片/鸡腿)沿用原版网格;破产灰化未做(P1 材质级去饱和,验证区摆放物恒未破产)。
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import VoxModel from '../voxel/VoxModel';
import { CHAR_VOXEL_SIZE, CHAR_PARTS, PIVOTS, SCREEN, HATS, HEAD_MAT } from '../voxel/charSpec';
import { HeadProp } from '../scene/MinecraftPlayer';
import { screenFace, tex } from '../assets/texlib';
import { P, PROP_COLORS, shade } from '../assets/palette';
import PixelText from '../assets/pixelfont/PixelText';

const S = CHAR_VOXEL_SIZE;
const VOX_URLS = import.meta.glob('../assets/vox/props/char/*.vox', { query: '?url', import: 'default', eager: true });
const urlOf = (file) => VOX_URLS[`../assets/vox/props/char/${file}`];

// 金件头饰的运行时 glow(对齐 headProps#pmatGlow:emissive=金色本色、强度 0.35——白光会稀释金色相)
// 皇冠冠圈底的暗金色阶(shade -14,生成器同式)也要进名单,原版是整圈发光。
const HAT_GLOW = {
  landlord: [PROP_COLORS.crown, shade(PROP_COLORS.crown, -14)],
  capitalist: [PROP_COLORS.hatBand],
  prosecutor: [PROP_COLORS.crown],
};

// ---- 荧幕贴片材质(模块级缓存 + CRT 抖动,机制照抄 MinecraftPlayer#partMats/flickerTick) ----
const nearest = (canvas) => {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const PLATE_CACHE = new Map();
const FLICKER = [];
let flickerStep = -1;
function flickerTick(t) {
  const step = Math.floor(t * 9);
  if (step === flickerStep) return;
  flickerStep = step;
  const useB = step % 6 === 0 || step % 17 === 5;
  for (const f of FLICKER) {
    const src = useB ? f.b : f.a;
    if (f.tex.image !== src.face) {
      f.tex.image = src.face; f.glow.image = src.glow;
      f.tex.needsUpdate = true; f.glow.needsUpdate = true;
    }
  }
}
function plateMat(expression, bankrupt) {
  const key = `${expression}|${bankrupt ? 1 : 0}`;
  let m = PLATE_CACHE.get(key);
  if (!m) {
    const a = screenFace({ expression, bankrupt, frame: 0 });
    const b = screenFace({ expression, bankrupt, frame: 1 });
    const texA = nearest(a.face), glowA = nearest(a.glow);
    m = new THREE.MeshStandardMaterial({
      map: texA, emissiveMap: glowA,
      emissive: new THREE.Color(P.chalkInk), emissiveIntensity: bankrupt ? 0.15 : 0.5,
      roughness: 1,
    });
    FLICKER.push({ tex: texA, glow: glowA, a, b });
    PLATE_CACHE.set(key, m);
  }
  return m;
}

const pmat = (color) => <meshStandardMaterial color={color} roughness={0.85} flatShading />;

export default function VoxPlayer({ player, expression, seed = 0, look = null, seated = false, label = null }) {
  const role = player.role ?? 'none';
  const bankrupt = !!player.bankrupt;
  const root = useRef(), lArm = useRef(), rArm = useRef(), head = useRef();
  const lElbow = useRef(), rElbow = useRef(), lKnee = useRef(), rKnee = useRef();
  const baseY = seated ? PIVOTS.seatedBaseY : 0;
  const legRot = seated ? PIVOTS.seatedLegRot : 0;
  const kneeRot = seated ? PIVOTS.seatedKnee : PIVOTS.kneeRest;
  const screen = useMemo(() => plateMat(expression ?? 'idle', bankrupt), [expression, bankrupt]);
  const abacusTex = useMemo(() => (role === 'investor' ? tex('abacus') : null), [role]);

  // 动画:逐条对齐 MinecraftPlayer#useFrame(数值一致;荧幕抖动不吃 seed=全场同步)
  useFrame((st) => {
    flickerTick(st.clock.elapsedTime);
    const g = root.current;
    if (!g) return;
    const t = st.clock.elapsedTime + seed;
    if (!bankrupt) {
      g.position.y = baseY + Math.sin(t * 1.6) * 0.03;
      g.rotation.z += (0 - g.rotation.z) * 0.15;
      if (lArm.current && rArm.current) {
        if (expression === 'win') {
          const cheer = -2.6 + Math.sin(t * 6) * 0.12;
          lArm.current.rotation.x += (cheer - lArm.current.rotation.x) * 0.18;
          rArm.current.rotation.x += (cheer - rArm.current.rotation.x) * 0.18;
        } else {
          const swing = Math.sin(t * 1.8) * 0.18;
          lArm.current.rotation.x += (swing - lArm.current.rotation.x) * 0.3;
          rArm.current.rotation.x += (-swing - rArm.current.rotation.x) * 0.3;
        }
        // 肘联动:静息微弯,肩后摆(正旋)时加弯——走摆的小臂滞后感;欢呼时近伸直
        for (const [arm, elbow] of [[lArm, lElbow], [rArm, rElbow]]) {
          if (!elbow.current) continue;
          const bend = expression === 'win'
            ? -0.3
            : PIVOTS.elbowRest - Math.max(0, arm.current.rotation.x) * 0.9;
          elbow.current.rotation.x += (bend - elbow.current.rotation.x) * 0.3;
        }
      }
      // 膝:静息微弯 / 坐姿大弯(平滑过渡,坐↔站切换不跳变)
      for (const knee of [lKnee, rKnee]) {
        if (knee.current) knee.current.rotation.x += (kneeRot - knee.current.rotation.x) * 0.2;
      }
      if (head.current) {
        if (look) {
          head.current.rotation.y += (look.yaw - head.current.rotation.y) * 0.2;
          head.current.rotation.x += (look.pitch - head.current.rotation.x) * 0.2;
        } else if (expression === 'lose') {
          head.current.rotation.y += (0 - head.current.rotation.y) * 0.15;
          head.current.rotation.x += (0.3 - head.current.rotation.x) * 0.15;
        } else {
          head.current.rotation.y = Math.sin(t * 0.7) * 0.18;
          head.current.rotation.x += (0 - head.current.rotation.x) * 0.1;
        }
      }
    } else {
      g.position.y = baseY;
      g.rotation.z += (0.12 - g.rotation.z) * 0.15;
    }
  });

  const HAU = CHAR_PARTS.armUpper.grid[1] * S, HAL = CHAR_PARTS.armLower.grid[1] * S;
  const HLU = CHAR_PARTS.legUpper.grid[1] * S, HLL = CHAR_PARTS.legLower.grid[1] * S;
  const HH = CHAR_PARTS.head.grid[1] * S;
  return (
    <group ref={root}>
      {/* 腿 ×2:髋枢轴组(坐姿绕 X 前伸)→ 大腿 + 膝枢轴组 → 小腿(z+0.015 与大腿对轴,鞋含前伸脚) */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * PIVOTS.hipX, PIVOTS.hipY, 0]} rotation={[legRot, 0, 0]}>
          <VoxModel url={urlOf(`leg-up-${role}.vox`)} scale={S} castShadow={false} position={[0, -HLU, 0]} />
          <group ref={sx < 0 ? lKnee : rKnee} position={[0, PIVOTS.kneeY, 0]}>
            <VoxModel url={urlOf(`leg-lo-${role}.vox`)} scale={S} castShadow={false} position={[0, -HLL, 0.015]} />
          </group>
        </group>
      ))}
      {/* 身(直挂 root,底=髋线) */}
      <VoxModel url={urlOf(`body-${role}.vox`)} scale={S} castShadow={false} position={[0, PIVOTS.hipY, 0]} />
      {/* 臂 ×2:肩枢轴组(摆臂/欢呼绕肩顶)→ 上臂 + 肘枢轴组 → 前臂;手持道具挂前臂随肘联动 */}
      <group ref={lArm} position={[-PIVOTS.shoulderX, PIVOTS.shoulderY, 0]}>
        <VoxModel url={urlOf(`arm-up-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAU, 0]} />
        <group ref={lElbow} position={[0, PIVOTS.elbowY, 0]}>
          <VoxModel url={urlOf(`arm-lo-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAL, 0]} />
          {role === 'investor' && !bankrupt && (
            <mesh position={[0, -0.39, 0.18]} rotation={[0.35, 0, 0]}>
              <planeGeometry args={[0.34, 0.24]} />
              <meshStandardMaterial map={abacusTex} roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      </group>
      <group ref={rArm} position={[PIVOTS.shoulderX, PIVOTS.shoulderY, 0]}>
        <VoxModel url={urlOf(`arm-up-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAU, 0]} />
        <group ref={rElbow} position={[0, PIVOTS.elbowY, 0]}>
          <VoxModel url={urlOf(`arm-lo-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAL, 0]} />
          {role === 'glutton' && !bankrupt && (
            <group position={[0, -0.41, 0.16]} rotation={[0.5, 0, 0]}>
              <mesh position={[0, 0.07, 0]}><boxGeometry args={[0.14, 0.2, 0.14]} />{pmat(PROP_COLORS.drumSkin)}</mesh>
              <mesh position={[0, -0.09, 0]}><boxGeometry args={[0.05, 0.14, 0.05]} />{pmat(PROP_COLORS.drumBone)}</mesh>
            </group>
          )}
        </group>
      </group>
      {/* 头:枢轴=头心;体素壳 + 荧幕贴片沉进凹槽 + 头饰(投资人眼镜=半透明网格特例) */}
      <group ref={head} position={[0, PIVOTS.headY, 0]}>
        {/* 机器头=金属:整头一档 metalness(逐色 MATL 细分在 .vox 里,给 MagicaVoxel/voxel 分支) */}
        <VoxModel
          url={urlOf('head.vox')} scale={S} castShadow={false} position={[0, -HH / 2, 0]}
          metalness={HEAD_MAT.metal} roughness={HEAD_MAT.rough}
        />
        <mesh position={[0, 0, SCREEN.plateZ]} material={screen}>
          <planeGeometry args={[HH, HH]} />
        </mesh>
        {!bankrupt && role === 'investor' && <HeadProp role="investor" />}
        {!bankrupt && HATS[role] && (
          <VoxModel
            url={urlOf(`hat-${role}.vox`)} scale={S} castShadow={false}
            position={[0, HATS[role].lift, 0]}
            emissiveColors={HAT_GLOW[role] ?? null} emissiveIntensity={0.35}
            emissive={HAT_GLOW[role]?.[0] ?? '#ffffff'}
          />
        )}
      </group>
      {/* 名牌(同原版) */}
      <Html position={[0, 2.35, 0]} center distanceFactor={6} zIndexRange={[30, 0]}>
        <div className={`mc-nameplate ${player.online ? '' : 'offline'}`}>
          <PixelText size={2} color={label != null ? 'var(--px-gold)' : '#fff'}>{label ?? player.name}</PixelText>
        </div>
      </Html>
    </group>
  );
}
