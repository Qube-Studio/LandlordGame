// Minecraft 风格方块人：头/身/双臂/双腿独立 box 堆叠，待机摆动，表情贴在头部正面，
// 头顶悬浮名牌（drei <Html> billboard）。纯表现，props 来自 state。
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { faceTexture } from './textures';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL, factionOf } from '../game/roles';

const ROLE_COLORS = {
  landlord:   { shirt: '#c79a3a', pants: '#5a4a22', sleeve: '#b88c30' },
  capitalist: { shirt: '#7a4fae', pants: '#3a2a55', sleeve: '#6c43a0' }, // 资本家：紫金
  farmer:     { shirt: '#5a8a4a', pants: '#394a2c', sleeve: '#4e7a40' },
  investor:   { shirt: '#3a8a86', pants: '#2c4a48', sleeve: '#308079' }, // 投资人：青绿
  glutton:    { shirt: '#7f8a3a', pants: '#44482c', sleeve: '#727a30' }, // 暴食者：橄榄绿
  none:       { shirt: '#6c707b', pants: '#45484f', sleeve: '#5a5e68' },
};
const SKIN = '#e0ac69';

function gray(hex) {
  const c = new THREE.Color(hex);
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  return new THREE.Color(l * 0.5, l * 0.5, l * 0.52).getStyle();
}

export default function MinecraftPlayer({ player, expression, seed = 0, look = null }) {
  const root = useRef();
  const lArm = useRef();
  const rArm = useRef();
  const head = useRef();

  const bankrupt = player.bankrupt;
  const pal = ROLE_COLORS[player.role ?? 'none'] ?? ROLE_COLORS.none;
  const shirt = bankrupt ? gray(pal.shirt) : pal.shirt;
  const pants = bankrupt ? gray(pal.pants) : pal.pants;
  const sleeve = bankrupt ? gray(pal.sleeve) : pal.sleeve;
  const skin = bankrupt ? gray(SKIN) : SKIN;

  // 头部 6 面材质：正面(+z, index 4) 用表情贴图，其余肤色
  const headMats = useMemo(() => {
    const face = faceTexture(expression, skin);
    const plain = () => new THREE.MeshStandardMaterial({ color: skin, roughness: 1, flatShading: true });
    const front = new THREE.MeshStandardMaterial({ map: face, roughness: 1, flatShading: true });
    return [plain(), plain(), plain(), plain(), front, plain()];
  }, [expression, skin]);

  useFrame((st) => {
    const t = st.clock.elapsedTime + seed;
    if (!bankrupt) {
      if (root.current) {
        root.current.position.y = Math.sin(t * 1.6) * 0.03;
        // 复活/重开后清除破产瘫倒倾斜（任务④：之前只在破产时写 z，从不归零）
        root.current.rotation.z += (0 - root.current.rotation.z) * 0.15;
      }
      const swing = Math.sin(t * 1.8) * 0.18;
      if (lArm.current) lArm.current.rotation.x = swing;
      if (rArm.current) rArm.current.rotation.x = -swing;
      if (head.current) {
        if (look) {
          // 任务⑦：跟随该玩家上报的视角转头（平滑插值）
          head.current.rotation.y += (look.yaw - head.current.rotation.y) * 0.2;
          head.current.rotation.x += (look.pitch - head.current.rotation.x) * 0.2;
        } else {
          head.current.rotation.y = Math.sin(t * 0.7) * 0.18; // 无上报：待机摆动
          head.current.rotation.x += (0 - head.current.rotation.x) * 0.1;
        }
      }
    } else if (root.current) {
      root.current.position.y = 0;
      root.current.rotation.z += (0.12 - root.current.rotation.z) * 0.15; // 平滑瘫倒
    }
  });

  const mat = (color) => <meshStandardMaterial color={color} roughness={1} flatShading />;

  return (
    <group ref={root}>
      {/* 腿 */}
      <mesh position={[-0.14, 0.35, 0]}><boxGeometry args={[0.26, 0.7, 0.26]} />{mat(pants)}</mesh>
      <mesh position={[0.14, 0.35, 0]}><boxGeometry args={[0.26, 0.7, 0.26]} />{mat(pants)}</mesh>
      {/* 身体 */}
      <mesh position={[0, 1.05, 0]}><boxGeometry args={[0.6, 0.7, 0.3]} />{mat(shirt)}</mesh>
      {/* 手臂（绕肩旋转摆动） */}
      <group ref={lArm} position={[-0.41, 1.4, 0]}>
        <mesh position={[0, -0.35, 0]}><boxGeometry args={[0.22, 0.7, 0.26]} />{mat(sleeve)}</mesh>
      </group>
      <group ref={rArm} position={[0.41, 1.4, 0]}>
        <mesh position={[0, -0.35, 0]}><boxGeometry args={[0.22, 0.7, 0.26]} />{mat(sleeve)}</mesh>
      </group>
      {/* 头 */}
      <mesh ref={head} position={[0, 1.675, 0]} material={headMats}>
        <boxGeometry args={[0.55, 0.55, 0.55]} />
      </mesh>
      {/* 地主：头顶皇冠 */}
      {player.role === 'landlord' && !bankrupt && (
        <mesh position={[0, 2.0, 0]}><boxGeometry args={[0.5, 0.14, 0.5]} />{mat('#e2c044')}</mesh>
      )}
      {/* 资本家：头顶礼帽（区别于地主皇冠） */}
      {player.role === 'capitalist' && !bankrupt && (
        <group position={[0, 2.0, 0]}>
          <mesh><boxGeometry args={[0.6, 0.05, 0.6]} />{mat('#1b1b22')}</mesh>
          <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.4, 0.28, 0.4]} />{mat('#23232c')}</mesh>
        </group>
      )}

      {/* 头顶名牌 */}
      <Html position={[0, 2.45, 0]} center distanceFactor={10} zIndexRange={[30, 0]}>
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
