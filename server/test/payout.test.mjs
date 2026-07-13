// 桌面显式结算（§3.8）整回合集成测试：真实 Room 相位机 + 小计时参数。
// 跑法：node server/test/payout.test.mjs
// 覆盖：农民胜（协商镜像/地主冻结视图/逐人拿取入账）、地主胜盈余、地主胜缺口（收账/压债破产/终局）、
// 拿取超时自动入账、离线代拿、竞技资本家本金归还与池换算/税/饭账的 adjust 步。

import assert from 'node:assert/strict';
import { Room } from '../Room.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeoutMs = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${what}`);
    await sleep(10);
  }
}

// 强制硬币结果（flipCoin 用 Math.random）：<0.5 = heads。
const realRandom = Math.random;
function forceCoin(result) { Math.random = () => (result === 'heads' ? 0.25 : 0.75); }
function restoreCoin() { Math.random = realRandom; }

// 极小计时：让相位机全速跑；takeTimeoutMs 留大以便手动拿取（个别用例单独覆盖）。
const FAST = {
  timing: {
    revealAnimMs: 1, coinAnimMs: 20, settleViewMs: 20, finalizeMs: 20,
    negotiateTimeoutMs: 60000, takeTimeoutMs: 60000, takeAutoDelayMs: 20,
    betMs: 60000, revealConfirmMs: 60000, // 下注/确认倒计时留大：测试全手动驱动（超时用例单独覆盖）
  },
};

// 建房 + 入座 + 选角 + 开局，返回 {room, ids:{L, farmers[]}}。玩家 ws=null（online 保持 true，全手动驱动）。
function setupRoom({ mode = 'quick', farmers = 2, config = {}, roles = null }) {
  const overrides = { ...config, timing: { ...FAST.timing, ...(config.timing ?? {}) } };
  const room = new Room('TEST', '测试房', mode, overrides);
  const L = room.addPlayer('房主', null).playerId;
  const fids = [];
  for (let i = 0; i < farmers; i++) fids.push(room.addPlayer(`农${i + 1}`, null).playerId);
  room.takeRole(L, roles?.landlord ?? 'landlord');
  fids.forEach((id, i) => room.takeRole(id, roles?.farmers?.[i] ?? 'farmer'));
  [L, ...fids].forEach(id => room.setLobbyReady(id, true)); // 全员准备（开局门槛，反馈①）
  assert.equal(room.startGame(L).ok, true);
  return { room, L, fids };
}

async function playToSettle(room, L, fids, bets, coin) {
  for (const p of [L, ...fids]) room.setReady(p);
  assert.equal(room.phase, 'BETTING');
  for (const p of [L, ...fids]) assert.equal(room.placeBet(p, bets[p]).ok, true, `下注失败 ${p}`);
  // 竞技：全员下注后若有农民凑得齐票会先进对质窗（§8.8）；默认测试路径全体农民跳过对质直达揭牌。
  if (room.phase === 'CHALLENGE') for (const id of fids) room.challengeSkip(id);
  assert.equal(room.phase, 'REVEAL');
  forceCoin(coin);
  for (const p of [L, ...fids]) room.confirmReveal(p);
  assert.equal(room.phase, 'COIN_FLIP');
  await until(() => room.phase !== 'COIN_FLIP', '硬币动画结束');
  restoreCoin();
}

// 驱动到对质窗（CHALLENGE，§8.8）：全员就绪 + 下注。竞技且有农民凑得齐票时下注后停在 CHALLENGE。
function playToChallenge(room, L, fids, bets) {
  for (const p of [L, ...fids]) room.setReady(p);
  assert.equal(room.phase, 'BETTING');
  for (const p of [L, ...fids]) assert.equal(room.placeBet(p, bets[p]).ok, true, `下注失败 ${p}`);
}

const stepSources = (room) => room.payout.script.filter(s => s.t === 'adjust').map(s => s.source);

