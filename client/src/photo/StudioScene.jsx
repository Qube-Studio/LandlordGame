// 拍照棚 3D 场景：复用真身酒馆造景 + 灯 rig + 后处理（与游戏同款观感），叠加可摆放物与坐标轴。
// 灯光/后处理数值逐项对齐 Scene3D 默认机位；ChandelierLight/FireLight 是内部组件，这里用其终态静态点光复刻。
// 物体常挂范式（EDITOR_OVERHAUL §2.1）：废除 PlainItem/SelectedItem 换挂——Item 统一常挂并登记
// itemRegistry；TransformControls 的 object 从注册表取（object= 已有 Object3D，禁 children 包裹）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Room, Fireplace, Barrels, Decor, Chandelier, Rug, Table } from '../scene/Scene3D';
import { P } from '../assets/palette';
import { usePhotoStore, primaryOf } from './photoStore';
import { ItemModel } from './models';
import { selectionLock } from './selectionLock';
import { gizmoRef, interaction, SNAP } from './interaction';
import Interactions from './Interactions';
import { itemRegistry, subscribeRegistry, getRegistryVersion, registerItem, unregisterItem, envRef } from './itemRegistry';

// 常挂摆放物：挂载即登记注册表（gizmo/框选/表面放置都从注册表取物），选中与否不换挂。
// hidden 物由父级过滤、根本不渲染 → 不进注册表（Raycaster 不查 visible，物理剔除）。
// 变换受控于 store props；gizmo 拖拽直接动这个 group 再写回 store（同值不打架）。
function Item({ item, selectable, onSelect }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const obj = ref.current;
    registerItem(item.id, obj);
    return () => unregisterItem(item.id, obj);
  }, [item.id]);
  // locked：可见但点选/框选/拖拽全跳过（框选跳过在 pick.js，这里点选与拖拽候选都不给）
  const clickable = selectable && !item.locked;
  return (
    <group
      ref={ref}
      position={item.pos}
      rotation={item.rot}
      scale={item.scale}
      // 框选/表面拖拽收尾时指针常悬在物体上，pointerup 后的 click 会打到这里——
      // 消费 selectionLock（与 onPointerMissed 同一闸，每次 click 只走其一），不许它篡改刚定好的选择集
      onClick={clickable ? (e) => {
        e.stopPropagation();
        if (selectionLock.current) { selectionLock.current = false; return; }
        onSelect(item.id, e);
      } : undefined}
      // 表面拖拽候选（§2.1 事件流）：r3f raycast 在冒泡阶段，晚于 Interactions 的捕获 pointerdown——
      // 那边先清空，这里最近命中的物体写入（stopPropagation 拦住身后更远的命中）。
      onPointerDown={clickable ? (e) => { if (e.button === 0) { e.stopPropagation(); interaction.candidate = item.id; } } : undefined}
    >
      <ItemModel item={item} />
    </group>
  );
}

// 网格吸附 props（X 键开关；多选时挂在 pivot 上=吸附作用于 pivot，Blender 同款语义）
const snapProps = (on) => ({
  translationSnap: on ? SNAP.translation : null,
  rotationSnap: on ? SNAP.rotation : null,
  scaleSnap: on ? SNAP.scale : null,
});

