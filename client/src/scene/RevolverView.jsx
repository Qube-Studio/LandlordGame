// 处决窗第一人称左轮视模（§3.9，MVP=静态跟随；后坐/火光后置）：
// 每帧把持枪组钉在相机位姿上（无现成 camera-attach，逐帧拷贝最稳），右下持枪位。
// 素材 assets/vox/props/revolver.vox（36×24×9 格,枪口指 +x → 绕 Y −90° 对齐相机前方 −z；
// 生成器 tools/voxrevolver.mjs,VOXEL_SIZE 尺度全长 54cm,FP 视模略缩 0.8 不占画面）。
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import VoxModel, { VOXEL_SIZE } from '../voxel/VoxModel';
import revolverUrl from '../assets/vox/props/revolver.vox?url';

export default function RevolverView() {
  const ref = useRef();
  const { camera } = useThree();
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.copy(camera.position);
    ref.current.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={ref}>
      {/* 右下持枪位（相机局部系）：FP 视模缩半（54cm 素材在半米处过大）、
          轻微内八 yaw + 枪口微垂 pitch——像握枪不像端枪 */}
      <group position={[0.22, -0.18, -0.58]} rotation={[-0.06, -Math.PI / 2 + 0.1, 0.02]}>
        <VoxModel url={revolverUrl} scale={VOXEL_SIZE * 0.5} anchor="center" castShadow={false} />
      </group>
    </group>
  );
}
