// HUD 叠加层（HUD 2.0 信息三层制 + 阶段三精简）：
//   常驻层 = 左上任务风 HUD(阶段名+机制卡) + 右上设置/退出 + 右缘玩家条(单行,悬停展开) + 右下资金簇 + 左下聊天;
//   决策层 = 底部行动区(当前阶段唯一主面板；3D 模式多数阶段面板退役,交互在桌上);
//   抽屉层 = 桌沿抽屉(Dock 把手 + 选角墙 R / 账本 L,收纳于屏幕正下方)。
//   瞬态 = 回合开始居中「第 N 回合」横幅(⑦)；房间名/号在设置面板(⑥)；破产走聊天系统消息(⑨)。
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
import RulesPanel from './RulesPanel';
import Dock from './Dock';
import RoleWall from './RoleWall';
import LedgerBook from './LedgerBook';
import { EVENT_TEXT } from '../game/settleText';
import { ROLE_LABEL, ROLE_GLYPH, factionOf, isFarmerSide, isLandlordSide } from '../game/roles';
import { IS_3D_INPUT } from '../game/inputMode';

const Icon = getArt('icon');

const PHASE_META = {
  LOBBY: { label: '准备大厅', hint: '在招募令墙上选择角色（R 呼出/收起），准备/开始按空格' },
  DISCUSSION: { label: '战术讨论', hint: '农民可密谈，所有人按空格准备后进入下注' },
  BETTING: {
    label: '下注中',
    hint: IS_3D_INPUT
      ? '点/拖/横扫捋牌下注，捋起的叠拖回怀里可散回（手牌长按拆分，圈内钱堆长按整堆拿起），空格确认'
      : '选钱牌组成下注额（长按拆分），空格确认',
  },
  REVEAL: { label: '揭牌', hint: '各家下注已公开，空格确认后掷硬币' },
  COIN_FLIP: { label: '掷硬币', hint: '正面地主阵营胜，反面农民阵营胜' },
  REFLIP: { label: '重掷决策', hint: '农民输了！暴食者可请求重掷硬币（每局 3 次）' },
  SETTLE: { label: '系统结算', hint: '桌上的钱聚拢成彩池，按规则分成几份送到各家圈里' },
  NEGOTIATE: {
    label: '农民协商',
    hint: IS_3D_INPUT
      ? '拖动圈里的钱牌/红色债务牌到队友圈重新分配（长按拆分），空格确认'
      : '农民内部重新分配钱与债务（桌面实时跟着变），空格确认',
  },
  FINALIZE: { label: '正式结算', hint: '钱还在桌上——按 F 拿取自己那份才入账（按 L 翻账本）' },
  ENDED: { label: '对局结束', hint: '' },
};

