// VoxLab 顶层:Canvas(参数对齐主项目) + 行走 rig + 2D 罩层(准心/操作卡/导入入口/素材库)。
// 导入素材:顶栏按钮(按住 CTRL 释放鼠标后点)或直接拖 .vox 文件进窗口——字节存 IndexedDB
// (刷新不丢),ObjectURL 走与内置资产同一条 loadVox 管线,导入即成为当前摆放笔刷。
// 素材库面板(未锁定时可点):换笔刷 / 删除素材(连同已摆实例)。场景摆放物持久化在 localStorage。
import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import PixelText from '../assets/pixelfont/PixelText';
import { ROLE_LABEL } from '../game/roles';
import { useLabStore, SWAP_KEYS, brushImport, hydrateLab } from './labStore';
import Stage from './Stage';
import LabRig from './LabRig';

const SWAP_LABEL = { chandelier: '吊灯', table: '桌', chairs: '椅', room: '墙梁', fireplace: '壁炉', barrels: '木桶', decor: '装饰', players: '人物' };

async function importVoxFiles(files) {
  const st = useLabStore.getState();
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.vox')) continue;
    st.addImport(f.name.replace(/\.vox$/i, ''), await f.arrayBuffer());
  }
}

// 性能角标:fps / draw call / 三角数(Stage#PerfProbe 半秒写一次 window.__voxperf;
// 体素资产替换的帧率影响一眼可见——墙面合并率翻车那次就是靠它定位的)
function PerfChip() {
  const [p, setP] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setP(window.__voxperf ?? null), 500);
    return () => clearInterval(t);
  }, []);
  if (!p) return null;
  return <span className="voxlab-chip">{p.fps}fps · {p.calls}dc · {Math.round(p.tris / 1000)}k△</span>;
}

function Hud() {
  const locked = useLabStore(s => s.locked);
  const aimKind = useLabStore(s => s.aimKind);
  const brush = useLabStore(s => s.brush);
  const imp = useLabStore(brushImport);
  const imports = useLabStore(s => s.imports);
  const charCount = useLabStore(s => s.chars.length);
  const swaps = useLabStore(s => s.swaps);
  const help = useLabStore(s => s.help);
  const ghostScale = useLabStore(s => s.ghostScale);
  const fileRef = useRef();

  // 拖 .vox 进窗口 = 导入(dragover 必须 preventDefault,否则浏览器直接打开文件)
  useEffect(() => {
    const over = (e) => { e.preventDefault(); };
    const drop = (e) => {
      e.preventDefault();
      importVoxFiles(e.dataTransfer?.files ?? []);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const brushLabel = imp ? imp.name : (ROLE_LABEL[brush] ?? brush);
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
        <PerfChip />
        {SWAP_KEYS.map((k) => (
          <span key={k} className={`voxlab-chip ${swaps[k] ? 'on' : ''}`}>
            {SWAP_LABEL[k] ?? k}:{swaps[k] ? '体素' : '现有'}
          </span>
        ))}
        <button
          type="button"
          className="voxlab-chip voxlab-btn"
          onClick={() => fileRef.current?.click()}
          title="导入 .vox 素材(MagicaVoxel 手修件直接丢进来);也可直接拖文件进窗口"
        >
          + 导入 .vox
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".vox"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { importVoxFiles(e.target.files ?? []); e.target.value = ''; }}
        />
      </div>
      {/* 素材库(未锁定=鼠标可点时展开;锁定中收起,免遮视野) */}
      {!locked && imports.length > 0 && (
        <div className="voxlab-assets">
          <div className="voxlab-help-title">素材库({imports.length})· 已持久保存</div>
          {imports.map((m) => (
            <div key={m.key} className="voxlab-asset-row">
              <span className={`voxlab-asset-name ${brush === m.key ? 'on' : ''}`}>{m.name}</span>
              <button type="button" className="voxlab-mini-btn" onClick={() => useLabStore.setState({ brush: m.key })}>笔刷</button>
              <button type="button" className="voxlab-mini-btn danger" onClick={() => useLabStore.getState().removeImport(m.key)}>删除</button>
            </div>
          ))}
        </div>
      )}
      {help && (
        <div className="voxlab-help">
          <div className="voxlab-help-title">操作</div>
          <div>WASD 走动 · 鼠标转视角</div>
          <div>左键 摆放(地面/桌面/横梁/天花板) · 右键 移除</div>
          <div>R 切换笔刷:<b>{brushLabel}</b></div>
          <div>Q/E 旋转 · 滚轮 缩放(×{ghostScale.toFixed(2)})</div>
          <div>体素↔现有:V 吊灯 · B 桌 · N 椅 · M 墙梁 · F 壁炉 · G 木桶 · T 装饰 · P 人物</div>
          <div>X 清空摆放</div>
          <div>导入素材:顶栏按钮 或 拖 .vox 进窗口</div>
          <div>CTRL 按住释放鼠标(管理素材库) · H 收起本卡</div>
          <div className="voxlab-help-dim">已摆放 {charCount} 个模型 · 摆放与素材均已持久保存</div>
        </div>
      )}
    </>
  );
}

export default function VoxLab() {
  // 启动水合:IndexedDB 素材 → localStorage 场景(一次;完成后自动订阅落盘)
  useEffect(() => { hydrateLab(); }, []);
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
