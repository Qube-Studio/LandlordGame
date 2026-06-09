import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import PlayerList from './PlayerList';
import BettingPanel from './BettingPanel';
import BankPanel from './BankPanel';
import ChatBox from './ChatBox';
import RoundHistory from './RoundHistory';
import FundHistory from './FundHistory';

export default function GameBoard() {
  const [showFundHistory, setShowFundHistory] = useState(false);
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const skipVotes = useGameStore(s => s.skipVotes);
  const send = useGameStore(s => s.send);
  const leaveRoom = useGameStore(s => s.leaveRoom);
  const error = useGameStore(s => s.error);

  if (!state) return <div className="loading">连接中…</div>;

  const { phase, round, players, roomId, roomName } = state;
  const myPlayer = players.find(p => p.id === playerId);
  const isLobby = phase === 'LOBBY';
  const isEnded = phase === 'ENDED';

  const canStart = isLobby
    && players.some(p => p.role === 'landlord')
    && players.some(p => p.role === 'farmer');

  const isSpectator = myPlayer?.bankrupt;

  const activeFarmers = players.filter(p => p.role === 'farmer' && !p.bankrupt);
  const isFarmerActive = myPlayer?.role === 'farmer' && !myPlayer?.bankrupt;
  const myVoted = skipVotes.includes(playerId);

  return (
    <div className="game-board">
      <header className="game-header">
        <div>
          <span className="room-id">{roomName ?? roomId}</span>
          <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>#{roomId}</span>
        </div>
        <span className="phase-badge">{phaseLabel(phase)}</span>
        {!isLobby && !isEnded && <span className="round-badge">第 {round} 回合</span>}
        {state.myBalanceHistory?.length > 0 && (
          <button className="btn small" onClick={() => setShowFundHistory(v => !v)}>
            {showFundHistory ? '收起历史' : '资金历史'}
          </button>
        )}
        <button className="btn small leave-btn" onClick={leaveRoom}>退出房间</button>
      </header>

      {error && <div className="error">{error}</div>}

      {isSpectator && (
        <div className="spectator-banner">
          👁️ 你已破产 — 透明观战模式（全场信息可见）
        </div>
      )}

      {isLobby && (
        <div className="card lobby-actions">
          <p>等待玩家就位…（至少需要地主 + 1名农民）</p>
          {canStart && (
            <button className="btn primary large" onClick={() => send({ type: 'start_game' })}>
              开始游戏
            </button>
          )}
        </div>
      )}

      {isEnded && (
        <div className="card ended">
          <h2>游戏结束</h2>
        </div>
      )}

      {phase === 'NEGOTIATION' && (
        <div className="card negotiation-banner">
          <div className="negotiation-title">🤝 协商阶段 — 农民可协商分配本轮收益</div>

          <div className="skip-votes">
            {activeFarmers.map(p => (
              <span key={p.id} className={`skip-badge ${skipVotes.includes(p.id) ? 'agreed' : 'pending'}`}>
                {p.name}: {skipVotes.includes(p.id) ? '✅ 同意跳过' : '⏳ 判断中'}
              </span>
            ))}
          </div>

          {isFarmerActive && !myVoted && (
            <button className="btn small" onClick={() => send({ type: 'skip_negotiation_vote' })}>
              同意跳过协商
            </button>
          )}
          {isFarmerActive && myVoted && (
            <span className="muted">已投票同意跳过，等待其他农民…</span>
          )}
        </div>
      )}

      {showFundHistory && <FundHistory />}

      <div className="board-grid">
        <div className="board-left">
          <PlayerList />
          <BettingPanel />
          <BankPanel />
        </div>
        <div className="board-right">
          <RoundHistory />
          <ChatBox />
        </div>
      </div>
    </div>
  );
}

function phaseLabel(phase) {
  const map = {
    LOBBY: '等待开始',
    BETTING: '下注中',
    REVEAL: '揭示下注',
    FLIP: '掷硬币',
    SETTLEMENT: '结算中',
    NEGOTIATION: '协商分配',
    ENDED: '游戏结束',
  };
  return map[phase] ?? phase;
}
