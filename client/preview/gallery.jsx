/* eslint-disable react-refresh/only-export-components */
// 视觉验证画廊（离线、不连后端）：用 mock 状态挂载真实表现层组件，逐个核对视觉，免开整局游戏。
// 跑法：`npm run dev` 后开 http://localhost:5173/preview/gallery.html
//
// 两类场景：
//   kind:'grid' —— 纯 props 组件直接渲染（角色形象 / 钱牌）。
//   kind:'game' —— 用 mock state 挂载真实 <GameScreen/>（HUD、面板、投保槽、硬币…都是线上同一套组件）。
// 加新场景：往下面 SCENES 数组里加一项即可（这就是「以后也这么做」的扩展点）。
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import '../src/theme.css';
import '../src/App.css';
import '../src/pixel.css';
import GameScreen from '../src/screens/GameScreen';
import MinecraftPlayer from '../src/scene/MinecraftPlayer';
import { getArt } from '../src/assets/registry';
import { ROLE_LABEL } from '../src/game/roles';
import { useGameStore } from '../src/store/gameStore';

const MoneyNote = getArt('moneyNote');

// ---------- mock state 基底 ----------
const base = {
  phase: 'BETTING', round: 2, roomName: '预览', roomId: 'PREV', mode: 'competitive',
  players: [], me: null, hostId: 'me',
  config: { timing: { coinAnimMs: 6000 }, landlordGoal: { minPenalty: 2, penaltyRate: 0.2 }, competitive: { investor: { maxPledge: 3 } } },
  history: [], coinResult: null, winnerSide: null, settlement: null, allocation: null,
  roundFarmerIds: ['g', 'i', 'f'], landlordGoal: null, capitalist: null,
};
const mk = (o) => ({ ...base, ...o });

const opp = (id, name, role, extra = {}) => ({ id, name, role, seat: 1, online: true, hasBet: true, bet: 2, betCount: 2, balance: null, ...extra });

// ---------- 各场景 mock state ----------
const lobby = mk({
  phase: 'LOBBY', round: 0,
  players: [
    { id: 'me', name: '我', role: 'investor', seat: 0, online: true, isHost: true },
    opp('c', '资本王', 'capitalist', { hasBet: false, bet: null }),
    opp('g', '暴食李', 'glutton', { hasBet: false, bet: null }),
  ],
  me: { id: 'me', role: 'investor', isHost: true, balance: null },
});

const investorBet = mk({
  players: [
    { id: 'me', name: '我', role: 'investor', seat: 0, online: true, isHost: true, hasBet: false, bet: null, balance: 8 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('g', '暴食李', 'glutton', { reflipsLeft: 2 }),
  ],
  me: { id: 'me', role: 'investor', balance: 8, bet: null, bounds: { minStake: 1, min: 1, max: 7, forceAllIn: false }, pledge: 0, premium: 0, pledgeMax: 3 },
});

const reflip = mk({
  phase: 'REFLIP', coinResult: 'heads',
  players: [
    { id: 'me', name: '我', role: 'glutton', seat: 0, online: true, isHost: true, hasBet: true, bet: 2, balance: 6, reflipsLeft: 2 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('f', '农民周', 'farmer'),
  ],
  me: { id: 'me', role: 'glutton', balance: 6, reflipsLeft: 2, passedReflip: false, mealAllowance: 3 },
});

// 一次性把四类 HUD 都点亮（线上不会同时出现；预览只为核对样式）。DISCUSSION 阶段避免渲染下注手牌。
const huds = mk({
  phase: 'DISCUSSION',
  players: [
    { id: 'me', name: '我', role: 'glutton', seat: 0, online: true, isHost: true, hasBet: true, bet: 2, balance: 14, reflipsLeft: 2, mealAllowance: 3 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('f', '农民周', 'farmer'),
  ],
  me: { id: 'me', role: 'glutton', balance: 14, reflipsLeft: 2, mealAllowance: 3, wage: { interval: 2, amount: 4, roundsToNext: 1 }, bounds: { minStake: 1 } },
  landlordGoal: { goal: 36, dueRound: 3, roundsLeft: 1, initial: 24, landlordId: 'l', landlordBalance: 20 },
  capitalist: { id: 'me', personal: 12, pool: 18, taxRate: 0.1, taxMin: 2 },
});

const finalize = mk({
  phase: 'FINALIZE', coinResult: 'tails',
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, balance: 13, hasBet: true, bet: 2 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('g', '暴食李', 'glutton'),
  ],
  me: { id: 'me', role: 'farmer', balance: 13 },
  history: [{
    round: 2, coinResult: 'tails', deltas: { me: 4, l: -6, g: 5 },
    debtWaiver: 4, wagePaid: { me: 4 }, allowanceCharged: { g: 3 },
    landlordGoalValue: null, landlordPenalty: 0, uncovered: 0, newlyBankrupt: [],
  }],
});

const coin = mk({
  phase: 'COIN_FLIP', coinResult: 'heads',
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, hasBet: true, bet: 3, betCount: 2, balance: 8 },
    opp('l', '地主张', 'landlord', { bet: 6 }), opp('g', '暴食李', 'glutton'),
  ],
  me: { id: 'me', role: 'farmer', balance: 8, bet: 3 },
});

