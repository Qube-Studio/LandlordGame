// VoxLab 专用:props 素材批次(附录 C)的场景装配——墙/梁/桌/椅的体素版,仅验证区,主游戏不引用。
// 墙 = 下段石墙裙(0~4m)+ 上段木板墙(4~10m),每面 4 段拼 24m(全部单模型素材;
//   段宽 6.048 相邻微互叠免缝,段缝正好落在上段的深色木筋柱底下);内面贴 ±12 与现有碰撞/Decor 对位。
// 地板/天花仍是贴图平面(VOXEL_PLAN §2.2 保留不动,这轮只换墙与梁);梁 = 3 段拼 24m,接缝落在铁箍上。
// 桌 = props/table-long(单人长桌),按 PROP_TABLE_Y 下移让可见桌顶回到 y=1.0;下注圈贴花本轮不叠(素毡属预期)。
import { tex } from '../assets/texlib';
import { P } from '../assets/palette';
import VoxModel from '../voxel/VoxModel';
import { PROP_VOXEL_SIZE, PROP_TABLE_Y } from '../voxel/propsSpec';
import wallLowerUrl from '../assets/vox/props/wall-lower.vox?url';
import wallUpperUrl from '../assets/vox/props/wall-upper.vox?url';
import beamUrl from '../assets/vox/props/beam.vox?url';
import tableUrl from '../assets/vox/props/table-long.vox?url';
import chairUrl from '../assets/vox/props/chair.vox?url';

const SEG_XS = [-9, -3, 3, 9];       // 每面墙 4 段
const WALL_OFF = 12 + 0.108;         // 墙厚 0.216 的一半:内面贴 ±12
const BEAM_XS = [-7.992, 0, 7.992];  // 段长 7.992,三段拼 24m
const BEAM_ZS = [-9, -3, 3, 9];      // 与 Room 的房梁同位(吊灯横杆搭 z=±3 两根)

function WallLayer({ url, y }) {
  const segs = [
    ...SEG_XS.map((x) => ({ pos: [x, y, -WALL_OFF], ry: 0 })),
    ...SEG_XS.map((x) => ({ pos: [x, y, WALL_OFF], ry: Math.PI })),
    ...SEG_XS.map((z) => ({ pos: [-WALL_OFF, y, z], ry: Math.PI / 2 })),
    ...SEG_XS.map((z) => ({ pos: [WALL_OFF, y, z], ry: -Math.PI / 2 })),
  ];
  return segs.map((w, i) => (
    <VoxModel
      key={i} url={url} scale={PROP_VOXEL_SIZE}
      position={w.pos} rotation={[0, w.ry, 0]}
      castShadow={false} receiveShadow
    />
  ));
}

// 体素房间:替换 Scene3D#Room(贴图墙/方梁 → 体素墙/梁;地板天花照旧)
export function VoxRoom() {
  const floor = tex('floor', {}, 6, 6);
  const ceil = tex('wood', { tone: P.wood700 }, 4, 4);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial map={floor} roughness={1} />
      </mesh>
      <WallLayer url={wallLowerUrl} y={0} />
      <WallLayer url={wallUpperUrl} y={4.0} />
      <mesh position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial map={ceil} roughness={1} />
      </mesh>
      {/* 房梁(castShadow:梁投影在桌面/地板落暗条纹,是 Room 的既定演出) */}
      {BEAM_ZS.map((z) => BEAM_XS.map((x) => (
        <VoxModel key={`${z}:${x}`} url={beamUrl} scale={PROP_VOXEL_SIZE} position={[x, 5.8, z]} />
      )))}
    </group>
  );
}

// 体素长桌:替换 Table(spots 贴花圈不叠,验证区看素材本体)
export function VoxTable() {
  return <VoxModel url={tableUrl} scale={PROP_VOXEL_SIZE} position={[0, PROP_TABLE_Y, 0]} receiveShadow />;
}

// 体素靠背椅:替换 Chair,同座位/朝向
export function VoxChair({ x, z, ry = 0 }) {
  return <VoxModel url={chairUrl} scale={PROP_VOXEL_SIZE} position={[x, 0, z]} rotation={[0, ry, 0]} />;
}
