// 纯逻辑边界测试（无框架，直接 `node server/test/logic.test.mjs`）。
// 覆盖：apportion 守恒/误差、结算双倍补偿（含付不起/被压垮破产）、农民平分、
// 地主资金目标序列（放缓/封顶）与惩罚、初始资金动态、下注边界。

import assert from 'node:assert/strict';
import { mergeConfig, roomConfig, getInitialBalance, getInitialPool, getMinStake, factionOf } from '../config.js';
import { apportion } from '../logic/apportion.js';
import { betBounds, settleRound, applyAllocation, allocateDebt } from '../logic/rules.js';
import { buildGoalSchedule, upcomingGoal, goalForRound, goalPenalty } from '../logic/landlordGoal.js';
import { computeWage, wageDueThisRound, investorWaiver, computeTax } from '../logic/competitive.js';

let passed = 0;
const cfg = mergeConfig();
const comp = roomConfig('competitive'); // 竞技档：landlordFundMultiplier=1.5、竞技 landlordGoal 已覆盖到顶层
const cfgWin2 = mergeConfig({ landlordWinMultiplier: 2 }); // 缺口/补偿机制测试固定 2×，与默认调参解耦
const sumVals = (o) => Object.values(o).reduce((s, v) => s + v, 0);

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// 模拟一回合：在「下注后余额」上跑系统结算 + 落账（可注入协商后的 allocation）。
function runRound({ coinResult, bets, postBetBalances, landlordId, farmerIds, allocationOverride, config = cfg }) {
  const settlement = settleRound({ coinResult, bets, balances: postBetBalances, landlordId, farmerIds, config });
  const allocation = allocationOverride ?? { takes: { ...settlement.takes }, debts: { ...settlement.debts } };
  const startBalances = {}; // 此处只关心相对入账，置 0 即可让 deltas == after
  for (const id of [landlordId, ...farmerIds]) startBalances[id] = 0;
  const result = applyAllocation({ settlement, allocation, balances: postBetBalances, bets, landlordId, farmerIds, startBalances, config });
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
test('正面缺口·乘数放大·全覆盖：地主拿到 pot + floor(base×乘数)', () => {
  // L=8 → target=16；pot=10；base=16−10=6；乘数2 → 实际债 floor(6×2)=12；两农民各余 8，可全补
  const { result, settlement } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 8, B: 8 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: cfgWin2,
  });
  assert.equal(settlement.pot, 10);
  assert.equal(settlement.shortfall, 12);    // 乘后债额（base 6 × 乘数 2）
  assert.equal(result.collected, 12);
  assert.equal(result.after.L, 22);          // pot 10 + 乘后缺口 12（超过 target 16）
  assert.equal(result.after.A, 2);           // 8 − 分摊 6
  assert.equal(result.after.B, 2);
});
test('正面缺口·付不起：地主只拿到实收，农民付光破产，余缺口 uncovered', () => {
  // 乘后债 12（base6×2），两农民仅余 2/1，远不足补 → 付光破产，uncovered=9
  const { result, settlement } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 2, B: 1 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: cfgWin2,
  });
  assert.equal(settlement.shortfall, 12);     // 乘后债额
  assert.equal(settlement.uncovered, 9);      // 12 − 实收 3
  assert.equal(result.collected, 3);          // 2 + 1
  assert.equal(result.after.L, 13);           // pot 10 + 实收 3
  assert.equal(result.after.A, 0);
  assert.equal(result.after.B, 0);
});
test('正面缺口·默认 1.5×：base×乘数（L=10,F=2 → 缺口 4）', () => {
  // 默认乘数 1.5：target=⌊10×1.5⌋=15；pot=12；base=3；实际债=floor(3×1.5)=4
  const { result, settlement } = runRound({
    coinResult: 'heads', bets: { L: 10, A: 1, B: 1 }, postBetBalances: { L: 0, A: 3, B: 3 },
    landlordId: 'L', farmerIds: ['A', 'B'], // 默认 cfg（1.5×）
  });
  assert.equal(settlement.target, 15);
  assert.equal(settlement.shortfall, 4);      // floor(3 × 1.5)
  assert.equal(result.collected, 4);
  assert.equal(result.after.L, 16);           // pot 12 + 缺口 4
  assert.equal(result.after.A + result.after.B, 2); // 6 − 4 = 2
});
test('任务 7+8：债务全压给一名农民→他破产，地主只收到他最后的钱', () => {
  // 系统默认会把 6 的缺口在 A/B 间分摊；这里模拟协商后全压给 A（A 仅余 2）。
  const { result } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 2, B: 5 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: cfgWin2,
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
test('显式序列：检查点回合 [2,4,7,10,15…]，目标 floor(B×[0.6,1.0,1.5,1.8,2.0…])', () => {
  const B = 30;
  const sched = buildGoalSchedule(B, cfg);
  const wantRounds = [2, 4, 7, 10, 15];
  const wantMul = [0.6, 1.0, 1.5, 1.8, 2.0];
  for (let i = 0; i < wantRounds.length; i++) {
    assert.equal(sched[i].round, wantRounds[i]);
    assert.equal(sched[i].goal, Math.floor(B * wantMul[i]));
  }
  for (let i = 1; i < sched.length; i++) assert.ok(sched[i].round > sched[i - 1].round);
});
test('封顶后重复末项：目标非递减且 ≤ floor(B*2.0)，间隔重复末项(5)', () => {
  const B = 30;
  const sched = buildGoalSchedule(B, cfg);
  const maxGoal = Math.floor(B * 2.0); // 60
  for (let i = 0; i < sched.length; i++) {
    assert.ok(sched[i].goal <= maxGoal);
    if (i > 0) assert.ok(sched[i].goal >= sched[i - 1].goal); // 非递减
  }
  assert.equal(sched[5].round, 20);    // 15 + 重复末项间隔 5
  assert.equal(sched[5].goal, maxGoal);
});
test('goalForRound / upcomingGoal', () => {
  const B = 30;
  assert.equal(goalForRound(2, B, cfg), Math.floor(B * 0.6));
  assert.equal(goalForRound(3, B, cfg), null); // 非检查点回合
  const up = upcomingGoal(1, B, cfg);
  assert.equal(up.dueRound, 2);
  assert.equal(up.roundsLeft, 1);
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
test('初始资金：农民 8；地主 = floor(1.2 * 农民数 * 8)', () => {
  assert.equal(getInitialBalance('farmer', 3, cfg), 8);
  assert.equal(getInitialBalance('landlord', 1, cfg), 9);   // floor(1.2*1*8)=9
  assert.equal(getInitialBalance('landlord', 3, cfg), 28);  // floor(1.2*3*8)=28
  assert.equal(getInitialBalance('landlord', 4, cfg), 38);  // floor(1.2*4*8)=38
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

console.log('competitive (§8)');
test('阵营映射 factionOf', () => {
  assert.equal(factionOf('landlord'), 'landlord');
  assert.equal(factionOf('capitalist'), 'landlord');
  assert.equal(factionOf('farmer'), 'farmer');
  assert.equal(factionOf('investor'), 'farmer');
  assert.equal(factionOf('glutton'), 'farmer');
  assert.equal(factionOf('bank'), null);
});
test('竞技初始资金：农民阵营按角色 9/8/6', () => {
  const o = { mode: 'competitive' };
  assert.equal(getInitialBalance('farmer', 3, comp, o), 9);
  assert.equal(getInitialBalance('investor', 3, comp, o), 8);
  assert.equal(getInitialBalance('glutton', 3, comp, o), 6);
});
test('竞技地主初始 = ⌊1.5 × 农民总资金⌋（按花名册）', () => {
  // 名册 farmer+investor+glutton = 9+8+6 = 23 → 地主 ⌊1.5×23⌋ = 34
  assert.equal(getInitialBalance('landlord', 3, comp, { mode: 'competitive', farmerTotal: 23 }), 34);
});
test('资本家：个人资金 = 农民数×4，资金池 = 农民数×10', () => {
  assert.equal(getInitialBalance('capitalist', 3, comp, { mode: 'competitive' }), 12);
  assert.equal(getInitialPool('capitalist', 3, comp), 30);
  assert.equal(getInitialPool('landlord', 3, comp), null);
});
test('资本家最小出资 = 1，且可全押（无强制全押、无保留金）', () => {
  assert.equal(getMinStake('capitalist', 3, comp, { mode: 'competitive' }), 1);
  const b = betBounds({ balance: 12, role: 'capitalist', farmerCount: 3, config: comp, mode: 'competitive' });
  assert.equal(b.forceAllIn, false);
  assert.equal(b.min, 1);
  assert.equal(b.max, 12); // 可全押到个人资金上限，无需留保留金
});
test('工资缩放：m=1..4 → interval 5/4/3/2、amount 1/2/3/4', () => {
  assert.deepEqual(computeWage(1, comp), { interval: 5, amount: 1 });
  assert.deepEqual(computeWage(2, comp), { interval: 4, amount: 2 });
  assert.deepEqual(computeWage(3, comp), { interval: 3, amount: 3 });
  assert.deepEqual(computeWage(4, comp), { interval: 2, amount: 4 });
});
test('发薪判定：round 为间隔整数倍', () => {
  assert.equal(wageDueThisRound(5, 5), true);
  assert.equal(wageDueThisRound(4, 5), false);
  assert.equal(wageDueThisRound(10, 5), true);
  assert.equal(wageDueThisRound(0, 5), false);
});
test('投资人减债 = waiveMultiplier × Σ担保（默认 2n）', () => {
  assert.equal(investorWaiver(3, comp), 6);
  assert.equal(investorWaiver(0, comp), 0);
});
test('settleRound：投资人担保作用于【乘后】缺口（减 2n 后再分摊）', () => {
  // L=8 → target ⌊8×1.5⌋=12；pot=10；base=2 → ×1.5=3（乘后债）；担保 n=1 → 减 2n=2 → shortfall=1
  const s = settleRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, balances: { L: 0, A: 5, B: 5 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: comp, debtWaiver: investorWaiver(1, comp),
  });
  assert.equal(s.target, 12);
  assert.equal(s.shortfall, 1);            // 乘后 3 − 担保 2 = 1
  assert.equal(s.debts.A + s.debts.B, 1);  // 剩余 1 由农民补
});
test('资本家税：max(taxMin, ⌊pool×10%⌋)，pool≤0 不扣', () => {
  assert.equal(computeTax(30, comp), 3);   // floor(3)
  assert.equal(computeTax(15, comp), 2);   // floor(1.5)=1 → 下限 2
  assert.equal(computeTax(0, comp), 0);
  assert.equal(computeTax(-5, comp), 0);
});

console.log(`\n全部通过：${passed} 项 ✅`);
