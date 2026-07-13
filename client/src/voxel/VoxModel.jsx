// 通用体素模型组件:<VoxModel url={...}/> — 加载 .vox,按 docs/VOXEL_PLAN.md §1 的材质规范渲染。
// P0-3 材质三件套(MATL 驱动,与 MagicaVoxel 材质面板一一对应):
//   main     = diffuse+metal 合桶:粗糙/金属走 aRm 顶点属性(onBeforeCompile 乘回)——
//              metal=0 的体素与旧版逐位元恒等;
//   emissive = 发光桶:辐射 = 顶点色 × aEmit × emissiveIntensity(有色发光,不再泛白);
//   glass    = 玻璃桶:透明 + 不写深度,不投影。
// 锚点:XZ 居中、Y=0 在模型底部。
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadVox } from './voxload';

export const VOXEL_SIZE = 0.015; // 全局体素尺度 s≈1.5cm(docs/VOXEL_PLAN.md §1;唯一旋钮,勿在别处另设)

// aRm 注入:声明 varying + begin_vertex 传递 + 粗糙/金属因子相乘。
// 注入集中在此,three 升级 shader chunk 命名时单点适配。
const injectRm = (shader) => {
  shader.vertexShader = 'attribute vec2 aRm;\nvarying vec2 vRm;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vRm = aRm;',
  );
  shader.fragmentShader = 'varying vec2 vRm;\n' + shader.fragmentShader
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= vRm.x;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor *= vRm.y;');
};
// aEmit 注入:辐射 = 顶点色 × emitK × emissive(uniform=白×emissiveIntensity)
const injectEmit = (shader) => {
  shader.vertexShader = 'attribute float aEmit;\nvarying float vEmit;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vEmit = aEmit;',
  );
  shader.fragmentShader = 'varying float vEmit;\n' + shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    'totalEmissiveRadiance = vColor.rgb * vEmit * emissive;',
  );
};

export default function VoxModel({
  url,
  scale = VOXEL_SIZE,
  emissiveColors = null,     // hex 数组:旧资产回退(与 .vox 内嵌 MATL 取并集)
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

  const mats = useMemo(() => {
    const main = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, flatShading: true });
    main.onBeforeCompile = injectRm;
    main.customProgramCacheKey = () => 'vox-rm';
    const emissive = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.6, flatShading: true,
      emissive: new THREE.Color('#ffffff'), emissiveIntensity,
    });
    emissive.onBeforeCompile = injectEmit;
    emissive.customProgramCacheKey = () => 'vox-emit';
    return { main, emissive };
  }, [emissiveIntensity]);
  const glassMat = useMemo(() => {
    if (!model?.glass) return null;
    return new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true,
      transparent: true, opacity: model.glassAlpha ?? 0.4, depthWrite: false,
      roughness: model.glassRough ?? 0.2,
    });
  }, [model]);

  if (!model) return null;
  const off = anchor === 'center'
    ? [-model.size.x / 2, -model.size.y / 2, -model.size.z / 2]
    : [-model.size.x / 2, 0, -model.size.z / 2];
  return (
    <group {...groupProps}>
      <group scale={scale} position={[off[0] * scale, off[1] * scale, off[2] * scale]}>
        {model.main && (
          <mesh geometry={model.main} material={mats.main} castShadow={castShadow} receiveShadow={receiveShadow} />
        )}
        {model.emissive && (
          <mesh geometry={model.emissive} material={mats.emissive} castShadow={false} />
        )}
        {model.glass && glassMat && (
          <mesh geometry={model.glass} material={glassMat} castShadow={false} />
        )}
      </group>
    </group>
  );
}
