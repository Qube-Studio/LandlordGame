// 主游戏人物单一入口(VOXEL_PLAN P1 并回,2026-07-19):默认=体素人 VoxPlayer(骨架 v2,肘/膝二级关节);
// ?art=box 回退旧盒子人 MinecraftPlayer(§5-1 骨架,**保留不删**,与 ?input=2d 同一保底哲学)。
// 盒子人不懂 exec(处决持枪/倒地动作)——回退模式下行刑者外部视角无持枪动作,属已知降级。
import MinecraftPlayer from './MinecraftPlayer';
import VoxPlayer from './VoxPlayer';
import { useSettingsStore } from '../store/settingsStore';

const queryArt = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('art')
  : null;
const QA_ART_OVERRIDE = queryArt === 'box' || queryArt === 'vox' ? queryArt : null;

export default function PlayerModel({ art = null, exec = null, ...rest }) {
  const visualStyle = useSettingsStore(s => s.visualStyle);
  const resolvedArt = art ?? QA_ART_OVERRIDE ?? (visualStyle === 'classic' ? 'box' : 'vox');
  return resolvedArt === 'box'
    ? <MinecraftPlayer {...rest} />
    : <VoxPlayer {...rest} exec={exec} />;
}
