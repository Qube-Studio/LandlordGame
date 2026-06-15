// 纯逻辑边界测试（无框架，直接 `node server/test/logic.test.mjs`）。
// 覆盖：apportion 守恒/误差、结算双倍补偿（含付不起/被压垮破产）、农民平分、
// 地主资金目标序列（放缓/封顶）与惩罚、初始资金动态、下注边界。

import assert from 'node:assert/strict';
import { mergeConfig, getInitialBalance, getMinStake } from '../config.js';
import { apportion } from '../logic/apportion.js';
import { betBounds, settleRound, applyAllocation, allocateDebt } from '../logic/rules.js';
import { buildGoalSchedule, upcomingGoal, goalForRound, goalPenalty } from '../logic/landlordGoal.js';

let passed = 0;
const cfg = mergeConfig();
const sumVals = (o) => Object.values(o).reduce((s, v) => s + v, 0);

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// 模拟一回合：在「下注后余额」上跑系统结算 + 落账（可注入协商后的 allocation）。
function runRound({ coinResult, bets, postBetBalances, landlordId, farmerIds, allocationOverride }) {
  const settlement = settleRound({ coinResult, bets, balances: postBetBalances, landlordId, farmerIds, config: cfg });
  const allocation = allocationOverride ?? { takes: { ...settlement.takes }, debts: { ...settlement.debts } };
  const startBalances = {}; // 此处只关心相对入账，置 0 即可让 deltas == after
  for (const id of [landlordId, ...farmerIds]) startBalances[id] = 0;
  const result = applyAllocation({ settlement, allocation, balances: postBetBalances, bets, landlordId, farmerIds, startBalances, config: cfg });
  return { settlement, allocation, result };
}

console.log('apportion');
test('守恒：份额之和 == total，且各为非负整数', () => {
  for (const total of [0, 1, 2, 7, 13, 100, 1001]) {
    for (const n of [1, 2, 3, 5]) {
      const items = Array.from({ length: n }, (_, i) => ({ id: `x${i}`, weight: (i + 1), tie: i }));
      const r = apportion(total, items);
      assert.equal(sumVals(r), total);
      for (const v of Object.values(r)) { assert.ok(Number.isInteger(v) && v >= 0); }
    }
  }
});
test('误差 ≤ 1：均权下任意两人份额差不超过 1', () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ id: `x${i}`, weight: 1 }));
  const r = apportion(10, items); // 10/3 → 4,3,3
  const vals = Object.values(r).sort((a, b) => a - b);
  assert.ok(vals[vals.length - 1] - vals[0] <= 1);
  assert.equal(sumVals(r), 10);
});
test('全零权重退化为均分', () => {
  const r = apportion(6, [{ id: 'a', weight: 0 }, { id: 'b', weight: 0 }, { id: 'c', weight: 0 }]);
  assert.equal(sumVals(r), 6);
});

console.log('settleRound / applyAllocation');
test('反面：农民平分桌面，地主净损失其下注', () => {
  const { result } = runRound({
    coinResult: 'tails', bets: { L: 4, A: 1, B: 1 }, postBetBalances: { L: 10, A: 5, B: 5 },
    landlordId: 'L', farmerIds: ['A', 'B'],
  });
  // pot=6 平分 → 各 +3；地主不变（其下注已在 pot 里被分掉）
  assert.equal(result.after.A, 8);
  assert.equal(result.after.B, 8);
  assert.equal(result.after.L, 10);
});
test('正面盈余：landlordTake + Σtakes == pot 不变量', () => {
  const { settlement } = runRound({
    coinResult: 'heads', bets: { L: 3, A: 5, B: 5 }, postBetBalances: { L: 10, A: 3, B: 3 },
    landlordId: 'L', farmerIds: ['A', 'B'],
  });
  assert.equal(settlement.landlordTake + sumVals(settlement.takes), settlement.pot);
});
test('正面缺口·全覆盖：地主恰好拿到双倍 = pot + 补偿', () => {
  // L=8 → target=16；pot=10；shortfall=6；两农民各余 5，可全补
  const { result, settlement } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 5, B: 5 },
    landlordId: 'L', farmerIds: ['A', 'B'],
  });
  assert.equal(settlement.pot, 10);
  assert.equal(result.collected, 6);
  assert.equal(result.after.L, 16); // pot 10 + 补偿 6 = 双倍 16
});
test('正面缺口·付不起：地主只拿到实收，农民付光破产', () => {
  // 两农民余额不足以补足 6
  const { result } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 2, B: 1 },
    landlordId: 'L', farmerIds: ['A', 'B'],
  });
  assert.equal(result.collected, 3);          // 2 + 1
  assert.equal(result.after.L, 13);           // pot 10 + 实收 3
  assert.equal(result.after.A, 0);
  assert.equal(result.after.B, 0);
});
test('任务 7+8：债务全压给一名农民→他破产，地主只收到他最后的钱', () => {
  // 系统默认会把 6 的缺口在 A/B 间分摊；这里模拟协商后全压给 A（A 仅余 2）。
  const { result } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 2, B: 5 },
    landlordId: 'L', farmerIds: ['A', 'B'],
    allocationOverride: { takes: { A: 0, B: 0 }, debts: { A: 6, B: 0 } },
  });
  assert.equal(result.after.A, 0);            // A 付光破产
  assert.equal(result.after.B, 5);            // B 一分没出
  assert.equal(result.collected, 2);          // 地主只收到 A 的最后 2 元
  assert.equal(result.after.L, 12);           // pot 10 + 2
});
test('allocateDebt：容量封顶 + 递归重摊，uncovered 正确', () => {
  const { debts, uncovered } = allocateDebt(6, [
    { id: 'A', bet: 1, capacity: 2 },
    { id: 'B', bet: 1, capacity: 1 },
  ], cfg);
  assert.equal(debts.A, 2);
  assert.equal(debts.B, 1);
  assert.equal(uncovered, 3);
});

