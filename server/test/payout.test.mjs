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
  assert.equal(room.startGame(L).ok, true);
  return { room, L, fids };
}

async function playToSettle(room, L, fids, bets, coin) {
  for (const p of [L, ...fids]) room.setReady(p);
  assert.equal(room.phase, 'BETTING');
  for (const p of [L, ...fids]) assert.equal(room.placeBet(p, bets[p]).ok, true, `下注失败 ${p}`);
  assert.equal(room.phase, 'REVEAL');
  forceCoin(coin);
  for (const p of [L, ...fids]) room.confirmReveal(p);
  assert.equal(room.phase, 'COIN_FLIP');
  await until(() => room.phase !== 'COIN_FLIP', '硬币动画结束');
  restoreCoin();
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
  await playToSettle(room, L, [A, B], { [L]: 4, [A]: 2, [B]: 1 }, 'heads');
  // target=6，pot=7：地主拿 6，盈余 1 归下注高的 A
  await until(() => room.phase === 'NEGOTIATE', '进入协商');
  room.negotiateConfirm(A, true);
  room.negotiateConfirm(B, true);
  assert.equal(room.phase, 'FINALIZE');
  assert.equal(room.payout.piles[L], 6);
  assert.equal(room.payout.piles[A], 1);
  assert.deepEqual([...room.payout.eligible].sort(), [L, A].sort());
  room.takePayout(L);
  room.takePayout(A);
  await until(() => room.phase === 'DISCUSSION', '进入下一回合');
  assert.equal(room.players.get(L).balance, 15 + 6);
  assert.equal(room.players.get(A).balance, 6 + 1);
  assert.equal(room.players.get(B).balance, 7);
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('地主胜·缺口：协商压债给一人、FINALIZE 收账入地主堆、付光者破产、终局兜底', async () => {
  // 单挑：农民 4、地主 4（1.2×4 取整）。乘数固定 2 便于制造缺口。
  const { room, L, fids: [A] } = setupRoom({
    farmers: 1,
    config: { initialBalance: { farmer: 4 }, landlordWinMultiplier: 2 },
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
  assert.equal(cap.balance, 4);  // 个人 = 1 农民 × 4
  assert.equal(cap.pool, 10);
  await playToSettle(room, C, [G], { [C]: 2, [G]: 1 }, 'tails');
  await until(() => room.phase === 'FINALIZE', '单农民跳协商');
  // pot 3 全归暴食者；资本家堆 0 → 池垫付本金 2；池 10−2−税2=6；暴食者饭账 1 从堆里扣
  assert.deepEqual(stepSources(room), ['capitalistPool', 'capitalistTax', 'mealAllowance']);
  assert.equal(room.payout.piles[C], 2);      // 本金留堆
  assert.equal(room.payout.piles[G], 3 - 1);  // take 3 − 饭账 1
  assert.equal(cap.pool, 6);
  room.takePayout(C);
  room.takePayout(G);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  assert.equal(cap.balance, 4);                          // 个人资金恒定
  assert.equal(room.players.get(G).balance, 5 + 3 - 1);  // 押1后5 + take3 − 饭账1
  room.destroy();
});

// ---------------------------------------------------------------------------
await test('竞技资本家：盈余入池步（heads 全覆盖）', async () => {
  const { room, L: C, fids: [F] } = setupRoom({
    mode: 'competitive', farmers: 1,
    roles: { landlord: 'capitalist', farmers: ['farmer'] },
  });
  await playToSettle(room, C, [F], { [C]: 3, [F]: 1 }, 'heads');
  await until(() => room.phase === 'FINALIZE', '单农民跳协商');
  // target floor(4.5)=4 = pot → landlordTake 4；堆 4 − 本金 3 = 盈余 1 入池；税 max(2, ⌊11×0.1⌋)=2
  const pool = room.payout.script.find(s => s.source === 'capitalistPool');
  assert.deepEqual(pool.flows, [{ from: { kind: 'pile', id: C }, to: { kind: 'pool', id: C }, amount: 1 }]);
  assert.equal(room.payout.piles[C], 3);
  assert.equal(room.players.get(C).pool, 10 + 1 - 2);
  room.takePayout(C);
  await until(() => room.phase === 'DISCUSSION', '下一回合');
  assert.equal(room.players.get(C).balance, 4);
  room.destroy();
});

console.log(`\n全部通过：${passed} 项 ✅`);