const balance = mk({
  phase: 'DISCUSSION',
  players: [{ id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, balance: 20, ready: false }],
  me: { id: 'me', role: 'farmer', balance: 20, ready: false, bounds: { minStake: 1 } },
});

const insDrop = mk({
  phase: 'DISCUSSION',
  players: [{ id: 'me', name: '我', role: 'investor', seat: 0, online: true, isHost: true, balance: 8, ready: false }],
  me: { id: 'me', role: 'investor', balance: 8, ready: false, bounds: { minStake: 1 } },
});

const SCENES = [
  { key: 'avatars', label: '角色形象', kind: 'grid' },
  { key: 'notes', label: '钱牌', kind: 'grid' },
  { key: 'lobby', label: '竞技选角', kind: 'game', state: lobby },
  { key: 'investorBet', label: '投资人投保槽', kind: 'game', state: investorBet, note: '把手牌拖进左侧槽 → 确认下注：注上桌、保单掉屏' },
  { key: 'insDrop', label: '投保掉落动画', kind: 'game', state: insDrop, note: '保单牌一张张掉出屏幕（循环演示）' },
  { key: 'reflip', label: '暴食者重掷/放弃', kind: 'game', state: reflip },
  { key: 'huds', label: '四类 HUD', kind: 'game', state: huds },
  { key: 'finalize', label: '结算播报', kind: 'game', state: finalize },
  { key: 'coin', label: '硬币', kind: 'game', state: coin },
  { key: 'balance', label: '资金增长动画', kind: 'game', state: balance, controls: 'balance' },
];

// ---------- 纯 props 网格 ----------
function AvatarCard({ player }) {
  return (
    <div className="gal-card">
      <Canvas camera={{ position: [0, 0.2, 4.2], fov: 40 }} style={{ height: 260 }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 6, 4]} intensity={1} />
        <group position={[0, -1.15, 0]}><MinecraftPlayer player={player} expression="idle" /></group>
      </Canvas>
      <div className="gal-label">{ROLE_LABEL[player.role]}（{player.role}）{player.bankrupt ? ' · 破产' : ''}</div>
    </div>
  );
}
function AvatarGrid() {
  const roles = ['landlord', 'capitalist', 'farmer', 'investor', 'glutton'];
  return (
    <div className="gal-grid">
      {roles.map(r => <AvatarCard key={r} player={{ id: r, name: ROLE_LABEL[r], role: r, online: true, bankrupt: false }} />)}
      <AvatarCard player={{ id: 'bk', name: '破产', role: 'glutton', online: true, bankrupt: true }} />
    </div>
  );
}
function NotesGrid() {
  const cell = (label, node) => <div className="gal-card"><div className="gal-notes">{node}</div><div className="gal-label">{label}</div></div>;
  return (
    <div className="gal-grid">
      {cell('面额 10 / 5 / 2 / 1', [10, 5, 2, 1].map(v => <MoneyNote key={v} value={v} width={72} />))}
      {cell('债务（红）', <MoneyNote value={5} debt width={72} />)}
      {cell('背面朝上', <MoneyNote value={10} faceDown width={72} />)}
      {cell('锁定（保留金）', <MoneyNote value={2} locked width={72} />)}
    </div>
  );
}