function statusOf(p, state) {
  if (p.bankrupt) return { text: '破产', cls: 'danger' };
  if (p.spectator) return { text: '观战', cls: 'dim' };
  if (!p.online) return { text: '离线', cls: 'dim' };
  switch (state.phase) {
    case 'LOBBY': return p.lobbyReady ? { text: '已准备', cls: 'ok' } : { text: '', cls: 'dim' };
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
  const panel = useGameStore(s => s.panel);
  const setPanel = useGameStore(s => s.setPanel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const localSys = useGameStore(s => s.localSys);

  const setSpaceHeld = useGameStore(s => s.setSpaceHeld);
  const spaceDownRef = useRef(false); // 空格物理按住中（真实按键态；store spaceHeld 只是延迟后的视觉按下态）
  const pressTimerRef = useRef(0);

  useEffect(() => {
    const typingNow = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    // 空格动作在 keyup 才判定（验收修④：像鼠标一样——按下只进入按下态，松开才"点击"）。
    // 松开时执行的动作按松开那一刻的 state 判定（与旧按下即触发的语义一致，只是时点后移）。
    const doSpaceAction = () => {
      const me = state.me;
      const phase = state.phase;
      if (phase === 'BETTING') return;          // 下注确认由 HandLayer(3D)/MoneyHand(2D) 自己处理
      const po = state.payout;
      const canTake = phase === 'FINALIZE' && !!po
        && po.eligible?.includes(playerId) && !po.taken?.includes(playerId);
      if (phase === 'LOBBY') {                   // 阶段六：全员（含房主）空格=切换准备；未选角只提示不发
        if (me?.spectator) return;
        if (!me?.role) { localSys('未选择角色', { key: 'norole', refresh: true }); return; } // 反馈⑦：refresh 重置计时、无金框
        if (panel === 'roles') { setPanel(null); send({ type: 'lobby_ready', ready: true }); } // 反馈⑥：面板展开时空格=收起并自动准备
        else send({ type: 'lobby_ready', ready: !me?.lobbyReady });
      }
      else if (phase === 'DISCUSSION' && !me?.ready && !me?.spectator) send({ type: 'ready' });
      else if (phase === 'REVEAL' && !me?.confirmed && !me?.spectator) send({ type: 'confirm_reveal' });
      else if (phase === 'NEGOTIATE' && state.roundFarmerIds?.includes(playerId)) {
        send({ type: 'negotiate_confirm', confirmed: !me?.negotiateConfirmed });
      } else if (phase === 'FINALIZE' && canTake) send({ type: 'take_payout' });
      else if (phase === 'ENDED' && me?.isHost) send({ type: 'restart_game' });
    };
    const onKey = (e) => {
      if (typingNow() || chatOpen) return;      // 输入/聊天聚焦时，游戏快捷键让位
      if (e.repeat) return;

      // 聊天唤起已改 Enter/点击（McChat 自管，T 退役——聊天 2.0 三轮）
      // 桌沿抽屉（HUD 2.0）：R 选角墙 / L 账本 / Esc 收起
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); togglePanel('roles'); return; }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); togglePanel('ledger'); return; }
      // 开局 (S)：阶段六——仅大厅、房主、已准备时生效（空格改为切换准备，S 才开局，防误触）
      if ((e.key === 's' || e.key === 'S') && state.phase === 'LOBBY' && state.me?.isHost && state.me?.lobbyReady) {
        e.preventDefault(); send({ type: 'start_game' }); return;
      }
      if (e.key === 'Escape') { if (panel) { e.preventDefault(); setPanel(null); } return; }
      // 拿取 (F)：FINALIZE 从桌面收取自己的钱堆（§3.8），空格同效
      const po = state.payout;
      const canTake = state.phase === 'FINALIZE' && !!po
        && po.eligible?.includes(playerId) && !po.taken?.includes(playerId);
      if ((e.key === 'f' || e.key === 'F') && canTake) { e.preventDefault(); send({ type: 'take_payout' }); return; }
      if (e.key !== ' ') return;                // 确认类动作统一空格（反馈⑩：回车退役）
      e.preventDefault();
      if (state.phase === 'BETTING') return;    // BETTING 完全交给 HandLayer（按下态+确认），这里绝不碰
      spaceDownRef.current = true;
      // 快速点按不闪按下动画：按住 ≥100ms 才进入视觉按下态（动作照常在松开时触发）
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = setTimeout(() => { if (spaceDownRef.current) setSpaceHeld(true); }, 100);
    };
    const onKeyUp = (e) => {
      if (e.key !== ' ') return;
      if (state.phase === 'BETTING') return;    // 同上：不消费 HandLayer 的按键态（曾吞掉确认下注）
      if (!spaceDownRef.current) return;        // 未经过按下（如聊天中按的）不触发
      spaceDownRef.current = false;
      clearTimeout(pressTimerRef.current);
      setSpaceHeld(false);
      if (typingNow() || chatOpen) return;
      e.preventDefault();
      doSpaceAction();
    };
    const onBlur = () => {                      // 窗口失焦时松开按下态，防卡死
      spaceDownRef.current = false;
      clearTimeout(pressTimerRef.current);
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [state, send, playerId, chatOpen, panel, setPanel, togglePanel, setSpaceHeld, localSys]);
}