// ---------------------------------------------------------------------------
await test('农民胜：脚本聚拢/分堆、协商镜像与地主冻结视图、逐人拿取才入账', async () => {
  const { room, L, fids: [A, B] } = setupRoom({ farmers: 2 });
  // 初始：农民 8/8，地主 floor(1.2×16)=19
  await playToSettle(room, L, [A, B], { [L]: 4, [A]: 2, [B]: 1 }, 'tails');
  assert.equal(room.phase, 'SETTLE');
  // 脚本：gather（3 家下注全进彩池）+ split（农民 4/3，地主无份）
  const [gather, split] = room.payout.script;
  assert.equal(gather.t, 'gather');
  assert.equal(gather.from.length, 3);
  assert.equal(gather.pot, 7);
  assert.equal(split.t, 'split');
  assert.deepEqual(split.shares.map(s => s.amount).sort((a, b) => b - a), [4, 3]);
  assert.equal(split.shares.find(s => s.id === L), undefined);

  await until(() => room.phase === 'NEGOTIATE', '进入协商');
  // 协商转移 1：农民/观战看到实时钱堆，地主看到冻结的系统方案
  const a4 = room.viewFor(A).payout.piles[A];
  room.negotiateTransfer(A, B, 'take', 1);
  assert.equal(room.viewFor(A).payout.piles[A], a4 - 1);
  assert.equal(room.viewFor(L).payout.piles[A], a4); // 地主冻结
  room.negotiateConfirm(A, true);
  room.negotiateConfirm(B, true);
  assert.equal(room.phase, 'FINALIZE');

  // 拿取前：余额未入账（仍为下注后的手上现钱）；eligible 只含有堆的人
  const pa = room.payout.piles[A], pb = room.payout.piles[B];
  assert.deepEqual([pa, pb].sort((a, b) => b - a), [4, 3]);
  assert.equal(room.players.get(A).balance, 6);
  assert.equal(room.players.get(B).balance, 7);
  assert.deepEqual([...room.payout.eligible].sort(), [A, B].sort());
  assert.equal(room.takePayout(L).error, '没有可拿取的钱');

  // 逐人拿取：此刻才入账
  assert.equal(room.takePayout(A).ok, true);
  assert.equal(room.players.get(A).balance, 6 + pa);
  assert.equal(room.payout.piles[A], 0);
  assert.equal(room.takePayout(A).error, '已经拿过了');
  assert.equal(room.players.get(B).balance, 7); // B 还没拿
  assert.equal(room.takePayout(B).ok, true);
  assert.equal(room.players.get(B).balance, 7 + pb);

  await until(() => room.phase === 'DISCUSSION', '进入下一回合');
  assert.equal(room.round, 2);
  // 守恒：本回合三家净变动之和为 0
  const d = room.history[0].deltas;
  assert.equal(d[L] + d[A] + d[B], 0);
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('地主胜·盈余：地主/盈余农民有堆可拿，无份农民自动完成', async () => {
  const { room, L, fids: [A, B] } = setupRoom({ farmers: 2 });
  await playToSettle(room, L, [A, B], { [L]: 4, [A]: 3, [B]: 1 }, 'heads');
  // target=round(4×1.5)=6，pot=8，盈余 2：地主抽成 round(2×0.5)=1（拿 7），盈余池 1 归下注高的 A
  await until(() => room.phase === 'NEGOTIATE', '进入协商');
  room.negotiateConfirm(A, true);
  room.negotiateConfirm(B, true);
  assert.equal(room.phase, 'FINALIZE');
  assert.equal(room.payout.piles[L], 7);
  assert.equal(room.payout.piles[A], 1);
  assert.deepEqual([...room.payout.eligible].sort(), [L, A].sort());
  room.takePayout(L);
  room.takePayout(A);
  await until(() => room.phase === 'DISCUSSION', '进入下一回合');
  assert.equal(room.players.get(L).balance, 15 + 7);
  assert.equal(room.players.get(A).balance, 5 + 1);
  assert.equal(room.players.get(B).balance, 7);
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('地主胜·缺口：协商压债给一人、FINALIZE 收账入地主堆、付光者破产、终局兜底', async () => {
  // 单挑：农民 4、地主 4（1.2×4 取整）。乘数固定 2 便于制造缺口。
  const { room, L, fids: [A] } = setupRoom({
    farmers: 1,
    config: { initialBalance: { farmer: 4 }, landlordAttrs: { landlord: { greed: 2, squeeze: 2 } } },
  });
  assert.equal(room.players.get(L).balance, 4);
  // L 押 3（target 6）、A 押 1 → pot 4 < 6，base 2 → 债 = 4；A 手上只剩 3 → 实付 3，uncovered 1
  await playToSettle(room, L, [A], { [L]: 3, [A]: 1 }, 'heads');
  // 单农民跳过协商，直接 FINALIZE
  await until(() => room.phase === 'FINALIZE', '跳过协商进入 FINALIZE');
  const collect = room.payout.script.find(s => s.source === 'debtCollect');
  assert.ok(collect, '应有收账步');
  assert.equal(collect.uncovered, 1);
  assert.deepEqual(collect.flows, [{ from: { kind: 'hand', id: A }, to: { kind: 'pile', id: L }, amount: 3 }]);
  assert.equal(room.players.get(A).balance, 0);       // 手上支出已入账
  assert.equal(room.players.get(A).bankrupt, false);  // 破产标记等拿取完成
  assert.equal(room.payout.piles[L], 4 + 3);          // pot + 实收
  assert.deepEqual(room.payout.eligible, [L]);
  room.takePayout(L);
  await until(() => room.phase === 'ENDED', '全农民破产终局');
  assert.equal(room.players.get(A).bankrupt, true);
  assert.equal(room.players.get(L).balance, 1 + 7);
  assert.equal(room.winnerSide, 'landlord');
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('拿取超时：到点未拿的自动入账并进入下一回合', async () => {
  const { room, L, fids: [A, B] } = setupRoom({
    farmers: 2,
    config: { timing: { takeTimeoutMs: 60 } },
  });
  await playToSettle(room, L, [A, B], { [L]: 4, [A]: 2, [B]: 1 }, 'tails');
  await until(() => room.phase === 'NEGOTIATE', '进入协商');
  room.negotiateConfirm(A, true);
  room.negotiateConfirm(B, true);
  assert.equal(room.phase, 'FINALIZE');
  await until(() => room.phase === 'DISCUSSION', '超时自动拿取后进入下一回合');
  assert.equal(room.players.get(A).balance + room.players.get(B).balance, 6 + 7 + 7); // 手上 13 + pot 7
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('离线代拿：takeAutoDelayMs 后自动替离线玩家拿取', async () => {
  const { room, L, fids: [A, B] } = setupRoom({ farmers: 2 });
  await playToSettle(room, L, [A, B], { [L]: 4, [A]: 2, [B]: 1 }, 'tails');
  await until(() => room.phase === 'NEGOTIATE', '进入协商');
  room.players.get(B).online = false; // 模拟断线（宽限 0=永久保座）
  room.negotiateConfirm(A, true);
  assert.equal(room.phase, 'FINALIZE'); // B 离线自动通过协商闸门
  assert.equal(room.takePayout(A).ok, true);
  await until(() => room.phase === 'DISCUSSION', '离线者被代拿后进入下一回合');
  assert.equal(room.players.get(B).balance, 7 + 3); // tie=highestBet：4 归 A，B 得 3
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('竞技资本家：本金留堆归还、盈亏差额走池、税收/饭账产出 adjust 步', async () => {
  // 资本家 + 单暴食者：农民胜 → 池垫付本金、扣税、结饭账
  const { room, L: C, fids: [G] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'capitalist', farmers: ['glutton'] },
  });
  const cap = room.players.get(C);
  assert.equal(cap.balance, 8);  // 钱包 = 6×1 + round(20×0.1) = 8
  assert.equal(cap.pool, 20);
  await playToSettle(room, C, [G], { [C]: 2, [G]: 1 }, 'tails');
  await until(() => room.phase === 'FINALIZE', '单农民跳协商');
  // pot 3 全归暴食者；资本家堆 0 → 池垫付本金 2；池 20−2=18（1 农民间隔=max(2,1)=2 → 回合 1 不征税）；
  // 暴食者饭账 1 从堆里扣
  assert.deepEqual(stepSources(room), ['capitalistPool', 'mealAllowance']);
  assert.equal(room.payout.piles[C], 2);      // 本金留堆
  assert.equal(room.payout.piles[G], 3 - 1);  // take 3 − 饭账 1
  assert.equal(cap.pool, 18);
  room.takePayout(C);
  room.takePayout(G);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  assert.equal(cap.balance, 8);                          // 本回合钱包 8（本金必归还）
  assert.equal(room.players.get(G).balance, 7 + 3 - 1);  // 押1后7 + take3 − 饭账1
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('竞技资本家：盈余入池步（heads 全覆盖）', async () => {
  const { room, L: C, fids: [F] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'capitalist', farmers: ['farmer'] },
  });
  await playToSettle(room, C, [F], { [C]: 2, [F]: 1 }, 'heads');
  await until(() => room.phase === 'FINALIZE', '单农民跳协商');
  // target round(2×1.6)=round(3.2)=3 = pot → landlordTake 3；堆 3 − 本金 2 = 盈余 1 入池；
  // 1 农民 → 间隔 max(2,1)=2 → 回合 1 不征税，池 = 20 + 盈余 1
  const pool = room.payout.script.find(s => s.source === 'capitalistPool');
  assert.deepEqual(pool.flows, [{ from: { kind: 'pile', id: C }, to: { kind: 'pool', id: C }, amount: 1 }]);
  assert.equal(room.payout.piles[C], 2);
  assert.equal(room.players.get(C).pool, 20 + 1);
  room.takePayout(C);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  assert.equal(room.players.get(C).balance, 8);  // 本回合钱包 = 6×1+round(20×0.1) = 8
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('竞技资本家税·间隔制：2 农民 → 回合 1 不征税（round%interval≠0）', async () => {
  // 征税间隔 = 农民人数 = 2；回合 1：1%2≠0 → 不征税（旧版每回合都扣，此为新行为的守卫）。
  const { room, L: C, fids: [A, B] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'capitalist', farmers: ['farmer', 'farmer'] },
  });
  // 资本家押 4 → target round(4×1.6)=round(6.4)=6；两农民各押 1 → pot=6=target（无溢余/无缺口）。heads 农民无所得可分。
  await playToSettle(room, C, [A, B], { [C]: 4, [A]: 1, [B]: 1 }, 'heads');
  await until(() => room.phase !== 'SETTLE', '离开系统结算');
  if (room.phase === 'NEGOTIATE') { room.negotiateConfirm(A, true); room.negotiateConfirm(B, true); }
  await until(() => room.phase === 'FINALIZE', '进入结算入账');
  assert.ok(!stepSources(room).includes('capitalistTax'), '回合 1（间隔 2）不应出现征税步');
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('相对目标：检查点未达标→扣 round(余额×10%)、平分农民、按罚后余额重定基', async () => {
  // 强制间隔=1 → 第 1 回合即检查点。L 初始 9、目标 round(9×1.1)=10；农民胜让 L 输光下注→远低于目标。
  const { room, L, fids: [A] } = setupRoom({
    farmers: 1,
    config: { landlordGoal: { interval: { min: 1, max: 1, mean: 1, sd: 0.001 } } },
  });
  assert.equal(room.goalTarget, 10);     // round(9 × 1.1)
  assert.equal(room.goalNextRound, 1);   // 间隔 clamp 到 1
  await playToSettle(room, L, [A], { [L]: 4, [A]: 2 }, 'tails'); // 农民胜：L 9−4=5
  await until(() => room.phase === 'FINALIZE', '单农民跳协商');
  room.takePayout(A);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  assert.equal(room.players.get(L).balance, 3);   // 9 − 下注 4 − 罚 max(2,round(5×0.1)=1)=2
  assert.equal(room.players.get(A).balance, 14);  // 8 − 2 + pot 6 + 罚金 2
  const h = room.history[room.history.length - 1];
  assert.equal(h.landlordGoalValue, 10);
  assert.equal(h.landlordGoalMet, false);
  assert.equal(h.landlordPenalty, 2);
  assert.equal(room.goalTarget, 3);      // 重定基：round(罚后 3 × 1.1)=round(3.3)=3
  assert.equal(room.goalNextRound, 2);   // 回合 1 + 间隔 1
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质命中地主：FINALIZE 强制目标评估、罚金、**不重定基**（间隔不变）', async () => {
  // 排期检查点在回合 5，本回合(1)非排期；对质命中 → 仅靠 _forceGoalCheckpoint 触发一次评估。
  const { room, L, fids: [A] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'landlord', farmers: ['farmer'] },
    config: { landlordGoal: { interval: { min: 5, max: 5, mean: 5, sd: 0.001 } } },
  });
  assert.equal(room.goalNextRound, 5);
  const target = room.goalTarget;                    // round(30×1.1)=33
  playToChallenge(room, L, [A], { [L]: 4, [A]: 1 }); // 地主 4 > 阵营 1
  assert.equal(room.phase, 'CHALLENGE');
  assert.equal(room.players.get(A).tickets, 3);
  assert.equal(room.accuse(A, L).ok, true);
  assert.equal(room.players.get(A).tickets, 1);      // 恒扣 2
  assert.equal(room.accuseResolve(A, 'more').ok, true); // 命中
  assert.equal(room.phase, 'REVEAL');
  forceCoin('tails'); for (const p of [L, A]) room.confirmReveal(p);
  await until(() => room.phase === 'FINALIZE', '单农民跳协商进 FINALIZE'); restoreCoin();
  room.takePayout(A);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  const h = room.history[room.history.length - 1];
  assert.equal(h.landlordGoalValue, target);
  assert.equal(h.landlordGoalMet, false);
  assert.ok(h.landlordPenalty > 0, '应有强制罚金');
  assert.equal(room.goalNextRound, 5);               // **不重定基**：排期仍在回合 5
  assert.equal(room.goalTarget, target);
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质命中资本家：回合1(间隔2 本无税)被强制额外扣一次税、资金池下降', async () => {
  const { room, L: C, fids: [A, B] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'capitalist', farmers: ['farmer', 'farmer'] },
  });
  assert.equal(room.players.get(C).pool, 40);
  playToChallenge(room, C, [A, B], { [C]: 4, [A]: 1, [B]: 1 }); // 资本家 4 > 阵营 2
  assert.equal(room.accuse(A, C).ok, true);
  assert.equal(room.accuseResolve(A, 'more').ok, true);          // 命中 → _forceTax
  forceCoin('heads'); for (const p of [C, A, B]) room.confirmReveal(p);
  await until(() => ['NEGOTIATE', 'FINALIZE'].includes(room.phase), '进结算');
  if (room.phase === 'NEGOTIATE') { room.negotiateConfirm(A, true); room.negotiateConfirm(B, true); }
  await until(() => room.phase === 'FINALIZE', '进 FINALIZE'); restoreCoin();
  assert.ok(stepSources(room).includes('capitalistTax'), '强制税步应出现（回合1本无排期税）');
  const h = room.history[room.history.length - 1];
  assert.ok(h.capitalistTax > 0, '强制税额 > 0');
  assert.ok(room.players.get(C).pool < 40 + 2, '资金池被强制税拉低');
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质落空：不置强制、目标日程/罚金不受影响，票仍恒扣 2', async () => {
  const { room, L, fids: [A] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'landlord', farmers: ['farmer'] },
    config: { landlordGoal: { interval: { min: 5, max: 5, mean: 5, sd: 0.001 } } },
  });
  playToChallenge(room, L, [A], { [L]: 4, [A]: 1 });   // 地主 4 > 阵营 1
  assert.equal(room.accuse(A, L).ok, true);
  assert.equal(room.accuseResolve(A, 'less').ok, true); // 喊「少」→ 4<1 假 → 落空
  assert.equal(room.players.get(A).tickets, 1);         // 猜错也扣 2
  forceCoin('tails'); for (const p of [L, A]) room.confirmReveal(p);
  await until(() => room.phase === 'FINALIZE', '进 FINALIZE'); restoreCoin();
  room.takePayout(A);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  const h = room.history[room.history.length - 1];
  assert.equal(h.landlordGoalValue ?? null, null);      // 未触发检查点
  assert.equal(h.landlordPenalty ?? 0, 0);
  assert.equal(room.goalNextRound, 5);                  // 日程不变
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质命中且本回合恰为排期检查点：只评估一次、走排期重定基（不双罚）', async () => {
  const { room, L, fids: [A] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'landlord', farmers: ['farmer'] },
    config: { landlordGoal: { interval: { min: 1, max: 1, mean: 1, sd: 0.001 } } },
  });
  assert.equal(room.goalNextRound, 1);                 // 排期在回合 1
  const target = room.goalTarget;
  playToChallenge(room, L, [A], { [L]: 4, [A]: 1 });
  assert.equal(room.accuse(A, L).ok, true);
  assert.equal(room.accuseResolve(A, 'more').ok, true); // 命中 + 本回合排期
  forceCoin('tails'); for (const p of [L, A]) room.confirmReveal(p);
  await until(() => room.phase === 'FINALIZE', '进 FINALIZE'); restoreCoin();
  room.takePayout(A);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  const h = room.history[room.history.length - 1];
  assert.equal(h.landlordGoalValue, target);
  assert.ok(h.landlordPenalty > 0);
  assert.equal(room.goalNextRound, 2);                 // 排期检查点 → 正常重定基到回合 2
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质票经济：投资者2票→指控一次即用尽；取消不退、票<2 无法再发起；全跳过揭牌', async () => {
  const { room, L, fids: [I] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'landlord', farmers: ['investor'] },
  });
  playToChallenge(room, L, [I], { [L]: 4, [I]: 1 });
  assert.equal(room.phase, 'CHALLENGE');               // 投资者 2 票 ≥ cost 2 → 有对质窗
  assert.equal(room.viewFor(I).me.canAccuse, true);
  assert.equal(room.accuse(I, L).ok, true);
  assert.equal(room.players.get(I).tickets, 0);        // 恒扣 2
  assert.equal(room.accuseCancel(I).ok, true);         // 取消 → 回决定窗，票不退
  assert.equal(room.phase, 'CHALLENGE');
  assert.equal(room.accuse(I, L).error, '对质票不足');
  assert.equal(room.viewFor(I).me.canAccuse, false);
  assert.equal(room.challengeSkip(I).ok, true);        // 无人能再指控 → 跳过直达揭牌
  assert.equal(room.phase, 'REVEAL');
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质预选（accuse_pick 两段确认）：pendingDir 农民可见/地主不可见、可改选、仅发起者', async () => {
  const { room, L, fids: [A, B] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'landlord', farmers: ['farmer', 'farmer'] },
  });
  playToChallenge(room, L, [A, B], { [L]: 4, [A]: 1, [B]: 1 });
  assert.equal(room.accusePick(A, 'more').error, '你没有进行中的指控'); // 未指控不可预选
  assert.equal(room.accuse(A, L).ok, true);
  assert.equal(room.accusePick(B, 'more').error, '你没有进行中的指控'); // 非发起者不可预选
  assert.equal(room.accusePick(A, 'bogus').error, '无效的指控方向');
  assert.equal(room.accusePick(A, 'more').ok, true);
  assert.equal(room.viewFor(A).challenge.accusation.pendingDir, 'more');
  assert.equal(room.viewFor(B).challenge.accusation.pendingDir, 'more');   // 队友同步可见
  assert.equal(room.viewFor(L).challenge.accusation.pendingDir, undefined); // 地主不可见
  assert.equal(room.accusePick(A, 'less').ok, true);                        // 可反复改选
  assert.equal(room.viewFor(B).challenge.accusation.pendingDir, 'less');
  assert.equal(room.accuseResolve(A, 'less').ok, true);                     // 第二击落定
  assert.equal(room.phase, 'REVEAL');
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('无票自动跳过对质：单暴食者(0票) 下注后直达揭牌（不进 CHALLENGE）', async () => {
  const { room, L: C, fids: [G] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'capitalist', farmers: ['glutton'] },
  });
  for (const p of [C, G]) room.setReady(p);
  for (const p of [C, G]) room.placeBet(p, 2);
  assert.equal(room.phase, 'REVEAL');                  // 暴食者 0 票 → 无人可指控 → 跳过 CHALLENGE
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('对质票转赠（NEGOTIATE）：农民互转、重置确认、可用余额校验', async () => {
  const { room, L, fids: [A, B] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'landlord', farmers: ['farmer', 'farmer'] },
  });
  await playToSettle(room, L, [A, B], { [L]: 4, [A]: 2, [B]: 1 }, 'tails'); // 内含跳过对质
  await until(() => room.phase === 'NEGOTIATE', '进协商');
  assert.equal(room.players.get(A).tickets, 3);
  assert.equal(room.players.get(B).tickets, 3);
  room.negotiateConfirm(A, true);
  assert.equal(room.transferTicket(A, B, 1).ok, true);
  assert.equal(room.players.get(A).tickets, 2);
  assert.equal(room.players.get(B).tickets, 4);
  assert.equal(room.players.get(A).negotiateConfirmed, false); // 转赠重置确认
  assert.equal(room.transferTicket(A, B, 5).error, '对质票不足');
  room.destroy();
});

