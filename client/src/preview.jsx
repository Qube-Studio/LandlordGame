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

// 截图/自动化探针：暴露真实 store 实例（HMR 时间戳会让外部 import 拿到另一份模块）
window.__gameStore = useGameStore;
// 掷币演出探针：读 flightLive.restAt 可精确对准分镜/扫光/浪潮的时刻截图
import('./scene/coinSim').then(m => { window.__coinSim = m; });

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
if (phase === 'COIN_FLIP') base.coinResult = 'heads'; // 掷币分镜演出（§3.4）截图核对
if (phase === 'LOBBY') {
  base.players = players.map(p => ({ ...p, hasBet: false, bet: null }));
  base.me = base.players[0];
}
if (phase === 'FLIGHT') {
  base.phase = 'BETTING';
  base.me = { ...players[0], bet: null, hasBet: false };
  base.players = [base.me, ...players.slice(1)];
}
if (phase === 'ENDED') {
  // 终局演出（§阶段七）：me 是农民 → winnerSide='farmers' 展示「胜利！」正面态（改 'landlord' 看败北态）
  base.winnerSide = 'farmers';
  base.endedReturnAt = Date.now() + 8000;
  base.players = players.map(p => ({ ...p, balance: p.role === 'landlord' ? 0 : 12, bankrupt: p.role === 'landlord' }));
  base.me = base.players[0];
}

useGameStore.setState({
  state: base,
  playerId: 'p1',
  connected: true,
  joining: false,
  // 聊天 2.0 着色样本齐全：敌方公开(红)/己方公开(绿)/阵营频道(橙标签+绿)/系统(金)
  chat: [
    { channel: 'public', from: 'p2', name: '地主张', text: '来吧，敢不敢全押', ts: Date.now() },
    { channel: 'public', from: 'p4', name: '农民王', text: '他在虚张声势', ts: Date.now() },
    { channel: 'farmer', from: 'p3', name: '农民李', text: '稳住，别慌', ts: Date.now() },
    { channel: 'public', from: 'p3', name: '农民李', text: '这是一条特别长的消息用来核对聊天行折行效果黑底应当随内容长高而不是让文字溢出到背景之外去', ts: Date.now() },
    { channel: 'public', from: null, name: '', text: '农民王（农民）已破产', ts: Date.now(), system: true },
  ],
  chatOpen: new URLSearchParams(location.search).get('chat') === 'open', // ?chat=open 截图展开态
  chatTab: new URLSearchParams(location.search).get('tab') ?? 'all',     // ?tab=faction|system 截图页签过滤
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
