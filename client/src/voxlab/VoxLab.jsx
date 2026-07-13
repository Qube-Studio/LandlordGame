// VoxLab 顶层:Canvas(参数对齐主项目) + 行走 rig + 2D 罩层(准心/操作卡/状态行)。
import { Canvas } from '@react-three/fiber';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL } from '../game/roles';
import { useLabStore, SWAP_KEYS } from './labStore';
import Stage from './Stage';
import LabRig from './LabRig';

const SWAP_LABEL = { chandelier: '吊灯' };

function Hud() {
  const locked = useLabStore(s => s.locked);
  const aimKind = useLabStore(s => s.aimKind);
  const role = useLabStore(s => s.role);
  const charCount = useLabStore(s => s.chars.length);
  const swaps = useLabStore(s => s.swaps);
  const help = useLabStore(s => s.help);
  return (
    <>
      {locked && (
        <div className={`walk-crosshair ${aimKind ? 'aim' : ''}`} data-aim={aimKind ?? undefined}>
          <i className="ch-n" /><i className="ch-s" /><i className="ch-w" /><i className="ch-e" />
        </div>
      )}
      {!locked && (
        <div className="voxlab-unlock-hint">点击画面锁定视角 · 按住 CTRL 释放鼠标</div>
      )}
      <div className="voxlab-top">
        <PixelText size={2} color="var(--c-brass-hi)">VOXLAB</PixelText>
        <span className="voxlab-chip">体素画风隔离验证区 · 仅本地</span>
        {SWAP_KEYS.map((k) => (
          <span key={k} className={`voxlab-chip ${swaps[k] ? 'on' : ''}`}>
            {SWAP_LABEL[k] ?? k}:{swaps[k] ? '体素' : '现有'}
          </span>
        ))}
      </div>
      {help && (
        <div className="voxlab-help">
          <div className="voxlab-help-title">操作</div>
          <div>WASD 走动 · 鼠标转视角</div>
          <div>左键(指地面) 摆放人物 · 右键(指人物) 移除</div>
          <div>滚轮 / R 切换角色:<b>{ROLE_LABEL[role] ?? role}</b></div>
          <div>V 切换吊灯(体素↔现有) · X 清空人物</div>
          <div>CTRL 按住释放鼠标 · H 收起本卡</div>
          <div className="voxlab-help-dim">已摆放 {charCount} 个模型</div>
        </div>
      )}
    </>
  );
}

export default function VoxLab() {
  return (
    <div className="r3f-scene voxlab-root">
      <Canvas
        shadows
        dpr={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5)}
        camera={{ position: [0, 2.35, 7.6], fov: 58, near: 0.1, far: 100 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <Stage />
        <LabRig />
      </Canvas>
      <Hud />
    </div>
  );
}
