// 选角墙「招募令」（HUD 2.0，反馈⑧）：桌沿抽屉里升起的一排羊皮招募令。
// LOBBY 可点击应征/改选；开局后变成只读「角色手册」。占用状态用火漆印章表达。
// 可选性判断与服务端 takeRole 同口径（地主阵营互斥 / 农民受 maxFarmers 上限）——
// 只用于置灰提示，最终裁决仍在服务端。
import { Canvas } from '@react-three/fiber';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import RoleBust3D from '../scene/RoleBust3D';
import {
  ROLE_LABEL, ROLE_SHEET, factionOf,
  LANDLORD_SIDE_ROLES, FARMER_SIDE_ROLES,
} from '../game/roles';

function Poster({ role, mode, state, me, send, readonly }) {
  const takers = state.players.filter(p => p.role === role);
  const mine = me?.role === role;
  let blocked = false;
  if (!readonly && !mine) {
    if (factionOf(role) === 'landlord') {
      blocked = state.players.some(p => factionOf(p.role) === 'landlord' && p.id !== me?.id);
    } else {
      const others = state.players.filter(p => factionOf(p.role) === 'farmer' && p.id !== me?.id).length;
      blocked = others >= (state.config?.maxFarmers ?? 4);
    }
  }
  const clickable = !readonly && !blocked && !mine && !me?.spectator;
  const sheet = ROLE_SHEET[role] ?? { tagline: '', lines: [] };
  const lines = [...sheet.lines, ...((mode === 'competitive' && sheet.competitiveLines) || [])];
  return (
    <div
      className={`poster ${mine ? 'mine' : ''} ${blocked ? 'blocked' : ''} ${clickable ? 'clickable' : ''}`}
      onClick={clickable ? () => send({ type: 'take_role', role }) : undefined}
    >
      {/* 反馈:身体与饰品都用真 3D 模型(与桌边的人完全一致);去掉头,头位浮着标志性饰品。
          frameloop="demand" 只渲一帧(静态半身像),多张招募令也近乎零持续开销。 */}
      <div className="poster-relic">
        <Canvas
          className="poster-bust"
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ position: [0, 0, 2.25], fov: 30 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        >
          <RoleBust3D role={role} />
        </Canvas>
      </div>
      <div className="poster-name"><PixelText size={3} color="var(--c-wood-900)">{ROLE_LABEL[role]}</PixelText></div>
      <div className="poster-tagline"><PixelText size={2} color="var(--c-parch-ink)">{sheet.tagline}</PixelText></div>
      <div className="poster-lines">
        {lines.map(([k, v]) => (
          <div key={k + v} className="poster-line">
            <span className="poster-k"><PixelText size={2} color="var(--c-wood-900)">{k}</PixelText></span>
            <span className="poster-v">{v}</span>
          </div>
        ))}
      </div>
      {takers.length > 0 && (
        <>
          <div className="poster-seal"><PixelText size={2} color="var(--c-parchment)">{mine ? '你' : '应征'}</PixelText></div>
          <div className="poster-takers"><PixelText size={2} color="var(--c-wax)">{takers.map(p => p.name).join('、')}</PixelText></div>
        </>
      )}
      {blocked && takers.length === 0 && (
        <div className="poster-takers"><PixelText size={2} color="var(--c-parch-ink)">阵营已满</PixelText></div>
      )}
    </div>
  );
}

export default function RoleWall() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const setPanel = useGameStore(s => s.setPanel);
  const me = state.me;
  const readonly = state.phase !== 'LOBBY';
  const competitive = state.mode === 'competitive';
  const farmers = state.players.filter(p => factionOf(p.role) === 'farmer').length;
  const landlords = state.players.filter(p => factionOf(p.role) === 'landlord').length;
  const maxF = state.config?.maxFarmers ?? 4;
  const pass = { mode: state.mode, state, me, send, readonly };
  return (
    <div className="drawer role-wall">
      <div className="drawer-title">
        <PixelText size={2} color="var(--c-wood-900)">{readonly ? '角色手册' : '招募令 · 选择你的角色'}</PixelText>
        <div className="drawer-title-right">
          <span className="drawer-hint"><PixelText size={2} color="var(--c-wood-900)">{`地主 ${landlords}/1 · 农民 ${farmers}/${maxF}`}</PixelText></span>
          <button className="drawer-x" onClick={() => setPanel(null)} title="收起 (R / Esc)">✕</button>
        </div>
      </div>
      <div className="drawer-body role-wall-body">
        {competitive ? (
          <>
            <div className="role-group">
              <div className="role-group-title"><PixelText size={2} color="var(--px-gold)">地主阵营 · 1 人</PixelText></div>
              <div className="poster-row">{LANDLORD_SIDE_ROLES.map(r => <Poster key={r} role={r} {...pass} />)}</div>
            </div>
            <div className="role-group">
              <div className="role-group-title"><PixelText size={2} color="var(--ok)">{`农民阵营 · 1–${maxF} 人,可重复`}</PixelText></div>
              <div className="poster-row">{FARMER_SIDE_ROLES.map(r => <Poster key={r} role={r} {...pass} />)}</div>
            </div>
          </>
        ) : (
          <div className="role-group">
            <div className="poster-row">{['landlord', 'farmer'].map(r => <Poster key={r} role={r} {...pass} />)}</div>
          </div>
        )}
      </div>
      {!readonly && (
        <div className="drawer-foot">
          {me?.isHost
            ? <button className="btn primary" onClick={() => send({ type: 'start_game' })}>开始游戏 <span className="keycap">⏎</span></button>
            : <PixelText size={2} color="var(--ink-dim)">选好角色,等待房主开始…</PixelText>}
        </div>
      )}
    </div>
  );
}
