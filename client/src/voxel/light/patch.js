// 材质补丁(P1-2/3/4):遍历场景给不透明 MeshStandardMaterial 注入光照体积采样——
//   环境+弹射项:探针体积 SH-L1(环境色/弹射色已在烘焙期折入,运行时直接当 irradiance 用)
//   直射项:≤8 盏解析点光(槽 0/1 吊灯/炉火,槽 2-7 发光素材虚拟灯;E.3)× 烘焙可见度(软阴影)× 强度动画
//   镜面项(v2 E.1):同一组灯(含壁灯补光)的 GGX 直射高光——金属/粗糙度走标准
//   材质链(VoxModel 的 aRm 顶点属性已在 roughnessmap/metalnessmap 阶段乘入)
// 不改任何造景源文件;补丁可完整撤销(unpatch 还原 onBeforeCompile/cacheKey)。
// three 升级 shader chunk 锚点时单点适配此文件;锚点缺失 = 注入静默不生效(shader 原样跑)。
// 与 VoxModel 的 injectRm/injectEmit 组合:先跑原 onBeforeCompile 再叠本补丁(链式包裹)。
import * as THREE from 'three';
import { DOMAIN } from './domain.js';
import { VOL } from './volume.js';

// 所有补丁材质共享同一组 uniform 对象(换体积/换灯/闪烁 = 改 .value,不用重编译)。
// 灯槽 8 个(E.3):0/1 = 宿主配置的真实灯(闪烁走 uVoxLK),2-7 = 烘焙时发现的虚拟发光灯。
// uVoxLN/uVoxFN = 实际灯数(片元循环早退——8 槽满跑会把空载片元成本翻倍,E.5 提前项)。
export function createLightUniforms() {
  return {
    // 世界 → 烘焙域。默认 identity(VoxLab 世界轴);主游戏传 spaceRoot 时逐帧刷新为
    // spaceRoot.matrixWorld^-1,让整间酒馆任意旋转而固定域/解析墙仍在 canonical 局部坐标。
    uVoxWorldToBake: { value: new THREE.Matrix4() },
    // SH 三张打包(E.5):12 通道(m0/mx/my/mz 各 rgb)恰填 3×RGBA——比四张少一次
    // 逐片元 3D 采样;逐通道数值/插值与四张时逐位一致(纯 swizzle),布局见 volume.js
    uVoxShA: { value: null },
    uVoxShB: { value: null },
    uVoxShC: { value: null },
    uVoxVis: { value: null },
    uVoxVis2: { value: null },
    uVoxLN: { value: 0 },
    uVoxFN: { value: 0 },
    // 镜面模式(E.5):0=关(归因测量) 1=门控(默认:粗糙电介质片元整段跳过) 2=全跑
    uVoxSpecMode: { value: 1 },
    uVoxLPos: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uVoxLColor: { value: Array.from({ length: 8 }, () => new THREE.Color(0)) },
    uVoxLK: { value: new Float32Array(8) },
    uVoxLDist: { value: new Float32Array(8).fill(1) },
    uVoxLSrcR: { value: new Float32Array(8).fill(0.3) },
    // 补光灯 ≤6(壁灯烛台这类贴墙小灯):解析直射、**不占可见度通道**(贴墙灯没有可遮挡的路径,
    // 影子意义≈0;8 个通道留给主灯/虚拟发光灯)。raster 模式无此灯——壁灯在 raster 里本来
    // 就只是自发光面片,这是 voxel 模式的观感升级而非对齐项。
    uVoxFPos: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    uVoxFColor: { value: Array.from({ length: 6 }, () => new THREE.Color(0)) },
    uVoxFK: { value: new Float32Array(6) },
    uVoxFDist: { value: new Float32Array([1, 1, 1, 1, 1, 1]) },
    uVoxFSrcR: { value: new Float32Array([0.15, 0.15, 0.15, 0.15, 0.15, 0.15]) },
  };
}