// ---------- 资金增长动画控制 ----------
function bump(delta) {
  const st = useGameStore.getState().state;
  const nb = Math.max(0, (st.me.balance ?? 0) + delta);
  useGameStore.setState({ state: { ...st, me: { ...st.me, balance: nb }, players: st.players.map(p => (p.id === st.me.id ? { ...p, balance: nb } : p)) } });
}
function setBalance(v) { // 重置到固定值，方便反复演示分级
  const st = useGameStore.getState().state;
  const nb = Math.max(0, v);
  useGameStore.setState({ state: { ...st, me: { ...st.me, balance: nb }, players: st.players.map(p => (p.id === st.me.id ? { ...p, balance: nb } : p)) } });
}
function BalanceControls() {
  return (
    <div className="gal-controls">
      <span>增长：</span>
      <button className="btn small" onClick={() => bump(1)}>+1</button>
      <button className="btn small" onClick={() => bump(5)}>+5（≥5 弹跳）</button>
      <button className="btn small" onClick={() => { const b = useGameStore.getState().state.me.balance; bump(Math.ceil(b * 0.6) + 1); }}>+60%（弹跳）</button>
      <span style={{ marginLeft: 12 }}>扣钱：</span>
      <button className="btn small" onClick={() => bump(-2)}>-2（不触发）</button>
      <button className="btn small" onClick={() => bump(-5)}>-5（一级抽动）</button>
      <button className="btn small" onClick={() => bump(-12)}>-12（二级抽动）</button>
      <button className="btn small" onClick={() => setBalance(20)}>↺ 重置 20</button>
    </div>
  );
}

// ---------- 画廊外壳 ----------
function applyGameScene(scene) {
  useGameStore.setState({
    state: scene.state, playerId: 'me', connected: true, joining: false,
    chat: [], chatOpen: false, flights: [], insuranceDrops: [], betFlight: null, myStack: null, looks: {},
    send: (m) => console.log('[preview send]', m), // 预览不连后端：发送变 no-op，确认下注只跑动画
  });
}

const urlScene = new URLSearchParams(location.search).get('scene');
function Gallery() {
  const [key, setKey] = useState(SCENES.some(s => s.key === urlScene) ? urlScene : SCENES[0].key);
  const scene = SCENES.find(s => s.key === key);
  useEffect(() => { if (scene.kind === 'game') applyGameScene(scene); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 投保掉落场景：循环触发，截图任意时刻都能看到半空的保单牌。
  useEffect(() => {
    if (key !== 'insDrop') return undefined;
    const fire = () => {
      const y = window.innerHeight - 140;
      useGameStore.getState().dropInsurance([0, 1, 2].map(i => ({
        id: `d-${Date.now()}-${i}`, value: 1, x: 130 + i * 46, y, w: 46, delay: i * 130, spin: (i % 2 ? 1 : -1) * 22,
      })));
    };
    fire();
    const t = setInterval(fire, 700);
    return () => clearInterval(t);
  }, [key]);

  return (
    <div className="gal-root">
      <div className="gal-bar">
        <b>视觉验证画廊</b>
        {SCENES.map(s => (
          <button key={s.key} className={`btn small ${s.key === key ? 'primary' : ''}`} onClick={() => setKey(s.key)}>{s.label}</button>
        ))}
        {scene.note && <span className="gal-note">{scene.note}</span>}
      </div>
      <div className="gal-stage">
        {scene.kind === 'grid'
          ? (scene.key === 'avatars' ? <AvatarGrid /> : <NotesGrid />)
          : <GameScreen key={key} />}
      </div>
      {scene.controls === 'balance' && <BalanceControls />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Gallery /></StrictMode>);
