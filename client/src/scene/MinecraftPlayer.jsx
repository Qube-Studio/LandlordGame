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

export default function MinecraftPlayer({ player, expression, seed = 0, look = null }) {
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

  // 道具材质：与身体分开，方便单独调。皇冠/怀表类金件带微 emissive(Bloom 下泛光,ART_BIBLE §1.5)。
  const pmat = (color) => <meshStandardMaterial color={color} roughness={0.85} flatShading />;
  const pmatGlow = (color) => (
    <meshStandardMaterial color={color} roughness={0.55} metalness={0.3} flatShading emissive={color} emissiveIntensity={0.35} />
  );

  // 五角色头顶/身上的辨识道具（共享几何，破产时不渲染）。坐标基于头中心 y=1.675、头顶≈1.95。
  // 围裙/马甲/袖套等布面已烘进皮肤纹理;这里只留立体件。
  const roleProp = (r) => {
    switch (r) {
      case 'landlord': // 真皇冠：冠圈 + 五尖 + 正面红宝石(金件发光)
        return (
          <group position={[0, 2.0, 0]}>
            <mesh><boxGeometry args={[0.5, 0.1, 0.5]} />{pmatGlow(PROP_COLORS.crown)}</mesh>
            {[[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [0, 0]].map(([x, z], i) => (
              <mesh key={i} position={[x, i === 4 ? 0.15 : 0.12, z]}>
                <boxGeometry args={[0.1, i === 4 ? 0.22 : 0.16, 0.1]} />{pmatGlow(PROP_COLORS.crown)}
              </mesh>
            ))}
            <mesh position={[0, 0.02, 0.26]}><boxGeometry args={[0.1, 0.1, 0.04]} />{pmat(PROP_COLORS.ruby)}</mesh>
          </group>
        );
      case 'capitalist': // 礼帽 + 金带
        return (
          <group position={[0, 2.0, 0]}>
            <mesh><boxGeometry args={[0.6, 0.05, 0.6]} />{pmat(PROP_COLORS.hatBrim)}</mesh>
            <mesh position={[0, 0.07, 0]}><boxGeometry args={[0.42, 0.05, 0.42]} />{pmatGlow(PROP_COLORS.hatBand)}</mesh>
            <mesh position={[0, 0.18, 0]}><boxGeometry args={[0.4, 0.28, 0.4]} />{pmat(PROP_COLORS.hatTop)}</mesh>
          </group>
        );
      case 'farmer': // 草帽：宽檐 + 矮顶(草编织纹)
        return (
          <group position={[0, 1.97, 0]}>
            <mesh>
              <boxGeometry args={[0.74, 0.05, 0.74]} />
              <meshStandardMaterial map={tex('fabric', { color: PROP_COLORS.straw, pattern: 'stripe' })} roughness={1} flatShading />
            </mesh>
            <mesh position={[0, 0.11, 0]}>
              <boxGeometry args={[0.4, 0.18, 0.4]} />
              <meshStandardMaterial map={tex('fabric', { color: PROP_COLORS.straw2, pattern: 'stripe' })} roughness={1} flatShading />
            </mesh>
          </group>
        );
      case 'investor': // 圆框眼镜(马甲/领带/袖套已烘进皮肤)
        return (
          <group>
            <mesh position={[-0.12, 1.7, 0.29]}><boxGeometry args={[0.15, 0.15, 0.03]} />{pmat(PROP_COLORS.lens)}</mesh>
            <mesh position={[0.12, 1.7, 0.29]}><boxGeometry args={[0.15, 0.15, 0.03]} />{pmat(PROP_COLORS.lens)}</mesh>
            <mesh position={[0, 1.7, 0.29]}><boxGeometry args={[0.1, 0.03, 0.03]} />{pmat(PROP_COLORS.lens)}</mesh>
          </group>
        );
      case 'glutton': // 厨师帽(围裙已烘进皮肤)
        return (
          <group>
            <mesh position={[0, 2.0, 0]}><boxGeometry args={[0.46, 0.1, 0.46]} />{pmat(PROP_COLORS.chefWhite)}</mesh>
            <mesh position={[0, 2.16, 0]}><boxGeometry args={[0.5, 0.22, 0.5]} />{pmat(PROP_COLORS.chefWhite2)}</mesh>
          </group>
        );
      default:
        return null;
    }
  };

  return (
    <group ref={root}>
      {/* 腿 */}
      <mesh position={[-0.14, 0.35, 0]} material={legMats}><boxGeometry args={[0.26, 0.7, 0.26]} /></mesh>
      <mesh position={[0.14, 0.35, 0]} material={legMats}><boxGeometry args={[0.26, 0.7, 0.26]} /></mesh>
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
      {/* 头 */}
      <mesh ref={head} position={[0, 1.675, 0]} material={headMats}>
        <boxGeometry args={[0.55, 0.55, 0.55]} />
      </mesh>
      {/* 角色专属道具（共享几何，各风格分支只换材质/配色） */}
      {!bankrupt && roleProp(role)}

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