// spaceRoot 可为 Object3D 或 React ref；null = 世界域(identity)。只改共享 uniform,不重编译。
// 当前生产场景的根只有平移/绕 Y 旋转/单位缩放；shader 对法线/视向量使用 mat3 变换。
// 若未来给根加非均匀缩放,应升级为独立 normal matrix，而不是默默接受错误高光。
export function setSpaceOnUniforms(uni, spaceRoot) {
  const root = spaceRoot?.current ?? spaceRoot ?? null;
  const m = uni.uVoxWorldToBake.value;
  if (!root) {
    m.identity();
    return m;
  }
  root.updateWorldMatrix?.(true, false);
  m.copy(root.matrixWorld).invert();
  return m;
}
// fills ≤6:{pos:[x,y,z], color, intensity, distance, srcR}
export function setFillsOnUniforms(uni, fills) {
  for (let i = 0; i < 6; i++) {
    const f = fills?.[i];
    uni.uVoxFPos.value[i].set(...(f?.pos ?? [0, 0, 0]));
    uni.uVoxFColor.value[i].set(f?.color ?? 0x000000);
    uni.uVoxFK.value[i] = f?.intensity ?? 0;
    uni.uVoxFDist.value[i] = f?.distance ?? 1;
    uni.uVoxFSrcR.value[i] = f?.srcR ?? 0.15;
  }
  uni.uVoxFN.value = Math.min(fills?.length ?? 0, 6);
}
export function setVolumeOnUniforms(uni, vol) {
  uni.uVoxShA.value = vol?.shA ?? null;
  uni.uVoxShB.value = vol?.shB ?? null;
  uni.uVoxShC.value = vol?.shC ?? null;
  uni.uVoxVis.value = vol?.vis ?? null;
  uni.uVoxVis2.value = vol?.vis2 ?? null;
}
// lights ≤8(E.3):{pos:[x,y,z], color(three 色值), intensity, distance, srcR}
export function setLightsOnUniforms(uni, lights) {
  for (let i = 0; i < 8; i++) {
    const l = lights[i];
    uni.uVoxLPos.value[i].set(...(l?.pos ?? [0, 0, 0]));
    uni.uVoxLColor.value[i].set(l?.color ?? 0x000000);
    uni.uVoxLK.value[i] = l?.intensity ?? 0;
    uni.uVoxLDist.value[i] = l?.distance ?? 1;
    uni.uVoxLSrcR.value[i] = l?.srcR ?? 0.3;
  }
  uni.uVoxLN.value = Math.min(lights.length, 8);
}