// ---------- 等待类本地系统提示（阶段五④：被退役木板的替身，仅 3D 模式） ----------
// 同一个 key='wait'：同时至多一条（协商等待天然顶掉上一回合的已下注提示）；
// localSys 自带去重（同 key 同文案且为最新 → 不重发），effect 依赖全为原语不随广播重跑。
function useWaitHints() {
  const phase = useGameStore(s => s.state.phase);
  const bet = useGameStore(s => s.state.me?.bet);
  const role = useGameStore(s => s.state.me?.role);
  const spectator = useGameStore(s => !!s.state.me?.spectator);
  const flying = useGameStore(s => !!(s.betFlight && s.betFlight.round === s.state.round));
  const localSys = useGameStore(s => s.localSys);
  useEffect(() => {
    if (!IS_3D_INPUT || spectator) return;
    if (phase === 'BETTING' && bet != null && !flying) {
      localSys('已下注，等待其他玩家...', { key: 'wait' });   // 飞牌落定才提示（与圈上浮字同步）
    } else if (phase === 'NEGOTIATE' && isLandlordSide(role)) {
      localSys('等待对方协商...', { key: 'wait' });
    }
  }, [phase, bet, role, spectator, flying, localSys]);
}

// ---------- 顶部信息条（HUD 精简⑥⑦：左侧房间牌/阶段牌退役——房间信息进设置面板，
// 阶段名并入左上任务风 HUD 首行，回合号改由回合开始的居中横幅播报）----------
// 3D 输入模式（PC）：按钮无底化——半透明像素符号 i（规则）/齿轮（设置）/门（退出）；
// 2D 模式（?input=2d，备移动端）保留旧样式按钮不动。
// 像素退出符号（门框 + 外指箭头；风格与齿轮/i 一致，assets/svg 的平滑线条版不动）
function PxExit({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="1" y="1" width="7" height="1" />
      <rect x="1" y="12" width="7" height="1" />
      <rect x="1" y="1" width="1" height="12" />
      <rect x="7" y="2" width="1" height="3" />
      <rect x="7" y="9" width="1" height="3" />
      <rect x="4" y="6" width="6" height="2" />
      <rect x="10" y="4" width="1" height="6" />
      <rect x="11" y="5" width="1" height="4" />
      <rect x="12" y="6" width="1" height="2" />
    </svg>
  );
}
function TopBar() {
  const state = useGameStore(s => s.state);
  const leaveRoom = useGameStore(s => s.leaveRoom);

  const inGame = !['LOBBY', 'ENDED'].includes(state.phase);
  const exit = () => {
    if (inGame && !window.confirm('游戏进行中，退出将视为弃局。确定退出？')) return;
    leaveRoom();
  };
  return (
    <div className="hud-top">
      <div className="hud-top-right">
        {IS_3D_INPUT && <RulesPanel />}
        <SettingsPanel bare={IS_3D_INPUT} />
        {IS_3D_INPUT
          ? <button className="hud-icon-btn danger" onClick={exit} title="退出" aria-label="退出"><PxExit size={16} /></button>
          : <button className="btn small danger-btn" onClick={exit}><Icon name="exit" size={15} /> 退出</button>}
      </div>
    </div>
  );
}