console.log('landlordGoal');
test('序列：首检查点第 3 回合、首目标(惩罚阈值) floor(B*0.5)、回合严格递增', () => {
  const B = 31;
  const sched = buildGoalSchedule(B, cfg);
  assert.equal(sched[0].round, 3);
  assert.equal(sched[0].goal, Math.floor(B * 0.5)); // 15
  for (let i = 1; i < sched.length; i++) assert.ok(sched[i].round > sched[i - 1].round);
});
test('封顶：间隔 ≤ maxInterval(9)、目标 ≤ floor(B*1.8)；目标增量逐渐放缓', () => {
  const B = 31;
  const sched = buildGoalSchedule(B, cfg);
  const maxGoal = Math.floor(B * 1.8); // 55
  let prevRound = 0, prevInc = Infinity, prevGoal = sched[0].goal;
  for (let i = 0; i < sched.length; i++) {
    const interval = sched[i].round - prevRound;
    assert.ok(interval >= 1 && interval <= cfg.landlordGoal.maxInterval);
    assert.ok(sched[i].goal <= maxGoal);
    if (i > 0) {
      const inc = sched[i].goal - prevGoal;
      assert.ok(inc >= 0);                 // 非递减
      assert.ok(inc <= prevInc + 1);       // 增量放缓（floor 容差 1）
      prevInc = inc; prevGoal = sched[i].goal;
    }
    prevRound = sched[i].round;
  }
});
test('goalForRound / upcomingGoal', () => {
  const B = 31;
  assert.equal(goalForRound(3, B, cfg), Math.floor(B * 0.5));
  assert.equal(goalForRound(4, B, cfg), null); // 非检查点回合
  const up = upcomingGoal(1, B, cfg);
  assert.equal(up.dueRound, 3);
  assert.equal(up.roundsLeft, 2);
});
test('惩罚平分给农民：apportion 守恒（份额之和 == 惩罚额）', () => {
  const penalty = goalPenalty(20, cfg); // floor(20*0.2)=4
  for (const ids of [['A', 'B'], ['A', 'B', 'C'], ['A']]) {
    const shares = apportion(penalty, ids.map((id, i) => ({ id, weight: 1, tie: i })));
    assert.equal(sumVals(shares), penalty);
  }
});
test('goalPenalty：max(minPenalty, floor(余额*rate))，余额下限 0', () => {
  assert.equal(goalPenalty(100, cfg), 20);
  assert.equal(goalPenalty(10, cfg), 2);    // floor(2)=2
  assert.equal(goalPenalty(3, cfg), 2);     // floor(0.6)=0 → 下限 2
  assert.equal(goalPenalty(-5, cfg), 2);    // 负余额按 0 处理 → 下限 2
});

console.log('config');
test('初始资金：农民 7；地主 = floor(1.5 * 农民数 * 7)', () => {
  assert.equal(getInitialBalance('farmer', 3, cfg), 7);
  assert.equal(getInitialBalance('landlord', 1, cfg), 10);
  assert.equal(getInitialBalance('landlord', 3, cfg), 31);
  assert.equal(getInitialBalance('landlord', 4, cfg), 42);
});
test('最小出资额：农民固定 1；地主 = 活跃农民数', () => {
  assert.equal(getMinStake('farmer', 3, cfg), 1);
  assert.equal(getMinStake('landlord', 3, cfg), 3);
});
test('下注边界：balance < 2*minStake 强制全押', () => {
  const b = betBounds({ balance: 1, role: 'farmer', farmerCount: 2, config: cfg });
  assert.ok(b.forceAllIn);
  assert.equal(b.allInAmount, 1);
  const b2 = betBounds({ balance: 10, role: 'farmer', farmerCount: 2, config: cfg });
  assert.equal(b2.forceAllIn, false);
  assert.equal(b2.min, 1);
  assert.equal(b2.max, 9);
});

console.log(`\n全部通过：${passed} 项 ✅`);