// uvw 归一化除数 = 光照体积的覆盖范围(探针网格 VOL,64×26×64 × 0.4m),不是 DOMAIN 尺寸——
// y 向 DOMAIN 是 10.24m 而体积盖 10.4m,用错整个光照场在 y 向被拉伸 1.6%,天花板附近偏
// 整整一个探针层(对抗审计确认项;x/z 恰好同值 25.6 掩盖了问题)
const EXT = [VOL.nx * VOL.cell, VOL.ny * VOL.cell, VOL.nz * VOL.cell];
const GLSL = /* glsl */`
uniform mat4 uVoxWorldToBake;
uniform sampler3D uVoxShA, uVoxShB, uVoxShC, uVoxVis, uVoxVis2;
uniform int uVoxLN;
uniform int uVoxFN;
uniform int uVoxSpecMode;
uniform vec3 uVoxLPos[8];
uniform vec3 uVoxLColor[8];
uniform float uVoxLK[8];
uniform float uVoxLDist[8];
uniform float uVoxLSrcR[8];
uniform vec3 uVoxFPos[6];
uniform vec3 uVoxFColor[6];
uniform float uVoxFK[6];
uniform float uVoxFDist[6];
uniform float uVoxFSrcR[6];
varying vec3 vVoxWorld;
vec3 voxUvw(vec3 wp, vec3 n) {
  return (wp + n * 0.2 - vec3(${DOMAIN.origin[0].toFixed(3)}, ${DOMAIN.origin[1].toFixed(3)}, ${DOMAIN.origin[2].toFixed(3)}))
       / vec3(${EXT[0].toFixed(3)}, ${EXT[1].toFixed(3)}, ${EXT[2].toFixed(3)});
}
vec3 voxIrradiance(vec3 uvw, vec3 n) {
  // 三张打包解码(布局:A=m0.rgb+mx.r / B=mx.gb+my.rg / C=my.b+mz.rgb)
  vec4 a = texture(uVoxShA, uvw);
  vec4 b = texture(uVoxShB, uvw);
  vec4 c = texture(uVoxShC, uvw);
  vec3 m0 = a.rgb;
  vec3 mx = vec3(a.a, b.r, b.g);
  vec3 my = vec3(b.b, b.a, c.r);
  vec3 mz = c.gba;
  // E(n) = m0 + 2·m1·n(L1 矩重建);环境色×AO 与弹射 GI 都折在矩里,只钳下限
  return max(m0 + 2.0 * (mx * n.x + my * n.y + mz * n.z), vec3(0.0));
}
// 解析点光直射(与 three PointLight 同式:color×intensity × 1/d² × 截断平滑 × dotNL),
// 乘烘焙可见度 → 软阴影;闪烁/压光走 uVoxLK,与烘焙解耦(P1-3 的核心解法)。
// vis 由主块采一次传入(镜面项也要用,省一次 3D 纹理取样);uVoxLN 早退 =
// 片元成本随实际灯数走,8 槽不加空载负担(uniform 一致分支,E.5 提前项)
vec3 voxDirect(vec3 wp, vec3 n, float vis[8]) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uVoxLN) break;
    vec3 lv = uVoxLPos[i] - wp;
    float d = max(length(lv), 0.02);
    if (d >= uVoxLDist[i]) continue;   // 截断距离外 cut 恒 0,早退省后续数学(E.5)
    float dnl = saturate(dot(n, lv / d));
    // 近场按源半径钳制:这些点光是"烛环/火堆/发光簇"的面光近似,零距离 1/d² 会把
    // 灯体自身照成熔金(用户真机实测);d≥srcR 处与 1/d² 完全一致,远场零影响
    float fall = 1.0 / max(d * d, uVoxLSrcR[i] * uVoxLSrcR[i]);
    float cut = pow2(saturate(1.0 - pow4(d / uVoxLDist[i])));
    acc += uVoxLColor[i] * (uVoxLK[i] * dnl * fall * cut * vis[i]);
  }
  // 补光灯(壁灯烛台):同一套衰减,无可见度(贴墙灯不占通道)。
  // 环绕项(wrap=0.6):蜡烛的近距弹射光——纯 dot(n,l) 会让墙角的垂直邻墙(入射角≈0)
  // 死黑,与被照墙形成生硬的一亮一黑(用户真机实测);半兰伯特包一圈,过渡即柔
  for (int i = 0; i < 6; i++) {
    if (i >= uVoxFN) break;
    vec3 lv = uVoxFPos[i] - wp;
    float d = max(length(lv), 0.02);
    if (d >= uVoxFDist[i]) continue;   // 壁灯 dist 5m,远半间房的片元整段跳过
    float dnl = saturate((dot(n, lv / d) + 0.6) / 1.6);
    float fall = 1.0 / max(d * d, uVoxFSrcR[i] * uVoxFSrcR[i]);
    float cut = pow2(saturate(1.0 - pow4(d / uVoxFDist[i])));
    acc += uVoxFColor[i] * (uVoxFK[i] * dnl * fall * cut);
  }
  return acc;
}
`;
// E.1 镜面直射(v2):同一套灯参数/衰减/可见度,BRDF 换 GGX——用 three 内建直射同款
// BRDF_GGX_Multiscatter(RE_Direct_Physical 里就是它,能量口径一致;含多散射补偿,
// 高粗糙度不发灰)。它和 PhysicalMaterial 结构体都定义在 lights_physical_pars_fragment,
// 在 <common> 之后——所以这块必须注在那个锚点后面,不能并进上面的 GLSL 块。
// 补光灯的镜面用真 dotNL 门控(不是漫反射那个 wrap 半兰伯特——wrap 是弹射光近似,
// 拿去门控镜面会让背光面冒出高光)。
const GLSL_SPEC = /* glsl */`
vec3 voxDirectSpec(const in vec3 wp, const in vec3 n, const in vec3 v, const in float vis[8], const in PhysicalMaterial material) {
  // E.5 惰性镜面:模式 0 = 全关(?voxspec=0,归因测量);模式 1(默认)= 粗糙电介质
  // 片元整段跳过——木/石/布(rough≈1、F0≈0.04)的 GGX 宽瓣在这间暗酒馆里趋不可见,
  // 而它们占满屏片元的绝大多数;金属/低粗糙片元(specularColor 亮 或 rough 低)照常跑。
  // aRm 是顶点属性 → 同一材质内逐片元分流,但体素同色块连片,warp 内高度一致,分支便宜。
  if (uVoxSpecMode == 0) return vec3(0.0);
  if (uVoxSpecMode == 1
      && material.roughness > 0.85
      && max(material.specularColor.r, max(material.specularColor.g, material.specularColor.b)) < 0.05) {
    return vec3(0.0);
  }
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uVoxLN) break;
    vec3 lv = uVoxLPos[i] - wp;
    float d = max(length(lv), 0.02);
    if (d >= uVoxLDist[i]) continue;   // 截断外 cut 恒 0,GGX 是循环里最贵的一段
    vec3 l = lv / d;
    float fall = 1.0 / max(d * d, uVoxLSrcR[i] * uVoxLSrcR[i]);
    float cut = pow2(saturate(1.0 - pow4(d / uVoxLDist[i])));
    vec3 irr = uVoxLColor[i] * (uVoxLK[i] * saturate(dot(n, l)) * fall * cut * vis[i]);
    acc += irr * BRDF_GGX_Multiscatter(l, v, n, material);
  }
  for (int i = 0; i < 6; i++) {
    if (i >= uVoxFN) break;
    vec3 lv = uVoxFPos[i] - wp;
    float d = max(length(lv), 0.02);
    if (d >= uVoxFDist[i]) continue;
    vec3 l = lv / d;
    float fall = 1.0 / max(d * d, uVoxFSrcR[i] * uVoxFSrcR[i]);
    float cut = pow2(saturate(1.0 - pow4(d / uVoxFDist[i])));
    vec3 irr = uVoxFColor[i] * (uVoxFK[i] * saturate(dot(n, l)) * fall * cut);
    acc += irr * BRDF_GGX_Multiscatter(l, v, n, material);
  }
  return acc;
}
`;