// ---------------------------------------------------------------------------
// 检察官·传唤（§8.9）：驱动一个完整回合（含对质跳过/协商确认/全员拿取），返回时已进下一回合 DISCUSSION。
async function playRoundThrough(room, ids, bets, coin, { beforeBet = null } = {}) {
  for (const p of ids) room.setReady(p);
  assert.equal(room.phase, 'BETTING');
  if (beforeBet) beforeBet();
  for (const p of ids) assert.equal(room.placeBet(p, bets[p]).ok, true, `下注失败 ${p}`);
  if (room.phase === 'CHALLENGE') for (const id of ids) if (room.roundFarmerIds.includes(id)) room.challengeSkip(id);
  assert.equal(room.phase, 'REVEAL');
  forceCoin(coin);
  for (const p of ids) room.confirmReveal(p);
  await until(() => ['SETTLE', 'NEGOTIATE', 'FINALIZE'].includes(room.phase), '进结算');
  restoreCoin();
  await until(() => room.phase === 'NEGOTIATE' || room.phase === 'FINALIZE', '协商或直达');
  if (room.phase === 'NEGOTIATE') for (const id of room.roundFarmerIds) room.negotiateConfirm(id, true);
  await until(() => room.phase === 'FINALIZE', '进 FINALIZE');
  for (const id of room.payout.eligible) room.takePayout(id);
  await until(() => room.phase === 'DISCUSSION' || room.phase === 'ENDED', '下一回合');
}

