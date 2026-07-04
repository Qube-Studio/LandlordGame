// HUD 叠加层（HUD 2.0 信息三层制）：
//   常驻层 = 顶部场次牌 + 右缘玩家条(单行,悬停展开) + 右下资金簇 + 左下聊天;
//   决策层 = 底部行动区(阶段提示小字 + 当前阶段唯一主面板);
//   抽屉层 = 桌沿抽屉(Dock 把手 + 选角墙 R / 账本 L,收纳于屏幕正下方)。
// 指针默认穿透到 3D 场景，仅交互元素接收事件。
import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import PixelText from '../assets/pixelfont/PixelText';
import CandleMark from '../assets/pixelfont/CandleMark';
import MoneyHand from './MoneyHand';
import NegotiationBoard from './NegotiationBoard';
import PhaseCoachmark from './PhaseCoachmark';
import SettingsPanel from './SettingsPanel';
import Dock from './Dock';
import RoleWall from './RoleWall';
import LedgerBook from './LedgerBook';
import { EVENT_TEXT } from '../game/settleText';
import { ROLE_LABEL, ROLE_GLYPH, factionOf, isFarmerSide, isLandlordSide } from '../game/roles';
import { IS_3D_INPUT } from '../game/inputMode';

const Icon = getArt('icon');

const PHASE_META = {
  LOBBY: { label: '准备大厅', hint: '在招募令墙上选择角色（R 呼出/收起），房主按 Enter 开始' },
  DISCUSSION: { label: '战术讨论', hint: '农民可密谈，所有人按 Enter 准备后进入下注' },
  BETTING: {
    label: '下注中',
    hint: IS_3D_INPUT
      ? '把手里的钱牌拖到自己的圆圈下注（长按拆分，点圈里的牌收回），Enter 确认'
      : '选钱牌组成下注额（长按拆分），Enter 确认',
  },
  REVEAL: { label: '揭牌', hint: '各家下注已公开，Enter 确认后掷硬币' },
  COIN_FLIP: { label: '掷硬币', hint: '正面地主阵营胜，反面农民阵营胜' },
  REFLIP: { label: '重掷决策', hint: '农民输了！暴食者可请求重掷硬币（每局 3 次）' },
  SETTLE: { label: '系统结算', hint: '桌上的钱聚拢成彩池，按规则分成几份送到各家圈里' },
  NEGOTIATE: {
    label: '农民协商',
    hint: IS_3D_INPUT
      ? '拖动圈里的钱牌/红色债务牌到队友圈重新分配（长按拆分），Enter 确认'
      : '农民内部重新分配钱与债务（桌面实时跟着变），Enter 确认',
  },
  FINALIZE: { label: '正式结算', hint: '钱还在桌上——按 F 拿取自己那份才入账（按 L 翻账本）' },
  ENDED: { label: '对局结束', hint: '' },
};

function statusOf(p, state) {
  if (p.bankrupt) return { text: '破产', cls: 'danger' };
  if (p.spectator) return { text: '观战', cls: 'dim' };
  if (!p.online) return { text: '离线', cls: 'dim' };
  switch (state.phase) {
    case 'DISCUSSION': return p.ready ? { text: '已准备', cls: 'ok' } : { text: '讨论中', cls: 'dim' };
    case 'BETTING': return p.hasBet ? { text: '已下注', cls: 'ok' } : { text: '思考中', cls: 'dim' };
    case 'REVEAL': return p.confirmed ? { text: '已确认', cls: 'ok' } : { text: '查看中', cls: 'dim' };
    case 'NEGOTIATE':
      if (!isFarmerSide(p.role)) return { text: '等待', cls: 'dim' };
      return p.negotiateConfirmed ? { text: '已确认', cls: 'ok' } : { text: '协商中', cls: 'dim' };
    case 'REFLIP':
      if (p.role === 'glutton') return p.reflipsLeft > 0 ? { text: '可重掷', cls: 'ok' } : { text: '无次数', cls: 'dim' };
      return { text: '等待', cls: 'dim' };
    case 'FINALIZE': {
      const po = state.payout;
      if (!po) return { text: '', cls: 'dim' };
      if (po.taken?.includes(p.id)) return { text: '已拿取', cls: 'ok' };
      if (po.eligible?.includes(p.id)) return { text: '待拿取', cls: 'dim' };
      return { text: '等待', cls: 'dim' };
    }
    default: return { text: '', cls: 'dim' };
  }
}

