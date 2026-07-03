// 招募令 3D 半身像（反馈：身体与饰品都要用真 3D 模型/纹理，二者一致）：
// 复用 MinecraftPlayer 的身体皮肤材质(partMats)与头顶道具(HeadProp)——躯干+双臂照旧，
// 去掉头，头的位置浮着标志性饰品。放进 RoleWall 的微型 <Canvas frameloop="demand"> 里，
// 只渲一帧（静态），近乎零持续开销。
import * as THREE from 'three';
import { skinTex } from '../assets/texlib';
import { HeadProp } from './MinecraftPlayer';

// 身体皮肤材质(与 3D 玩家同一批 skinTex 纹理,只是另建材质对象;按 role|part 缓存)。
const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'];
const BUST_MAT_CACHE = new Map();
function bustMats(role, part) {
  const key = `${role}|${part}`;
  if (BUST_MAT_CACHE.has(key)) return BUST_MAT_CACHE.get(key);
  const arr = FACE_ORDER.map(face => new THREE.MeshStandardMaterial({
    map: skinTex({ role, part, face, bankrupt: false }), roughness: 1, flatShading: true,
  }));
  BUST_MAT_CACHE.set(key, arr);
  return arr;
}

export default function RoleBust3D({ role = 'none' }) {
  const bodyMats = bustMats(role, 'body');
  const armMats = bustMats(role, 'arm');
  return (
    <group>
      <ambientLight intensity={0.92} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.05} />
      <directionalLight position={[-3, 1, 2]} intensity={0.35} />
      {/* 把胸像框到画面：冠顶靠上、身体填满往下(腰部裁掉,标准半身像) */}
      <group position={[0, -1.5, 0]}>
        {/* 躯干 + 双臂（与 3D 玩家同一批皮肤材质） */}
        <mesh position={[0, 1.05, 0]} material={bodyMats}><boxGeometry args={[0.6, 0.7, 0.3]} /></mesh>
        <mesh position={[-0.41, 1.05, 0]} material={armMats}><boxGeometry args={[0.22, 0.7, 0.26]} /></mesh>
        <mesh position={[0.41, 1.05, 0]} material={armMats}><boxGeometry args={[0.22, 0.7, 0.26]} /></mesh>
        {/* 头位浮空饰品（无头）：HeadProp 坐标为头部局部系，挂在原头中心 y=1.675 处 */}
        <group position={[0, 1.72, 0]}><HeadProp role={role} /></group>
      </group>
    </group>
  );
}
