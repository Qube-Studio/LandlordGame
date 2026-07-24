// 主游戏可复用的体素酒馆造景。这里只装配静态美术；桌面交互、钱堆、硬币物理和游戏状态仍由 Scene3D 管理。
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { tex } from '../assets/texlib';
import { coinFaceTexture } from './textures';
import { P } from '../assets/palette';
import VoxModel from '../voxel/VoxModel';
import { PROP_VOXEL_SIZE, PROP_TABLE_Y, FLOOR_TILE } from '../voxel/propsSpec';

import wallLowerUrl from '../assets/vox/props/wall-lower.vox?url';
import wallUpperUrl from '../assets/vox/props/wall-upper.vox?url';
import floorTileUrl from '../assets/vox/props/floor-tile.vox?url';
import beamUrl from '../assets/vox/props/beam.vox?url';
import tableUrl from '../assets/vox/props/table.vox?url';
import tableLongUrl from '../assets/vox/props/table-long.vox?url';
import chairUrl from '../assets/vox/props/chair.vox?url';
import barrelUrl from '../assets/vox/props/barrel.vox?url';
import crateUrl from '../assets/vox/props/crate.vox?url';
import fireplaceUrl from '../assets/vox/props/fireplace.vox?url';
import bottleGreenUrl from '../assets/vox/props/bottle-green.vox?url';
import bottleBrownUrl from '../assets/vox/props/bottle-brown.vox?url';
import mugUrl from '../assets/vox/props/mug.vox?url';
import shelfUrl from '../assets/vox/props/shelf.vox?url';
import benchUrl from '../assets/vox/props/bench.vox?url';
import doorUrl from '../assets/vox/props/door.vox?url';
import dartboardUrl from '../assets/vox/props/dartboard.vox?url';
import sconceUrl from '../assets/vox/props/sconce.vox?url';
import tableRoundUrl from '../assets/vox/props/table-round.vox?url';
import coatrackUrl from '../assets/vox/props/coatrack.vox?url';

export { default as VoxChandelier } from '../voxel/VoxChandelier';

const S = PROP_VOXEL_SIZE;
const Vox = (props) => <VoxModel scale={S} castShadow={false} {...props} />;

const SEG_XS = [-9, -3, 3, 9];
const WALL_OFF = 12 + 0.108;
// 墙段横向互叠 4.8cm 防漏缝；奇数段再向房外退 4mm，消除两块浮雕共面的 z-fighting。
const SEG_JOG = 0.004;
const BEAM_XS = [-7.992, 0, 7.992];
const BEAM_ZS = [-9, -3, 3, 9];
// 222 格的真实边长是 7.992m；使用名义 8m 会留下两条贯穿房间的 8mm 缝。
const FLOOR_STEP = 222 * S;
const FLOOR_GRID = [-FLOOR_STEP, 0, FLOOR_STEP];

const TABLE_DIMS = {
  multi: { w: 6.0, d: 4.0 },
  single: { w: 8.6, d: 4.0 },
};

function WallLayer({ url, y }) {
  const jog = (i) => (i % 2 ? SEG_JOG : 0);
  const segments = [
    ...SEG_XS.map((x, i) => ({ pos: [x, y, -WALL_OFF - jog(i)], ry: 0 })),
    ...SEG_XS.map((x, i) => ({ pos: [x, y, WALL_OFF + jog(i)], ry: Math.PI })),
    ...SEG_XS.map((z, i) => ({ pos: [-WALL_OFF - jog(i), y, z], ry: Math.PI / 2 })),
    ...SEG_XS.map((z, i) => ({ pos: [WALL_OFF + jog(i), y, z], ry: -Math.PI / 2 })),
  ];
  return segments.map((wall, i) => (
    <VoxModel
      key={i}
      url={url}
      scale={S}
      position={wall.pos}
      rotation={[0, wall.ry, 0]}
      castShadow={false}
      bake={false}
    />
  ));
}

