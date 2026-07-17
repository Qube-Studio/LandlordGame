// VoxLab 舞台:完全复用主项目的造景组件与渲染管线(灯 rig/Bloom/Vignette 参数照抄
// Scene3D#SceneContents)——「隔离区先完全采用现有资产和渲染管线」;体素资产经 swaps 逐个换入。
// 隔离区特调:雾从游戏的 (10,26) 推远到 (16,44)+环境光微抬——验收资产要看得清全屋,
// 游戏里的"打烊账房"氛围雾在这儿碍事(主项目参数不动)。
// 布局 = 单人长桌酒馆(与行走碰撞体对位);摆放物 = 角色 / 导入 .vox,带旋转/缩放,虚影预览。
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Room, Fireplace, Barrels, Decor, Chandelier, Rug, Table, Chair, FireLight } from '../scene/Scene3D';
import { SINGLE_TABLE, SINGLE_TEAM_SEATS, SINGLE_BOSS_SEAT, singleSpotOf } from '../scene/singleLayout';
import MinecraftPlayer from '../scene/MinecraftPlayer';
import VoxChandelier from '../voxel/VoxChandelier';
import VoxModel, { VOXEL_SIZE } from '../voxel/VoxModel';
import { VoxRoom, VoxTable, VoxChair } from './VoxProps';
import { VoxFireplace, VoxBarrels, VoxDecor } from './VoxDecor';
import VoxPlayer from './VoxPlayer';
import { loadVox } from '../voxel/voxload';
import { P } from '../assets/palette';
import { ROLE_LABEL } from '../game/roles';
import { useLabStore, aimLive, ghostLive, brushImport, placeTransform } from './labStore';

const SEATS = [...SINGLE_TEAM_SEATS, SINGLE_BOSS_SEAT];
const SPOTS = SEATS.map(singleSpotOf);

// 环境贴图(IBL,2026-07-17):房间中心 CubeCamera 把酒馆自拍成 128² HDR 立方图 → scene.environment。
// 金属(机器头/黄铜嵌线/吊灯铜盘/螺栓)无漫反射、全靠环境反射——无 envMap 时它们只能反射虚空
// (发黑发闷,charSpec.HEAD_MAT 的 ⚠ 即此)。场景静态:烘两拍(1.5s/5s,覆盖异步 .vox 加载)+
// swaps 变化后 1.5s 重烘。HalfFloat 保发光体(灯柱/火焰/炭床)的 HDR 高光进反射。
// 重烘时不清 env 直接重拍:env 进 env = 温和的二次弹射,收敛且合意。
/* eslint-disable react-hooks/immutability -- scene 是 three 共享单例,environment 只能原地挂 */
function EnvBake() {
  const { gl, scene } = useThree();
  const swaps = useLabStore(s => s.swaps);
  const rigRef = useRef(null);
  if (rigRef.current === null) {
    const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 60, rt);
    cam.position.set(0, 2.3, 0);           // 桌面上方、吊灯下方——金属件密集带的视点
    rigRef.current = { rt, cam, queue: [1.5, 5], mark: false };
  }
  useEffect(() => {
    rigRef.current.mark = true;            // swaps 变化(含首挂)→ 下一帧起 1.5s 后重烘
  }, [swaps]);
  useEffect(() => () => {
    const rig = rigRef.current;
    if (scene.environment === rig.rt.texture) scene.environment = null;
    rig.rt.dispose();
  }, [scene]);
  useFrame((st) => {
    const rig = rigRef.current;
    const t = st.clock.elapsedTime;
    if (rig.mark) { rig.mark = false; rig.queue.push(t + 1.5); rig.queue.sort((a, b) => a - b); }
    if (rig.queue.length && t >= rig.queue[0]) {
      rig.queue.shift();
      rig.cam.update(gl, scene);
      scene.environment = rig.rt.texture;
      // 0.6:全强度会给漫反射材质叠一层可感的 IBL 底光,冲淡「打烊账房」压暗氛围;
      // 环境本身是暗酒馆,金属反射在 0.6 下已可读。调观感改这一个数。
      scene.environmentIntensity = 0.6;
    }
  });
  return null;
}
/* eslint-enable react-hooks/immutability */

