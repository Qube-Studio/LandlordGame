// VoxLab 舞台:完全复用主项目的造景组件与渲染管线(灯 rig/雾/Bloom/Vignette 参数照抄
// Scene3D#SceneContents)——「隔离区先完全采用现有资产和渲染管线」;体素资产经 swaps 逐个换入。
// 布局 = 单人长桌酒馆(与行走碰撞体对位);人物 = 摆放的 MinecraftPlayer(站姿,idle)。
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Room, Fireplace, Barrels, Decor, Chandelier, Rug, Table, Chair, FireLight } from '../scene/Scene3D';
import { SINGLE_TABLE, SINGLE_TEAM_SEATS, SINGLE_BOSS_SEAT, singleSpotOf } from '../scene/singleLayout';
import MinecraftPlayer from '../scene/MinecraftPlayer';
import VoxChandelier from '../voxel/VoxChandelier';
import { P } from '../assets/palette';
import { ROLE_LABEL } from '../game/roles';
import { useLabStore, aimLive } from './labStore';

const SEATS = [...SINGLE_TEAM_SEATS, SINGLE_BOSS_SEAT];
const SPOTS = SEATS.map(singleSpotOf);

// 吊灯点光:强度/位置同 ChandelierLight(Scene3D),不带游戏相位压光——隔离区无游戏
function LabChandelierLight() {
  return <pointLight position={[0, 3.3, 0]} intensity={21} distance={13.5} decay={2} color={P.candle} />;
}

// 摆放预览:准心指地面时的落点圆环(读 aimLive,不订阅 store——逐帧零重渲染)
function PlaceMarker() {
  const ref = useRef();
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const aim = aimLive.current;
    if (aim?.kind === 'floor') {
      m.visible = true;
      m.position.set(aim.x, 0.02, aim.z);
    } else {
      m.visible = false;
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.34, 0.42, 24]} />
      <meshBasicMaterial color={P.brassHi} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  );
}

export default function Stage() {
  const chars = useLabStore(s => s.chars);
  const voxChandelier = useLabStore(s => s.swaps.chandelier);

  return (
    <>
      <color attach="background" args={[P.sceneBg]} />
      <fog attach="fog" args={[P.sceneFog, 10, 26]} />
      {/* 灯 rig(5 盏,参数照抄 SceneContents) */}
      <ambientLight intensity={0.38} color={P.sceneAmbient} />
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

      {/* 造景(全部现有资产) + 吊灯按开关换体素版 */}
      <Room />
      <Fireplace />
      <FireLight />
      <Barrels />
      <Decor />
      {voxChandelier ? <VoxChandelier /> : <Chandelier />}
      <Rug />
      <Table spots={SPOTS} size={SINGLE_TABLE} />
      {SEATS.map((seat, i) => (
        <Chair key={i} x={seat.x} z={seat.z} ry={Math.atan2(-seat.x, -seat.z)} />
      ))}

      {/* 摆放的人物(站姿 idle;名牌=角色名) */}
      {chars.map((c, i) => (
        <group key={c.id} position={[c.x, 0, c.z]} rotation={[0, c.ry, 0]}>
          <MinecraftPlayer
            player={{ id: c.id, name: ROLE_LABEL[c.role] ?? c.role, role: c.role, bankrupt: false, online: true }}
            expression="idle"
            seed={i * 1.7}
          />
        </group>
      ))}
      <PlaceMarker />

      <ContactShadows position={[0, 0.02, 0]} scale={18} blur={2.6} opacity={0.5} far={4.5} resolution={256} color={P.wood900} />
      <EffectComposer disableNormalPass multisampling={0}>
        <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  );
}