// 单选坐标轴：object 从注册表取——物体常挂，坐标轴只是"借"它，选择切换不再重挂模型。
// 拖拽回写走 §2.1 范式：拖拽开始 pushHistory 一次 → 期间 applyTransforms 静默写回 → 收尾落账。
// （原先自带的捕获 pointerdown 监听已并入 Interactions 的唯一分派器——两套捕获监听会打架，
//   这里只负责把 controls 发布到 gizmoRef 供分派器判「按在坐标轴上」。）
function SingleGizmo({ id }) {
  const gizmo = usePhotoStore(s => s.gizmo);
  const space = usePhotoStore(s => s.space);
  const snapOn = usePhotoStore(s => s.snap);
  const controlsRef = useRef();

  // 订阅注册表取物：新增物与入选同一次提交时，Item 的登记（layout effect）发通知触发重读，
  // 必然命中；物体被删/隐藏即注销 → 自动回落 null 卸下坐标轴。
  const obj = useSyncExternalStore(subscribeRegistry, () => itemRegistry.get(id) ?? null);

  // 坐标轴事件：读被控对象自身（坐标轴就挂在其上，数据同源）
  useEffect(() => {
    const c = controlsRef.current;
    if (!c || !obj) return undefined;
    gizmoRef.current = c;
    if (import.meta.env.DEV) window.__photoControls = c;
    const st = () => usePhotoStore.getState();
    const patch = () => ({
      pos: [obj.position.x, obj.position.y, obj.position.z],
      rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    });
    // 拖拽期间写回不进历史；一次拖拽=一步撤回（历史在拖拽开始处压一次）
    const onObj = () => st().applyTransforms({ [id]: patch() });
    const onDrag = (e) => {
      if (e.value) { selectionLock.current = true; st().pushHistory(); }
      else st().applyTransforms({ [id]: patch() }, true);   // 收尾落账（立即持久化）
    };
    c.addEventListener('objectChange', onObj);
    c.addEventListener('dragging-changed', onDrag);
    return () => {
      c.removeEventListener('objectChange', onObj);
      c.removeEventListener('dragging-changed', onDrag);
      if (gizmoRef.current === c) gizmoRef.current = null;
    };
  }, [obj, id]);

  return obj ? <TransformControls ref={controlsRef} object={obj} mode={gizmo} space={space} {...snapProps(snapOn)} /> : null;
}

// 多选坐标轴（§2.1 批量变换）：TransformControls 挂独立 pivot 空组（object= 已有 Object3D，硬约束①），
// pivot 位置=选中集 Box3 质心，仅在选择集变化时重算（拖拽中不动）。
// 拖拽范式=起点快照+全量 delta：dragging(true) 存 pivot 逆矩阵与各物世界矩阵 →
// objectChange 每次用 delta × startMat 全量重算（不做增量累加，无漂移）→ decompose 写 live group
// + 静默写回 store → dragging(false) 一次性落账。旋转经 decompose 出的四元数 setFromQuaternion
// 回欧拉（禁欧拉直加）。
function MultiGizmo({ ids }) {
  const gizmo = usePhotoStore(s => s.gizmo);
  const space = usePhotoStore(s => s.space);
  const snapOn = usePhotoStore(s => s.snap);
  const controlsRef = useRef();
  const [pivot, setPivot] = useState(null);      // pivot 空组挂载后才能把 TransformControls 指过去
  const idsRef = useRef(ids);
  // 活值经 ref 给拖拽监听器（只挂一次）；layout effect 同步保证声明在后的质心 effect 读到本次 ids
  useLayoutEffect(() => { idsRef.current = ids; });
  const idsKey = ids.join('\n');
  // 订阅注册表版本号：选中物晚一拍登记（同一提交新增+入选）时重算质心
  const regVer = useSyncExternalStore(subscribeRegistry, getRegistryVersion);

  // pivot 归位：位置=选中集 world Box3 质心；姿态归零（rotate/scale 手柄始终世界对齐起步）
  useLayoutEffect(() => {
    if (!pivot) return;
    const box = new THREE.Box3();
    const one = new THREE.Box3();
    for (const id of idsRef.current) {
      const obj = itemRegistry.get(id);
      if (!obj) continue;
      one.setFromObject(obj);
      if (!one.isEmpty()) box.union(one);
    }
    if (!box.isEmpty()) box.getCenter(pivot.position);
    pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
  }, [pivot, idsKey, regVer]);

  useEffect(() => {
    const c = controlsRef.current;
    if (!c || !pivot) return undefined;
    gizmoRef.current = c;
    if (import.meta.env.DEV) window.__photoControls = c;
    const st = () => usePhotoStore.getState();
    let startInv = null;          // 拖拽起点的 pivot 世界矩阵逆
    let startMats = null;         // id → 拖拽起点各物世界矩阵
    const delta = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const euler = new THREE.Euler();

    const computePatches = () => {
      // 多选 scale 限等比（three TransformControls scale 恒 local——写进硬约束①）：
      // 拖单轴手柄也统一成等比——取离 1 最远的分量铺满三轴，异轴缩放对带旋转的成员会产生剪切
      if (st().gizmo === 'scale') {
        const s = pivot.scale;
        let u = s.x;
        if (Math.abs(s.y - 1) > Math.abs(u - 1)) u = s.y;
        if (Math.abs(s.z - 1) > Math.abs(u - 1)) u = s.z;
        s.set(u, u, u);
      }
      pivot.updateMatrixWorld(true);
      delta.multiplyMatrices(pivot.matrixWorld, startInv);
      const patches = {};
      for (const [id, m0] of startMats) {
        const obj = itemRegistry.get(id);
        if (!obj) continue;
        world.multiplyMatrices(delta, m0);
        world.decompose(pos, quat, scl);
        // 写 live group（物体直挂场景根，世界=本地）——写回 store 走 React 同值不打架
        obj.position.copy(pos); obj.quaternion.copy(quat); obj.scale.copy(scl);
        euler.setFromQuaternion(quat);                 // 四元数合成回欧拉，禁欧拉直加
        patches[id] = { pos: [pos.x, pos.y, pos.z], rot: [euler.x, euler.y, euler.z], scale: [scl.x, scl.y, scl.z] };
      }
      return patches;
    };
    const onObj = () => { if (startInv) st().applyTransforms(computePatches()); };
    const onDrag = (e) => {
      if (e.value) {
        selectionLock.current = true;
        st().pushHistory();                            // 一次拖拽=一步撤回
        pivot.updateMatrixWorld(true);
        startInv = pivot.matrixWorld.clone().invert();
        startMats = new Map();
        for (const id of idsRef.current) {
          const obj = itemRegistry.get(id);
          if (obj) { obj.updateMatrixWorld(true); startMats.set(id, obj.matrixWorld.clone()); }
        }
      } else if (startInv) {
        st().applyTransforms(computePatches(), true);  // 收尾一次性落账
        startInv = null; startMats = null;
        // pivot 姿态归零（位置保留——translate 拖过去了就留在那）：下次拖拽手柄仍世界对齐
        pivot.quaternion.identity();
        pivot.scale.set(1, 1, 1);
        pivot.updateMatrixWorld(true);
      }
    };
    c.addEventListener('objectChange', onObj);
    c.addEventListener('dragging-changed', onDrag);
    return () => {
      c.removeEventListener('objectChange', onObj);
      c.removeEventListener('dragging-changed', onDrag);
      if (gizmoRef.current === c) gizmoRef.current = null;
    };
  }, [pivot]);

  return (
    <>
      <group ref={setPivot} />
      {pivot && <TransformControls ref={controlsRef} object={pivot} mode={gizmo} space={space} {...snapProps(snapOn)} />}
    </>
  );
}

