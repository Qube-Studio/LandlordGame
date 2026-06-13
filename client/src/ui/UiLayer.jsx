// UI 层：同一时间只展示当前阶段需要的 UI + 全局常驻 UI（房间号/退出/玩家状态条）。
// 每个阶段顶部有一句话说明现在该做什么（自解释设计）。

import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getArt } from '../assets/registry';
import MoneyHand from './MoneyHand';
import NegotiationBoard from './NegotiationBoard';

const Icon = getArt('icon');

const PHASE_META = {
  LOBBY: { label: '准备大厅', hint: '选择角色，等待房主开始游戏' },
  DISCUSSION: { label: '战术讨论', hint: '农民可在密谈频道商量战术，所有人准备后进入下注' },
  BETTING: { label: '下注中', hint: '从手牌选择钱牌组成下注额（对其他人保密）' },
  REVEAL: { label: '揭牌', hint: '各家下注已公开，确认后掷硬币' },
  COIN_FLIP: { label: '掷硬币', hint: '正面地主胜，反面农民胜' },
  SETTLE: { label: '系统结算', hint: '系统按规则给出默认分配方案' },
  NEGOTIATE: { label: '农民协商', hint: '农民内部重新分配钱与债务' },
  FINALIZE: { label: '正式结算', hint: '钱已入账，即将进入下一回合' },
  ENDED: { label: '对局结束', hint: '' },
};

const ROLE_LABEL = { landlord: '地主', farmer: '农民', bank: '银行' };

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

function GlobalBar() {
  const state = useGameStore(s => s.state);
  const leaveRoom = useGameStore(s => s.leaveRoom);
  const showToast = useGameStore(s => s.showToast);
  const [showId, setShowId] = useState(false);

  const inGame = !['LOBBY', 'ENDED'].includes(state.phase);
  const exit = () => {
    if (inGame && !window.confirm('游戏进行中，退出将视为弃局。确定退出？')) return;
    leaveRoom();
  };
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(state.roomId);
      showToast('房间号已复制', 'ok');
    } catch {
      showToast(`房间号：${state.roomId}`, 'ok');
    }
  };

  return (
    <div className="global-bar">
      <div className="bar-left">
        <button className="btn ghost small" onClick={() => setShowId(v => !v)}>
          {state.roomName}{showId ? ` · ${state.roomId}` : ''}
        </button>
        {showId && <button className="btn ghost tiny" onClick={copyId}><Icon name="copy" size={14} /></button>}
        {state.round > 0 && <span className="round-chip">第 {state.round} 回合</span>}
        <span className="phase-chip">{PHASE_META[state.phase]?.label ?? state.phase}</span>
      </div>
      <button className="btn ghost small" onClick={exit}><Icon name="exit" size={15} /> 退出房间</button>
    </div>
  );
}

function PlayersStrip() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  return (
    <div className="players-strip">
      {state.players.map(p => {
        const st = statusOf(p, state);
        return (
          <div key={p.id} className={`player-chip ${p.id === playerId ? 'me' : ''}`}>
            <span className={`role-dot ${p.role ?? 'none'}`} />
            <span className="chip-name">{p.name}{p.isHost ? ' 👑' : ''}</span>
            <span className="chip-role">{ROLE_LABEL[p.role] ?? '未选'}</span>
            <span className="chip-balance">{p.balance != null ? `¥${p.balance}` : '¥🔒'}</span>
            {st.text && <span className={`chip-status ${st.cls}`}>{st.text}</span>}
          </div>
        );
      })}
    </div>
  );
}

function LobbyPanel() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const me = state.me;
  return (
    <div className="phase-panel">
      <div className="role-pick">
        <button
          className={`btn ${me?.role === 'landlord' ? 'primary' : ''}`}
          onClick={() => send({ type: 'take_role', role: 'landlord' })}
        >当地主</button>
        <button
          className={`btn ${me?.role === 'farmer' ? 'primary' : ''}`}
          onClick={() => send({ type: 'take_role', role: 'farmer' })}
        >当农民</button>
      </div>
      {me?.isHost ? (
        <button className="btn primary wide" onClick={() => send({ type: 'start_game' })}>开始游戏</button>
      ) : (
        <p className="dim">等待房主开始…</p>
      )}
    </div>
  );
}

function DiscussionPanel() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const me = state.me;
  if (me?.spectator) return <p className="dim">你已破产，正在观战。</p>;
  return (
    <div className="phase-panel">
      {me?.ready
        ? <p className="ok">已准备，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'ready' })}>准备完毕</button>}
    </div>
  );
}

function BettingPanel() {
  const state = useGameStore(s => s.state);
  const me = state.me;
  if (me?.spectator || !['landlord', 'farmer'].includes(me?.role)) {
    return <p className="dim">观战中：等待玩家下注…</p>;
  }
  if (me.bet != null) return <p className="ok">已下注，等待其他玩家…</p>;
  return <MoneyHand key={`${state.round}-${me.balance}`} />;
}