// ---------- 回合横幅（HUD 精简⑦）：每回合开始屏幕中上方浮现「第 N 回合」，约 2s 后淡出 ----------
// 只在回合号真的发生变化时播（prev 从 null 起步：冷挂载/重连/画廊注入不播）。
function RoundBanner() {
  const round = useGameStore(s => s.state.round);
  const [show, setShow] = useState(0);
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = round;
    if (prev === null || !round || round === prev) return undefined;
    setShow(round);
    const t = setTimeout(() => setShow(0), 2400);
    return () => clearTimeout(t);
  }, [round]);
  if (!show) return null;
  return (
    <div className="round-banner" key={show}>
      <PixelText size={5} color="var(--px-gold)">{`第 ${show} 回合`}</PixelText>
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

// ---------- 任务风 HUD 图形件（精简二轮：图形承担语义，文字压到每卡一行） ----------
// 值变化 → 递增 key（首帧/重连注入不算变化），key 变化令元素重挂载重播 .quest-bump 强调动画。
function useBumpKey(value) {
  const [key, setKey] = useState(0);
  const prev = useRef(value);
  const inited = useRef(false);
  useEffect(() => {
    if (!inited.current) { inited.current = true; prev.current = value; return; }
    if (value !== prev.current) { prev.current = value; setKey(k => k + 1); }
  }, [value]);
  return key;
}
const clamp01 = (r) => Math.max(0, Math.min(1, r || 0));
const pct = (r) => `${Math.round(clamp01(r) * 100)}%`;

// 无缝细进度条。ratio=null 表示进度不可知（农民看地主目标）：满宽暗斜纹。
// cost = 填充段右端的红色开销区（占填充段的比例，如 罚款/当前余额）。
function QuestTrack({ ratio, cost = 0 }) {
  return (
    <span className="quest-track">
      {ratio == null
        ? <span className="quest-fill unknown" />
        : (
          <span className="quest-fill" style={{ width: pct(ratio) }}>
            <span className="quest-cost" style={{ width: pct(cost) }} />
          </span>
        )}
    </span>
  );
}
// 薄有缝计数条：total 等宽格、亮 filled 格。独立用（重掷）或作 .quest-ring 外包环。
function QuestSegs({ total, filled, className = '' }) {
  const T = Math.max(1, Math.min(12, Math.floor(total || 0) || 1));
  const F = Math.max(0, Math.min(T, Math.floor(filled || 0)));
  return (
    <span className={`quest-segs ${className}`}>
      {Array.from({ length: T }, (_, i) => <span key={i} className={`quest-seg ${i < F ? 'on' : ''}`} />)}
    </span>
  );
}
// 始终填满、两端渐隐的占比条：左区=可挪用比例（绿）、右区=开销占比（红），宽度带阻尼过渡。
function QuestFullBar({ left = 0, right = 0 }) {
  const r = clamp01(right);
  const l = Math.min(clamp01(left), 1 - r);
  return (
    <span className="quest-pool">
      <span className="qp-left" style={{ width: pct(l) }} />
      <span className="qp-right" style={{ width: pct(r) }} />
    </span>
  );
}
// 单行紧凑文案：[label, value, color?] 对——标签暗、数值按语义着色；bump 时整行金闪。
// value 传空串 = 纯标签项（如「不可重掷」）。
function QuestLine({ pairs, bump = 0 }) {
  return (
    <div key={bump} className={`quest-line ${bump ? 'quest-bump' : ''}`}>
      {pairs.map(([label, value, color], i) => (
        <span key={i} className="quest-pair">
          <PixelText size={2} color="var(--ink-dim)">{label}</PixelText>
          {String(value) !== '' && <PixelText size={2} color={color ?? 'var(--px-gold)'}>{String(value)}</PixelText>}
        </span>
      ))}
    </div>
  );
}

// ---------- 地主资金目标 ----------
// 内=无缝细条（当前余额→目标的填充；农民看不到余额=暗斜纹"不可知"）；
// 外包薄有缝环=还剩回合数；结算回合外环耗尽→改为轮廓闪光（达标绿/未达红/不可知金）。
function GoalHud() {
  const state = useGameStore(s => s.state);
  const g = state.landlordGoal;
  const bump = useBumpKey(g?.landlordBalance);
  if (!g) return null;
  const cur = g.landlordBalance;                      // 农民视角 null（不泄露）
  const met = cur != null && cur >= g.goal;
  const lg = state.config?.landlordGoal;
  const penalty = (cur != null && lg)
    ? Math.max(lg.minPenalty ?? 0, Math.round(Math.max(0, cur) * (lg.penaltyRate ?? 0)))
    : null;
  const due = g.roundsLeft <= 0;
  const glow = due ? `due ${cur == null ? '' : met ? 'met' : 'miss'}` : '';
  // 地主本人看「目标」，其他人（农民/观战）看「地主目标」
  const label = state.me?.id === g.landlordId ? '目标：' : '地主目标：';
  const pairs = [[label, cur != null ? `${cur}/${g.goal}` : String(g.goal), met ? 'var(--ok)' : 'var(--px-gold)']];
  if (penalty != null) pairs.push(['罚款：', penalty, 'var(--danger)']);
  return (
    <div className="goal-hud hud-card quest-card">
      <QuestLine bump={bump} pairs={pairs} />
      <div className={`quest-wrap ${glow}`}>
        {!due && <QuestSegs total={g.interval ?? 1} filled={g.roundsLeft} className="quest-ring" />}
        <QuestTrack
          ratio={cur != null ? (g.goal > 0 ? cur / g.goal : 1) : null}
          cost={cur != null && cur > 0 && penalty != null ? penalty / cur : 0}
        />
      </div>
    </div>
  );
}

// ---------- 资本家资金池 HUD（本人/观战可见） ----------
// 始终填满的渐隐条：左区（绿）=个人资金/池=可挪用比例，右区（红）=下回合税/池=税负比例；
// 区宽随池涨跌阻尼变化。税额服务端直发（§8.6 恒定税），客户端只渲染。
function CapitalistHud() {
  const state = useGameStore(s => s.state);
  const c = state.capitalist;
  const bump = useBumpKey(c?.pool);
  if (!c || c.pool == null) return null;
  const pool = Math.max(0, c.pool);
  const tax = c.taxNext ?? 0;
  // 左区分子固定用开局个人资金（下注中 balance 暂时下探，占比不该跟着抖）
  const personal = c.personalInitial ?? c.personal ?? 0;
  return (
    <div className="goal-hud hud-card quest-card">
      <QuestLine bump={bump} pairs={[['担保资金：', pool], ['回合税务：', tax, 'var(--danger)']]} />
      <QuestFullBar
        left={pool > 0 ? personal / pool : 0}
        right={pool > 0 ? tax / pool : (tax > 0 ? 1 : 0)}
      />
    </div>
  );
}

// ---------- 基础农民工资 HUD（本人可见） ----------
// 单条：距发薪的进度填充（外环与内条重复表达同一信息，环已删）；发放回合绿光闪。
function WageHud() {
  const state = useGameStore(s => s.state);
  const w = state.me?.wage;
  const bump = useBumpKey(w?.amount);
  if (!w) return null;
  const due = w.roundsToNext <= 0;
  return (
    <div className="goal-hud hud-card quest-card">
      <QuestLine bump={bump} pairs={[['工资：', `+${w.amount}`, 'var(--ok)']]} />
      <div className={`quest-wrap noring ${due ? 'due met' : ''}`}>
        <QuestTrack ratio={w.interval > 0 ? 1 - w.roundsToNext / w.interval : 1} />
      </div>
    </div>
  );
}

// ---------- 暴食者饭账 HUD（本人可见） ----------
// 满填渐隐条：右区（红）=待结算饭账/总资金（吃掉身家的比例）；
// 下方紧贴浅黄重掷条（同款两端渐隐）：初始填满，每用一次扣掉一段。
function GluttonHud() {
  const state = useGameStore(s => s.state);
  const me = state.me;
  const bump = useBumpKey(me?.mealAllowance);
  if (me?.role !== 'glutton' || me?.mealAllowance == null) return null;
  const meal = me.mealAllowance;
  const bal = Math.max(0, me.balance ?? 0);
  const maxReflips = state.config?.competitive?.glutton?.maxReflips ?? 3;
  const left = Math.max(0, me.reflipsLeft ?? 0);
  const pairs = [['伙食费：', meal, meal > 0 ? 'var(--danger)' : 'var(--px-gold)']];
  pairs.push(left > 0 ? ['可重掷：', left] : ['不可重掷', '']);
  return (
    <div className="goal-hud hud-card quest-card">
      <QuestLine bump={bump} pairs={pairs} />
      <QuestFullBar right={bal > 0 ? meal / bal : (meal > 0 ? 1 : 0)} />
      <span className="quest-reflip">
        <span className="qr-fill" style={{ width: pct(maxReflips > 0 ? left / maxReflips : 0) }} />
      </span>
    </div>
  );
}

// ---------- 阶段面板 ----------
// LOBBY：选角已搬到招募令墙（RoleWall 抽屉，进大厅自动升起）。
// 3D 输入模式（PC）底部木板面板退役（反馈⑪）——选角/准备/开始都在自己圈上的浮字（FeltPrompts）；
// 2D 模式（?input=2d，备移动端）保留面板。
function LobbyPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send);
  const togglePanel = useGameStore(s => s.togglePanel);
  const localSys = useGameStore(s => s.localSys);
  const me = state.me;
  if (IS_3D_INPUT) return null;
  const ready = !!me?.lobbyReady;
  const onReady = () => {
    if (!me?.role) { localSys('未选择角色', { key: 'norole', refresh: true }); return; }
    send({ type: 'lobby_ready', ready: !ready });
  };
  return (
    <div className="phase-panel">
      <div className="role-pick">
        <button className="btn" onClick={() => togglePanel('roles')}>
          {me?.role ? `我的角色：${ROLE_LABEL[me.role]}（改选 R）` : '选择角色 (R)'}
        </button>
      </div>
      {/* 阶段六：全员（含房主）先准备；房主已准备后才出现「开始游戏 S」 */}
      <button className={`btn wide ${ready ? '' : 'primary'}`} onClick={onReady}>
        {ready ? '取消准备' : '准备'} <span className="keycap">空格</span>
      </button>
      {me?.isHost && ready && <button className="btn primary wide" onClick={() => send({ type: 'start_game' })}>开始游戏 <span className="keycap">S</span></button>}
    </div>
  );
}