// 选中 Box3 线框（主选=金、次选=灰白）：Box3Helper 的 updateMatrixWorld 每帧读 this.box，
// 逐帧 setFromObject 跟住呼吸/拖拽中的物体；depthTest 关掉=编辑器语义（选框不被桌面遮住）。
const OUTLINE_PRIMARY = P.gold;
const OUTLINE_OTHER = '#cfc8bb';
function SelectionBox({ id, primary }) {
  const obj = useSyncExternalStore(subscribeRegistry, () => itemRegistry.get(id) ?? null);
  const helper = useMemo(() => {
    const h = new THREE.Box3Helper(new THREE.Box3(), primary ? OUTLINE_PRIMARY : OUTLINE_OTHER);
    h.material.depthTest = false;
    h.material.transparent = true;
    h.material.opacity = primary ? 0.95 : 0.55;
    h.renderOrder = 999;
    return h;
  }, [primary]);
  useEffect(() => () => { helper.geometry.dispose(); helper.material.dispose(); }, [helper]);
  // useFrame 在渲染前跑：首帧就有正确的盒，不闪原点单位盒
  useFrame(() => { if (obj) helper.box.setFromObject(obj); });
  return obj ? <primitive object={helper} /> : null;
}

// 造景（真身组件统一包一层 group）——发布 envRef 单例（P② 表面放置 traverse 收集环境 mesh）。
// 横梁烘在 Room 内（y≈6 的长条），按 hideOverhead 遍历 visible=false（只扫 Room，防误伤吊灯等同高件）。
function Environment({ hideOverhead }) {
  const envGroupRef = useRef();
  const roomRef = useRef();
  useLayoutEffect(() => {
    const g = envGroupRef.current;
    envRef.current = g;
    return () => { if (envRef.current === g) envRef.current = null; };
  }, []);
  useLayoutEffect(() => {
    const g = roomRef.current; if (!g) return;
    g.traverse((o) => { if (o.isMesh && Math.abs(o.position.y - 6) < 0.05) o.visible = !hideOverhead; });
  }, [hideOverhead]);
  return (
    <group ref={envGroupRef}>
      <group ref={roomRef}><Room /></group>
      <Fireplace />
      <Barrels />
      <Decor />
      {!hideOverhead && <Chandelier />}
      <Rug />
      <Table spots={[]} />
    </group>
  );
}

