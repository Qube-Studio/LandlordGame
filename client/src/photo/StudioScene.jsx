// 拍照棚 3D 场景：复用真身酒馆造景 + 灯 rig + 后处理（与游戏同款观感），叠加可摆放物与坐标轴。
// 灯光/后处理数值逐项对齐 Scene3D 默认机位；ChandelierLight/FireLight 是内部组件，这里用其终态静态点光复刻。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Room, Fireplace, Barrels, Decor, Chandelier, Rug, Table } from '../scene/Scene3D';
import { P } from '../assets/palette';
import { usePhotoStore } from './photoStore';
import { ItemModel } from './models';
import { selectionLock } from './selectionLock';

// 平铺的摆放物（未选中/飞行态）——点击选中（仅摆放模式响应，飞行模式指针锁定不误触）。
function PlainItem({ item, selectable, onSelect }) {
  return (
    <group
      position={item.pos}
      rotation={item.rot}
      scale={item.scale}
      onClick={selectable ? (e) => { e.stopPropagation(); onSelect(item.id); } : undefined}
    >
      <ItemModel item={item} />
    </group>
  );
}

// 选中物：坐标轴直接**挂在自己的 group 上**（object 属性），不套 drei 的包裹组——
// 否则 drei 会把子节点塞进它自己的原点 group 并移动那个包裹，坐标轴与模型脱节、回读到错的组（本次 bug）。
// group 受控于 store 变换；拖拽经 controls 事件回写 store（同值不打架）。
function SelectedItem({ item }) {
  const gizmo = usePhotoStore(s => s.gizmo);
  const space = usePhotoStore(s => s.space);
  const setTransform = usePhotoStore(s => s.setTransform);
  const [obj, setObj] = useState(null);   // 回调 ref 拿到真 Object3D 再挂坐标轴（保证 attach）
  const controlsRef = useRef();

  // 坐标轴事件：拖拽回写 store（读被控对象 obj 自身，坐标轴就在其上，数据同源）
  useEffect(() => {
    const c = controlsRef.current;
    if (!c || !obj) return undefined;
    if (import.meta.env.DEV) window.__photoControls = c;
    const onObj = () => setTransform(item.id, {
      pos: [obj.position.x, obj.position.y, obj.position.z],
      rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    });
    const onDrag = (e) => { if (e.value) selectionLock.current = true; };
    c.addEventListener('objectChange', onObj);
    c.addEventListener('dragging-changed', onDrag);
    return () => { c.removeEventListener('objectChange', onObj); c.removeEventListener('dragging-changed', onDrag); };
  }, [obj, item.id, setTransform]);

  // 捕获阶段 pointerdown：按在坐标轴上（controls.axis 非空）→ 锁一次取消选择。
  useEffect(() => {
    const onDown = () => { const c = controlsRef.current; selectionLock.current = !!(c && (c.axis || c.dragging)); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  return (
    <>
      <group ref={setObj} position={item.pos} rotation={item.rot} scale={item.scale}>
        <ItemModel item={item} />
      </group>
      {obj && <TransformControls ref={controlsRef} object={obj} mode={gizmo} space={space} />}
    </>
  );
}

// 造景（含横梁的房间）——横梁烘在 Room 内（y≈6 的长条），按 hideOverhead 遍历隐藏；不碰任何灯光。
function Environment({ hideOverhead }) {
  const roomRef = useRef();
  useLayoutEffect(() => {
    const g = roomRef.current; if (!g) return;
    g.traverse((o) => { if (o.isMesh && Math.abs(o.position.y - 6) < 0.05) o.visible = !hideOverhead; });
  }, [hideOverhead]);
  return <group ref={roomRef}><Room /></group>;
}

export default function StudioScene() {
  const items = usePhotoStore(s => s.items);
  const selectedId = usePhotoStore(s => s.selectedId);
  const mode = usePhotoStore(s => s.mode);
  const uiHidden = usePhotoStore(s => s.uiHidden);
  const capturing = usePhotoStore(s => s.capturing);
  const postFx = usePhotoStore(s => s.postFx);
  const hideOverhead = usePhotoStore(s => s.hideOverhead);
  const select = usePhotoStore(s => s.select);

  const arrange = mode === 'arrange';
  const showGizmo = arrange && !uiHidden && !capturing && !!selectedId;
  const sel = items.find(it => it.id === selectedId);

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
      <Fireplace />
      <Barrels />
      <Decor />
      {!hideOverhead && <Chandelier />}
      <Rug />
      <Table spots={[]} />

      {/* 摆放物：选中的那件交给坐标轴，其余平铺 */}
      {items.map(it => (showGizmo && it.id === selectedId
        ? null
        : <PlainItem key={it.id} item={it} selectable={arrange} onSelect={select} />))}
      {showGizmo && sel && <SelectedItem key={`sel-${sel.id}`} item={sel} />}

      {postFx && (
        <EffectComposer disableNormalPass multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette eskil={false} offset={0.28} darkness={0.62} />
        </EffectComposer>
      )}
    </>
  );
}
