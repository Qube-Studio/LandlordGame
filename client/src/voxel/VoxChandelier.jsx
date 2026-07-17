// 双层圆盘吊灯(2026-07-16 新款,规格=chandelierSpec.TIERED,素材=props/chandelier-tiered.vox):
// 双层黄铜圆盘金属质感 + 末地烛式自发光灯柱(ink 暖白,**无火苗面片**——灯柱本身就是光源,
// 交给 Bloom;整灯明暗仍由吊灯点光闪烁承担)+ 下盘水晶吊坠(specGlass 玻璃 MATL,
// 靠吊灯点光近距离直射透亮,不做自发光——保住冷色相)。
// 旧款八角木轮(chandelier-deluxe)留在素材库可随时切回比对。
// 吊装(吊杆+两梁横杆)沿用常规网格——房梁体系是 Room 的,不属于资产本体;castShadow=false 同旧款。
import chandUrl from '../assets/vox/props/chandelier-tiered.vox?url';
import VoxModel from './VoxModel';
import { PROP_VOXEL_SIZE } from './propsSpec';
import { TIERED } from './chandelierSpec';
import { P } from '../assets/palette';

export default function VoxChandelier() {
  return (
    <group position={[0, TIERED.mountY, 0]}>
      {/* 灯柱 emissive 0.85:1.5 会被 Bloom(阈值 0.72)打成白热(琥珀吊坠时代的教训,暖白同理) */}
      <VoxModel url={chandUrl} scale={PROP_VOXEL_SIZE} emissiveColors={[P.ink]} emissiveIntensity={0.85} castShadow={false} />
      {/* 吊杆 → 两梁间横杆(世界 y=6,同旧款;横杆不投影) */}
      <mesh position={[0, (TIERED.hoopTop + (6 - TIERED.mountY)) / 2, 0]}>
        <boxGeometry args={[0.05, (6 - TIERED.mountY) - TIERED.hoopTop, 0.05]} />
        <meshStandardMaterial color={P.wood900} roughness={1} />
      </mesh>
      <mesh position={[0, 6 - TIERED.mountY, 0]}>
        <boxGeometry args={[0.18, 0.18, 6.2]} />
        <meshStandardMaterial color={P.beam} roughness={1} flatShading />
      </mesh>
    </group>
  );
}
