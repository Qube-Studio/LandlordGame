// HUD 叠加层（像素风）：顶部信息条 + 右侧玩家纵列 + 右下角自己资金大字 + 阶段动作面板 +
// 全局键盘操作。指针默认穿透到 3D 场景，仅交互元素接收事件。
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import PixelText from '../assets/pixelfont/PixelText';
import MoneyHand from './MoneyHand';
import NegotiationBoard from './NegotiationBoard';
import { decompose } from '../game/notes';
import { projectPoint } from '../scene/projection';

const Icon = getArt('icon');

const PHASE_META = {
  LOBBY: { label: '准备大厅', hint: '选择角色，等待房主开始（房主按 Enter 开始）' },
  DISCUSSION: { label: '战术讨论', hint: '农民可密谈，所有人按 Enter 准备后进入下注' },
  BETTING: { label: '下注中', hint: '选钱牌组成下注额（长按拆分），Enter 确认' },
  REVEAL: { label: '揭牌', hint: '各家下注已公开，Enter 确认后掷硬币' },
  COIN_FLIP: { label: '掷硬币', hint: '正面地主胜，反面农民胜' },
  SETTLE: { label: '系统结算', hint: '系统按规则给出默认分配方案' },
  NEGOTIATE: { label: '农民协商', hint: '农民内部重新分配钱与债务，Enter 确认' },
  FINALIZE: { label: '正式结算', hint: '钱已入账，即将进入下一回合' },
  ENDED: { label: '对局结束', hint: '' },
};
const ROLE_LABEL = { landlord: '地主', farmer: '农民', bank: '银行', none: '未选' };

function statusOf(p, state) {
  if (p.bankrupt) return { text: '破产', cls: 'danger' };
  if (!p.online) return { text: '离线', cls: 'dim' };
  switch (state.phase) {
    case 'DISCUSSION': return p.ready ? { text: '已准备', cls: 'ok' } : { text: '讨论中', cls: 'dim' };
    case 'BETTING': return p.hasBet ? { text: '已下注', cls: 'ok' } : { text: '思考中', cls: 'dim' };
    case 'REVEAL': return p.confirmed ? { text: '已确认', cls: 'ok' } : { text: '查看中', cls: 'dim' };
    case 'NEGOTIATE':
      if (p.role !== 'farmer') return { text: '等待', cls: 'dim' };
      return p.negotiateConfirmed ? { text: '已确认', cls: 'ok' } : { text: '协商中', cls: 'dim' };
    default: return { text: '', cls: 'dim' };
  }
}

// ---------- 全局键盘 ----------
function useGameKeys() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const playerId = useGameStore(s => s.playerId);
  const chatOpen = useGameStore(s => s.chatOpen);
  const setChatOpen = useGameStore(s => s.setChatOpen);

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || chatOpen) return;          // 输入/聊天聚焦时，游戏快捷键让位
      if (e.repeat) return;

      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setChatOpen(true); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;

      const me = state.me;
      const phase = state.phase;
      if (phase === 'BETTING') return;          // 下注确认由 MoneyHand 自己处理
      let acted = false;
      if (phase === 'LOBBY' && me?.isHost) { send({ type: 'start_game' }); acted = true; }
      else if (phase === 'DISCUSSION' && !me?.ready && !me?.spectator) { send({ type: 'ready' }); acted = true; }
      else if (phase === 'REVEAL' && !me?.confirmed && !me?.spectator) { send({ type: 'confirm_reveal' }); acted = true; }
      else if (phase === 'NEGOTIATE' && state.roundFarmerIds?.includes(playerId)) {
        send({ type: 'negotiate_confirm', confirmed: !me?.negotiateConfirmed }); acted = true;
      } else if (phase === 'ENDED' && me?.isHost) { send({ type: 'restart_game' }); acted = true; }
      if (acted) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, send, playerId, chatOpen, setChatOpen]);
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
          <PixelText size={2}>{`${state.roomName}  ${state.roomId}`}</PixelText>
        </button>
        {state.round > 0 && <span className="px-chip"><PixelText size={2}>{`R${state.round}`}</PixelText></span>}
        <span className="px-chip"><PixelText size={2} color="var(--px-gold)">{PHASE_META[state.phase]?.label ?? state.phase}</PixelText></span>
      </div>
      <button className="btn small danger-btn" onClick={exit}><Icon name="exit" size={15} /> 退出</button>
    </div>
  );
}