// 性能探针:fps/draw call/三角数,半秒一拍写 window.__voxperf(HUD PerfChip 显示;
// 体素资产的几何量回归全靠这三个数把关)。不进 store——逐帧数据不触发 React。
function PerfProbe() {
  const { gl } = useThree();
  const acc = useRef({ n: 0, t: 0, calls: 0, tris: 0 });
  // EffectComposer 多 pass + info.autoReset 会把 info 冲成"最后一个全屏 pass"(1 call/1 tri)——
  // 关掉自动重置,在每帧开头(useFrame 先于 render)读上一帧全程累计再手动清零
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- three 惯用法:renderer.info 的开关就在实例上
    gl.info.autoReset = false;
    // eslint-disable-next-line react-hooks/immutability
    return () => { gl.info.autoReset = true; };
  }, [gl]);
  useFrame((_, dt) => {
    const a = acc.current;
    a.n++; a.t += dt;
    a.calls = gl.info.render.calls;
    a.tris = gl.info.render.triangles;
    gl.info.reset();
    if (a.t >= 0.5) {
      window.__voxperf = { fps: Math.round(a.n / a.t), calls: a.calls, tris: a.tris };
      a.n = 0; a.t = 0;
    }
  });
  return null;
}

// 吊灯点光:强度/位置同 ChandelierLight(Scene3D),不带游戏相位压光——隔离区无游戏
function LabChandelierLight() {
  return <pointLight position={[0, 3.3, 0]} intensity={21} distance={13.5} decay={2} color={P.candle} />;
}

// 落点圆环(读 aimLive,不订阅 store——逐帧零重渲染);贴所有可放置面,天花板贴下侧
function PlaceMarker() {
  const ref = useRef();
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const aim = aimLive.current;
    if (aim?.kind === 'floor') {
      m.visible = true;
      m.position.set(aim.x, aim.y + (aim.surface === 'ceiling' ? -0.02 : 0.02), aim.z);
    } else {
      m.visible = false;
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.34, 0.42, 24]} />
      <meshBasicMaterial color={P.brassHi} transparent opacity={0.55} depthWrite={false} side={2} />
    </mesh>
  );
}

// 摆放虚影:当前笔刷的半透明预览,跟随准心,吃 Q/E 旋转 + 滚轮缩放。
// 变换与点击落子共用 placeTransform——虚影所见即所得。材质=逐 mesh 克隆再调透明
// (MinecraftPlayer 的材质是模块级共享缓存,直接改会把全场角色一起改成幽灵)。
function GhostPreview() {
  const brush = useLabStore(s => s.brush);
  const imp = useLabStore(brushImport);
  const ref = useRef();
  const contentRef = useRef();
  const [voxGeo, setVoxGeo] = useState(null);

  // 体素笔刷:取几何(缓存命中即秒回)+ 回填原始高度。
  // 不在 effect 里清 state——渲染侧用 voxGeo.url === imp.url 守卫,旧几何自然失效。
  useEffect(() => {
    if (!imp) {
      ghostLive.rawHeight = 2.0;    // 角色身高(名牌不计)
      return undefined;
    }
    let live = true;
    loadVox(imp.url, { emissiveColors: [P.ember] }).then((m) => {
      if (!live) return;
      ghostLive.rawHeight = m.size.y * VOXEL_SIZE;
      setVoxGeo({ url: imp.url, ...m });
    }).catch(() => {});
    return () => { live = false; };
  }, [imp]);
  const geo = imp && voxGeo?.url === imp.url ? voxGeo : null;

  // 角色笔刷:遍历克隆材质调成半透明(卸载时销毁克隆,防泄漏)
  useEffect(() => {
    if (imp) return undefined;
    const g = contentRef.current;
    if (!g) return undefined;
    const cloned = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const c = m.clone();
        c.transparent = true; c.opacity = 0.45; c.depthWrite = false;
        cloned.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      o.castShadow = false;
    });
    return () => cloned.forEach(m => m.dispose());
  }, [brush, imp]);

  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const aim = aimLive.current;
    const st = useLabStore.getState();
    if (aim?.kind === 'floor' && st.locked) {
      const p = placeTransform(camera, aim, st);
      g.visible = true;
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.ry;
      g.scale.setScalar(st.ghostScale);
    } else {
      g.visible = false;
    }
  });

  return (
    <group ref={ref} visible={false}>
      {imp ? (
        geo && (
          <group scale={VOXEL_SIZE} position={[-geo.size.x / 2 * VOXEL_SIZE, 0, -geo.size.z / 2 * VOXEL_SIZE]}>
            <mesh geometry={geo.main}>
              <meshStandardMaterial vertexColors roughness={1} flatShading transparent opacity={0.45} depthWrite={false} />
            </mesh>
            {geo.emissive && (
              <mesh geometry={geo.emissive}>
                <meshStandardMaterial vertexColors roughness={1} flatShading transparent opacity={0.45} depthWrite={false} />
              </mesh>
            )}
          </group>
        )
      ) : (
        <group ref={contentRef}>
          {/* 虚影刻意保留 box 版(不随 swaps.players 切体素):透明化靠挂载后一次性克隆材质,
              VoxPlayer 的部件异步加载,克隆时机抓不住;落子结果两条路径同值,预览差异可接受 */}
          <MinecraftPlayer
            player={{ id: 'ghost', name: '', role: brush, bankrupt: false, online: true }}
            expression="idle"
            seed={0}
          />
        </group>
      )}
    </group>
  );
}