function RevealPanel() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const me = state.me;
  const confirmedCount = state.players.filter(p => p.confirmed).length;
  const activeCount = state.players.filter(p => ['landlord', 'farmer'].includes(p.role) && !p.bankrupt).length;
  return (
    <div className="phase-panel">
      <p className="dim">已确认 {confirmedCount}/{activeCount}，期间可以聊天</p>
      {me?.spectator ? null : me?.confirmed
        ? <p className="ok">已确认，等待其他玩家…</p>
        : <button className="btn primary wide" onClick={() => send({ type: 'confirm_reveal' })}>看清了，掷硬币！</button>}
    </div>
  );
}

const EVENT_TEXT = {
  landlord_win: e => `正面朝上，地主胜！拿走目标 ${e.target}${e.surplus > 0 ? `，盈余 ${e.surplus}（地主再取 ${e.landlordExtra}，农民分 ${e.farmerPool}）` : ''}`,
  landlord_win_shortfall: e => `正面朝上，地主胜！桌面不足目标 ${e.target}，缺口 ${e.shortfall} 由农民共同补足${e.uncovered > 0 ? `（仍有 ${e.uncovered} 无人能付）` : ''}`,
  farmers_win: e => `反面朝上，农民胜！平分桌面全部 ${e.pot}`,
};

function SettlePanel() {
  const state = useGameStore(s => s.state);
  const s = state.settlement;
  if (!s) return null;
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? id;
  return (
    <div className="phase-panel settle-panel">
      {s.events.map((e, i) => <p key={i} className="settle-line">{EVENT_TEXT[e.type]?.(e) ?? ''}</p>)}
      <div className="settle-detail">
        <span>地主拿走 <b className="gold">{s.landlordTake}</b></span>
        {Object.entries(s.takes).filter(([, v]) => v > 0).map(([id, v]) => (
          <span key={id}>{nameOf(id)} 分得 <b className="gold">{v}</b></span>
        ))}
        {Object.entries(s.debts).filter(([, v]) => v > 0).map(([id, v]) => (
          <span key={id}>{nameOf(id)} 需补 <b className="danger">{v}</b></span>
        ))}
      </div>
    </div>
  );
}

function NegotiatePanel() {
  const state = useGameStore(s => s.state);
  const me = state.me;
  if (me?.role === 'landlord' && !me?.spectator) {
    return <p className="dim">农民正在协商分配，请稍候…</p>;
  }
  return <NegotiationBoard />;
}

function FinalizePanel() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const myDelta = last.deltas?.[playerId] ?? 0;
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? id;
  return (
    <div className="phase-panel">
      <p className={`delta-big ${myDelta >= 0 ? 'ok' : 'danger'}`}>
        本回合 {myDelta >= 0 ? `+${myDelta}` : myDelta}
      </p>
      <div className="settle-detail">
        {Object.entries(last.deltas ?? {}).map(([id, d]) => (
          <span key={id} className={d >= 0 ? 'ok' : 'danger'}>{nameOf(id)} {d >= 0 ? `+${d}` : d}</span>
        ))}
      </div>
      {last.newlyBankrupt?.length > 0 && (
        <p className="danger">{last.newlyBankrupt.map(nameOf).join('、')} 破产了！</p>
      )}
    </div>
  );
}

function EndedPanel() {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const leaveRoom = useGameStore(s => s.leaveRoom);
  const me = state.me;
  const iWon = state.winnerSide && ((state.winnerSide === 'farmers') === (me?.role === 'farmer'));
  return (
    <div className="phase-panel ended-panel">
      <h2 className={iWon ? 'gold' : 'dim'}>
        {state.winnerSide === 'farmers' ? '🌾 农民阵营胜利！' : '👑 地主胜利！'}
      </h2>
      <div className="settle-detail">
        {state.players.map(p => (
          <span key={p.id}>{p.name}：¥{p.balance ?? '?'}{p.bankrupt ? '（破产）' : ''}</span>
        ))}
      </div>
      <div className="role-pick">
        {me?.isHost && <button className="btn primary" onClick={() => send({ type: 'restart_game' })}>再来一局</button>}
        <button className="btn" onClick={leaveRoom}>离开房间</button>
      </div>
    </div>
  );
}

function NullPanel() {
  return null;
}

const PHASE_PANELS = {
  LOBBY: LobbyPanel,
  DISCUSSION: DiscussionPanel,
  BETTING: BettingPanel,
  REVEAL: RevealPanel,
  COIN_FLIP: () => <p className="dim coin-hint">掷硬币中…</p>,
  SETTLE: SettlePanel,
  NEGOTIATE: NegotiatePanel,
  FINALIZE: FinalizePanel,
  ENDED: EndedPanel,
};

export default function UiLayer() {
  const state = useGameStore(s => s.state);
  const meta = PHASE_META[state.phase] ?? { label: state.phase, hint: '' };
  const Panel = PHASE_PANELS[state.phase] ?? NullPanel;

  return (
    <div className="ui-layer">
      <GlobalBar />
      <PlayersStrip />
      {meta.hint && <div className="phase-banner">{meta.hint}</div>}
      <div className="bottom-area" data-hand-anchor>
        <Panel />
      </div>
    </div>
  );
}