// ---------- 右侧玩家纵列 ----------
function PlayerRail() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  return (
    <div className="player-rail">
      {state.players.map(p => {
        const st = statusOf(p, state);
        const mine = p.id === playerId;
        return (
          <div key={p.id} className={`rail-row ${mine ? 'me' : ''} ${p.online ? '' : 'offline'}`}>
            <div className="rail-line1">
              <span className={`rail-dot ${p.role ?? 'none'}`} />
              <PixelText size={2}>{`${p.name}${p.isHost ? ' ♔' : ''}`}</PixelText>
            </div>
            <div className="rail-line2">
              <PixelText size={2} color="var(--ink-dim)">{ROLE_LABEL[p.role] ?? '未选'}</PixelText>
              <PixelText size={2} color="var(--px-gold)">{p.balance != null ? `¥${p.balance}` : '¥??'}</PixelText>
            </div>
            <div className="rail-line2">
              <span className="rail-line1"><span className={`rail-online ${p.online ? '' : 'off'}`} /><PixelText size={2} color="var(--ink-dim)">{p.online ? '在线' : '离线'}</PixelText></span>
              {st.text && <PixelText size={2} className={`rail-status ${st.cls}`}>{st.text}</PixelText>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 右下角自己资金 ----------
function BalanceHud() {
  const state = useGameStore(s => s.state);
  const me = state.me;
  if (!me || me.balance == null) return null;
  const minStake = me.bounds?.minStake ?? 1;
  const low = me.balance <= minStake * 2;
  return (
    <div className={`balance-hud ${low ? 'low' : ''}`}>
      <div className="bh-value">
        <PixelText size={4} color="var(--px-gold)">¥</PixelText>
        <PixelText size={9} color={low ? 'var(--danger)' : 'var(--px-gold)'}>{String(me.balance)}</PixelText>
      </div>
    </div>
  );
}

// ---------- 阶段面板 ----------
function LobbyPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  return (
    <div className="phase-panel">
      <div className="role-pick">
        <button className={`btn ${me?.role === 'landlord' ? 'primary' : ''}`} onClick={() => send({ type: 'take_role', role: 'landlord' })}>当地主</button>
        <button className={`btn ${me?.role === 'farmer' ? 'primary' : ''}`} onClick={() => send({ type: 'take_role', role: 'farmer' })}>当农民</button>
      </div>
      {me?.isHost
        ? <button className="btn primary wide" onClick={() => send({ type: 'start_game' })}>开始游戏 <span className="keycap">⏎</span></button>
        : <p className="dim">等待房主开始…</p>}
    </div>
  );
}
function DiscussionPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  if (me?.spectator) return <div className="phase-panel"><p className="dim">你已破产，正在观战。</p></div>;
  return (
    <div className="phase-panel">
      {me?.ready ? <p className="ok">已准备，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'ready' })}>准备完毕 <span className="keycap">⏎</span></button>}
    </div>
  );
}
function BettingPanel() {
  const state = useGameStore(s => s.state); const me = state.me;
  if (me?.spectator || !['landlord', 'farmer'].includes(me?.role)) return <div className="phase-panel"><p className="dim">观战中：等待玩家下注…</p></div>;
  if (me.bet != null) return <div className="phase-panel"><p className="ok">已下注，等待其他玩家…</p></div>;
  return <MoneyHand key={`${state.round}-${me.balance}`} />;
}
function RevealPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const me = state.me;
  const confirmedCount = state.players.filter(p => p.confirmed).length;
  const activeCount = state.players.filter(p => ['landlord', 'farmer'].includes(p.role) && !p.bankrupt).length;
  return (
    <div className="phase-panel">
      <p className="dim">已确认 {confirmedCount}/{activeCount}</p>
      {me?.spectator ? null : me?.confirmed ? <p className="ok">已确认，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'confirm_reveal' })}>看清了，掷硬币！ <span className="keycap">⏎</span></button>}
    </div>
  );
}
const EVENT_TEXT = {
  landlord_win: e => `正面朝上，地主胜！拿走目标 ${e.target}${e.surplus > 0 ? `，盈余 ${e.surplus}（地主再取 ${e.landlordExtra}，农民分 ${e.farmerPool}）` : ''}`,
  landlord_win_shortfall: e => `正面朝上，地主胜！桌面不足目标 ${e.target}，缺口 ${e.shortfall} 由农民补足${e.uncovered > 0 ? `（仍有 ${e.uncovered} 无人能付）` : ''}`,
  farmers_win: e => `反面朝上，农民胜！平分桌面全部 ${e.pot}`,
};
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
  if (me?.role === 'landlord' && !me?.spectator) return <div className="phase-panel"><p className="dim">农民正在协商分配，请稍候…</p></div>;
  return <div className="phase-panel"><NegotiationBoard /></div>;
}
function FinalizePanel() {
  const state = useGameStore(s => s.state); const playerId = useGameStore(s => s.playerId);
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const myDelta = last.deltas?.[playerId] ?? 0;
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? id;
  return (
    <div className="phase-panel">
      <p className={`delta-big ${myDelta >= 0 ? 'ok' : 'danger'}`}>本回合 {myDelta >= 0 ? `+${myDelta}` : myDelta}</p>
      <div className="settle-detail">
        {Object.entries(last.deltas ?? {}).map(([id, d]) => <span key={id} className={d >= 0 ? 'ok' : 'danger'}>{nameOf(id)} {d >= 0 ? `+${d}` : d}</span>)}
      </div>
      {last.newlyBankrupt?.length > 0 && <p className="danger">{last.newlyBankrupt.map(nameOf).join('、')} 破产了！</p>}
    </div>
  );
}
function EndedPanel() {
  const state = useGameStore(s => s.state); const send = useGameStore(s => s.send); const leaveRoom = useGameStore(s => s.leaveRoom);
  const me = state.me;
  const iWon = state.winnerSide && ((state.winnerSide === 'farmers') === (me?.role === 'farmer'));
  return (
    <div className="phase-panel ended-panel">
      <h2 className={iWon ? 'gold' : 'dim'}>{state.winnerSide === 'farmers' ? '🌾 农民阵营胜利！' : '👑 地主胜利！'}</h2>
      <div className="settle-detail">
        {state.players.map(p => <span key={p.id}>{p.name}：¥{p.balance ?? '?'}{p.bankrupt ? '（破产）' : ''}</span>)}
      </div>
      <div className="role-pick">
        {me?.isHost && <button className="btn primary" onClick={() => send({ type: 'restart_game' })}>再来一局 <span className="keycap">⏎</span></button>}
        <button className="btn" onClick={leaveRoom}>离开房间</button>
      </div>
    </div>
  );
}
function CoinFlipPanel() { return <div className="phase-panel"><p className="dim coin-hint">掷硬币中…</p></div>; }
function NullPanel() { return null; }
const PHASE_PANELS = {
  LOBBY: LobbyPanel, DISCUSSION: DiscussionPanel, BETTING: BettingPanel, REVEAL: RevealPanel,
  COIN_FLIP: CoinFlipPanel,
  SETTLE: SettlePanel, NEGOTIATE: NegotiatePanel, FINALIZE: FinalizePanel, ENDED: EndedPanel,
};

