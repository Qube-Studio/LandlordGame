// Minecraft 风格方块人：头/身/双臂/双腿独立 box 堆叠，待机摆动，表情贴在头部正面，
// 头顶悬浮名牌（drei <Html> billboard）。纯表现，props 来自 state。
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL, factionOf } from '../game/roles';
import { PROP_COLORS } from '../assets/palette';
import { skinTex, tex } from '../assets/texlib';
import { buildHeadProp } from './headProps';

// 全身像素皮肤(ART_BIBLE §1.5):每个 box 的六面各一张 16² 烘焙皮肤(织纹/AO/描边/角色个性),
// 材质数组按 role|part|bankrupt(|expression) 模块级缓存,全场玩家共享——mesh 数不变、材质对象大降。
// 破产不再做材质级灰化,而是烘焙灰皮(保留织纹层次)。
const MAT_CACHE = new Map();
// box 面序:[+x右, -x左, +y顶, -y底, +z前, -z后]
const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'];
function partMats(role, part, bankrupt, expression = 'idle') {
  const key = `${role}|${part}|${bankrupt ? 1 : 0}|${part === 'head' ? expression : ''}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const arr = FACE_ORDER.map(face => new THREE.MeshStandardMaterial({
    map: skinTex({ role, part, face, expression, bankrupt }),
    roughness: 1, flatShading: true,
  }));
  MAT_CACHE.set(key, arr);
  return arr;
}

// 道具材质(手持件用;头戴件已移至 headProps.js 命令式单一真源)。
const pmat = (color) => <meshStandardMaterial color={color} roughness={0.85} flatShading />;

// 头戴道具:几何/材质定义在 headProps.js#buildHeadProp(招募令快照 bustSnapshot 共用同一份),
// 这里包成组件挂进头组,随转头/低头一起动。
export function HeadProp({ role }) {
  const obj = useMemo(() => buildHeadProp(role), [role]);
  return obj ? <primitive object={obj} /> : null;
}

export default function MinecraftPlayer({ player, expression, seed = 0, look = null, seated = false }) {
  const root = useRef();
  const lArm = useRef();
  const rArm = useRef();
  const head = useRef();

  const bankrupt = player.bankrupt;
  const role = player.role ?? 'none';

  const headMats = useMemo(() => partMats(role, 'head', bankrupt, expression), [role, bankrupt, expression]);
  const bodyMats = useMemo(() => partMats(role, 'body', bankrupt), [role, bankrupt]);
  const armMats = useMemo(() => partMats(role, 'arm', bankrupt), [role, bankrupt]);
  const legMats = useMemo(() => partMats(role, 'leg', bankrupt), [role, bankrupt]);

  const baseY = seated ? -0.16 : 0; // 坐姿:臀部落到凳面(凳高≈0.5,髋部 0.7→0.54)

  useFrame((st) => {
    const t = st.clock.elapsedTime + seed;
    if (!bankrupt) {
      if (root.current) {
        root.current.position.y = baseY + Math.sin(t * 1.6) * 0.03;
        // 复活/重开后清除破产瘫倒倾斜（任务④：之前只在破产时写 z，从不归零）
        root.current.rotation.z += (0 - root.current.rotation.z) * 0.15;
      }
      // 胜负姿态(§1.9 ④):胜=双臂高举欢呼(带一点节奏晃),负=垂臂;平时待机摆动
      if (expression === 'win') {
        const cheer = -2.6 + Math.sin(t * 6) * 0.12;
        if (lArm.current) lArm.current.rotation.x += (cheer - lArm.current.rotation.x) * 0.18;
        if (rArm.current) rArm.current.rotation.x += (cheer - rArm.current.rotation.x) * 0.18;
      } else {
        const swing = Math.sin(t * 1.8) * 0.18;
        if (lArm.current) lArm.current.rotation.x += (swing - lArm.current.rotation.x) * 0.3;
        if (rArm.current) rArm.current.rotation.x += (-swing - rArm.current.rotation.x) * 0.3;
      }
      if (head.current) {
        if (look) {
          // 任务⑦：跟随该玩家上报的视角转头（平滑插值）
          head.current.rotation.y += (look.yaw - head.current.rotation.y) * 0.2;
          head.current.rotation.x += (look.pitch - head.current.rotation.x) * 0.2;
        } else if (expression === 'lose') {
          // 败方低头
          head.current.rotation.y += (0 - head.current.rotation.y) * 0.15;
          head.current.rotation.x += (0.3 - head.current.rotation.x) * 0.15;
        } else {
          head.current.rotation.y = Math.sin(t * 0.7) * 0.18; // 无上报：待机摆动
          head.current.rotation.x += (0 - head.current.rotation.x) * 0.1;
        }
      }
    } else if (root.current) {
      root.current.position.y = baseY;
      root.current.rotation.z += (0.12 - root.current.rotation.z) * 0.15; // 平滑瘫倒
    }
  });

  const legRot = seated ? -1.5 : 0; // 坐姿:大腿前伸(髋部铰链,伸进桌下)

  return (
    <group ref={root}>
      {/* 腿(髋部铰链组,支持坐姿前伸) */}
      <group position={[-0.14, 0.7, 0]} rotation={[legRot, 0, 0]}>
        <mesh position={[0, -0.35, 0]} material={legMats}><boxGeometry args={[0.26, 0.7, 0.26]} /></mesh>
      </group>
      <group position={[0.14, 0.7, 0]} rotation={[legRot, 0, 0]}>
        <mesh position={[0, -0.35, 0]} material={legMats}><boxGeometry args={[0.26, 0.7, 0.26]} /></mesh>
      </group>
      {/* 身体 */}
      <mesh position={[0, 1.05, 0]} material={bodyMats}><boxGeometry args={[0.6, 0.7, 0.3]} /></mesh>
      {/* 手臂（绕肩旋转摆动;手持道具挂在臂组里随摆动） */}
      <group ref={lArm} position={[-0.41, 1.4, 0]}>
        <mesh position={[0, -0.35, 0]} material={armMats}><boxGeometry args={[0.22, 0.7, 0.26]} /></mesh>
        {!bankrupt && role === 'investor' && (
          <mesh position={[0, -0.72, 0.18]} rotation={[0.35, 0, 0]}>
            <planeGeometry args={[0.34, 0.24]} />
            <meshStandardMaterial map={tex('abacus')} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
      <group ref={rArm} position={[0.41, 1.4, 0]}>
        <mesh position={[0, -0.35, 0]} material={armMats}><boxGeometry args={[0.22, 0.7, 0.26]} /></mesh>
        {!bankrupt && role === 'glutton' && (
          <group position={[0, -0.74, 0.16]} rotation={[0.5, 0, 0]}>
            <mesh position={[0, 0.07, 0]}><boxGeometry args={[0.14, 0.2, 0.14]} />{pmat(PROP_COLORS.drumSkin)}</mesh>
            <mesh position={[0, -0.09, 0]}><boxGeometry args={[0.05, 0.14, 0.05]} />{pmat(PROP_COLORS.drumBone)}</mesh>
          </group>
        )}
      </group>
      {/* 头(组化:头戴道具随转头/低头一起动) */}
      <group ref={head} position={[0, 1.675, 0]}>
        <mesh material={headMats}>
          <boxGeometry args={[0.55, 0.55, 0.55]} />
        </mesh>
        {!bankrupt && <HeadProp role={role} />}
      </group>

      {/* 头顶名牌(distanceFactor 6:第一人称落座相机视距变近,10 档会糊满半屏) */}
      <Html position={[0, 2.35, 0]} center distanceFactor={6} zIndexRange={[30, 0]}>
        <div className={`mc-nameplate ${player.online ? '' : 'offline'}`}>
          <div className="np-row">
            <PixelText size={2} className={`np-role ${factionOf(player.role) ?? ''}`}>
              {ROLE_LABEL[player.role] ?? '?'}
            </PixelText>
            <PixelText size={2}>{player.name}</PixelText>
            {player.bankrupt && <PixelText size={2} className="np-tag-bankrupt">破产</PixelText>}
          </div>
        </div>
      </Html>
    </group>
  );
}