// DISCUSSION：3D 模式准备提示在圈上（FeltPrompts，反馈⑫），面板退役
function DiscussionPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  if (IS_3D_INPUT) return null;
  if (me?.spectator) return <div className="phase-panel"><p className="dim">正在观战。</p></div>;
  return (
    <div className="phase-panel">
      {me?.ready ? <p className="ok">已准备，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'ready' })}>准备完毕 <span className="keycap">空格</span></button>}
    </div>
  );
}
function BettingPanel() {
  const state = useGameStore(s => s.state); const me = state.me;
  // 3D 模式底部无面板（阶段五①）：下注在场景里做，已下注等待改走聊天系统提示（useWaitHints）
  if (IS_3D_INPUT) return null;
  if (me?.spectator || !factionOf(me?.role)) return <div className="phase-panel"><p className="dim">观战中：等待玩家下注…</p></div>;
  if (me.bet != null) return <div className="phase-panel"><p className="ok">已下注，等待其他玩家…</p></div>;
  return <MoneyHand key={`${state.round}-${me.balance}`} />;
}
// REVEAL：3D 模式确认提示在圈上（FeltPrompts），面板退役
function RevealPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  if (IS_3D_INPUT) return null;
  const confirmedCount = state.players.filter(p => p.confirmed).length;
  const activeCount = state.players.filter(p => factionOf(p.role) && !p.bankrupt).length;
  return (
    <div className="phase-panel">
      <p className="dim">已确认 {confirmedCount}/{activeCount}</p>
      {me?.spectator ? null : me?.confirmed ? <p className="ok">已确认，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'confirm_reveal' })}>看清了，掷硬币！ <span className="keycap">空格</span></button>}
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
// SETTLE/FINALIZE：3D 模式底部面板退役（HUD 精简⑧）——分账过程即桌面演出，明细进账本 L；
// 2D 模式（?input=2d，备移动端）保留文字版。
function SettlePanel() {
  const state = useGameStore(s => s.state); const s = state.settlement;
  if (IS_3D_INPUT) return null;
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
  // 3D 模式底部无面板（阶段五①）：协商在桌面上做；地主侧的等待改走聊天系统提示（useWaitHints）
  if (IS_3D_INPUT) return null;
  if (isLandlordSide(me?.role) && !me?.spectator) return <div className="phase-panel"><p className="dim">农民正在协商分配，请稍候…</p></div>;
  return <div className="phase-panel"><NegotiationBoard /></div>;
}
function FinalizePanel() {
  const state = useGameStore(s => s.state); const playerId = useGameStore(s => s.playerId);
  const last = state.history[state.history.length - 1];
  if (IS_3D_INPUT) return null;
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
  if (IS_3D_INPUT) return null; // 3D：终局交给 GameScreen#VictoryOverlay 演出（§阶段七），账本走 L，离开走顶栏，自动回大厅
  return <EndedPanel2D />;
}
function EndedPanel2D() {
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
        {me?.isHost && <button className="btn primary" onClick={() => send({ type: 'restart_game' })}>再来一局 <span className="keycap">空格</span></button>}
        <button className="btn" onClick={() => togglePanel('ledger')}>查看账本 <span className="keycap">L</span></button>
        <button className="btn" onClick={leaveRoom}>离开房间</button>
      </div>
      {!me?.isHost && <p className="dim">等待房主开启「再来一局」(重选角色重新开局),或自行离开</p>}
    </div>
  );
}
// 掷硬币木板 3D 退役（阶段五①）：硬币本身就是画面主角，无需底部文字
function CoinFlipPanel() { return IS_3D_INPUT ? null : <div className="phase-panel"><p className="dim coin-hint">掷硬币中…</p></div>; }
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
  useWaitHints();
  const Panel = PHASE_PANELS[state.phase] ?? NullPanel;

  // 抽屉随阶段收起：阶段切换一律收起面板（别挡住新阶段行动区）；**进大厅/首挂不再自动升起招募令**
  // （反馈③：进房间不默认打开选角面板）。首挂不覆盖画廊/重连注入的面板状态。
  const phase = state.phase;
  const prevPhase = useRef(null);
  useEffect(() => {
    if (prevPhase.current === phase) return;
    const first = prevPhase.current === null;
    prevPhase.current = phase;
    if (!first) setPanel(null);
  }, [phase, setPanel]);

  // 开局演出让位（反馈⑤ + 二轮③）：左上任务 HUD + 右下资金蜡烛，大厅隐藏；**仅开局那一刻（第 1 轮讨论）**
  // 延迟 3s 缓慢划入，避让开局瞬间「圈/左上/右下」同时变的抢视野；**若 3s 内全员已准备进了下注阶段，则中断
  // 计时、此刻直接显示**（不再枯等）。纯 CSS 派生（round===1&&DISCUSSION→延迟划入类；此后一律直显类），无 state。
  // 用 round===1 而非笼统 DISCUSSION：否则每轮讨论都会把 HUD 藏 3s 再划入。
  const hudDelaying = phase === 'DISCUSSION' && state.round === 1;
  const hudCls = (side) => (phase === 'LOBBY' ? 'hud-veiled' : hudDelaying ? `hud-reveal-${side}` : 'hud-shown');

  return (
    <div className="hud">
      <TopBar />
      {!connected && <div className="hud-disconnect"><PixelText size={2} color="var(--danger)">连接已断开，正在重连…</PixelText></div>}
      <PhaseCoachmark />
      <RoundBanner />
      <PlayerRail />
      {/* 机制 HUD（HUD 精简⑮）：左上角 3A 任务追踪风纵列——首行阶段名，下接各机制卡；
          去底板、细金线分隔、文字投影（样式见 pixel.css 末尾 quest 段）；右下角只留自己的资金蜡烛 */}
      <div className={`hud-left-stack quest ${hudCls('l')}`}>
        <div className="quest-phase">
          {/* key=phase：换阶段重挂载，重播淡入 */}
          <PixelText key={state.phase} size={3} color="var(--px-gold)" className="quest-fade">
            {PHASE_META[state.phase]?.label ?? state.phase}
          </PixelText>
        </div>
        <GoalHud />
        <CapitalistHud />
        <WageHud />
        <GluttonHud />
      </div>
      <div className={`corner-stack ${hudCls('r')}`}>
        <BalanceHud />
      </div>
      <div className="hud-bottom" data-hand-anchor>
        {/* 底部阶段提示横幅（phase-caption）暂时屏蔽（HUD 精简⑭）——文案保留在 PHASE_META.hint 备用 */}
        <Panel />
      </div>
      {panel === 'roles' && <RoleWall />}
      {panel === 'ledger' && <LedgerBook />}
      <Dock />
    </div>
  );
}
