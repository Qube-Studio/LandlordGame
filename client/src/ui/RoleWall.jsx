// 选角墙「招募令」（HUD 2.0，反馈⑧）：桌沿抽屉里升起的一排羊皮招募令。
// LOBBY 可点击应征/改选；开局后变成只读「角色手册」。占用状态用火漆印章表达。
// 可选性判断与服务端 takeRole 同口径（地主阵营互斥 / 农民受 maxFarmers 上限）——
// 只用于置灰提示，最终裁决仍在服务端。
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { bustUrl } from '../scene/bustSnapshot';
import {
  ROLE_LABEL, ROLE_SHEET, factionOf,
  LANDLORD_SIDE_ROLES, FARMER_SIDE_ROLES,
} from '../game/roles';
import { parseRuns } from '../game/richtext';
import { IS_TOUCH } from '../game/inputMode';

// 可选性判断（与服务端 takeRole 同口径，仅置灰提示）：Poster 与触屏详情卡共用。
function selectability(role, state, me, readonly) {
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
  return { mine, blocked, clickable: !readonly && !blocked && !mine && !me?.spectator };
}

// 角色手册正文（浮窗与触屏详情卡共用）：简介段落 + 高级信息表。
function RoleDetailBody({ role, advanced }) {
  const sheet = ROLE_SHEET[role];
  return (
    <>
      <div className="role-detail-head">
        <img className="role-detail-bust" src={bustUrl(role)} alt="" draggable={false} />
        <PixelText size={3} color="var(--px-gold)">{ROLE_LABEL[role]}</PixelText>
      </div>
      <div className="role-intro">
        {sheet.intro.map((p, i) => (
          <p key={i} className="role-intro-p">
            {parseRuns(p).map((r, j) => (
              <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>
            ))}
          </p>
        ))}
      </div>
      {advanced && sheet.advanced?.length > 0 && (
        <div className="role-adv">
          {sheet.advanced.map(([k, v], i) => (
            <div key={i} className="role-adv-row">
              <span className="role-adv-k">{k}</span>
              <span className="role-adv-v">{v}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// 触屏角色详情卡（移动端）：点招募令弹出居中固定卡——属性常开、内置应征按钮；点卡外关闭。
function RoleSheet({ role, state, me, send, readonly, onClose }) {
  useEffect(() => {
    if (!role) return undefined;
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest('.role-detail.sheet')) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [role, onClose]);
  if (!role || !ROLE_SHEET[role]?.intro) return null;
  const { mine, clickable } = selectability(role, state, me, readonly);
  return createPortal(
    <div className="role-detail sheet">
      <RoleDetailBody role={role} advanced />
      {(clickable || mine) && (
        <button
          className="btn primary role-take"
          disabled={mine}
          onClick={() => { send({ type: 'take_role', role }); onClose(); }}
        >{mine ? '已应征' : '应征'}</button>
      )}
    </div>,
    document.body
  );
}

// 跟随鼠标的角色手册浮窗（黑底金字，与四类 HUD 同语言）：鼠标即面板。
// 悬停招募令时飘在光标旁；因贴着光标必须 pointer-events:none（否则挡住 hover），
// 故「高级信息」改为按住 Shift 展开（点击已无法命中浮窗）。
// 经 portal 挂到 body：.drawer 有 transform，会把 position:fixed 锚死在抽屉内。
function RoleTooltip({ role, pos, advOpen }) {
  const sheet = role ? ROLE_SHEET[role] : null;
  if (!role || !sheet?.intro) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const flipX = pos.x > vw * 0.62;
  const flipY = pos.y > vh * 0.55;
  const style = {
    position: 'fixed',
    left: pos.x + (flipX ? -16 : 16),
    top: pos.y + (flipY ? -16 : 16),
    transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
    pointerEvents: 'none',
    zIndex: 200,
  };
  return createPortal(
    <div className="role-detail float" style={style}>
      <RoleDetailBody role={role} advanced={advOpen} />
      {!advOpen && sheet.advanced?.length > 0 && (
        <div className="role-adv-hint">
          <PixelText size={2} color="var(--ink-dim)">按住 Shift 查看高级信息</PixelText>
        </div>
      )}
    </div>,
    document.body
  );
}

function Poster({ role, state, me, send, readonly, onHover, onOpenSheet }) {
  const takers = state.players.filter(p => p.role === role);
  const { mine, blocked, clickable } = selectability(role, state, me, readonly);
  // 触屏：点海报=弹详情卡（应征在卡内按钮），不直接选角；桌面：点=选角，悬停=浮窗详情。
  const onClick = IS_TOUCH
    ? () => onOpenSheet?.(role)
    : (clickable ? () => send({ type: 'take_role', role }) : undefined);
  return (
    <div
      className={`poster ${mine ? 'mine' : ''} ${blocked ? 'blocked' : ''} ${clickable || IS_TOUCH ? 'clickable' : ''}`}
      onClick={onClick}
      onMouseEnter={IS_TOUCH ? undefined : (e) => onHover?.(role, e)}
      onMouseMove={IS_TOUCH ? undefined : (e) => onHover?.(role, e)}
      onMouseLeave={IS_TOUCH ? undefined : () => onHover?.(null)}
    >
      {/* 半身像 = bustSnapshot 预渲染静态素材(饰品正交正视 + 皮肤正面,拼接 dataURL):
          <img> 即插即显无渲染空窗,身体与饰品都与桌边的人同源。 */}
      <div className="poster-relic">
        <img className="poster-bust" src={bustUrl(role)} alt={ROLE_LABEL[role]} draggable={false} />
      </div>
      <div className="poster-name"><PixelText size={3} color="var(--c-wood-900)">{ROLE_LABEL[role]}</PixelText></div>
      {/* 简介移入下方悬停面板 RoleDetail(黑底金字,便于放白色正文+高亮) */}
      {takers.length > 0 && (
        <div className="poster-seals">
          {takers.map(p => (
            <span key={p.id} className={`poster-seal ${p.id === me?.id ? 'mine' : ''}`} title={p.name}>{p.name}</span>
          ))}
        </div>
      )}
      {blocked && takers.length === 0 && (
        <div className="poster-note"><PixelText size={2} color="var(--c-parch-ink)">阵营已满</PixelText></div>
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
  // 跟随鼠标的角色浮窗（桌面）：悬停招募令→浮窗贴光标；离开即隐。高级信息按住 Shift 展开。
  // 触屏（移动端）：点海报→居中详情卡 RoleSheet（属性常开+应征按钮）。
  const [hoverRole, setHoverRole] = useState(null);
  const [sheetRole, setSheetRole] = useState(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [advOpen, setAdvOpen] = useState(false);
  const onHover = (role, e) => {
    setHoverRole(role);
    if (e) setPos({ x: e.clientX, y: e.clientY });
  };
  // Shift 按住 = 展开高级信息（浮窗 pointer-events:none，点击无法命中，故用键位）。
  useEffect(() => {
    const down = (e) => { if (e.key === 'Shift') setAdvOpen(true); };
    const up = (e) => { if (e.key === 'Shift') setAdvOpen(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  // 点击招募令与桌沿抽屉（Dock）以外任意处 = 收起（反馈①）。挂 window 捕获阶段；开墙那一下的
  // pointerdown 早于本 effect 挂载，不会自关。Dock 排除掉，让「角色」页签自己的 toggle 正常开合。
  useEffect(() => {
    const onDown = (e) => {
      // 触屏详情卡(portal 到 body)也算墙内——点它不收抽屉
      if (e.target instanceof Element && (e.target.closest('.role-wall') || e.target.closest('.dock') || e.target.closest('.role-detail.sheet'))) return;
      setPanel(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [setPanel]);
  const competitive = state.mode === 'competitive';
  const farmers = state.players.filter(p => factionOf(p.role) === 'farmer').length;
  const landlords = state.players.filter(p => factionOf(p.role) === 'landlord').length;
  const maxF = state.config?.maxFarmers ?? 4;
  const pass = { state, me, send, readonly, onHover, onOpenSheet: setSheetRole };
  return (
    <div className="drawer role-wall">
      <div className="drawer-title">
        <PixelText size={2} color="var(--c-wood-900)">{readonly ? '角色手册' : '招募令 · 选择你的角色'}</PixelText>
        <div className="drawer-title-right">
          <span className="drawer-hint"><PixelText size={2} color="var(--c-wood-900)">{`地主 ${landlords}/1 · 农民 ${farmers}/${maxF}`}</PixelText></span>
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
      {/* 招募令只负责选角（反馈①）：准备/开局都在圈上浮字（收起本墙后可见），或面板内按空格=收起并自动准备。 */}
      {IS_TOUCH
        ? <RoleSheet role={sheetRole} state={state} me={me} send={send} readonly={readonly} onClose={() => setSheetRole(null)} />
        : <RoleTooltip role={hoverRole} pos={pos} advOpen={advOpen} />}
    </div>
  );
}
