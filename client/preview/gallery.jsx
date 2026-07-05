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
import { insStackStyle } from '../src/game/notes';
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

// 3D 手牌下注（交互 3D 化）：余额分解成纸牌捏在相机前，拖进圆圈=暂存下注，点圈内牌收回；
// 圈外右侧保留金（正面朝上不可交互）；圈上白字浮提示（无背景板）。
const betting3d = mk({
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, hasBet: false, bet: null, balance: 12 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('f', '农民周', 'farmer'),
  ],
  me: { id: 'me', role: 'farmer', balance: 12, bet: null, bounds: { minStake: 1, min: 1, max: 11, forceAllIn: false } },
});

// 满手牌扇形（反馈①回归）：大余额分解出 11 张牌，核对真扇形排列/交错不穿模/悬停沿牌轴抽出。
const fanHand = mk({
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, hasBet: false, bet: null, balance: 98 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('f', '农民周', 'farmer'),
  ],
  me: { id: 'me', role: 'farmer', balance: 98, bet: null, bounds: { minStake: 1, min: 1, max: 97, forceAllIn: false } },
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

// 资本家资金蜡烛盈亏变色(bug 修复回归):个人本金恒定,deltas 恒 0——蜡烛须改用资金池净变动判色。
// 这局上一回合池亏损(poolDelta -3 − 税 2 = 净 -5),右下角蜡烛应为红。
const capitalistLoss = mk({
  phase: 'DISCUSSION',
  players: [
    { id: 'me', name: '我', role: 'capitalist', seat: 0, online: true, isHost: true, balance: 12 },
    opp('f', '农民周', 'farmer', { hasBet: false, bet: null }),
    opp('g', '暴食李', 'glutton', { hasBet: false, bet: null }),
  ],
  me: { id: 'me', role: 'capitalist', balance: 12, pool: 13, bounds: { minStake: 1 } },
  capitalist: { id: 'me', personal: 12, pool: 13, taxRate: 0.1, taxMin: 2 },
  history: [{
    round: 1, coinResult: 'tails', bets: { me: 3, f: 2, g: 2 }, pot: 7, deltas: { me: 0, f: 4, g: -2 },
    capitalistPool: 13, capitalistPoolDelta: -3, capitalistTax: 2,
    landlordGoalValue: null, landlordPenalty: 0, uncovered: 0, newlyBankrupt: [],
  }],
});

// 账本资本家视角(bug 修复回归):摘要行「我 ±N」与摘开明细里「我」那一行都必须走资金池净变动，
// 不能沿用恒为 0 的 deltas.me——两轮分别验证盈利(+7)与亏损(−5)都正确显示且颜色正确。
const ledgerCapitalist = mk({
  phase: 'DISCUSSION', round: 3,
  players: [
    { id: 'me', name: '我', role: 'capitalist', seat: 0, online: true, isHost: true, balance: 20 },
    opp('f', '农民周', 'farmer', { hasBet: false, bet: null }),
    opp('g', '暴食李', 'glutton', { hasBet: false, bet: null }),
  ],
  me: { id: 'me', role: 'capitalist', balance: 20, pool: 20, bounds: { minStake: 1 } },
  capitalist: { id: 'me', personal: 20, pool: 20, taxRate: 0.1, taxMin: 2 },
  history: [
    {
      round: 1, coinResult: 'heads', bets: { me: 6, f: 2, g: 2 }, pot: 10, deltas: { me: 0, f: -2, g: -2 },
      capitalistPool: 15, capitalistPoolDelta: 9, capitalistTax: 2,
      landlordGoalValue: null, landlordPenalty: 0, uncovered: 0, newlyBankrupt: [],
    },
    {
      round: 2, coinResult: 'tails', bets: { me: 4, f: 3, g: 3 }, pot: 10, deltas: { me: 0, f: 5, g: 5 },
      capitalistPool: 10, capitalistPoolDelta: -5, capitalistTax: 0,
      landlordGoalValue: null, landlordPenalty: 0, uncovered: 0, newlyBankrupt: [],
    },
  ],
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

// ---- 桌面显式结算（§3.8）四场景 ----
const payoutPlayers = [
  { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, hasBet: true, bet: 3, betCount: 2, balance: 5 },
  opp('l', '地主张', 'landlord', { bet: 6, betCount: 3 }),
  opp('f', '农民周', 'farmer', { bet: 2, betCount: 1 }),
];
const payoutBase = {
  mode: 'quick', roundFarmerIds: ['me', 'f'],
  players: payoutPlayers,
  me: { id: 'me', role: 'farmer', balance: 5, bet: 3 },
};
// SETTLE：切进场景即播放 聚拢→分堆→派送（重进场景可重播）
const payoutSettle = mk({
  ...payoutBase, phase: 'SETTLE', coinResult: 'tails',
  settlement: { coinResult: 'tails', pot: 11, landlordTake: 0, takes: { me: 6, f: 5 }, debts: {}, uncovered: 0, events: [{ type: 'farmers_win', pot: 11 }] },
  payout: {
    script: [
      { id: 1, t: 'gather', from: [{ id: 'l', amount: 6 }, { id: 'me', amount: 3 }, { id: 'f', amount: 2 }], pot: 11 },
      { id: 2, t: 'split', shares: [{ id: 'me', amount: 6 }, { id: 'f', amount: 5 }] },
    ],
    piles: { me: 6, f: 5, l: 0 }, taken: [], eligible: [], deadline: null,
  },
});
// NEGOTIATE（农民胜）：桌面钱堆镜像协商方案
const payoutNegotiate = mk({
  ...payoutBase, phase: 'NEGOTIATE', coinResult: 'tails',
  settlement: { coinResult: 'tails', pot: 11, landlordTake: 0, takes: { me: 6, f: 5 }, debts: {}, uncovered: 0, events: [{ type: 'farmers_win', pot: 11 }] },
  allocation: { takes: { me: 6, f: 5 }, debts: {}, confirms: [], deadline: null },
  payout: {
    script: [
      { id: 1, t: 'gather', from: [{ id: 'l', amount: 6 }, { id: 'me', amount: 3 }, { id: 'f', amount: 2 }], pot: 11 },
      { id: 2, t: 'split', shares: [{ id: 'me', amount: 6 }, { id: 'f', amount: 5 }] },
    ],
    piles: { me: 6, f: 5, l: 0 }, taken: [], eligible: [], deadline: null,
  },
});
// NEGOTIATE（地主胜·缺口）：全池归地主圈，农民圈红色债务牌可拖
const payoutDebt = mk({
  ...payoutBase, phase: 'NEGOTIATE', coinResult: 'heads',
  settlement: { coinResult: 'heads', pot: 11, landlordTake: 11, takes: { me: 0, f: 0 }, debts: { me: 2, f: 1 }, shortfall: 3, uncovered: 0, target: 12, events: [{ type: 'landlord_win_shortfall', target: 12, base: 1, shortfall: 3, uncovered: 0 }] },
  allocation: { takes: { me: 0, f: 0 }, debts: { me: 2, f: 1 }, confirms: [], deadline: null },
  payout: {
    script: [
      { id: 1, t: 'gather', from: [{ id: 'l', amount: 6 }, { id: 'me', amount: 3 }, { id: 'f', amount: 2 }], pot: 11 },
      { id: 2, t: 'split', shares: [{ id: 'l', amount: 11 }] },
    ],
    piles: { me: 0, f: 0, l: 11 }, taken: [], eligible: [], deadline: null,
  },
});
// FINALIZE 拿取：自己的堆浮「拿取 (F)」，f 已拿取、l 无份自动完成
const payoutTake = mk({
  ...payoutBase, phase: 'FINALIZE', coinResult: 'tails',
  settlement: { coinResult: 'tails', pot: 11, landlordTake: 0, takes: { me: 6, f: 5 }, debts: {}, uncovered: 0, events: [{ type: 'farmers_win', pot: 11 }] },
  payout: {
    script: [
      { id: 1, t: 'gather', from: [{ id: 'l', amount: 6 }, { id: 'me', amount: 3 }, { id: 'f', amount: 2 }], pot: 11 },
      { id: 2, t: 'split', shares: [{ id: 'me', amount: 6 }, { id: 'f', amount: 5 }] },
      { id: 3, t: 'adjust', source: 'wage', label: '发工资', flows: [{ from: { kind: 'void' }, to: { kind: 'pile', id: 'me' }, amount: 2 }] },
    ],
    piles: { me: 8, f: 0, l: 0 }, taken: ['f'], eligible: ['me', 'f'], deadline: null,
  },
  history: [{
    round: 2, coinResult: 'tails', bets: { me: 3, l: 6, f: 2 }, pot: 11,
    deltas: { me: 5, l: -6, f: 3 }, wagePaid: { me: 2 },
    landlordGoalValue: null, landlordPenalty: 0, uncovered: 0, collected: 0, newlyBankrupt: [],
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

// 断线横幅（本次新增）：!connected 时 UiLayer 顶部红色「连接已断开，正在重连…」横幅。
const disconnected = mk({
  phase: 'DISCUSSION',
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, balance: 12, ready: false },
    opp('l', '地主张', 'landlord', { hasBet: false, bet: null }),
    opp('f', '农民周', 'farmer', { hasBet: false, bet: null }),
  ],
  me: { id: 'me', role: 'farmer', balance: 12, ready: false, bounds: { minStake: 1 } },
});

// 观战者聊天频道（本次新增）：me 破产 → 只能发观战频道；〔观战〕标签 + 观> 前缀，活跃玩家看不到。
const spectatorChat = mk({
  phase: 'BETTING',
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, bankrupt: true, spectator: true, balance: 0 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('f', '农民周', 'farmer'),
  ],
  me: { id: 'me', role: 'farmer', balance: 0, bankrupt: true, spectator: true },
});
const spectatorChatLog = [
  { channel: 'public', from: 'l', name: '地主张', text: '快下注', ts: 1 },
  { channel: 'spectator', from: 'me', name: '我', text: '（观战）地主只剩 2 块，农民梭哈！', ts: 2 },
  { channel: 'spectator', from: 'x', name: '吃瓜群众', text: '稳了', ts: 3 },
];

// 新手即时教学卡（O0，本次新增）：quick 模式首次进入某阶段的一次性讲解。
const coachmarkScene = mk({
  phase: 'BETTING', mode: 'quick',
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, hasBet: false, bet: null, balance: 8 },
    opp('l', '地主张', 'landlord', { bet: 6 }),
    opp('f', '农民周', 'farmer'),
  ],
  me: { id: 'me', role: 'farmer', balance: 8, bet: null, bounds: { minStake: 1, min: 1, max: 7, forceAllIn: false } },
});

// 选角墙(HUD 2.0):快速模式两张招募令;LOBBY 进房自动升起,R/Esc 收起。
const quickWall = mk({
  phase: 'LOBBY', round: 0, mode: 'quick',
  players: [
    { id: 'me', name: '我', role: null, seat: 0, online: true, isHost: true },
    opp('l', '地主张', 'landlord', { hasBet: false, bet: null }),
  ],
  me: { id: 'me', role: null, isHost: true, balance: null },
  config: { ...base.config, maxFarmers: 4 },
});

// 酒馆账本(HUD 2.0):3 轮历史——农民胜(工资/饭账)、地主胜缺口补足、地主胜+破产。
const ledgerScene = mk({
  phase: 'DISCUSSION', round: 4,
  players: [
    { id: 'me', name: '我', role: 'farmer', seat: 0, online: true, isHost: true, balance: 9 },
    opp('l', '地主张', 'landlord', { hasBet: false, bet: null }),
    opp('g', '暴食李', 'glutton', { hasBet: false, bet: null, bankrupt: true }),
  ],
  me: { id: 'me', role: 'farmer', balance: 9, bounds: { minStake: 1 } },
  history: [
    {
      round: 1, coinResult: 'tails', bets: { me: 2, l: 5, g: 1 }, pot: 8, landlordTake: 0,
      takes: { me: 4, g: 4 }, debts: {}, uncovered: 0, collected: 0,
      landlordPenalty: 0, landlordGoalValue: null, landlordGoalMet: null,
      events: [{ type: 'farmers_win', pot: 8 }],
      deltas: { me: 6, l: -5, g: 1 }, newlyBankrupt: [],
      debtWaiver: 0, wagePaid: { me: 4 }, allowanceCharged: { g: 2 },
    },
    {
      round: 2, coinResult: 'heads', bets: { me: 1, l: 8, g: 2 }, pot: 11, landlordTake: 12,
      takes: {}, debts: { me: 1 }, uncovered: 0, collected: 1,
      landlordPenalty: 0, landlordGoalValue: null, landlordGoalMet: null,
      events: [{ type: 'landlord_win_shortfall', target: 12, shortfall: 1, uncovered: 0 }],
      deltas: { me: -2, l: 4, g: -2 }, newlyBankrupt: [],
      debtWaiver: 2, wagePaid: {}, allowanceCharged: {},
    },
    {
      round: 3, coinResult: 'heads', bets: { me: 2, l: 4, g: 3 }, pot: 9, landlordTake: 6,
      takes: {}, debts: {}, uncovered: 0, collected: 0,
      landlordPenalty: 0, landlordGoalValue: 29, landlordGoalMet: true,
      events: [{ type: 'landlord_win', target: 6, surplus: 3, landlordExtra: 2, farmerPool: 1 }],
      deltas: { me: -2, l: 6, g: -4 }, newlyBankrupt: ['g'],
      debtWaiver: 0, wagePaid: {}, allowanceCharged: {},
    },
  ],
});

const SCENES = [
  { key: 'avatars', label: '角色形象', kind: 'grid' },
  { key: 'notes', label: '钱牌', kind: 'grid' },
  { key: 'insSlot', label: '投保槽状态', kind: 'grid' },
  { key: 'lobby', label: '选角墙(竞技)', kind: 'game', state: lobby, note: '进大厅自动升起招募令墙;R/Esc 收起,点羊皮令应征;火漆印=已被占' },
  { key: 'roleWallQuick', label: '选角墙(快速)', kind: 'game', state: quickWall, note: '快速模式只有地主/农民两张招募令' },
  { key: 'ledger', label: '酒馆账本', kind: 'game', state: ledgerScene, panel: 'ledger', note: '桌沿抽屉 L 呼出;一行一轮(最新在上),点击摊开明细;他人余额保密' },
  { key: 'betting3d', label: '3D手牌·拖拽下注', kind: 'game', state: betting3d, note: '手牌真扇形捏在相机前(抬头渐收/低头微举,甩视角带惯性摆);短按点击=直接飞入圆圈,拖到圈=暂存,点圈内牌收回,长按拆分;圈外右侧保留金' },
  { key: 'fanHand', label: '3D手牌·满手扇形', kind: 'game', state: fanHand, note: '扇面平行层(绝无穿模);竖拉拽单张/横扫捋牌(只吸划过区段,捋起即跟手,¥合计随行);拖回怀里散回;圈内钱堆长按整堆拿起;短按点击=直接飞入圆圈' },
  { key: 'investorBet', label: '投资人投保圈', kind: 'game', state: investorBet, note: '3D 模式:圆圈左侧投保圈,拖牌进圈=投保、点保单牌收回(加 ?input=2d 可看旧 2D 槽)' },
  { key: 'insDrop', label: '投保掉落动画', kind: 'game', state: insDrop, note: '保单牌一张张掉出屏幕（循环演示）' },
  { key: 'reflip', label: '暴食者重掷/放弃', kind: 'game', state: reflip },
  { key: 'huds', label: '四类 HUD', kind: 'game', state: huds, note: '四类 HUD 已移到左上角房间号下,黑底半透明;右下角只留资金蜡烛' },
  { key: 'capitalistLoss', label: '资本家蜡烛变色', kind: 'game', state: capitalistLoss, note: '资本家上回合池亏损→右下角蜡烛应为红(个人本金恒定,须按资金池净变动判色)' },
  { key: 'ledgerCapitalist', label: '账本(资本家视角)', kind: 'game', state: ledgerCapitalist, panel: 'ledger', note: 'R1 我 +7(绿) / R2 我 −5(红)——摘要行与摘开明细的「我」都须走资金池净变动,不是恒 0 的 deltas.me' },
  { key: 'finalize', label: '结算播报', kind: 'game', state: finalize },
  { key: 'payoutSettle', label: '结算·分堆演出', kind: 'game', state: payoutSettle, note: '§3.8 聚拢→彩池→分堆→派送(农民胜 6/5);重进场景可重播' },
  { key: 'payoutNegotiate', label: '结算·协商拖拽', kind: 'game', state: payoutNegotiate, note: '3D 直接操作:重力枪拖自己的钱牌到队友圈=转移(长按拆分);圈上白字确认行(预览无后端,消息只打日志)' },
  { key: 'payoutDebt', label: '结算·债务标记', kind: 'game', state: payoutDebt, note: '地主胜缺口:全池归地主圈,农民圈内侧红色债务牌(3D 拖债给队友)' },
  { key: 'payoutTake', label: '结算·拿取(F)', kind: 'game', state: payoutTake, note: '钱留桌上,自己的堆浮纯文字「拿取 [F]」(与金额标签同款);农民周已拿取,地主无份自动完成' },
  { key: 'coin', label: '硬币', kind: 'game', state: coin },
  { key: 'balance', label: '资金增长动画', kind: 'game', state: balance, controls: 'balance' },
  { key: 'disconnected', label: '断线横幅', kind: 'game', state: disconnected, connected: false, note: '!connected → 顶部红色「连接已断开，正在重连…」横幅' },
  { key: 'spectatorChat', label: '观战聊天频道', kind: 'game', state: spectatorChat, chat: spectatorChatLog, chatOpen: true, note: '观战者只能发观战频道；〔观战〕标签 + 观> 前缀，活跃玩家看不到' },
  { key: 'coachmark', label: '新手讲解卡', kind: 'game', state: coachmarkScene, note: 'quick 模式首次进入阶段的一次性讲解(O0)；清 localStorage llg_onboarding 可重看' },
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

// 投保槽四态：核对堆叠式布局、钱框比例、can-drop/no-drop 反馈（拖拽态无法 headless 截图，用类名静态呈现）。
function InsSlotGrid() {
  const box = (label, cls, notes) => (
    <div className="gal-card">
      <div className="insurance-slot">
        <span className="ins-slot-label">投保 ¥{notes.reduce((s, v) => s + v, 0)}/3</span>
        <div className={`ins-dropzone ${cls}`}>
          <div className="ins-slot-notes">
            {notes.map((v, i) => (
              <span key={i} className="ins-slot-note" style={insStackStyle(i, notes.length)}>
                <MoneyNote value={v} width={62} />
              </span>
            ))}
            {notes.length === 0 && <span className="ins-slot-hint">拖牌入槽</span>}
          </div>
        </div>
      </div>
      <div className="gal-label">{label}</div>
    </div>
  );
  return (
    <div className="gal-grid">
      {box('空框', '', [])}
      {box('堆叠 1+1+1', '', [1, 1, 1])}
      {box('可投保 (can-drop)', 'can-drop', [2])}
      {box('超上限 (no-drop)', 'no-drop', [2, 1])}
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
    state: scene.state, playerId: 'me', connected: scene.connected ?? true, joining: false,
    chat: scene.chat ?? [], chatOpen: scene.chatOpen ?? false, insuranceDrops: [], betFlight: null, myStack: null, looks: {},
    panel: scene.panel ?? null, // 桌沿抽屉:场景可注入初始面板(LOBBY 场景由 UiLayer 自动升起选角墙)
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
      const y = window.innerHeight - 170;
      // 保单牌按手牌/投保槽实际尺寸掉落（不缩小，w=62），间距随之放宽。
      useGameStore.getState().dropInsurance([0, 1, 2].map(i => ({
        id: `d-${Date.now()}-${i}`, value: i === 1 ? 2 : 1, x: 120 + i * 74, y, w: 62, delay: i * 130, spin: (i % 2 ? 1 : -1) * 22,
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
          ? (scene.key === 'avatars' ? <AvatarGrid /> : scene.key === 'insSlot' ? <InsSlotGrid /> : <NotesGrid />)
          : <GameScreen key={key} />}
      </div>
      {scene.controls === 'balance' && <BalanceControls />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Gallery /></StrictMode>);