await test('检察官传唤地主（§8.9）：双倍罚上缴国库（不分农民）、重定基+重抽间隔、同回合互斥、递增费门槛', async () => {
  const { room, L, fids: [P, A] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'landlord', farmers: ['prosecutor', 'farmer'] },
    config: { landlordGoal: { interval: { min: 5, max: 5, mean: 5, sd: 0.001 } } },
  });
  // 初始：P=4, A=15 → 地主 = 2×19 = 38；目标 = round(38×1.1) = 42、排期检查点在回合 5
  assert.equal(room.players.get(P).balance, 4);
  assert.equal(room.players.get(P).tickets, 4);
  assert.equal(room.players.get(L).balance, 38);
  assert.equal(room.goalTarget, 42);
  assert.equal(room.goalNextRound, 5);
  const ids = [L, P, A];
  await playRoundThrough(room, ids, { [L]: 2, [P]: 1, [A]: 1 }, 'tails', {
    beforeBet: () => {
      assert.equal(room.summon(A).error, '只有检察官可以传唤');       // 非检察官不可传
      assert.equal(room.viewFor(P).me.canSummon, true);
      assert.equal(room.viewFor(P).me.summonCost, 2);                 // 首费 = 农民数 2
      assert.equal(room.summon(P).ok, true);
      assert.equal(room.players.get(P).balance, 2);                   // 4 − 2（费进虚空）
      assert.equal(room.summon(P).error, '本回合已传唤');
      assert.equal(room.viewFor(P).me.canSummon, false);
      assert.ok(room.lastSummon && room.lastSummon.targetId === L);
    },
  });
  // 结算账目：tails 农民胜、彩池=全部注 4（L2+P1+A1）均分 2/2。地主 38−2=36 < 42 →
  // 传唤双倍罚 = 2×max(2, round(3.6)) = 8 → 28。罚款上缴国库：P/A 一分不进。
  assert.equal(room.players.get(L).balance, 28);
  assert.equal(room.players.get(P).balance, 3);                       // 2−1+2（无罚金分成）
  assert.equal(room.players.get(A).balance, 16);                      // 15−1+2（无罚金分成）
  const h = room.history[room.history.length - 1];
  assert.equal(h.landlordGoalValue, 42);
  assert.equal(h.landlordGoalMet, false);
  assert.equal(h.landlordPenalty, 8);
  // 传唤 = 正式考核提前开庭：重定基（28）+ 重抽间隔（下检查点 = 1+5 = 6）
  assert.equal(room.goalBaseline, 28);
  assert.equal(room.goalTarget, Math.round(28 * 1.1));
  assert.equal(room.goalNextRound, 6);
  // 回合 2：递增费 = round(2×1.5) = 3；P 余额 2 < 3+1 → 资金不足
  for (const p of ids) room.setReady(p);
  assert.equal(room.round, 2);
  assert.equal(room.viewFor(P).me.summonCost, 3);
  assert.match(room.summon(P).error ?? '', /资金不足/);
  room.destroy();
});