export function VoxRoom() {
  const ceiling = tex('wood', { tone: P.wood700 }, 4, 4);
  return (
    <group>
      {FLOOR_GRID.map((x) => FLOOR_GRID.map((z) => (
        <VoxModel
          key={`floor-${x}:${z}`}
          url={floorTileUrl}
          scale={S}
          position={[x, -FLOOR_TILE.th * S, z]}
          castShadow={false}
          receiveShadow
          bake={false}
        />
      )))}
      <WallLayer url={wallLowerUrl} y={0} />
      <WallLayer url={wallUpperUrl} y={4.0} />
      {/* 天花仍是贴图面片；主游戏抬头视角看不到值得体素化的细节。 */}
      <mesh position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial map={ceiling} roughness={1} />
      </mesh>
      {BEAM_ZS.map((z) => BEAM_XS.map((x) => (
        <VoxModel key={`beam-${z}:${x}`} url={beamUrl} scale={S} position={[x, 5.8, z]} />
      )))}
    </group>
  );
}

export function VoxTable({ spots = [], single = false }) {
  const dims = single ? TABLE_DIMS.single : TABLE_DIMS.multi;
  const modelUrl = single ? tableLongUrl : tableUrl;
  // tex() 自带按 spots/dims 的内容缓存；实时 state 重渲染不会重复画相同贴花。
  const decal = tex('tableDecal', { spots, dims });
  return (
    <group>
      <VoxModel url={modelUrl} scale={S} position={[0, PROP_TABLE_Y, 0]} receiveShadow />
      {/* 只叠金色席位/币圈标记，不覆盖 .vox 自带的体素毡面；所有交互仍以 y=1.0 为准。 */}
      <mesh position={[0, 1.003, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[dims.w, dims.d]} />
        <meshStandardMaterial
          map={decal}
          transparent
          alphaTest={0.01}
          depthWrite={false}
          roughness={1}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
    </group>
  );
}

export function VoxChair({ x, z, ry = 0 }) {
  return <VoxModel url={chairUrl} scale={S} position={[x, 0, z]} rotation={[0, ry, 0]} />;
}

export function VoxFireplace() {
  const flameMaterials = useRef([]);
  const frames = useMemo(() => [0, 1, 2].map((frame) => tex('flame', { frame })), []);
  useFrame((state) => {
    const frame = Math.floor(state.clock.elapsedTime * 2.5) % frames.length;
    for (const material of flameMaterials.current) {
      if (material && material.map !== frames[frame]) {
        material.map = frames[frame];
        material.emissiveMap = frames[frame];
      }
    }
  });
  return (
    <group position={[0, 0, -11.6]}>
      <Vox url={fireplaceUrl} emissiveColors={[P.ember]} emissiveIntensity={0.9} />
      {[0, Math.PI / 2].map((ry, i) => (
        <mesh key={ry} position={[0, 0.62, 0.08]} rotation={[0, ry, 0]}>
          <planeGeometry args={[0.9, 1.3]} />
          <meshStandardMaterial
            ref={(material) => { if (material) flameMaterials.current[i] = material; }}
            map={frames[0]}
            emissiveMap={frames[0]}
            emissive="#ffffff"
            emissiveIntensity={2}
            transparent
            alphaTest={0.4}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <mesh position={[0.85, 2.32, 0.06]}>
        <planeGeometry args={[0.1, 0.16]} />
        <meshStandardMaterial
          map={frames[1]}
          emissiveMap={frames[1]}
          emissive={P.ink}
          emissiveIntensity={1.6}
          transparent
          alphaTest={0.4}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export function VoxBarrels() {
  return [[-9, -8], [-10, -4], [9.5, -7]].map(([x, z], i) => (
    <Vox key={`${x}:${z}`} url={barrelUrl} position={[x, 0, z]} rotation={[0, i * 1.3, 0]} />
  ));
}

function FlamePlanes({ frames, frame, scale = 1 }) {
  return [0, Math.PI / 2].map((ry) => (
    <mesh key={ry} position={[0, 0.24 * scale, 0]} rotation={[0, ry, 0]}>
      <planeGeometry args={[0.1 * scale, 0.16 * scale]} />
      <meshStandardMaterial
        map={frames[frame]}
        emissiveMap={frames[frame]}
        emissive={P.ink}
        emissiveIntensity={1.7}
        transparent
        alphaTest={0.4}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  ));
}

export function VoxDecor() {
  const wood = tex('wood', { tone: P.wood700 });
  const frames = useMemo(() => [0, 1, 2].map((frame) => tex('flame', { frame })), []);
  const woodMaterial = <meshStandardMaterial map={wood} roughness={1} flatShading />;

  const sconce = (key, position, ry, frame) => (
    <group key={key} position={position} rotation={[0, ry, 0]}>
      <Vox url={sconceUrl} position={[0, -0.29, 0]} />
      <group position={[0, 0.12, 0]}><FlamePlanes frames={frames} frame={frame} scale={1.25} /></group>
    </group>
  );
  const moonWindow = (key, position, ry = 0) => (
    <group key={key} position={position} rotation={[0, ry, 0]}>
      <mesh>
        <planeGeometry args={[1.3, 1.7]} />
        <meshStandardMaterial color={P.coolFill} emissive={P.coolFill} emissiveIntensity={0.85} roughness={1} />
      </mesh>
      <mesh position={[0, 0.88, 0.05]}><boxGeometry args={[1.54, 0.12, 0.12]} />{woodMaterial}</mesh>
      <mesh position={[0, -0.88, 0.05]}><boxGeometry args={[1.54, 0.12, 0.12]} />{woodMaterial}</mesh>
      <mesh position={[-0.71, 0, 0.05]}><boxGeometry args={[0.12, 1.64, 0.12]} />{woodMaterial}</mesh>
      <mesh position={[0.71, 0, 0.05]}><boxGeometry args={[0.12, 1.64, 0.12]} />{woodMaterial}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[0.08, 1.64, 0.08]} />{woodMaterial}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[1.54, 0.08, 0.08]} />{woodMaterial}</mesh>
    </group>
  );
  const shelf = (key, position, ry = 0, items = 'bottles') => (
    <group key={key} position={position} rotation={[0, ry, 0]}>
      <Vox url={shelfUrl} position={[0, -0.04, 0]} />
      {items === 'bottles' && [[-0.7, bottleGreenUrl], [-0.15, bottleBrownUrl], [0.45, bottleGreenUrl]].map(([x, url], i) => (
        <Vox key={`${url}-${x}`} url={url} position={[x, 0.76, 0]} rotation={[0, i * 1.1, 0]} />
      ))}
      {(items === 'bottles' ? [-0.5, 0.3] : [-0.7, -0.25, 0.2, 0.65]).map((x, i) => (
        <Vox key={`mug-low-${x}`} url={mugUrl} position={[x, 0.05, 0]} rotation={[0, i * 2.1 + 0.6, 0]} />
      ))}
      {items === 'mugs' && [-0.45, 0.45].map((x, i) => (
        <Vox key={`mug-top-${x}`} url={mugUrl} position={[x, 0.77, 0]} rotation={[0, i * 2.6 + 1.4, 0]} />
      ))}
    </group>
  );

  return (
    <group>
      {moonWindow('window-back', [-7.5, 3.7, -11.88])}
      {shelf('shelf-back', [-9.6, 2.85, -11.76])}
      <group position={[5.6, 3.0, -11.86]}>
        <mesh>
          <boxGeometry args={[1.5, 1.1, 0.06]} />
          <meshStandardMaterial map={tex('menu')} emissiveMap={tex('menu')} emissive={P.ink} emissiveIntensity={0.22} roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 0.61, 0]}><boxGeometry args={[1.7, 0.12, 0.1]} />{woodMaterial}</mesh>
        <mesh position={[0, -0.61, 0]}><boxGeometry args={[1.7, 0.12, 0.1]} />{woodMaterial}</mesh>
        <mesh position={[-0.79, 0, 0]}><boxGeometry args={[0.12, 1.1, 0.1]} />{woodMaterial}</mesh>
        <mesh position={[0.79, 0, 0]}><boxGeometry args={[0.12, 1.1, 0.1]} />{woodMaterial}</mesh>
      </group>
      {sconce('sconce-back-left', [-3.1, 2.55, -11.72], 0, 0)}
      {sconce('sconce-back-right', [3.1, 2.55, -11.72], 0, 1)}
      <group position={[-8.4, 0, -10.3]}>
        <Vox url={crateUrl} rotation={[0, 0.12, 0]} scale={S * 1.125} />
        <Vox url={crateUrl} position={[-1.0, 0, 0.25]} rotation={[0, -0.3, 0]} />
        <Vox url={crateUrl} position={[-0.15, 0.9, 0.1]} rotation={[0, 0.5, 0]} scale={S * 0.9375} />
      </group>

      <Vox url={doorUrl} position={[2.5, 0, 11.85]} />
      <group position={[2.5, 3.62, 11.8]}>
        {[-0.16, 0.16].map((x) => (
          <mesh key={x} position={[x, 0.32, 0]}><boxGeometry args={[0.04, 0.42, 0.04]} /><meshStandardMaterial color={P.wood900} roughness={1} flatShading /></mesh>
        ))}
        <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.46, 0.46, 0.05, 12]} />
          <meshStandardMaterial map={tex('wood', { tone: P.wood500 })} roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 0, -0.02]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[0.4, 16]} />
          <meshStandardMaterial map={coinFaceTexture('heads')} emissiveMap={coinFaceTexture('heads')} emissive={P.candle} emissiveIntensity={0.18} roughness={1} />
        </mesh>
      </group>
      <Vox url={coatrackUrl} position={[-2.0, 1.9, 11.82]} />
      <Vox url={benchUrl} position={[-2.0, 0, 11.47]} />
      {sconce('sconce-front-left', [-5.4, 2.55, 11.72], Math.PI, 1)}
      {sconce('sconce-front-right', [6.4, 2.55, 11.72], Math.PI, 0)}

      {moonWindow('window-left', [-11.88, 3.7, 2.5], Math.PI / 2)}
      {shelf('shelf-left', [-11.76, 2.85, -3.0], Math.PI / 2)}
      {sconce('sconce-left', [-11.72, 2.55, 7.5], Math.PI / 2, 1)}

      <Vox url={dartboardUrl} position={[11.86, 2.14, 1.5]} rotation={[0, -Math.PI / 2, 0]} />
      {shelf('shelf-right', [11.76, 2.85, -4.0], -Math.PI / 2, 'mugs')}
      {sconce('sconce-right', [11.72, 2.55, 6.5], -Math.PI / 2, 0)}

      <group position={[8.3, 0, 6.8]}>
        <Vox url={tableRoundUrl} />
        <Vox url={mugUrl} position={[-0.25, 0.9, 0.1]} rotation={[0, 0.8, 0]} />
        <Vox url={mugUrl} position={[0.2, 0.9, -0.18]} rotation={[0, 2.9, 0]} />
      </group>
      <VoxChair x={7.25} z={5.85} ry={0.85} />
      <VoxChair x={9.3} z={7.75} ry={-2.4} />
      <Vox url={barrelUrl} position={[-8.6, 0, 7.2]} rotation={[0, 0.8, 0]} />
      <Vox url={crateUrl} position={[-7.35, 0, 8.0]} rotation={[0, -0.25, 0]} scale={S * 0.875} />
    </group>
  );
}