// 竞技角色的紧凑技能标签（玩家列）：暴食者剩余重掷/饭账、投资人投保额+生效状态、资本家资金池。
function skillTag(p, state) {
  if (p.role === 'glutton') {
    const meal = p.mealAllowance != null ? ` 饭账¥${p.mealAllowance}` : '';
    return `重${p.reflipsLeft ?? 0}${meal}`;
  }
  if (p.role === 'investor' && p.pledge != null && p.pledge > 0) {
    const eff = state.coinResult ? (state.coinResult === 'heads' ? ' 生效' : ' 未生效') : '';
    return `保¥${p.pledge}${eff}`;
  }
  if (p.role === 'capitalist' && p.pool != null) return `池¥${p.pool}`;
  return null;
}

// ---------- 全局键盘 ----------
function useGameKeys() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const playerId = useGameStore(s => s.playerId);
  const chatOpen = useGameStore(s => s.chatOpen);
  const setChatOpen = useGameStore(s => s.setChatOpen);
  const panel = useGameStore(s => s.panel);
  const setPanel = useGameStore(s => s.setPanel);
  const togglePanel = useGameStore(s => s.togglePanel);

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || chatOpen) return;          // 输入/聊天聚焦时，游戏快捷键让位
      if (e.repeat) return;

      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setChatOpen(true); return; }
      // 桌沿抽屉（HUD 2.0）：R 选角墙 / L 账本 / Esc 收起
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); togglePanel('roles'); return; }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); togglePanel('ledger'); return; }
      if (e.key === 'Escape') { if (panel) { e.preventDefault(); setPanel(null); } return; }
      // 拿取 (F)：FINALIZE 从桌面收取自己的钱堆（§3.8），Enter/Space 同效
      const po = state.payout;
      const canTake = state.phase === 'FINALIZE' && !!po
        && po.eligible?.includes(playerId) && !po.taken?.includes(playerId);
      if ((e.key === 'f' || e.key === 'F') && canTake) { e.preventDefault(); send({ type: 'take_payout' }); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;

      const me = state.me;
      const phase = state.phase;
      if (phase === 'BETTING') return;          // 下注确认由 HandLayer(3D)/MoneyHand(2D) 自己处理
      let acted = false;
      if (phase === 'LOBBY' && me?.isHost) { send({ type: 'start_game' }); acted = true; }
      else if (phase === 'DISCUSSION' && !me?.ready && !me?.spectator) { send({ type: 'ready' }); acted = true; }
      else if (phase === 'REVEAL' && !me?.confirmed && !me?.spectator) { send({ type: 'confirm_reveal' }); acted = true; }
      else if (phase === 'NEGOTIATE' && state.roundFarmerIds?.includes(playerId)) {
        send({ type: 'negotiate_confirm', confirmed: !me?.negotiateConfirmed }); acted = true;
      } else if (phase === 'FINALIZE' && canTake) { send({ type: 'take_payout' }); acted = true; }
      else if (phase === 'ENDED' && me?.isHost) { send({ type: 'restart_game' }); acted = true; }
      if (acted) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, send, playerId, chatOpen, setChatOpen, panel, setPanel, togglePanel]);
}

// ---------- 顶部信息条 ----------
function TopBar() {
  const state = useGameStore(s => s.state);
  const leaveRoom = useGameStore(s => s.leaveRoom);
  const showToast = useGameStore(s => s.showToast);

  const inGame = !['LOBBY', 'ENDED'].includes(state.phase);
  const exit = () => {
    if (inGame && !window.confirm('游戏进行中，退出将视为弃局。确定退出？')) return;
    leaveRoom();
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(state.roomId); showToast('房间号已复制', 'ok'); }
    catch { showToast(`房间号：${state.roomId}`, 'ok'); }
  };
  return (
    <div className="hud-top">
      <div className="hud-top-left">
        <button className="px-chip" onClick={copyId} title="复制房间号">
          <PixelText size={2} color="#fff">{`${state.roomName}  ${state.roomId}`}</PixelText>
        </button>
        <span className="px-chip phase-chip">
          <PixelText size={2} color="var(--px-gold)">
            {state.round > 0
              ? `第${state.round}轮 · ${PHASE_META[state.phase]?.label ?? state.phase}`
              : (PHASE_META[state.phase]?.label ?? state.phase)}
          </PixelText>
        </span>
      </div>
      <div className="hud-top-right">
        <SettingsPanel />
        <button className="btn small danger-btn" onClick={exit}><Icon name="exit" size={15} /> 退出</button>
      </div>
    </div>
  );
}

