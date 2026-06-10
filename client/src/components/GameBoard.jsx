import { useGameStore } from '../store/gameStore';
import GameTable from './GameTable';
import ActionPanel from './ActionPanel';
import BalanceBar from './BalanceBar';
import PlayerList from './PlayerList';
import ChatBox from './ChatBox';
import RoundHistory from './RoundHistory';
import FundHistory from './FundHistory';

export default function GameBoard() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
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

  return (
    <div className="game-board">
      <header className="game-header">
        <div>
          <span className="room-id">{roomName ?? roomId}</span>
          <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>#{roomId}</span>
        </div>
        <span className="phase-badge">{phaseLabel(phase)}</span>
        {!isLobby && !isEnded && <span className="round-badge">第 {round} 回合</span>}
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

      <div className="main-grid">
        <div className="gt-table">
          <GameTable />
        </div>
        <div className="gt-players">
          <PlayerList />
          <FundHistory />
          <RoundHistory />
        </div>
        <div className="gt-chat">
          <ChatBox />
        </div>
        <div className="gt-decisions">
          <ActionPanel />
        </div>
        <div className="gt-balance">
          <BalanceBar />
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
