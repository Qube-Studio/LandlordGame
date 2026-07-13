// 通用体素模型组件:<VoxModel url={...}/> — 加载 .vox,按 docs/VOXEL_PLAN.md §1 的材质规范渲染
// (顶点色 MeshStandardMaterial + flatShading;自发光体素拆子网格走 emissive+Bloom)。
// 锚点:XZ 居中、Y=0 在模型底部(与放在地面/桌面的世界摆位习惯一致)。
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadVox } from './voxload';

export const VOXEL_SIZE = 0.015; // 全局体素尺度 s≈1.5cm(docs/VOXEL_PLAN.md §1;唯一旋钮,勿在别处另设)

export default function VoxModel({
  url,
  scale = VOXEL_SIZE,
  emissiveColors = null,     // hex 数组:这些颜色的体素发光
  emissiveIntensity = 1.4,
  castShadow = true,
  receiveShadow = false,
  anchor = 'bottom',         // 'bottom' = XZ 居中 + Y0 在底;'center' = 全轴居中
  onLoaded = null,
  ...groupProps
}) {
  const [model, setModel] = useState(null);
  useEffect(() => {
    let live = true;
    loadVox(url, { emissiveColors: emissiveColors ?? undefined })
      .then((m) => { if (live) { setModel(m); onLoaded?.(m); } })
      .catch((e) => console.error('[VoxModel]', e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, emissiveColors?.join(',')]);

  const mats = useMemo(() => ({
    main: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    emissive: new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.6, flatShading: true,
      emissive: new THREE.Color('#ffffff'), emissiveIntensity,
    }),
  }), [emissiveIntensity]);

  if (!model) return null;
  const off = anchor === 'center'
    ? [-model.size.x / 2, -model.size.y / 2, -model.size.z / 2]
    : [-model.size.x / 2, 0, -model.size.z / 2];
  return (
    <group {...groupProps}>
      <group scale={scale} position={[off[0] * scale, off[1] * scale, off[2] * scale]}>
        <mesh geometry={model.main} material={mats.main} castShadow={castShadow} receiveShadow={receiveShadow} />
        {model.emissive && (
          <mesh geometry={model.emissive} material={mats.emissive} castShadow={false} />
        )}
      </group>
    </group>
  );
}
