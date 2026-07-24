// 烘焙混合光照的 r3f 挂载点(P1-1 域+debug 可视化;P1-2 GPU 烘焙器+材质补丁)。
// 通用组件,不依赖 labStore——宿主(voxlab/Stage)喂 props:
//   active      true = 建域并烘焙(去抖两拍:500ms 主烘 + 3s 补烘,等 VoxModel 异步挂进场景)
//   debug       true = 显示可视化(粗层占位线框盒 + 细层切片;[ / ] 调切片高度)
//   lit         true = 烘光照体积并给全场不透明材质打 SH 环境项补丁(宿主须同时卸掉 ambientLight 防双计)
//   ambient     {color, intensity}:被替换的环境光参数(体积全开处曝光对齐 raster)
//   rebakeKeys  依赖数组语义的触发值(宿主把静态几何/灯参版本塞进来,变化即重烘)
//   spaceRoot   可选 Object3D/ref:烘焙与运行时采样都固定在该酒馆根的局部坐标
//   onStatus    可选回调:'baking' | 'ready' | 'failed'；宿主据此原子切换/回退旧光栅灯
//   patchInterval 动态材质增量扫描秒数(默认 .5；不触发重烘)
// 探针:window.__voxbake = {cells, ms, volMs, …}(与 __voxlab 分开——LabRig 逐帧整体覆写)。
/* eslint-disable react-hooks/immutability -- three 惯用法:uniform.value 逐帧写(炉火闪烁),与 LabRig 同款豁免 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DOMAIN, createDomain, getCell, worldOf } from './domain';
import { bakeAll } from './bake';
import { buildLightVolume, getVoxelLightSupport } from './volume';
import { findEmissiveLights } from './cluster';
import {
  createLightUniforms, setVolumeOnUniforms, setLightsOnUniforms, setFillsOnUniforms,
  setSpaceOnUniforms, patchMaterials, prunePatchedMaterials, unpatchMaterials,
} from './patch';

// 虚拟发光灯标定:intensity = min(簇能量 × VIRT_K, VIRT_MAX);distance/srcR 固定。
// 以吊灯(intensity 21)为锚肉眼校过一轮。VIRT_MAX 封顶(用户真机实测的教训):
// 簇能量随发光体素数量线性涨,大素材(整盏吊灯摆地上)不封顶会算出远超真吊灯的强度,
// 把源体自己和旁边角色照爆——单个摆放灯不该比主吊灯还亮。
const VIRT_K = 0.5;
const VIRT_MAX = 12;
// 灯池半径 9→6(E.5):9m 时一盏摆放灯覆盖大半间房,片元灯循环的距离早退形同虚设;
// 6m 让远处片元真正剪枝,多摆灯的运行时成本从"全场×盏数"降为"局部×盏数"
const VIRT_DIST = 6;
const VIRT_SRC_R = 0.35;

// domain.js 现含占位/反照率/发光累加与成品数组,实算约 87.7MiB。生产旧档必须真的
// 释放它,因此改为组件实例惰性持有；active=false 后丢引用供 GC，而非模块级永久单例。

const resolveSpaceRoot = (value) => {
  if (!value) return null;
  if (value.isObject3D) return value;
  return value.current?.isObject3D ? value.current : null;
};

export default function VoxelLight(props) {
  // 子组件边界让 active=false 真正卸载全部 hooks/typed arrays/3D textures；这比在 effect
  // 里同步 setState 清空更安全，也让 classic 档不会常驻近 88MiB 烘焙域。
  return props.active ? <ActiveVoxelLight {...props} /> : null;
}

function ActiveVoxelLight({
  debug,
  lit = false,
  ambient = null,
  lights = null,
  fillLights = null,
  sun = null,
  rebakeKeys = [],
  spaceRoot = null,
  onStatus = null,
  patchInterval = 0.5,
}) {
  const { scene, gl } = useThree();
  const [domain] = useState(createDomain);

  const chainRef = useRef(Promise.resolve());
  const [bakeStamp, setBakeStamp] = useState(0);
  const [volumeReady, setVolumeReadyState] = useState(false);
  const volumeReadyRef = useRef(false);
  const setVolumeReady = useCallback((value) => {
    volumeReadyRef.current = value;
    setVolumeReadyState(value);
  }, []);

  const lightsRef = useRef(lights);
  useEffect(() => { lightsRef.current = lights; }, [lights]);
  const statusCbRef = useRef(onStatus);
  useEffect(() => { statusCbRef.current = onStatus; }, [onStatus]);
  const lastStatusRef = useRef(null);
  const reportStatus = useCallback((status) => {
    if (lastStatusRef.current === status) return;
    lastStatusRef.current = status;
    statusCbRef.current?.(status);
  }, []);

  const uniforms = useMemo(() => createLightUniforms(), []);
  const volRef = useRef(null);
  const bakeSigRef = useRef(null);
  const patchedRef = useRef(new Map());
  const nextPatchAt = useRef(0);

  useEffect(() => () => {
    volRef.current?.dispose();
    volRef.current = null;
    setVolumeOnUniforms(uniforms, null);
    unpatchMaterials(patchedRef.current);
    if (typeof window !== 'undefined') {
      window.__voxvol = null;
      window.__voxuni = null;
    }
  }, [uniforms]);

  // 补光灯(壁灯烛台,≤6):静态解析灯,无可见度通道/无闪烁。
  useEffect(() => { setFillsOnUniforms(uniforms, fillLights ?? []); }, [uniforms, fillLights]);

  // 逐帧只改少量 uniform；每 patchInterval 秒扫描一次后来挂载的 Coin/Money/Payout
  // 材质并清掉卸载材质强引用。扫描不碰占位域、不触发重烘。
  useFrame((st) => {
    setSpaceOnUniforms(uniforms, spaceRoot);
    if (!lit || !volumeReadyRef.current) return;

    const ls = lightsRef.current;
    if (ls) {
      for (let i = 0; i < 2; i++) {
        if (ls[i]?.flicker) uniforms.uVoxLK.value[i] = ls[i].flicker(st.clock.elapsedTime);
      }
    }

    if (!(patchInterval > 0) || st.clock.elapsedTime < nextPatchAt.current) return;
    nextPatchAt.current = st.clock.elapsedTime + Math.max(0.1, patchInterval);
    patchMaterials(scene, uniforms, patchedRef.current);
    prunePatchedMaterials(scene, patchedRef.current);
  });

  useEffect(() => {
    let dead = false;
    // 已有可用体积时后台重烘不降回旧灯；只有首烘对宿主暴露 baking 门控。
    if (lit && !volRef.current) reportStatus('baking');

    const fail = (reason, stats = null) => {
      if (dead) return;
      if (!volRef.current) setVolumeReady(false);
      if (typeof window !== 'undefined') {
        window.__voxbake = { ...(window.__voxbake ?? {}), ...(stats ?? {}), failed: true, reason };
      }
      reportStatus('failed');
    };

    const run = () => {
      // 串行链:补烘/连续触发不并行改写同一个域。
      chainRef.current = chainRef.current.then(async () => {
        if (dead) return;

        if (lit) {
          const support = getVoxelLightSupport(gl);
          if (!support.supported) {
            fail(support.reason);
            return;
          }
          if (!volRef.current) reportStatus('baking');
        }

        const localRoot = resolveSpaceRoot(spaceRoot);
        if (spaceRoot && !localRoot) {
          fail('space-root-unavailable');
          return;
        }
        const bakeRoot = localRoot ?? scene;
        setSpaceOnUniforms(uniforms, localRoot);
        const stats = await bakeAll(domain, bakeRoot, { spaceRoot: localRoot });
        if (dead) return;

        // debug 只需占位域；生产 lit 才建 GPU 光照体积。
        if (!lit) {
          if (typeof window !== 'undefined') window.__voxbake = { ...(window.__voxbake ?? {}), ...stats };
          setBakeStamp((s) => s + 1);
          return;
        }

        const q = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams();
        let rays = parseInt(q.get('voxrays'), 10) || undefined;
        if (!rays) {
          // 软件渲染自动降载；显式 ?voxrays 永远优先。
          const glc = gl.getContext();
          const dbg = glc.getExtension('WEBGL_debug_renderer_info');
          const rname = String(glc.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : glc.RENDERER) ?? '');
          if (/swiftshader|llvmpipe|software/i.test(rname)) rays = 16;
        }
        const bounces = parseInt(q.get('voxbounces'), 10) || undefined;
        const bounceK = parseFloat(q.get('voxbouncek')) || undefined;
        const specMode = parseInt(q.get('voxspec'), 10);
        uniforms.uVoxSpecMode.value = Number.isInteger(specMode) ? Math.max(0, Math.min(2, specMode)) : 1;
        if (typeof window !== 'undefined') window.__voxuni = uniforms;

        // 约定:传 spaceRoot 时，真实灯/补光灯/sun 全使用同一酒馆局部坐标。
        const real = lightsRef.current ?? [];
        const clusters = findEmissiveLights(domain, { exclude: real.map((l) => l.pos), maxLights: 6 });
        const virtual = clusters.map((c) => ({
          pos: c.pos,
          color: c.color,
          intensity: Math.min(c.power * VIRT_K, VIRT_MAX),
          distance: VIRT_DIST,
          srcR: VIRT_SRC_R,
        }));
        const all = [...real.slice(0, 2), ...virtual];
        const linear = (c) => {
          const t = new THREE.Color(...(Array.isArray(c) ? c : [c]));
          return [t.r, t.g, t.b];
        };
        const amb = new THREE.Color(ambient?.color ?? '#ffffff').multiplyScalar(ambient?.intensity ?? 0.5);

        // 粗层占位+发光体+全部光参的输入指纹；未变则跳过昂贵 GPU 体积重烘。
        const hashArr = (h, a) => {
          for (let i = 0; i < a.length; i++) {
            h = (h ^ a[i]) >>> 0;
            h = (((h << 5) | (h >>> 27)) + 0x9e3779b9) >>> 0;
          }
          return h;
        };
        let sig = hashArr(0x811c9dc5, domain.coarse);
        sig = hashArr(sig, new Uint32Array(domain.emi.buffer, 0, domain.emi.length));
        sig += '|' + JSON.stringify([
          rays, bounces, bounceK, [amb.r, amb.g, amb.b], sun,
          all.map((l) => [l.pos, l.srcR ?? 0.3, linear(l.color), l.intensity, l.distance]),
        ]);

        if (sig === bakeSigRef.current && volRef.current) {
          stats.volMs = volRef.current.ms;
          stats.volSkipped = true;
          if (typeof window !== 'undefined') window.__voxbake = { ...(window.__voxbake ?? {}), ...stats, failed: false };
          setSpaceOnUniforms(uniforms, localRoot);
          patchMaterials(scene, uniforms, patchedRef.current);
          setVolumeReady(true);
          nextPatchAt.current = 0;
          setBakeStamp((s) => s + 1);
          reportStatus('ready');
          return;
        }

        const nextVolume = buildLightVolume(gl, domain, {
          rays,
          bounces,
          bounceK,
          lights: all.map((l) => ({
            pos: l.pos,
            srcR: l.srcR ?? 0.3,
            color: linear(l.color),
            k: l.intensity,
            dist: l.distance,
          })),
          ambient: [amb.r, amb.g, amb.b],
          sun: sun ? (() => {
            const c = new THREE.Color(sun.color ?? '#ffffff').multiplyScalar(sun.intensity ?? 1);
            return { dir: sun.dir, color: [c.r, c.g, c.b] };
          })() : null,
        });
        if (!nextVolume) {
          fail('volume-build-failed', stats);
          return;
        }
        if (dead) {
          nextVolume.dispose();
          return;
        }

        // 新体积完整成功后再替换旧体积，失败不把当前可用画面先销毁。
        const previous = volRef.current;
        volRef.current = nextVolume;
        setVolumeOnUniforms(uniforms, nextVolume);
        setLightsOnUniforms(uniforms, all.map((l) => ({
          pos: l.pos,
          color: Array.isArray(l.color) ? new THREE.Color(...l.color) : l.color,
          intensity: l.intensity,
          distance: l.distance,
          srcR: l.srcR ?? 0.3,
        })));
        bakeSigRef.current = sig;
        previous?.dispose();

        stats.volMs = nextVolume.ms;
        stats.volBounces = nextVolume.bounces;
        stats.virtualLights = clusters.map((c) => ({
          pos: c.pos.map((v) => +v.toFixed(2)),
          power: +c.power.toFixed(2),
        }));
        if (typeof window !== 'undefined') {
          window.__voxbake = { ...(window.__voxbake ?? {}), ...stats, failed: false };
          window.__voxvol = {
            m0: (x, y, z) => volRef.current?.sampleM0(x, y, z),
            vis: (x, y, z) => volRef.current?.sampleVis(x, y, z),
            sh0: (x, y, z) => volRef.current?.sampleSh0(x, y, z),
            bounce0: (x, y, z) => volRef.current?.sampleBounce0(x, y, z),
          };
        }

        // onStatus('ready') 前先补当前材质，宿主此刻卸旧灯不会出现一帧黑场。
        setSpaceOnUniforms(uniforms, localRoot);
        patchMaterials(scene, uniforms, patchedRef.current);
        setVolumeReady(true);
        nextPatchAt.current = 0;
        setBakeStamp((s) => s + 1);
        reportStatus('ready');
      }).catch((e) => {
        console.warn('[voxlight] 烘焙失败', e);
        fail(e?.message ?? 'bake-failed');
      });
    };

    const t1 = setTimeout(run, 500);
    const t2 = setTimeout(run, 3000);
    return () => { dead = true; clearTimeout(t1); clearTimeout(t2); };
    // 宿主用 rebakeKeys 明确声明静态几何/灯参依赖；避免把每次 WS state 对象误放进来重烘。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, scene, gl, lit, uniforms, spaceRoot, ...rebakeKeys]);

  // 首个有效体积就绪后打补丁；退出 lit/active 或组件卸载时完整还原。
  useEffect(() => {
    if (!lit || !volumeReady) return undefined;
    const m = patchedRef.current;
    patchMaterials(scene, uniforms, m);
    return () => unpatchMaterials(m);
  }, [lit, volumeReady, scene, uniforms]);

  useEffect(() => {
    if (lit && volumeReady && bakeStamp > 0) {
      patchMaterials(scene, uniforms, patchedRef.current);
    }
  }, [lit, volumeReady, bakeStamp, scene, uniforms]);

  if (!debug) return null;
  const view = <DebugView domain={domain} stamp={bakeStamp} />;
  return spaceRoot ? <BakeSpaceDebug spaceRoot={spaceRoot}>{view}</BakeSpaceDebug> : view;
}

function BakeSpaceDebug({ spaceRoot, children }) {
  const ref = useRef();
  useFrame(() => {
    const root = resolveSpaceRoot(spaceRoot);
    if (!root || !ref.current) return;
    root.updateWorldMatrix?.(true, false);
    ref.current.matrix.copy(root.matrixWorld);
    ref.current.matrixWorldNeedsUpdate = true;
  });
  return <group ref={ref} matrixAutoUpdate={false}>{children}</group>;
}

// ---- debug 可视化:粗层线框盒(占位剪影) + 细层切片(位图∩反照率色) ----
const SLICE_TABLE = Math.floor((1.0 - DOMAIN.origin[1]) / DOMAIN.cell); // 默认停在桌面高度
const COARSE = DOMAIN.cell * 8;

function DebugView({ domain, stamp }) {
  const [sliceY, setSliceY] = useState(SLICE_TABLE);

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'BracketLeft') setSliceY((y) => Math.max(0, y - (e.shiftKey ? 8 : 1)));
      else if (e.code === 'BracketRight') setSliceY((y) => Math.min(DOMAIN.ny - 1, y + (e.shiftKey ? 8 : 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 粗层占位 → InstancedMesh 线框盒(千级实例;上限兜底防病态场景炸内存)
  const inst = useMemo(() => {
    const { cnx, cny } = DOMAIN;
    const idx = [];
    for (let i = 0; i < domain.coarse.length && idx.length < 60000; i++) {
      if (domain.coarse[i]) idx.push(i);
    }
    const geo = new THREE.BoxGeometry(COARSE, COARSE, COARSE);
    const mat = new THREE.MeshBasicMaterial({
      color: '#6ec6ff', wireframe: true, transparent: true, opacity: 0.28, depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, idx.length);
    const m = new THREE.Matrix4();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const cx = i % cnx, cy = ((i / cnx) | 0) % cny, cz = (i / (cnx * cny)) | 0;
      m.setPosition(
        DOMAIN.origin[0] + (cx + 0.5) * COARSE,
        DOMAIN.origin[1] + (cy + 0.5) * COARSE,
        DOMAIN.origin[2] + (cz + 0.5) * COARSE,
      );
      mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, stamp]);
  useEffect(() => () => { inst.geometry.dispose(); inst.material.dispose(); }, [inst]);

  // 细层切片:640×640 纹理,占位格显反照率色(平贴切片高度;plane 转 +90° 使 v→+z,行序=世界 z)
  const sliceTex = useMemo(() => {
    const { nx, nz, anx, any: ay } = DOMAIN;
    const px = new Uint8Array(nx * nz * 4);
    const ay1 = Math.min(ay - 1, sliceY >> 2);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!getCell(domain, ix, sliceY, iz)) continue;
        const ai = (ix >> 2) + anx * (ay1 + ay * (iz >> 2));
        const o = (ix + nx * iz) * 4;
        const has = domain.albedo[ai * 4 + 3];
        px[o] = has ? domain.albedo[ai * 4] : 255;
        px[o + 1] = has ? domain.albedo[ai * 4 + 1] : 0;
        px[o + 2] = has ? domain.albedo[ai * 4 + 2] : 255;
        px[o + 3] = 235;
      }
    }
    const t = new THREE.DataTexture(px, nx, nz, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, stamp, sliceY]);
  useEffect(() => () => sliceTex.dispose(), [sliceTex]);
  useEffect(() => {
    window.__voxbake = { ...(window.__voxbake ?? {}), sliceY, sliceWorldY: worldOf(sliceY, 1) };
  }, [sliceY]);

  return (
    <group userData={{ voxBakeSkip: true }}>
      <primitive object={inst} />
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, worldOf(sliceY, 1), 0]}>
        <planeGeometry args={[DOMAIN.nx * DOMAIN.cell, DOMAIN.nz * DOMAIN.cell]} />
        <meshBasicMaterial map={sliceTex} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
