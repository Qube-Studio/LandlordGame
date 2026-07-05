// 仅用于离线截图核对画面：用 mock state 挂载真实 GameScreen，不连后端。
// 通过 ?phase=REVEAL|SETTLE|BETTING|LOBBY 选择阶段。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import './App.css';
import './pixel.css';
import GameScreen from './screens/GameScreen';
import { useGameStore } from './store/gameStore';

const phase = new URLSearchParams(location.search).get('phase') || 'REVEAL';

const players = [
  { id: 'p1', name: '我', role: 'farmer', balance: 8, online: true, isHost: true, hasBet: true, bet: 3, confirmed: false, negotiateConfirmed: false, bounds: { minStake: 1, min: 1, max: 7, forceAllIn: false }, wage: { interval: 3, amount: 2, roundsToNext: 2 } },
  { id: 'p2', name: '地主张', role: 'landlord', balance: null, online: true, isHost: false, hasBet: true, bet: 5, confirmed: true },
  { id: 'p3', name: '农民李', role: 'farmer', balance: null, online: true, isHost: false, hasBet: true, bet: 2, confirmed: false, negotiateConfirmed: false },
  { id: 'p4', name: '农民王', role: 'farmer', balance: null, online: false, isHost: false, hasBet: true, bet: 4, confirmed: false, negotiateConfirmed: false },
];

const base = {
  phase,
  round: 2,
  roomName: '测试房',
  roomId: 'ABCD',
  players,
  me: players[0],
  config: { timing: { coinAnimMs: 2200 }, landlordGoal: { minPenalty: 2, penaltyRate: 0.2 } },
  history: [],
  coinResult: null,
  winnerSide: null,
  settlement: null,
  allocation: null,
  roundFarmerIds: ['p1', 'p3', 'p4'],
  // 截图核对用：landlordBalance/capitalist 在真实农民视角本应为 null/不可见，这里点亮只为核对图形
  landlordGoal: { goal: 25, dueRound: 3, roundsLeft: 1, interval: 3, initial: 31, landlordId: 'p2', landlordBalance: 20 },
  capitalist: { id: 'p2', personal: 8, personalInitial: 8, pool: 22, poolInitial: 30, taxNext: 3, taxRate: 0.1, taxMin: 2 },
};

if (phase === 'BETTING') {
  base.me = { ...players[0], bet: null, hasBet: false };
  base.players = [{ ...players[0], bet: null, hasBet: false }, ...players.slice(1)];
}
if (phase === 'SETTLE') {
  base.coinResult = 'heads';
  base.settlement = { events: [{ type: 'landlord_win', target: 5, surplus: 0 }], landlordTake: 5, takes: { p3: 2 }, debts: {} };
}
if (phase === 'LOBBY') {
  base.players = players.map(p => ({ ...p, hasBet: false, bet: null }));
  base.me = base.players[0];
}
if (phase === 'FLIGHT') {
  base.phase = 'BETTING';
  base.me = { ...players[0], bet: null, hasBet: false };
  base.players = [base.me, ...players.slice(1)];
}

useGameStore.setState({
  state: base,
  playerId: 'p1',
  connected: true,
  joining: false,
  chat: [
    { channel: 'public', from: 'p2', name: '地主张', text: '来吧，敢不敢全押', ts: Date.now() },
    { channel: 'farmer', from: 'p3', name: '农民李', text: '稳住，别慌', ts: Date.now() },
  ],
  chatOpen: false,
});

if (phase === 'FLIGHT') {
  const fire = () => useGameStore.getState().startBetFlight({
    round: base.round,
    items: [
      { id: 'f1', value: 5, fromScreen: { x: 560, y: 700 } },
      { id: 'f2', value: 2, fromScreen: { x: 640, y: 705 } },
      { id: 'f3', value: 1, fromScreen: { x: 715, y: 700 } },
    ],
  });
  fire();
  setInterval(fire, 450); // 持续重发，任意时刻总有牌在半空，便于截图核对
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GameScreen />
  </StrictMode>,
);
