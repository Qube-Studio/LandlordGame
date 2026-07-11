// 单人模式会话层测试（§9.6）：多人同形 state 适配 + 意图路由 + 掷币演出节拍。
// 跑法：node server/test/singleSession.test.mjs
import assert from 'node:assert/strict';
import { SingleSession, SINGLE_INTENTS } from '../single/session.js';
import { Room } from '../Room.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const seq = (...vals) => { let i = 0; return () => { const v = vals[Math.min(i, vals.length - 1)]; i++; return v; }; };

// 收集广播的 state；coinAnimMs 压到 15ms 让演出节拍可测。
function mkSession({ teamRoles, rng, ghost = false, persona }) {
  const pushes = [];
  const s = new SingleSession({
    teamRoles, persona, ghost, rng,
    configOverrides: { timing: { coinAnimMs: 15 } },
    send: (m) => pushes.push(m),
  });
  return { s, pushes, last: () => pushes[pushes.length - 1]?.state };
}

await test('整局流：BETTING → 席位切换逐座下注 → COIN_FLIP 演出 → NEGOTIATE → 确认 → 回合2', async () => {
  const { s, last } = mkSession({ teamRoles: ['farmer', 'farmer'], rng: seq(0.0) });
  let v = s.view();
  assert.equal(v.phase, 'BETTING');
  assert.equal(v.mode, 'single');
  assert.equal(v.players.length, 3);                       // 2 席位 + Boss
  assert.equal(v.players[2].role, 'landlord');
  assert.equal(v.me.id, 's0');
  assert.ok(v.me.bounds.min >= 1);
  // 席位 s0 下注 → 切席 s1 下注 → 自动 resolve → 演出锁
  assert.equal(s.handle('place_bet', { amount: 3 }).ok, true);
  assert.equal(s.handle('single_seat', { seatId: 's1' }).ok, true);
  assert.equal(s.handle('place_bet', { amount: 2 }).ok, true);
  v = last();
  assert.equal(v.phase, 'COIN_FLIP');                      // 掷币演出叠加相位
  assert.equal(v.coinResult, 'tails');                     // 0.0 < 0.5 → 队胜
  assert.match(s.handle('place_bet', { amount: 1 }).error, /掷硬币中/); // 演出期间锁操作
  await sleep(40);
  v = last();
  assert.equal(v.phase, 'NEGOTIATE');                      // 队胜有收益可分 → 协商
  assert.ok(v.allocation && v.allocation.takes);
  assert.ok(v.payout && v.payout.piles);
  assert.equal(v.pot, 3 + 2 + 23);                         // 掷币后彩池公开
  // 协商：当前席位 s1 把收益挪 3 给 s0 → 确认落账 → 回合 2
  const t1 = v.allocation.takes.s1;
  assert.ok(t1 >= 3);                                      // 28 均分 → 14
  assert.equal(s.handle('negotiate_transfer', { toId: 's0', amount: 3, kind: 'take' }).ok, true);
  const v2 = last();
  assert.equal(v2.allocation.takes.s0, v.allocation.takes.s0 + 3);
  assert.equal(s.handle('negotiate_transfer', { toId: 's0', amount: 999, kind: 'take' }).error, '可转移的数额不足');
  assert.equal(s.handle('negotiate_confirm', {}).ok, true);
  v = last();
  assert.equal(v.phase, 'BETTING');
  assert.equal(v.round, 2);
});

await test('与多人 viewFor 形状对齐：单机 state 含多人顶层全部键', () => {
  // 真实 Room 竞技局的 viewFor 键集为基准（客户端组件按这些键取数）
  const room = new Room('T', 't', 'competitive', {});
  const L = room.addPlayer('地主', null).playerId;
  const F = room.addPlayer('农', null).playerId;
  room.takeRole(L, 'landlord'); room.takeRole(F, 'farmer');
  [L, F].forEach(id => room.setLobbyReady(id, true));
  room.startGame(L);
  const roomKeys = Object.keys(room.viewFor(F));
  room.destroy();
  const { s } = mkSession({ teamRoles: ['farmer'], rng: seq(0.0) });
  const v = s.view();
  const missing = roomKeys.filter(k => !(k in v));
  assert.deepEqual(missing, [], `单机 state 缺键：${missing.join(',')}`);
  // players[] 与 me 的关键字段
  for (const k of ['id', 'name', 'role', 'seat', 'online', 'hasBet', 'balance', 'bankrupt', 'spectator']) {
    assert.ok(k in v.players[0], `players[] 缺 ${k}`);
  }
  for (const k of ['id', 'role', 'balance', 'bet', 'bounds', 'pledge', 'reflipsLeft', 'tickets']) {
    assert.ok(k in v.me, `me 缺 ${k}`);
  }
});

await test('检察官经济流：canSummon 门槛 → 监管 → usedSummonThisRound → lastSummon 驱动告警', async () => {
  const { s, last } = mkSession({ teamRoles: ['prosecutor'], rng: seq(0.99) });
  let v = s.view();
  assert.equal(v.me.canSummon, true);                      // n=1 费2，4≥2+1
  assert.equal(v.me.summonCost, 2);
  assert.equal(s.handle('summon', {}).ok, true);
  v = last();
  assert.equal(v.me.canSummon, false);
  assert.equal(v.me.usedSummonThisRound, true);
  assert.ok(v.lastSummon && v.lastSummon.targetId === 'L'); // 客户端制约卡 ⚠ 告警数据源
  assert.equal(s.handle('place_bet', { amount: 1 }).ok, true);
  await sleep(40);
  v = last();
  // 败局注金+债务被榨（检察官只剩 2−1=1 再扣债 1 → 0 破产）或活着进回合2——两种都合法，只验状态机不炸
  assert.ok(['BETTING', 'ENDED'].includes(v.phase));
});

await test('暴食者重掷经会话路由：REFLIP 相位 → request_reflip → 第二次掷币演出', async () => {
  const { s, last } = mkSession({ teamRoles: ['farmer', 'glutton'], rng: seq(0.99, 0.0) });
  s.handle('place_bet', { amount: 2 });
  s.handle('single_seat', { seatId: 's1' });
  s.handle('place_bet', { amount: 1 });
  await sleep(40);                                          // 第一枚硬币演出完
  let v = last();
  assert.equal(v.phase, 'REFLIP');
  assert.equal(v.coinResult, 'heads');                      // 败局展示
  assert.equal(s.handle('request_reflip', {}).ok, true);    // 当前席位 s1=暴食者
  v = last();
  assert.equal(v.phase, 'COIN_FLIP');                       // 重掷=又一枚硬币
  await sleep(40);
  v = last();
  assert.equal(v.coinResult, 'tails');                      // 0.0 → 翻盘
  assert.notEqual(v.phase, 'REFLIP');
});

await test('single_quit 意图集合完备（客户端会发的名字都在路由表里）', () => {
  for (const t of ['place_bet', 'summon', 'request_reflip', 'pass_reflip', 'negotiate_transfer', 'negotiate_confirm', 'single_seat', 'ready']) {
    assert.ok(SINGLE_INTENTS.has(t), `路由表缺 ${t}`);
  }
});

console.log(`\n全部通过：${passed} 项 ✅`);