function injectVoxLight(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = 'varying vec3 vVoxWorld;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vVoxWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
  );
  // 函数块注在 <common> 之后(要用它定义的 saturate/pow2/pow4/BRDF_Lambert),不能整体前置;
  // 镜面块要用 PhysicalMaterial/BRDF_GGX_Multiscatter,注在 lights_physical_pars_fragment 之后
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\n' + GLSL,
  ).replace(
    '#include <lights_physical_pars_fragment>',
    '#include <lights_physical_pars_fragment>\n' + GLSL_SPEC,
  ).replace(
    '#include <lights_fragment_begin>',
    // 采样点沿法线抬半探针格(voxUvw):探针落在实体内是全黑,贴面采样会把面吃暗。
    // 环境+弹射走 irradiance(getAmbientLightIrradiance 同标定:不乘 π,r184 实测);
    // 直射走 directDiffuse(与 pointLight 的 RE_Direct 同路)+ directSpecular(E.1 GGX,
    // 视向量用世界系 cameraPosition 现算——BRDF 只做点积,全程世界系即自洽;
    // material.diffuseColor 已被 three 按 metalness 消隐,金属的能量全走 specularColor)。
    // ⚠ 坐标系:lights 阶段的 normal 是**视空间**——必须先转回世界空间再与世界系的灯向量/
    // SH 方向矩点积。直接用 normal 的症状:光照随相机角度出现/消失、墙角一面亮一面死黑
    // (用户真机实测,2026-07-17)。inverseTransformDirection(dir, viewMatrix) = 视→世界。
    `#include <lights_fragment_begin>
  {
    vec3 voxWorldN = inverseTransformDirection(normal, viewMatrix);
    vec3 voxWp = (uVoxWorldToBake * vec4(vVoxWorld, 1.0)).xyz;
    vec3 voxN = normalize(mat3(uVoxWorldToBake) * voxWorldN);
    vec3 voxuvw = voxUvw(voxWp, voxN);
    vec4 voxvisA = texture(uVoxVis, voxuvw);
    // 槽 4-7 只有玩家摆 >2 盏发光素材才占用——默认场景省掉第 6 次 3D 采样(uniform 分支)
    vec4 voxvisB = (uVoxLN > 4) ? texture(uVoxVis2, voxuvw) : vec4(0.0);
    float voxvis[8];
    voxvis[0] = voxvisA.x; voxvis[1] = voxvisA.y; voxvis[2] = voxvisA.z; voxvis[3] = voxvisA.w;
    voxvis[4] = voxvisB.x; voxvis[5] = voxvisB.y; voxvis[6] = voxvisB.z; voxvis[7] = voxvisB.w;
    vec3 voxV = normalize(mat3(uVoxWorldToBake) * (cameraPosition - vVoxWorld));
    irradiance += voxIrradiance(voxuvw, voxN);
    reflectedLight.directDiffuse += voxDirect(voxWp, voxN, voxvis) * BRDF_Lambert(material.diffuseColor);
    reflectedLight.directSpecular += voxDirectSpec(voxWp, voxN, voxV, voxvis, material);
  }`,
  );
}

