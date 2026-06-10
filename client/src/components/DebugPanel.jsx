import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import GameBoard from './GameBoard';
import { PHASES, PHASE_LABEL, buildMockState, buildMockChat, LAST_ROUND_RESULT } from '../debug/mockData';

const VIEWER_OPTIONS = [
  { id: 'p-landlord', label: '地主小张' },
  { id: 'p-farmer-a', label: '农民小李' },
  { id: 'p-farmer-b', label: '农民小王（破产观战）' },
  { id: 'p-bank', label: '银行小赵' },
];

export default function DebugPanel() {
  const [phase, setPhase] = useState('BETTING');
  const [viewerId, setViewerId] = useState('p-landlord');
  const [coinResult, setCoinResult] = useState('heads');

  useEffect(() => {
    const mockState = buildMockState({ phase, viewerId, coinResult });
    const { chatMessages, bankruptChat } = buildMockChat();
    useGameStore.setState({
      username: '调试模式',
      roomId: 'DEBUG',
      playerId: viewerId,
      gameState: mockState,
      chatMessages,
      bankruptChat,
      coinResult: phase === 'FLIP' ? coinResult : null,
      lastRoundResult: ['SETTLEMENT', 'NEGOTIATION'].includes(phase) ? { ...LAST_ROUND_RESULT, coinResult } : null,
      revealedBets: phase === 'REVEAL' ? mockState.bets : null,
      error: null,
    });
  }, [phase, viewerId, coinResult]);

  const showCoinToggle = phase === 'FLIP' || phase === 'SETTLEMENT' || phase === 'NEGOTIATION';

  return (
    <div>
      <div className="debug-bar">
        <strong>🛠 UI 调试模式</strong>
        <label>
          阶段：
          <select value={phase} onChange={e => setPhase(e.target.value)}>
            {PHASES.map(p => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
          </select>
        </label>
        <label>
          视角：
          <select value={viewerId} onChange={e => setViewerId(e.target.value)}>
            {VIEWER_OPTIONS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        {showCoinToggle && (
          <label>
            硬币结果：
            <select value={coinResult} onChange={e => setCoinResult(e.target.value)}>
              <option value="heads">正面 👑</option>
              <option value="tails">反面 🌾</option>
            </select>
          </label>
        )}
      </div>
      <GameBoard />
    </div>
  );
}