await test('检察官同回合互斥：传唤后当回合不能再发起对质', async () => {
  const { room, L, fids: [P, A] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'landlord', farmers: ['prosecutor', 'farmer'] },
  });
  for (const p of [L, P, A]) room.setReady(p);
  assert.equal(room.summon(P).ok, true);
  for (const p of [L, P, A]) room.placeBet(p, p === L ? 2 : 1);
  assert.equal(room.phase, 'CHALLENGE');
  assert.equal(room.viewFor(P).me.canAccuse, false);                  // 入口同步隐藏（BUG 回归：曾只有 accuse() 硬闸门）
  assert.equal(room.viewFor(A).me.canAccuse, true);                   // 队友入口不受影响
  assert.equal(room.accuse(P, L).error, '本回合已传唤，不能再发起对质');
  assert.equal(room.accuse(A, L).ok, true);                           // 队友照常可指控
  room.destroy();
});

await test('检察官传唤后若无其他农民有票：不开对质空窗，直接揭牌', async () => {
  const { room, L, fids: [P, G] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'landlord', farmers: ['prosecutor', 'glutton'] },
  });
  for (const p of [L, P, G]) room.setReady(p);
  assert.equal(room.summon(P).ok, true);
  for (const p of [L, P, G]) room.placeBet(p, p === L ? 2 : 1);
  assert.equal(room.phase, 'REVEAL'); // 暴食者 0 票、检察官已传唤不可对质 → 15s 决定窗没人能用，跳过
  room.destroy();
});