// FINALIZE：赢到的钱从桌面飞回手牌区（保留原飞牌表现）
function useFinalizeFlight() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const addFlights = useGameStore(s => s.addFlights);
  useEffect(() => {
    if (state.phase !== 'FINALIZE') return;
    const last = state.history[state.history.length - 1];
    const myDelta = last?.deltas?.[playerId] ?? 0;
    if (myDelta <= 0) return;
    const toEl = document.querySelector('[data-hand-anchor]');
    if (!toEl) return;
    const fp = projectPoint(0, 1.1, 0);                 // 桌心彩池 → 屏幕
    const fromX = fp ? fp.x : window.innerWidth / 2;
    const fromY = fp ? fp.y : window.innerHeight * 0.42;
    const to = toEl.getBoundingClientRect();
    addFlights(decompose(myDelta).map((n, i) => ({
      id: `fin-${last.round}-${n.id}`, value: n.value, faceDown: false,
      from: { x: fromX - 26 + i * 6, y: fromY, w: 52, h: 73 },
      to: { x: to.x + to.width / 2 - 26 + i * 10, y: to.y, w: 52, h: 73 },
    })));
  }, [state.phase, state.history, playerId, addFlights]);
}

export default function UiLayer() {
  const state = useGameStore(s => s.state);
  useGameKeys();
  useFinalizeFlight();
  const meta = PHASE_META[state.phase] ?? { label: state.phase, hint: '' };
  const Panel = PHASE_PANELS[state.phase] ?? NullPanel;

  return (
    <div className="hud">
      <TopBar />
      {meta.hint && <div className="hud-banner"><PixelText size={2}>{meta.hint}</PixelText></div>}
      <PlayerRail />
      <BalanceHud />
      <div className="hud-bottom" data-hand-anchor>
        <Panel />
      </div>
    </div>
  );
}
