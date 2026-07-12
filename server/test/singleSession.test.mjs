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
  for (const t of ['place_bet', 'summon', 'request_reflip', 'pass_reflip', 'negotiate_transfer', 'negotiate_confirm', 'single_seat', 'ready', 'single_role', 'single_ghost', 'single_begin']) {
    assert.ok(SINGLE_INTENTS.has(t), `路由表缺 ${t}`);
  }
});

await test('组队期（SETUP，交互 v2）：桌边选角 → 幽灵 → 开局；槽位=固定座位；对局期改队被拒', async () => {
  const { s, last } = mkSession({ rng: seq(0.0) });          // 不带 teamRoles → 进组队期
  let v = s.view();
  assert.equal(v.phase, 'SINGLE_SETUP');
  assert.equal(v.me, null);
  assert.equal(v.single.seatId, null);
  assert.deepEqual(v.single.setup.roles, ['farmer', 'farmer', null, null]);
  assert.equal(v.players[v.players.length - 1].id, 'L');     // Boss 在组队期就坐在对面
  assert.equal(v.players[v.players.length - 1].seat, 4);
  // 改槽：1 号槽清空、3 号槽放暴食者；非法槽/角色被拒
  assert.equal(s.handle('single_role', { slot: 1, role: null }).ok, true);
  assert.equal(s.handle('single_role', { slot: 3, role: 'glutton' }).ok, true);
  assert.ok(s.handle('single_role', { slot: 9, role: 'farmer' }).error);
  assert.ok(s.handle('single_role', { slot: 0, role: 'landlord' }).error);
  assert.equal(s.handle('single_ghost', { on: true }).ok, true);
  // 组队期不许下注
  assert.ok(s.handle('place_bet', { amount: 2 }).error);
  // 开局：farmer(槽0)+glutton(槽3) → seats s0/s1，seat 字段保留槽位
  assert.equal(s.handle('single_begin', {}).ok, true);
  v = last();
  assert.equal(v.phase, 'BETTING');
  assert.equal(v.single.setup, null);
  assert.equal(v.single.seatId, 's0');
  assert.equal(v.single.bossGhost, true);
  const seatsOf = Object.fromEntries(v.players.map(p => [p.id, p.seat]));
  assert.equal(seatsOf.s0, 0);
  assert.equal(seatsOf.s1, 3);                               // 槽位跟人走：组队期选哪坐哪
  assert.equal(seatsOf.L, 4);
  // 对局期改队被拒
  assert.ok(s.handle('single_role', { slot: 0, role: 'lucky' }).error);
  assert.ok(s.handle('single_begin', {}).error);
});

await test('空队伍不许开局', () => {
  const { s } = mkSession({ rng: seq(0.0) });
  for (const slot of [0, 1]) s.handle('single_role', { slot, role: null });
  assert.ok(s.handle('single_begin', {}).error);
});

await test('暂存注（交互 v3）：默认最小注 → ±1/全押/保金 → 开掷落账 → 下回合继承并夹紧', async () => {
  const { s, last } = mkSession({ teamRoles: ['farmer', 'investor'], rng: seq(0.0) });
  let v = s.view();
  // 初始暂存=保底 1,全员 hasBet（钱堆常驻）
  assert.deepEqual(v.players.slice(0, 2).map(p => p.bet), [1, 1]);
  assert.ok(v.players[0].hasBet && v.players[1].hasBet);
  // ±1：+3 −1 → 3;下压不破保底
  for (let i = 0; i < 3; i++) s.handle('single_bet_adjust', { seatId: 's0', delta: 1 });
  s.handle('single_bet_adjust', { seatId: 's0', delta: -1 });
  for (let i = 0; i < 9; i++) s.handle('single_bet_adjust', { seatId: 's0', delta: -1 });
  v = last();
  assert.equal(v.players[0].bet, 1);                          // 压不破 1
  for (let i = 0; i < 4; i++) s.handle('single_bet_adjust', { seatId: 's0', delta: 1 });
  // 全押：s0 注=余额 20
  assert.equal(s.handle('single_bet_allin', { seatId: 's0' }).ok, true);
  v = last();
  assert.equal(v.players[0].bet, 20);
  // 投资人保金：+2 → 注上限被挤占
  assert.equal(s.handle('single_pledge_adjust', { seatId: 's1', delta: 1 }).ok, true);
  assert.equal(s.handle('single_pledge_adjust', { seatId: 's1', delta: 1 }).ok, true);
  v = last();
  assert.equal(v.players[1].pledge, 2);
  assert.ok(s.handle('single_pledge_adjust', { seatId: 's0', delta: 1 }).error); // 农民不可投保
  // 开掷 → 演出锁 → 队胜(0.0)
  assert.equal(s.handle('single_flip', {}).ok, true);
  v = last();
  assert.equal(v.phase, 'COIN_FLIP');
  await sleep(40);
  // 协商确认 → 回合 2：暂存继承上回合注法（s0 全押 20 超新余额则夹紧;不够则尽量）
  if (last().phase === 'NEGOTIATE') s.handle('negotiate_confirm', {});
  v = last();
  assert.equal(v.phase, 'BETTING');
  assert.equal(v.round, 2);
  const s0 = v.players.find(p => p.id === 's0');
  const s0bal = s0.balance;
  assert.ok(s0.bet >= 1 && s0.bet <= s0bal, `继承注 ${s0.bet} 应在 [1, ${s0bal}]`);
  assert.equal(s0.bet, Math.min(20, s0bal));                  // 继承 20,不够则尽量
  const s1 = v.players.find(p => p.id === 's1');
  assert.equal(s1.pledge, 0);                                 // 保金不继承
});

console.log(`\n全部通过：${passed} 项 ✅`);
