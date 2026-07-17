// VoxLab 专用:小物件体素装配(附录 C 批次)——壁炉/酒桶/杂项装饰的体素版,仅验证区。
// 布局坐标逐条对齐 Scene3D 的 Fireplace/Barrels/Decor;自发光面片(火苗/月光窗/菜单板/铜币牌)
// 按 VOXEL_PLAN §2.2 保留为面片,实体件换 props/ 体素素材。castShadow=false 对齐原件(原摆设不投影)。
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { tex } from '../assets/texlib';
import { coinFaceTexture } from '../scene/textures';
import { P } from '../assets/palette';
import VoxModel from '../voxel/VoxModel';
import { PROP_VOXEL_SIZE } from '../voxel/propsSpec';
import { VoxChair } from './VoxProps';
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

const S = PROP_VOXEL_SIZE;
const Vox = (props) => <VoxModel scale={S} castShadow={false} {...props} />;

// 交叉火苗面片(同 Scene3D#Decor 的 flamePlanes)
function FlamePlanes({ frames, fi, s = 1 }) {
  return [0, Math.PI / 2].map((ry, k) => (
    <mesh key={k} position={[0, 0.24 * s, 0]} rotation={[0, ry, 0]}>
      <planeGeometry args={[0.1 * s, 0.16 * s]} />
      <meshStandardMaterial
        map={frames[fi]} emissiveMap={frames[fi]} emissive={P.ink} emissiveIntensity={1.7}
        transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
      />
    </mesh>
  ));
}

