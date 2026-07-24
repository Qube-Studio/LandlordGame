// 仅用于离线截图核对画面：用 mock state 挂载真实 GameScreen，不连后端。
// 通过 ?phase=REVEAL|SETTLE|BETTING|LOBBY 选择阶段。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import './App.css';
import './pixel.css';
import GameScreen from './screens/GameScreen';
import AppStage from './ui/AppStage';
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
if (phase === 'REFLIP') {
  // 重掷决策窗浮字核对：me=暴食者（可重掷）。加 ?wait=1 看非暴食者的等待视角。
  base.coinResult = 'heads';
  base.reflipDeadline = Date.now() + 8000;
  const meGlutton = new URLSearchParams(location.search).get('wait') !== '1';
  base.players = players.map(p => (p.id === 'p3' ? { ...p, role: 'glutton', reflipsLeft: 2, reflipsMax: 3 } : p));
  if (meGlutton) {
    base.players[0] = { ...base.players[0], role: 'glutton', reflipsLeft: 2, reflipsMax: 3, passedReflip: false };
    base.roundFarmerIds = ['p1', 'p3', 'p4'];
  }
  base.me = base.players[0];
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
if (phase === 'EXECUTION') {
  // 处决窗（§3.9）快速验证入口：
  //   ?view=judge(默认)|watcher|target|dead — 行刑者(准心+左轮+软锁)/旁观运镜/焦点目标/死亡视角
  //   &play=1     — 播完整判决剧本（焦点1 处决 → 焦点2 赦免 → 收窗，循环）；不加=静态定格
  //   &volley=1   — 播超时连发剧本（第三人称锁定镜头 + 连续默认处决）
  //   &outcome=pardoned — 剧本焦点1 改为赦免（target 视角看白字滞留路径）
  // 破产标记推迟制：待判目标 bankrupt=false（正常外观，判决落定才灰化瘫倒）。
  const q = new URLSearchParams(location.search);
  const view = q.get('view') ?? (q.get('wait') ? 'watcher' : q.get('target') ? 'target' : 'judge'); // 旧参数兼容
  const meId = view === 'judge' ? 'p1' : view === 'target' ? 'p3' : view === 'dead' ? 'p3' : 'p1';
  const judgeId = view === 'judge' ? 'p1' : 'p2';
  const mkPlayers = (patch = {}) => players.map(p => {
    const base2 = p.id === 'p3' ? { ...p, balance: 0 } : p.id === 'p4' ? { ...p, balance: 0 } : p;
    return patch[p.id] ? { ...base2, ...patch[p.id] } : base2;
  });
  const mkExec = (over) => ({
    targetId: 'p3', executionerId: judgeId, deadline: Date.now() + 10000,
    compensation: 5, queue: ['p3', 'p4'], queueLeft: 2, results: [], lastResult: null, volley: false,
    ...over,
  });
  const mkMe = (ps, ex) => {
    const self = ps.find(p => p.id === meId);
    return ex && ex.executionerId === meId && ex.targetId
      ? { ...self, isExecutioner: true, canPardon: true, pardonCost: ex.compensation ?? 5 }
      : { ...self };
  };
  const apply = (ex, patch = {}) => {
    const ps = mkPlayers(patch);
    const st = { ...base, phase: ex ? 'EXECUTION' : 'DISCUSSION', players: ps, execution: ex, me: mkMe(ps, ex) };
    useGameStore.setState({ state: st, playerId: meId });
  };
  //   &fallen=1 — p4 静态已破产（验中弹倒地躺姿+灰化的确定性入口,低帧机上拍运动分镜靠运气）
  base.players = mkPlayers(view === 'dead' ? { p3: { bankrupt: true } } : q.get('fallen') ? { p4: { bankrupt: true } } : {});
  base.execution = mkExec(view === 'dead' ? { targetId: 'p4', queue: ['p4'], queueLeft: 1 } : {});
  base.me = mkMe(base.players, base.execution);

  if (q.get('play') || q.get('volley')) {
    const oc1 = q.get('outcome') === 'pardoned' ? 'pardoned' : 'executed';
    const rec1 = { targetId: 'p3', executionerId: judgeId, outcome: oc1, compensation: 5, auto: false };
    const rec2 = { targetId: 'p4', executionerId: judgeId, outcome: 'pardoned', compensation: 4, auto: false };
    const p3After = oc1 === 'executed' ? { p3: { bankrupt: true } } : { p3: { balance: 5 } };
    // [延时ms, 动作]：volley=连发剧本（1.2s 一枪全 executed）；play=决断→结果窗→下一焦点→收窗
    const script = q.get('volley')
      ? [
        [1000, () => apply(mkExec({}))],
        // 结果窗保留 executionerId（服务端语义：只清 targetId——相机分派/外部持枪都依赖）；results 只增不清
        [4000, () => apply(mkExec({ targetId: null, deadline: null, volley: true, lastResult: { ...rec1, auto: true }, results: [{ ...rec1, auto: true }] }), { p3: { bankrupt: true } })],
        [5200, () => apply(mkExec({ targetId: 'p4', deadline: null, volley: true, queueLeft: 1, results: [{ ...rec1, auto: true }] }), { p3: { bankrupt: true } })],
        [5300, () => apply(mkExec({ targetId: null, deadline: null, volley: true, lastResult: { ...rec2, outcome: 'executed', auto: true }, results: [{ ...rec1, auto: true }, { ...rec2, outcome: 'executed', auto: true }] }), { p3: { bankrupt: true }, p4: { bankrupt: true } })],
        [8300, () => apply(null, { p3: { bankrupt: true }, p4: { bankrupt: true } })],
      ]
      : [
        [1000, () => apply(mkExec({}))],
        [5000, () => apply(mkExec({ targetId: null, deadline: null, lastResult: rec1, results: [rec1] }), p3After)],
        [8000, () => apply(mkExec({ targetId: 'p4', queueLeft: 1, compensation: 4, results: [rec1] }), p3After)],
        [12000, () => apply(mkExec({ targetId: null, deadline: null, lastResult: rec2, results: [rec1, rec2], queueLeft: 1 }), { ...p3After, p4: { balance: 4 } })],
        [15000, () => apply(null, { ...p3After, p4: { balance: 4 } })],
      ];
    const runOnce = () => { for (const [ms, fn] of script) setTimeout(fn, ms); };
    setTimeout(runOnce, 800);
    setInterval(runOnce, (script[script.length - 1][0] ?? 15000) + 2600); // 循环重播，便于反复观察
  }
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
    <AppStage>
      <GameScreen />
    </AppStage>
  </StrictMode>,
);