export default function StudioScene() {
  const items = usePhotoStore(s => s.items);
  const selection = usePhotoStore(s => s.selection);
  const mode = usePhotoStore(s => s.mode);
  const uiHidden = usePhotoStore(s => s.uiHidden);
  const capturing = usePhotoStore(s => s.capturing);
  const postFx = usePhotoStore(s => s.postFx);
  const hideOverhead = usePhotoStore(s => s.hideOverhead);
  const select = usePhotoStore(s => s.select);
  const toggleSelect = usePhotoStore(s => s.toggleSelect);

  const arrange = mode === 'arrange';
  const pid = primaryOf(selection);
  // 编辑显形件（坐标轴/选框）：截图与隐藏 UI 时全部让位
  const showEdit = arrange && !uiHidden && !capturing;
  // 点选=单选；Ctrl+点=切换（r3f 事件透传原生修饰键）
  const onSelect = (id, e) => { if (e?.ctrlKey || e?.metaKey) toggleSelect(id); else select(id); };
  // 坐标轴只借给可拖的物（P③ outliner 可把 locked/hidden 物选进"管理选择"——看选框/改属性，
  // 但锁=「拖拽全跳过」（§2.1），hidden 不在注册表：两者都不给 gizmo 摆布）
  const gizmoIds = selection.filter(id => {
    const it = items.find(i => i.id === id);
    return it && !it.locked && !it.hidden;
  });

  return (
    <>
      {/* 背景/雾/灯 rig（对齐 Scene3D 默认机位；吊灯&炉火用终态静态点光复刻内部组件） */}
      <color attach="background" args={[P.sceneBg]} />
      <fog attach="fog" args={[P.sceneFog, 10, 26]} />
      <ambientLight intensity={0.42} color={P.sceneAmbient} />
      <directionalLight
        position={[4, 9, 3]} intensity={1.35} color={P.key}
        castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1} shadow-camera-far={30}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-6, 4, 6]} intensity={0.30} color={P.coolFill} />
      {/* 吊灯光池永远在（隐藏顶部只藏吊灯**造型**，光照不变） */}
      <pointLight position={[0, 3.3, 0]} intensity={21} distance={13.5} decay={2} color={P.candle} />
      <pointLight position={[0, 1.7, -10.5]} intensity={7} distance={9} decay={2} color={P.fire} />

      {/* 造景（真身组件） */}
      <Environment hideOverhead={hideOverhead} />

      {/* 摆放物：全部常挂（hidden 除外），选中与否不换挂 */}
      {items.filter(it => !it.hidden).map(it => (
        <Item key={it.id} item={it} selectable={arrange} onSelect={onSelect} />
      ))}

      {/* 框选/表面拖拽分派器（唯一的窗口捕获 pointerdown，常挂——它自己按 mode 让位） */}
      <Interactions />

      {/* 坐标轴：单选=物体本尊，多选=pivot 空组（两者互斥，gizmoRef 只有一份） */}
      {showEdit && gizmoIds.length === 1 && <SingleGizmo id={gizmoIds[0]} />}
      {showEdit && gizmoIds.length > 1 && <MultiGizmo ids={gizmoIds} />}
      {/* 选中 Box3 线框：主选金、次选灰白 */}
      {showEdit && selection.map(id => <SelectionBox key={id} id={id} primary={id === pid} />)}

      {postFx && (
        <EffectComposer disableNormalPass multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette eskil={false} offset={0.28} darkness={0.62} />
        </EffectComposer>
      )}
    </>
  );
}
