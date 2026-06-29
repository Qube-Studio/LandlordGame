// Minecraft 风格方块人：头/身/双臂/双腿独立 box 堆叠，待机摆动，表情贴在头部正面，
// 头顶悬浮名牌（drei <Html> billboard）。纯表现，props 来自 state。
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { faceTexture } from './textures';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL, factionOf } from '../game/roles';

// 暖光酒馆：整体提暖、降饱和；暴食者脱离橄榄绿改暖棕橙(配厨师设定)。
const ROLE_COLORS = {
  landlord:   { shirt: '#caa24a', pants: '#5a4424', sleeve: '#b8902f' },
  capitalist: { shirt: '#6e4a92', pants: '#3a2a4e', sleeve: '#5e3f80' }, // 资本家：葡萄酒紫
  farmer:     { shirt: '#7a9a4e', pants: '#4a5230', sleeve: '#6c8a44' },
  investor:   { shirt: '#3f8a82', pants: '#2c4a48', sleeve: '#368079' }, // 投资人：青绿
  glutton:    { shirt: '#9a6a3a', pants: '#5a3e26', sleeve: '#8a5e32' }, // 暴食者：暖棕橙(厨子)
  none:       { shirt: '#8a7a64', pants: '#54483a', sleeve: '#7a6a54' },
};
const SKIN = '#e8b878';

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
  // 道具材质：与身体分开，方便各风格分支单独调（霓虹发光 / 卡通描边 / 暖光哑光）。
  const pmat = (color) => <meshStandardMaterial color={color} roughness={0.85} flatShading />;

  // 五角色头顶/身上的辨识道具（共享几何，破产时不渲染）。坐标基于头中心 y=1.675、头顶≈1.95。
  const roleProp = (role) => {
    switch (role) {
      case 'landlord': // 真皇冠：冠圈 + 五尖 + 正面红宝石
        return (
          <group position={[0, 2.0, 0]}>
            <mesh><boxGeometry args={[0.5, 0.1, 0.5]} />{pmat('#f0d060')}</mesh>
            {[[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [0, 0]].map(([x, z], i) => (
              <mesh key={i} position={[x, i === 4 ? 0.15 : 0.12, z]}>
                <boxGeometry args={[0.1, i === 4 ? 0.22 : 0.16, 0.1]} />{pmat('#f0d060')}
              </mesh>
            ))}
            <mesh position={[0, 0.02, 0.26]}><boxGeometry args={[0.1, 0.1, 0.04]} />{pmat('#c4423a')}</mesh>
          </group>
        );
      case 'capitalist': // 礼帽 + 金带
        return (
          <group position={[0, 2.0, 0]}>
            <mesh><boxGeometry args={[0.6, 0.05, 0.6]} />{pmat('#1e1a24')}</mesh>
            <mesh position={[0, 0.07, 0]}><boxGeometry args={[0.42, 0.05, 0.42]} />{pmat('#d8b86a')}</mesh>
            <mesh position={[0, 0.18, 0]}><boxGeometry args={[0.4, 0.28, 0.4]} />{pmat('#23232c')}</mesh>
          </group>
        );
      case 'farmer': // 草帽：宽檐 + 矮顶
        return (
          <group position={[0, 1.97, 0]}>
            <mesh><boxGeometry args={[0.74, 0.05, 0.74]} />{pmat('#cda861')}</mesh>
            <mesh position={[0, 0.11, 0]}><boxGeometry args={[0.4, 0.18, 0.4]} />{pmat('#c09a4e')}</mesh>
          </group>
        );
      case 'investor': // 圆框眼镜 + 围巾（账房/担保人）
        return (
          <group>
            <mesh position={[-0.12, 1.7, 0.29]}><boxGeometry args={[0.15, 0.15, 0.03]} />{pmat('#cfd4dc')}</mesh>
            <mesh position={[0.12, 1.7, 0.29]}><boxGeometry args={[0.15, 0.15, 0.03]} />{pmat('#cfd4dc')}</mesh>
            <mesh position={[0, 1.7, 0.29]}><boxGeometry args={[0.1, 0.03, 0.03]} />{pmat('#cfd4dc')}</mesh>
            <mesh position={[0, 1.33, 0]}><boxGeometry args={[0.64, 0.12, 0.34]} />{pmat(sleeve)}</mesh>
          </group>
        );
      case 'glutton': // 厨师帽 + 围裙
        return (
          <group>
            <mesh position={[0, 2.0, 0]}><boxGeometry args={[0.46, 0.1, 0.46]} />{pmat('#f2ece0')}</mesh>
            <mesh position={[0, 2.16, 0]}><boxGeometry args={[0.5, 0.22, 0.5]} />{pmat('#f8f4ea')}</mesh>
            <mesh position={[0, 1.0, 0.16]}><boxGeometry args={[0.5, 0.6, 0.04]} />{pmat('#b85a3a')}</mesh>
          </group>
        );
      default:
        return null;
    }
  };

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
      {/* 角色专属道具（共享几何，各风格分支只换材质/配色） */}
      {!bankrupt && roleProp(player.role)}

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