// ---------- 右侧玩家纵列（HUD 2.0 瘦身，反馈⑨）----------
// 常驻只留一行：阵营色签 + 名字 + 右侧一个信息位（LOBBY 显示所选角色，游戏中显示阶段状态）。
// 悬停该行才滑出详情卡（角色/余额/技能/在线）——3D 名牌已有名字与角色，条只负责速览。
function PlayerRail() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const lobby = state.phase === 'LOBBY';
  return (
    <div className="player-rail">
      {state.players.map(p => {
        const st = statusOf(p, state);
        const mine = p.id === playerId;
        const tag = skillTag(p, state);
        return (
          <div key={p.id} className={`rail-row ${mine ? 'me' : ''} ${p.online ? '' : 'offline'} ${p.bankrupt ? 'gone' : ''}`}>
            <div className="rail-main">
              {/* 左：在线灯(绿=在线/灰=离线) 中：名字 右：单字身份章(加粗汉字,按阵营上色)。状态放展开详情。 */}
              <span className={`rail-online ${p.online ? '' : 'off'}`} title={p.online ? '在线' : '离线'} />
              <span className="rail-name"><PixelText size={2}>{`${p.name}${p.isHost ? ' ♔' : ''}`}</PixelText></span>
              {p.role
                ? <span className={`rail-role-glyph pixel-cjk ${factionOf(p.role) ?? 'none'}`} title={ROLE_LABEL[p.role]}>{ROLE_GLYPH[p.role] ?? '?'}</span>
                : (lobby && <PixelText size={2} color="var(--ink-dim)">未选</PixelText>)}
            </div>
            <div className="rail-detail">
              <div className="rail-line2">
                <PixelText size={2} color="var(--ink-dim)">{ROLE_LABEL[p.role] ?? '未选'}</PixelText>
                <PixelText size={2} color="var(--px-gold)">{p.balance != null ? `¥${p.balance}` : '¥??'}</PixelText>
              </div>
              {tag && <div className="rail-line2"><PixelText size={2} color="var(--ink-dim)">{tag}</PixelText></div>}
              {/* 阶段状态(思考中/讨论中/已下注…)——原在线行删掉,在线已由主行左侧的灯表示 */}
              {st.text && <div className="rail-line2"><PixelText size={2} className={`rail-status ${st.cls}`}>{st.text}</PixelText></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 右下角自己资金 ----------
// 数字变化时逐帧经过路径上的整数（不直接跳到目标）。强调动画分两类：
//   · 增长（≥ 原资金 50% 或 ≥ 5）：随计数「不断提起放下」等幅弹跳，剩 (1-bumpStop) 时间时收尾归零。
//   · 扣钱：分级「被打一拳」冲击——一级(> 30% 或 ≥ 5) / 二级(> 60% 或 ≥ 10，幅度更大)。
//     与减小同时开始；受击瞬间「位移击退 + 缩放爆点 + 受伤红闪」三线索叠加（随机方向、每次不同），
//     再略带弹性地回正（轻微过冲）。三线索是打击感的来源。
// 可手动调的参数集中在下面 TUNE 里。
const BALANCE_GOLD = '#e2c044', BALANCE_DANGER = '#e36262'; // 与主题色一致，用于受伤红闪 lerp
const BALANCE_TUNE = {
  durMin: 600, durMax: 1200,   // 计数时长范围（ms,§1.9 ⑤:小额变化 600ms 内滚完）
  durPerUnit: 40,              // 每变化 1 点资金增加的时长（ms），落在 [durMin,durMax]
  bumpPeriod: 250,             // 单次「提起放下」周期（ms）——越小弹得越密
  bumpMaxAmp: 11,              // 提起高度（px，等幅）
  bumpStop: 0.8,               // 弹跳进行到此进度即停（0.8 = 还剩 20% 时间时停止弹跳）
  punchDur: 380,             // 「一拳」冲击+回正总时长（ms）
  punchAttack: 0.08,         // 冲到最大受击位移所占比例（越小击得越脆）
  punchSpring: 1.1,          // 回正弹性（>1 带一次轻微反向过冲）
  punchDecay: 2.4,           // 回正阻尼（越大回正越快、过冲越小）
  punchAmp1: 18,             // 一级受击位移（px）
  punchAmp2: 30,             // 二级受击位移（px，更大）
  punchScale1: 0.18,         // 一级受击放大量（缩放爆点：1→1+x）
  punchScale2: 0.30,         // 二级受击放大量
  punchFlashMs: 200,         // 受伤红闪时长（ms）
};
// 受伤红闪：金 → 红 线性插值（t∈[0,1]）。
function balanceFlashColor(t) {
  const lerp = (i) => Math.round(
    parseInt(BALANCE_GOLD.slice(i, i + 2), 16) +
    (parseInt(BALANCE_DANGER.slice(i, i + 2), 16) - parseInt(BALANCE_GOLD.slice(i, i + 2), 16)) * t);
  return `rgb(${lerp(1)}, ${lerp(3)}, ${lerp(5)})`;
}
function useBalanceCount(target) {
  const [view, setView] = useState({ display: target ?? 0, tx: 0, ty: 0, scale: 1, flash: 0 });
  const prevRef = useRef(target ?? 0);
  const initedRef = useRef(false);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target == null) return;
    if (!initedRef.current) { initedRef.current = true; prevRef.current = target; setView({ display: target, tx: 0, ty: 0, scale: 1, flash: 0 }); return; }
    const from = prevRef.current, to = target;
    prevRef.current = to;
    if (from === to) return;

    const T = BALANCE_TUNE;
    const delta = to - from;
    // 增长弹跳：> 原资金 50% 或 ≥ 5
    const emphasize = delta > 0 && (delta > Math.abs(from) * 0.5 || delta >= 5);
    // 扣钱冲击分级：一级 >30% 或 ≥5；二级 >60% 或 ≥10（幅度更大）
    const dec = -delta;
    let tier = 0;
    if (dec > 0) {
      if (dec > Math.abs(from) * 0.6 || dec >= 10) tier = 2;
      else if (dec > Math.abs(from) * 0.3 || dec >= 5) tier = 1;
    }
    const punchAmp = tier === 2 ? T.punchAmp2 : tier === 1 ? T.punchAmp1 : 0;
    const punchScale = tier === 2 ? T.punchScale2 : tier === 1 ? T.punchScale1 : 0;
    const ang = Math.random() * Math.PI * 2;      // 任意方向的一拳
    const dirX = Math.cos(ang), dirY = Math.sin(ang);
    // 时长落在 [durMin, durMax]：幅度越大越久
    const duration = Math.min(T.durMax, Math.max(T.durMin, T.durMin + Math.abs(delta) * T.durPerUnit));
    // 提放次数按「弹跳窗口」(t∈[0,bumpStop]) 算整数次，保证收尾时正好落回 0
    const nBumps = Math.max(1, Math.round((duration * T.bumpStop) / T.bumpPeriod));
    const startT = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now) => {
      const elapsed = now - startT;
      const t = Math.min(1, elapsed / duration);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic：先快后慢，经过路径上的整数
      const display = Math.round(from + delta * e);
      // 增长：等幅竖向弹跳，仅在 t < bumpStop 窗口内，末端 sin 正好归零
      const bumpY = (emphasize && t < T.bumpStop)
        ? -T.bumpMaxAmp * Math.abs(Math.sin(Math.PI * (t / T.bumpStop) * nBumps))
        : 0;
      // 扣钱：受击瞬间位移击退 + 缩放爆点 + 红闪，再弹性回正
      let px = 0, py = 0, scale = 1, flash = 0;
      if (punchAmp > 0 && elapsed < T.punchDur) {
        const s = elapsed / T.punchDur;
        let imp;                            // 归一化冲击形状：起手冲到 1，再弹性回到 0（带轻微过冲）
        if (s < T.punchAttack) {
          const a = s / T.punchAttack;
          imp = 1 - (1 - a) * (1 - a);
        } else {
          const r = (s - T.punchAttack) / (1 - T.punchAttack);
          imp = Math.exp(-T.punchDecay * r) * Math.cos(Math.PI * T.punchSpring * r);
        }
        px = dirX * punchAmp * imp;
        py = dirY * punchAmp * imp;
        scale = 1 + punchScale * Math.max(0, imp);          // 缩放只在击出方向放大
        flash = Math.max(0, 1 - elapsed / T.punchFlashMs);  // 红闪快速淡出
      }
      setView({ display, tx: px, ty: bumpY + py, scale, flash });
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setView({ display: to, tx: 0, ty: 0, scale: 1, flash: 0 });
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  return view;
}

function BalanceHud() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const me = state.me;
  const { display, tx, ty, scale, flash } = useBalanceCount(me?.balance ?? null);
  if (!me || me.balance == null) return null;
  const minStake = me.bounds?.minStake ?? 1;
  const low = me.balance <= minStake * 2;
  const moved = tx || ty || (scale && scale !== 1);
  const style = moved
    ? { transform: `translate(${(tx || 0).toFixed(1)}px, ${(ty || 0).toFixed(1)}px) scale(${(scale || 1).toFixed(3)})`, transformOrigin: 'right bottom' }
    : undefined;
  const numColor = flash > 0 ? balanceFlashColor(flash) : (low ? 'var(--danger)' : 'var(--px-gold)');
  // 蜡烛(货币符)按上一回合盈亏染色：亏损→红，盈利/持平/尚无回合→绿(默认盈利绿)。
  // 资本家个人本金恒定(deltas 恒 0),盈亏体现在资金池——改用池净变动(下注盈亏 − 税)判色。
  const last = state.history?.length ? state.history[state.history.length - 1] : null;
  let lastDelta = null;
  if (last) {
    lastDelta = (me.role === 'capitalist' && last.capitalistPoolDelta != null)
      ? last.capitalistPoolDelta - (last.capitalistTax ?? 0)
      : (last.deltas?.[playerId] ?? 0);
  }
  const candleColor = lastDelta != null && lastDelta < 0 ? 'var(--danger)' : 'var(--ok)';
  return (
    <div className={`balance-hud ${low ? 'low' : ''}`}>
      <div className="bh-value" style={style}>
        <PixelText size={8} color={candleColor}>¥</PixelText>
        <PixelText size={9} color={numColor}>{String(display)}</PixelText>
      </div>
    </div>
  );
}

// ---------- 地主资金目标（所有人可见；地主/观战者另见进度） ----------
function GoalHud() {
  const state = useGameStore(s => s.state);
  const g = state.landlordGoal;
  if (!g) return null;
  const behind = g.landlordBalance != null && g.landlordBalance < g.goal;
  // 未达标惩罚 = max(minPenalty, floor(余额 × penaltyRate))；仅在地主余额可见时展示（不泄露隐私）。
  const lg = state.config?.landlordGoal;
  const penalty = (g.landlordBalance != null && lg)
    ? Math.max(lg.minPenalty ?? 0, Math.floor(Math.max(0, g.landlordBalance) * (lg.penaltyRate ?? 0)))
    : null;
  return (
    <div className={`goal-hud hud-card ${behind ? 'behind' : ''}`}>
      <div className="goal-line hud-card-title"><PixelText size={2} color="var(--px-gold)">地主目标</PixelText></div>
      <div className="goal-line gap">
        <PixelText size={3} color={behind ? 'var(--danger)' : 'var(--px-gold)'}>{`¥${g.goal}`}</PixelText>
      </div>
      <div className="goal-line"><PixelText size={2} color="var(--ink-dim)">
        {g.roundsLeft <= 0 ? '本回合结算' : `还剩 ${g.roundsLeft} 回合`}
      </PixelText></div>
      {g.landlordBalance != null && (
        <div className="goal-line"><PixelText size={2} color={behind ? 'var(--danger)' : 'var(--ok)'}>{`当前 ¥${g.landlordBalance}`}</PixelText></div>
      )}
      {penalty != null && (
        <div className="goal-line"><PixelText size={2} color="var(--danger)">{`未达罚 ¥${penalty}`}</PixelText></div>
      )}
    </div>
  );
}

// ---------- 资本家资金池 HUD（本人/观战可见血条；耗尽即破产） ----------
function CapitalistHud() {
  const state = useGameStore(s => s.state);
  const c = state.capitalist;
  if (!c || c.pool == null) return null;
  const taxNext = Math.max(c.taxMin ?? 0, Math.floor(Math.max(0, c.pool) * (c.taxRate ?? 0)));
  const low = c.pool <= taxNext * 2;
  return (
    <div className={`goal-hud hud-card ${low ? 'behind' : ''}`}>
      <div className="goal-line hud-card-title"><PixelText size={2} color="var(--px-gold)">资金池</PixelText></div>
      <div className="goal-line gap"><PixelText size={3} color={low ? 'var(--danger)' : 'var(--px-gold)'}>{`¥${c.pool}`}</PixelText></div>
      <div className="goal-line"><PixelText size={2} color="var(--danger)">{`下回合税 ¥${taxNext}`}</PixelText></div>
      <div className="goal-line"><PixelText size={2} color="var(--ink-dim)">{`耗尽即破产`}</PixelText></div>
    </div>
  );
}

// ---------- 基础农民工资 HUD（本人可见：还剩几回合、每次发多少） ----------
function WageHud() {
  const state = useGameStore(s => s.state);
  const w = state.me?.wage;
  if (!w) return null;
  return (
    <div className="goal-hud hud-card">
      <div className="goal-line hud-card-title"><PixelText size={2} color="var(--px-gold)">工资</PixelText></div>
      <div className="goal-line gap"><PixelText size={3} color="var(--ok)">{`+${w.amount}`}</PixelText></div>
      <div className="goal-line"><PixelText size={2} color="var(--ink-dim)">
        {w.roundsToNext <= 0 ? '本回合发放' : `还剩 ${w.roundsToNext} 回合`}
      </PixelText></div>
    </div>
  );
}

// ---------- 暴食者饭账 HUD（本人可见：累积欠账 + 剩余重掷） ----------
function GluttonHud() {
  const state = useGameStore(s => s.state);
  const me = state.me;
  if (me?.role !== 'glutton' || me?.mealAllowance == null) return null;
  const owes = me.mealAllowance > 0;
  return (
    <div className="goal-hud hud-card">
      <div className="goal-line hud-card-title"><PixelText size={2} color="var(--px-gold)">饭账</PixelText></div>
      <div className="goal-line gap"><PixelText size={3} color={owes ? 'var(--danger)' : 'var(--px-gold)'}>{`¥${me.mealAllowance}`}</PixelText></div>
      <div className="goal-line"><PixelText size={2} color="var(--ink-dim)">胜时扣除</PixelText></div>
      <div className="goal-line"><PixelText size={2} color="var(--ink-dim)">{`重掷剩 ${me.reflipsLeft ?? 0} 次`}</PixelText></div>
    </div>
  );
}

// ---------- 阶段面板 ----------
// LOBBY：选角已搬到招募令墙（RoleWall 抽屉，进大厅自动升起）；面板只留当前身份 + 开始。
function LobbyPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send);
  const togglePanel = useGameStore(s => s.togglePanel);
  const me = state.me;
  return (
    <div className="phase-panel">
      <div className="role-pick">
        <button className="btn" onClick={() => togglePanel('roles')}>
          {me?.role ? `我的角色：${ROLE_LABEL[me.role]}（改选 R）` : '选择角色 (R)'}
        </button>
      </div>
      {me?.isHost
        ? <button className="btn primary wide" onClick={() => send({ type: 'start_game' })}>开始游戏 <span className="keycap">⏎</span></button>
        : <p className="dim">等待房主开始…</p>}
    </div>
  );
}

function DiscussionPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  if (me?.spectator) return <div className="phase-panel"><p className="dim">正在观战。</p></div>;
  return (
    <div className="phase-panel">
      {me?.ready ? <p className="ok">已准备，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'ready' })}>准备完毕 <span className="keycap">⏎</span></button>}
    </div>
  );
}
function BettingPanel() {
  const state = useGameStore(s => s.state); const me = state.me;
  if (me?.spectator || !factionOf(me?.role)) return <div className="phase-panel"><p className="dim">观战中：等待玩家下注…</p></div>;
  if (me.bet != null) return <div className="phase-panel"><p className="ok">已下注，等待其他玩家…</p></div>;
  // 3D 交互模式：下注全在场景里做（HandLayer 手牌拖拽 + 圆圈浮字），底部不出面板
  if (IS_3D_INPUT) return null;
  return <MoneyHand key={`${state.round}-${me.balance}`} />;
}
function RevealPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  const confirmedCount = state.players.filter(p => p.confirmed).length;
  const activeCount = state.players.filter(p => factionOf(p.role) && !p.bankrupt).length;
  return (
    <div className="phase-panel">
      <p className="dim">已确认 {confirmedCount}/{activeCount}</p>
      {me?.spectator ? null : me?.confirmed ? <p className="ok">已确认，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'confirm_reveal' })}>看清了，掷硬币！ <span className="keycap">⏎</span></button>}
    </div>
  );
}
function ReflipPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  const isGlutton = me?.role === 'glutton' && !me?.spectator;
  const canReflip = isGlutton && (me.reflipsLeft ?? 0) > 0 && !me.passedReflip;
  return (
    <div className="phase-panel">
      <p className="danger">正面朝上，农民阵营输了！</p>
      {!isGlutton ? (
        <p className="dim">等待暴食者决定是否重掷…</p>
      ) : me.passedReflip ? (
        <p className="dim">已放弃重掷，等待其他暴食者…</p>
      ) : canReflip ? (
        <div className="role-pick">
          <button className="btn primary" onClick={() => send({ type: 'request_reflip' })}>重掷（剩 {me.reflipsLeft}） <span className="keycap">⟲</span></button>
          <button className="btn" onClick={() => send({ type: 'pass_reflip' })}>不重掷</button>
        </div>
      ) : (
        <p className="dim">重掷次数已用尽</p>
      )}
      <p className="dim">重掷仅消耗 1 次机会，不影响饭账（饭账于农民胜时结清）</p>
    </div>
  );
}
function SettlePanel() {
  const state = useGameStore(s => s.state); const s = state.settlement;
  if (!s) return null;
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? id;
  return (
    <div className="phase-panel settle-panel">
      {s.events.map((e, i) => <p key={i} className="settle-line">{EVENT_TEXT[e.type]?.(e) ?? ''}</p>)}
      <div className="settle-detail">
        <span>地主拿走 <b className="gold">{s.landlordTake}</b></span>
        {Object.entries(s.takes).filter(([, v]) => v > 0).map(([id, v]) => <span key={id}>{nameOf(id)} 分得 <b className="gold">{v}</b></span>)}
        {Object.entries(s.debts).filter(([, v]) => v > 0).map(([id, v]) => <span key={id}>{nameOf(id)} 需补 <b className="danger">{v}</b></span>)}
      </div>
    </div>
  );
}
function NegotiatePanel() {
  const state = useGameStore(s => s.state); const me = state.me;
  if (isLandlordSide(me?.role) && !me?.spectator) return <div className="phase-panel"><p className="dim">农民正在协商分配，请稍候…</p></div>;
  // 3D 交互模式：协商在桌面上做（拖钱牌/债务牌到队友圈，圆圈浮字确认），2D 协商板退场
  if (IS_3D_INPUT) return null;
  return <div className="phase-panel"><NegotiationBoard /></div>;
}
function FinalizePanel() {
  const state = useGameStore(s => s.state); const playerId = useGameStore(s => s.playerId);
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const myDelta = last.deltas?.[playerId] ?? 0;
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? id;
  const landlordName = nameOf(state.landlordGoal?.landlordId);
  const po = state.payout;
  // 等待名单不含自己：自己该做的事（按 F 拿取）由桌面浮字与阶段提示表达
  const waiting = po ? po.eligible.filter(id => !po.taken.includes(id) && id !== playerId) : [];
  return (
    <div className="phase-panel">
      {waiting.length > 0 && (
        <p className="dim">等待 {waiting.map(nameOf).join('、')} 拿取桌上的钱…</p>
      )}
      <p className={`delta-big ${myDelta >= 0 ? 'ok' : 'danger'}`}>本回合 {myDelta >= 0 ? `+${myDelta}` : myDelta}</p>
      <div className="settle-detail">
        {Object.entries(last.deltas ?? {}).map(([id, d]) => <span key={id} className={d >= 0 ? 'ok' : 'danger'}>{nameOf(id)} {d >= 0 ? `+${d}` : d}</span>)}
      </div>
      {last.landlordGoalValue != null && (
        last.landlordPenalty > 0
          ? <p className="danger">地主未达目标 <CandleMark />{last.landlordGoalValue}，扣除惩罚 <CandleMark />{last.landlordPenalty}（平分给农民）！</p>
          : <p className="ok">{landlordName ? `${landlordName} ` : '地主'}达成目标 <CandleMark />{last.landlordGoalValue}</p>
      )}
      {last.debtWaiver > 0 && <p className="ok">投资人担保免除了 <CandleMark />{last.debtWaiver} 债务</p>}
      {last.wagePaid && Object.keys(last.wagePaid).length > 0 && (
        <p className="ok">发工资：{Object.entries(last.wagePaid).map(([id, v]) => `${nameOf(id)} +${v}`).join('、')}</p>
      )}
      {last.allowanceCharged && Object.keys(last.allowanceCharged).length > 0 && (
        <p className="danger">扣伙食费：{Object.entries(last.allowanceCharged).map(([id, v]) => `${nameOf(id)} −${v}`).join('、')}</p>
      )}
      {last.capitalistPool != null && (
        <p className={last.capitalistPoolDelta >= 0 ? 'ok' : 'danger'}>
          资金池 {last.capitalistPoolDelta >= 0 ? `+${last.capitalistPoolDelta}` : last.capitalistPoolDelta}
          ，扣税 <CandleMark />{last.capitalistTax} → <CandleMark />{last.capitalistPool}
        </p>
      )}
      {last.uncovered > 0 && <p className="dim">仍有 <CandleMark />{last.uncovered} 缺口无人能补，地主收不到</p>}
      {last.newlyBankrupt?.length > 0 && <p className="danger">{last.newlyBankrupt.map(nameOf).join('、')} 破产了！</p>}
    </div>
  );
}
function EndedPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const leaveRoom = useGameStore(s => s.leaveRoom);
  const togglePanel = useGameStore(s => s.togglePanel);
  const me = state.me;
  const iWon = state.winnerSide && ((state.winnerSide === 'farmers') === isFarmerSide(me?.role));
  const landlordSide = state.players.find(p => isLandlordSide(p.role));
  const winLabel = state.winnerSide === 'farmers'
    ? '🌾 农民阵营胜利！'
    : `👑 ${ROLE_LABEL[landlordSide?.role] ?? '地主'}胜利！`;
  return (
    <div className="phase-panel ended-panel">
      <h2 className={iWon ? 'gold' : 'dim'}>{winLabel}</h2>
      <div className="settle-detail">
        {state.players.map(p => <span key={p.id}>{p.name}：<CandleMark />{p.balance ?? '?'}{p.bankrupt ? '（破产）' : ''}</span>)}
      </div>
      <div className="role-pick">
        {me?.isHost && <button className="btn primary" onClick={() => send({ type: 'restart_game' })}>再来一局 <span className="keycap">⏎</span></button>}
        <button className="btn" onClick={() => togglePanel('ledger')}>查看账本 <span className="keycap">L</span></button>
        <button className="btn" onClick={leaveRoom}>离开房间</button>
      </div>
      {!me?.isHost && <p className="dim">等待房主开启「再来一局」(重选角色重新开局),或自行离开</p>}
    </div>
  );
}
function CoinFlipPanel() { return <div className="phase-panel"><p className="dim coin-hint">掷硬币中…</p></div>; }
function NullPanel() { return null; }
const PHASE_PANELS = {
  LOBBY: LobbyPanel, DISCUSSION: DiscussionPanel, BETTING: BettingPanel, REVEAL: RevealPanel,
  COIN_FLIP: CoinFlipPanel, REFLIP: ReflipPanel,
  SETTLE: SettlePanel, NEGOTIATE: NegotiatePanel, FINALIZE: FinalizePanel, ENDED: EndedPanel,
};