export default function Stage() {
  const chars = useLabStore(s => s.chars);
  const imports = useLabStore(s => s.imports);
  const swaps = useLabStore(s => s.swaps);

  return (
    <>
      <color attach="background" args={[P.sceneBg]} />
      <fog attach="fog" args={[P.sceneFog, 16, 44]} />
      <EnvBake />
      {/* 灯 rig(5 盏,参数照抄 SceneContents;环境光 0.38→0.5 隔离区微抬,看清远处资产) */}
      <ambientLight intensity={0.5} color={P.sceneAmbient} />
      <directionalLight
        position={[4, 9, 3]} intensity={1.35} color={P.key}
        castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1} shadow-camera-far={30}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
      <LabChandelierLight />
      <directionalLight position={[-6, 4, 6]} intensity={0.30} color={P.coolFill} />

      {/* 造景:体素资产经 swaps 逐项换入(V 吊灯/B 桌/N 椅/M 墙梁/F 壁炉/G 木桶/T 装饰),随时切回现有 */}
      {swaps.room ? <VoxRoom /> : <Room />}
      {swaps.fireplace ? <VoxFireplace /> : <Fireplace />}
      <FireLight />
      {swaps.barrels ? <VoxBarrels /> : <Barrels />}
      {swaps.decor ? <VoxDecor /> : <Decor />}
      {swaps.chandelier ? <VoxChandelier /> : <Chandelier />}
      <Rug />
      {swaps.table ? <VoxTable /> : <Table spots={SPOTS} size={SINGLE_TABLE} />}
      {SEATS.map((seat, i) => {
        const ry = Math.atan2(-seat.x, -seat.z);
        return swaps.chairs
          ? <VoxChair key={i} x={seat.x} z={seat.z} ry={ry} />
          : <Chair key={i} x={seat.x} z={seat.z} ry={ry} />;
      })}

      {/* 摆放物:角色(站姿 idle,名牌=角色名) / 导入的 .vox 素材(加载后回填准心包围盒,原始尺寸不乘缩放) */}
      {chars.map((c, i) => {
        const url = c.kind === 'vox' ? imports.find(m => m.key === c.importKey)?.url : null;
        if (c.kind === 'vox' && !url) return null;
        return (
          <group key={c.id} position={[c.x, c.y ?? 0, c.z]} rotation={[0, c.ry, 0]} scale={c.scale ?? 1}>
            {c.kind === 'vox' ? (
              <VoxModel
                url={url}
                emissiveColors={[P.ember]}
                onLoaded={(m) => useLabStore.getState().setCharExtent(
                  c.id,
                  Math.max(0.2, (Math.max(m.size.x, m.size.z) / 2) * VOXEL_SIZE),
                  Math.max(0.3, m.size.y * VOXEL_SIZE),
                )}
              />
            ) : swaps.players ? (
              <VoxPlayer
                player={{ id: c.id, name: ROLE_LABEL[c.role] ?? c.role, role: c.role, bankrupt: false, online: true }}
                expression="idle"
                seed={i * 1.7}
              />
            ) : (
              <MinecraftPlayer
                player={{ id: c.id, name: ROLE_LABEL[c.role] ?? c.role, role: c.role, bankrupt: false, online: true }}
                expression="idle"
                seed={i * 1.7}
              />
            )}
          </group>
        );
      })}
      <PlaceMarker />
      <GhostPreview />
      <PerfProbe />

      <ContactShadows position={[0, 0.02, 0]} scale={18} blur={2.6} opacity={0.5} far={4.5} resolution={256} color={P.wood900} />
      <EffectComposer disableNormalPass multisampling={0}>
        <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  );
}