// 补丁代数(2026-07-18 L 循环重进死黑修复):three 给每个材质私藏一张 cacheKey→program 的
// Map,needsUpdate 不清它——重打补丁时若 key 与上一轮相同,会命中旧 patched program 并走
// 捷径:onBeforeCompile 不再执行、materialProperties.uniforms 也不更新(还停在 raster 期
// 的无 uVox 清单)→ 5 个 sampler3D 全没被 uniform1i,落在纹理单元 0 与 2D 贴图同槽 →
// GL_INVALID_OPERATION「Two textures of different types use the same sampler location」
// → draw call 整个被丢(只剩没打补丁的发光桶在渲染,全场死黑)。每次 unpatch 递增代数、
// 打补丁时把代数烤进 cacheKey,强制重进走 miss 路线重编译(模式切换低频,重编译可接受)。
let patchGen = 0;

// 打补丁:root 下所有不透明 lit 材质(basic/points/lines 无光照路径跳过;透明桶保持原样)。
// 材质可能被多 mesh 共享——按 uuid 去重,记录进 patched Map 供 unpatch。
export function patchMaterials(root, uniforms, patched = new Map()) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      // voxUnlit:发光桶等"自己就是光源"的材质不吃注入光(点亮自己=过曝;VoxModel 打标)
      if (!m || !m.isMeshStandardMaterial || m.transparent || m.userData?.voxUnlit || patched.has(m.uuid)) continue;
      const prev = m.onBeforeCompile;
      // cache key 必须在替换 onBeforeCompile **之前**求值成快照——three 基类的
      // customProgramCacheKey 是原型方法,返回 this.onBeforeCompile.toString() 且调用时才求值;
      // 若只 bind 再事后调用,拿到的是补丁 wrapper 自己的源码,所有被补丁材质 key 相同 →
      // three 复用第一个编译的 program,后来者的原注入被静默丢弃(对抗审计确认项)
      const hadOwnKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey');
      const ownKeyFn = hadOwnKey ? m.customProgramCacheKey : null;
      const keySnapshot = m.customProgramCacheKey();
      patched.set(m.uuid, { mat: m, prev, hadOwnKey, ownKeyFn });
      m.onBeforeCompile = (shader, renderer) => {
        if (prev) prev(shader, renderer);
        injectVoxLight(shader, uniforms);
      };
      const gen = patchGen;   // 快照本轮代数(闭包读活值会在 unpatch 后漂移)
      m.customProgramCacheKey = () => `${keySnapshot}|voxlit${gen}`;
      m.needsUpdate = true;
    }
  });
  return patched;
}

export function unpatchMaterials(patched) {
  patchGen++;   // 换代:下一轮补丁的 cacheKey 必不与本轮相同(见 patchGen 注释)
  for (const entry of patched.values()) restoreMaterial(entry);
  patched.clear();
}

function restoreMaterial({ mat, prev, hadOwnKey, ownKeyFn }) {
  mat.onBeforeCompile = prev;
  // 还原到打补丁前的形态:自有 key 还回去,原本走原型方法的删掉自有属性回落原型
  if (hadOwnKey) mat.customProgramCacheKey = ownKeyFn;
  else delete mat.customProgramCacheKey;
  mat.needsUpdate = true;
}

// 主游戏会在阶段切换后才挂 Coin/MoneyStack/Payout 材质。VoxelLight 低频调用本函数清掉
// 已卸载材质的强引用；否则 patched Map 会跨轮累计。仍在场景中的新材质由 patchMaterials
// 幂等补挂，整个过程只触发新材质编译，不触发体积重烘。
export function prunePatchedMaterials(root, patched) {
  const live = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) if (mat) live.add(mat.uuid);
  });
  for (const [uuid, entry] of patched) {
    if (live.has(uuid)) continue;
    restoreMaterial(entry);
    patched.delete(uuid);
  }
  return patched;
}