// （旧「FINALIZE 桌面→手牌 2D 幽灵飞行」已退役：拿取的钱由 3D 编导层 PayoutLayer 飞向资金蜡烛，§3.8）

export default function UiLayer() {
  const state = useGameStore(s => s.state);
  const connected = useGameStore(s => s.connected);
  const panel = useGameStore(s => s.panel);
  const setPanel = useGameStore(s => s.setPanel);
  useGameKeys();
  const meta = PHASE_META[state.phase] ?? { label: state.phase, hint: '' };
  const Panel = PHASE_PANELS[state.phase] ?? NullPanel;

  // 抽屉随阶段自动开合：进大厅升起招募令墙；阶段切换一律收起（别挡住新阶段的行动区）。
  // 首挂只处理 LOBBY（不覆盖画廊/重连注入的面板状态）。
  const phase = state.phase;
  const prevPhase = useRef(null);
  useEffect(() => {
    if (prevPhase.current === phase) return;
    const first = prevPhase.current === null;
    prevPhase.current = phase;
    if (first) { if (phase === 'LOBBY') setPanel('roles'); return; }
    setPanel(phase === 'LOBBY' ? 'roles' : null);
  }, [phase, setPanel]);

  return (
    <div className="hud">
      <TopBar />
      {!connected && <div className="hud-disconnect"><PixelText size={2} color="var(--danger)">连接已断开，正在重连…</PixelText></div>}
      <PhaseCoachmark />
      <PlayerRail />
      {/* 角色/机制 HUD：左上角房间号下纵列（黑底半透明）；右下角只留自己的资金蜡烛 */}
      <div className="hud-left-stack">
        <GoalHud />
        <CapitalistHud />
        <WageHud />
        <GluttonHud />
      </div>
      <div className="corner-stack">
        <BalanceHud />
      </div>
      <div className="hud-bottom" data-hand-anchor>
        {meta.hint && <div className="phase-caption"><PixelText size={2} color="var(--ink-dim)">{meta.hint}</PixelText></div>}
        <Panel />
      </div>
      {panel === 'roles' && <RoleWall />}
      {panel === 'ledger' && <LedgerBook />}
      <Dock />
    </div>
  );
}