// ================= 体素壁炉(石拱/炉台/圆木/炭床=体素;火焰与烛焰=面片,帧轮换照抄 Fireplace) =================
export function VoxFireplace() {
  const flameMat = useRef([]);
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  useFrame((st) => {
    const i = Math.floor(st.clock.elapsedTime * 2.5) % 3;
    for (const m of flameMat.current) {
      if (m && m.map !== frames[i]) { m.map = frames[i]; m.emissiveMap = frames[i]; }
    }
  });
  return (
    <group position={[0, 0, -11.6]}>
      {/* 炭床 ember 自发光子网格(0.9:同吊坠,Bloom 下留住琥珀色相) */}
      <Vox url={fireplaceUrl} emissiveColors={[P.ember]} emissiveIntensity={0.9} />
      {[0, Math.PI / 2].map((ry, i) => (
        <mesh key={i} position={[0, 0.62, 0.08]} rotation={[0, ry, 0]}>
          <planeGeometry args={[0.9, 1.3]} />
          <meshStandardMaterial
            ref={(m) => { if (m) flameMat.current[i] = m; }}
            map={frames[0]} emissiveMap={frames[0]} emissive={'#ffffff'} emissiveIntensity={2}
            transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* 炉台蜡烛的火苗(静帧,同原件) */}
      <mesh position={[0.85, 2.32, 0.06]}>
        <planeGeometry args={[0.1, 0.16]} />
        <meshStandardMaterial
          map={frames[1]} emissiveMap={frames[1]} emissive={P.ink} emissiveIntensity={1.6}
          transparent alphaTest={0.4} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ================= 体素酒桶 ×3(沿墙,位置/朝向同 Barrels;桶心 0.75=桶高一半 → 底锚 y0) =================
export function VoxBarrels() {
  return [[-9, -8], [-10, -4], [9.5, -7]].map(([x, z], i) => (
    <Vox key={i} url={barrelUrl} position={[x, 0, z]} rotation={[0, i * 1.3, 0]} />
  ));
}

// ================= 体素杂项装饰(布局照抄 Decor;月光窗/菜单板/铜币牌保留原面片) =================
export function VoxDecor() {
  const wood7 = tex('wood', { tone: P.wood700 });
  const frames = useMemo(() => [0, 1, 2].map(f => tex('flame', { frame: f })), []);
  const woodMat = <meshStandardMaterial map={wood7} roughness={1} flatShading />;

  // 墙面烛台:体素托座(锚点=托底,内部 -0.29 回位) + 火苗面片
  const sconce = (key, pos, ry, fi) => (
    <group key={key} position={pos} rotation={[0, ry, 0]}>
      <Vox url={sconceUrl} position={[0, -0.29, 0]} />
      <group position={[0, 0.12, 0]}><FlamePlanes frames={frames} fi={fi} s={1.25} /></group>
    </group>
  );
  // 月光窗(自发光玻璃,保留原件:§2.2 窗玻璃=面片)
  const moonWindow = (key, pos, ry = 0) => (
    <group key={key} position={pos} rotation={[0, ry, 0]}>
      <mesh>
        <planeGeometry args={[1.3, 1.7]} />
        <meshStandardMaterial color={P.coolFill} emissive={P.coolFill} emissiveIntensity={0.85} roughness={1} />
      </mesh>
      <mesh position={[0, 0.88, 0.05]}><boxGeometry args={[1.54, 0.12, 0.12]} />{woodMat}</mesh>
      <mesh position={[0, -0.88, 0.05]}><boxGeometry args={[1.54, 0.12, 0.12]} />{woodMat}</mesh>
      <mesh position={[-0.71, 0, 0.05]}><boxGeometry args={[0.12, 1.64, 0.12]} />{woodMat}</mesh>
      <mesh position={[0.71, 0, 0.05]}><boxGeometry args={[0.12, 1.64, 0.12]} />{woodMat}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[0.08, 1.64, 0.08]} />{woodMat}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[1.54, 0.08, 0.08]} />{woodMat}</mesh>
    </group>
  );
  // 体素搁板 + 体素瓶/杯(板体抬 0.04 → VoxModel 下移回位;瓶底=顶板面 0.76,杯底=底板面 0.05)
  const shelf = (key, pos, ry = 0, items = 'bottles') => (
    <group key={key} position={pos} rotation={[0, ry, 0]}>
      <Vox url={shelfUrl} position={[0, -0.04, 0]} />
      {items === 'bottles' && [[-0.7, bottleGreenUrl], [-0.15, bottleBrownUrl], [0.45, bottleGreenUrl]].map(([bx, url], i) => (
        <Vox key={i} url={url} position={[bx, 0.76, 0]} rotation={[0, i * 1.1, 0]} />
      ))}
      {(items === 'bottles' ? [-0.5, 0.3] : [-0.7, -0.25, 0.2, 0.65]).map((bx, i) => (
        <Vox key={`m${bx}`} url={mugUrl} position={[bx, 0.05, 0]} rotation={[0, i * 2.1 + 0.6, 0]} />
      ))}
      {items === 'mugs' && [-0.45, 0.45].map((bx, i) => (
        <Vox key={`t${bx}`} url={mugUrl} position={[bx, 0.77, 0]} rotation={[0, i * 2.6 + 1.4, 0]} />
      ))}
    </group>
  );
  return (
    <group>
      {/* ===== 后墙(z-) ===== */}
      {moonWindow('w-back', [-7.5, 3.7, -11.88])}
      {shelf('s-back', [-9.6, 2.85, -11.76])}
      {/* 粉笔菜单板(自发光,保留原件) */}
      <group position={[5.6, 3.0, -11.86]}>
        <mesh>
          <boxGeometry args={[1.5, 1.1, 0.06]} />
          <meshStandardMaterial map={tex('menu')} emissiveMap={tex('menu')} emissive={P.ink} emissiveIntensity={0.22} roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 0.61, 0]}><boxGeometry args={[1.7, 0.12, 0.1]} />{woodMat}</mesh>
        <mesh position={[0, -0.61, 0]}><boxGeometry args={[1.7, 0.12, 0.1]} />{woodMat}</mesh>
        <mesh position={[-0.79, 0, 0]}><boxGeometry args={[0.12, 1.1, 0.1]} />{woodMat}</mesh>
        <mesh position={[0.79, 0, 0]}><boxGeometry args={[0.12, 1.1, 0.1]} />{woodMat}</mesh>
      </group>
      {sconce('sc-b1', [-3.1, 2.55, -11.72], 0, 0)}
      {sconce('sc-b2', [3.1, 2.55, -11.72], 0, 1)}
      {/* 木箱堆(后左角;基准箱 0.8,按原尺寸 0.9/0.8/0.75 比例缩放) */}
      <group position={[-8.4, 0, -10.3]}>
        <Vox url={crateUrl} position={[0, 0, 0]} rotation={[0, 0.12, 0]} scale={S * 1.125} />
        <Vox url={crateUrl} position={[-1.0, 0, 0.25]} rotation={[0, -0.3, 0]} />
        <Vox url={crateUrl} position={[-0.15, 0.9, 0.1]} rotation={[0, 0.5, 0]} scale={S * 0.9375} />
      </group>

      {/* ===== 前墙(z+) ===== */}
      <Vox url={doorUrl} position={[2.5, 0, 11.85]} />
      {/* 门上硬币挂牌(自发光店招,保留原件) */}
      <group position={[2.5, 3.62, 11.8]}>
        {[-0.16, 0.16].map((cx) => (
          <mesh key={cx} position={[cx, 0.32, 0]}><boxGeometry args={[0.04, 0.42, 0.04]} /><meshStandardMaterial color={P.wood900} roughness={1} flatShading /></mesh>
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
      {sconce('sc-f1', [-5.4, 2.55, 11.72], Math.PI, 1)}
      {sconce('sc-f2', [6.4, 2.55, 11.72], Math.PI, 0)}

      {/* ===== 左墙(x-) ===== */}
      {moonWindow('w-left', [-11.88, 3.7, 2.5], Math.PI / 2)}
      {shelf('s-left', [-11.76, 2.85, -3.0], Math.PI / 2)}
      {sconce('sc-l1', [-11.72, 2.55, 7.5], Math.PI / 2, 1)}

      {/* ===== 右墙(x+) ===== */}
      <Vox url={dartboardUrl} position={[11.86, 2.14, 1.5]} rotation={[0, -Math.PI / 2, 0]} />
      {shelf('s-right', [11.76, 2.85, -4.0], -Math.PI / 2, 'mugs')}
      {sconce('sc-r1', [11.72, 2.55, 6.5], -Math.PI / 2, 0)}

      {/* ===== 地面角落 ===== */}
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