await test('检察官传唤·下注后不可传 + 快速模式不可传', async () => {
  const { room, L, fids: [P] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'landlord', farmers: ['prosecutor'] },
  });
  for (const p of [L, P]) room.setReady(p);
  room.placeBet(P, 1);
  assert.equal(room.summon(P).error, '请在自己下注前传唤');
  room.destroy();
  const q = setupRoom({ farmers: 1 });
  for (const p of [q.L, ...q.fids]) q.room.setReady(p);
  assert.equal(q.room.summon(q.fids[0]).error, '仅竞技模式可传唤');
  q.room.destroy();
});

await test('检察官传唤资本家（§8.9）：双倍税 + 税钟锚点归零（下轮不征、隔轮再征）', async () => {
  const { room, L: C, fids: [P, A] } = setupRoom({
    mode: 'competitive', farmers: 2,
    roles: { landlord: 'capitalist', farmers: ['prosecutor', 'farmer'] },
  });
  assert.equal(room.players.get(C).pool, 40);                         // 池 = 2×20
  const ids = [C, P, A];
  // 回合 1：传唤 → tails 资本家输 1 → 池 39 → 传唤双倍税 = 2×max(2, round(3.9)) = 8 → 31；锚=1
  await playRoundThrough(room, ids, { [C]: 1, [P]: 1, [A]: 1 }, 'tails', {
    beforeBet: () => { assert.equal(room.summon(P).ok, true); },
  });
  assert.equal(room.players.get(C).pool, 31);
  assert.equal(room.taxAnchorRound, 1);
  // 此刻已进回合 2 的 DISCUSSION：锚=1、间隔 2 → 下次税在回合 3，距今 1 回合（排期的回合 2 被锚跳过）
  assert.equal(room.viewFor(C).capitalist.taxRoundsToNext, 1);
  // 回合 2：本该排期征税（2%2==0）但锚=1 → 不征。tails 输 1 → 池 30
  await playRoundThrough(room, ids, { [C]: 1, [P]: 1, [A]: 1 }, 'tails');
  assert.equal(room.players.get(C).pool, 30);
  // 回合 3：距锚 2 回合 → 征税 max(2, round(2.9)) = 3。tails 输 1 → 29 − 3 = 26
  await playRoundThrough(room, ids, { [C]: 1, [P]: 1, [A]: 1 }, 'tails');
  assert.equal(room.players.get(C).pool, 26);
  room.destroy();
});

await test('下注超时（timing.betMs）：到点未下注全员自动押最小注并推进 + 系统播报', async () => {
  const { room, L, fids: [A, B] } = setupRoom({ farmers: 2, config: { timing: { betMs: 50 } } });
  for (const p of [L, A, B]) room.setReady(p);
  assert.equal(room.phase, 'BETTING');
  assert.equal(typeof room.viewFor(A).betDeadline, 'number');          // 倒计时对客户端可见
  await until(() => room.phase !== 'BETTING', '下注超时自动推进');
  assert.equal(room.phase, 'REVEAL');
  assert.deepEqual(room.bets, { [L]: 2, [A]: 1, [B]: 1 });             // 地主最小注=农民数×1，农民=1
  assert.equal(room.players.get(L).balance, 19 - 2);
  assert.equal(room.players.get(A).balance, 8 - 1);
  assert.ok(room.chatLog.some(m => m.system && m.text.includes('超时未下注')));
  assert.equal(room.viewFor(A).betDeadline, null);                     // 出相位即隐藏
  room.destroy();
});

await test('揭牌确认超时（timing.revealConfirmMs）：到点自动全员确认、直接进掷币', async () => {
  const { room, L, fids: [A, B] } = setupRoom({ farmers: 2, config: { timing: { revealConfirmMs: 50 } } });
  for (const p of [L, A, B]) room.setReady(p);
  for (const p of [L, A, B]) assert.equal(room.placeBet(p, p === L ? 2 : 1).ok, true);
  assert.equal(room.phase, 'REVEAL');
  assert.equal(typeof room.viewFor(A).revealDeadline, 'number');
  forceCoin('tails');
  room.confirmReveal(A);                                               // 只有一人确认，其余靠超时代确认
  assert.equal(room.phase, 'REVEAL');
  await until(() => room.phase !== 'REVEAL', '确认超时自动掷币');
  assert.equal(room.phase, 'COIN_FLIP');
  await until(() => room.phase !== 'COIN_FLIP', '硬币动画结束');
  restoreCoin();
  assert.equal(room.phase, 'SETTLE');
  room.destroy();
});

console.log(`\n全部通过：${passed} 项 ✅`);
