// 纯逻辑边界测试（无框架，直接 `node server/test/logic.test.mjs`）。
// 覆盖：apportion 守恒/误差、结算双倍补偿（含付不起/被压垮破产）、农民平分、
// 地主资金目标序列（放缓/封顶）与惩罚、初始资金动态、下注边界。

import assert from 'node:assert/strict';
import { mergeConfig, roomConfig, getInitialBalance, getInitialPool, getMinStake, factionOf, capitalistWallet } from '../config.js';
import { apportion } from '../logic/apportion.js';
import { betBounds, settleRound, applyAllocation, allocateDebt } from '../logic/rules.js';
import { relativeGoal, goalPenalty, drawGoalInterval } from '../logic/landlordGoal.js';
import { computeWage, wageDueThisRound, investorWaiver, computeTax, taxInterval, taxDueThisRound } from '../logic/competitive.js';
import { createLedger, buildSettleScript, flowsFromParts } from '../logic/payout.js';

let passed = 0;
const cfg = mergeConfig();
const comp = roomConfig('competitive'); // 竞技档：landlordFundMultiplier=1.5、竞技 landlordGoal 已覆盖到顶层
const cfgWin2 = mergeConfig({ landlordAttrs: { landlord: { greed: 2, squeeze: 2 } } }); // 缺口/补偿机制测试固定 2×（贪婪=盘剥=2），与默认调参解耦
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
test('正面缺口·默认 1.5×：base×乘数（L=10,F=2 → 缺口 5，四舍五入）', () => {
  // 默认乘数 1.5：target=round(10×1.5)=15；pot=12；base=3；实际债=round(3×1.5)=round(4.5)=5
  const { result, settlement } = runRound({
    coinResult: 'heads', bets: { L: 10, A: 1, B: 1 }, postBetBalances: { L: 0, A: 3, B: 3 },
    landlordId: 'L', farmerIds: ['A', 'B'], // 默认 cfg（1.5×）
  });
  assert.equal(settlement.target, 15);
  assert.equal(settlement.shortfall, 5);      // round(3 × 1.5) = round(4.5) = 5
  assert.equal(result.collected, 5);
  assert.equal(result.after.L, 17);           // pot 12 + 缺口 5
  assert.equal(result.after.A + result.after.B, 1); // 6 − 5 = 1
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
test('applyAllocation 返回 paidBy：逐人实付且 Σ == collected', () => {
  const { result, allocation } = runRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, postBetBalances: { L: 0, A: 2, B: 8 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: cfgWin2,
  });
  assert.equal(result.paidBy.A + result.paidBy.B, result.collected);
  assert.ok(result.paidBy.A <= (allocation.debts.A ?? 0));
  assert.ok(result.paidBy.B <= (allocation.debts.B ?? 0));
});

console.log('payout（§3.8 台账/编导脚本）');
test('createLedger：扣款先扣堆、不足再扣手；进账进堆', () => {
  const led = createLedger({ A: 3 });
  assert.deepEqual(led.debit('A', 5), [{ kind: 'pile', amount: 3 }, { kind: 'hand', amount: 2 }]);
  assert.equal(led.pileOf('A'), 0);
  assert.equal(led.handDebits.A, 2);
  led.credit('A', 4);
  assert.deepEqual(led.debit('A', 1), [{ kind: 'pile', amount: 1 }]);
  assert.equal(led.pileOf('A'), 3);
  assert.deepEqual(led.debit('A', 0), []);
});
test('createLedger 恒等式：pile == after − (now − handDebit)', () => {
  // 模拟：A 桌上分到 5，又被扣 8（罚金），手上原有 10 → after 应为 10+5−8=7
  const now = { A: 10 };
  const led = createLedger({ A: 5 });
  led.debit('A', 8);
  const after = 10 + 5 - 8;
  assert.equal(led.pileOf('A'), Math.max(0, after - (now.A - led.handDebits.A)));
});
test('buildSettleScript：gather 含全部非零下注、split 份额 = 方案；0 份额省略', () => {
  const settlement = settleRound({
    coinResult: 'tails', bets: { L: 4, A: 2, B: 1 }, balances: { L: 10, A: 6, B: 7 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: cfg,
  });
  let seq = 0;
  const steps = buildSettleScript({ settlement, bets: { L: 4, A: 2, B: 1 }, landlordId: 'L', farmerIds: ['A', 'B'] }, () => ++seq);
  assert.equal(steps[0].t, 'gather');
  assert.deepEqual(steps[0].from.map(f => f.amount), [4, 2, 1]);
  assert.equal(steps[0].pot, 7);
  assert.equal(steps[1].t, 'split');
  assert.equal(steps[1].shares.reduce((s, x) => s + x.amount, 0), 7);       // 份额守恒 == pot
  assert.equal(steps[1].shares.find(s => s.id === 'L'), undefined);         // 地主 0 份省略
  assert.ok(steps[1].id > steps[0].id);
});
test('flowsFromParts：按接收方份额精确切分，跨 pile/hand 边界', () => {
  const flows = flowsFromParts('L', [{ kind: 'pile', amount: 3 }, { kind: 'hand', amount: 2 }], [
    { to: { kind: 'pile', id: 'A' }, amount: 2 },
    { to: { kind: 'pile', id: 'B' }, amount: 3 },
  ]);
  assert.deepEqual(flows, [
    { from: { kind: 'pile', id: 'L' }, to: { kind: 'pile', id: 'A' }, amount: 2 },
    { from: { kind: 'pile', id: 'L' }, to: { kind: 'pile', id: 'B' }, amount: 1 },
    { from: { kind: 'hand', id: 'L' }, to: { kind: 'pile', id: 'B' }, amount: 2 },
  ]);
  assert.equal(flows.reduce((s, f) => s + f.amount, 0), 5);
});

console.log('landlordGoal（相对制）');
test('relativeGoal = round(基准 × goalMultiplier)（默认 1.1，四舍五入）', () => {
  assert.equal(relativeGoal(30, cfg), 33);   // round(33.0)=33
  assert.equal(relativeGoal(35, cfg), 39);   // round(38.5)=39（半档进位）
  assert.equal(relativeGoal(100, cfg), 110);
  assert.equal(relativeGoal(0, cfg), 0);
  assert.equal(relativeGoal(-5, cfg), 0);    // 基准按 0 下限
});
test('goalPenalty：max(minPenalty, round(余额×penaltyRate))，余额下限 0（默认 10%）', () => {
  assert.equal(goalPenalty(100, cfg), 10);   // round(10)
  assert.equal(goalPenalty(25, cfg), 3);     // round(2.5)=3（半档进位）
  assert.equal(goalPenalty(10, cfg), 2);     // round(1)=1 → 下限 2
  assert.equal(goalPenalty(3, cfg), 2);      // round(0.3)=0 → 下限 2
  assert.equal(goalPenalty(-5, cfg), 2);     // 负余额按 0 处理 → 下限 2
});
test('drawGoalInterval：正态 clamp 到 [min,max] 的整数，确定性 rng 可复现', () => {
  const seq = [0.01, 0.5, 0.99, 0.5, 0.5, 0.5, 0.2, 0.8, 0.37, 0.62];
  let i = 0; const rng = () => seq[(i++) % seq.length];
  for (let k = 0; k < 60; k++) {
    const iv = drawGoalInterval(rng, cfg);
    assert.ok(Number.isInteger(iv) && iv >= 2 && iv <= 5, `间隔越界: ${iv}`);
  }
  // 同一 rng 序列 → 同一结果（可复现）
  let a = 0; const rngA = () => seq[(a++) % seq.length];
  let b = 0; const rngB = () => seq[(b++) % seq.length];
  assert.equal(drawGoalInterval(rngA, cfg), drawGoalInterval(rngB, cfg));
});
test('惩罚平分给农民：apportion 守恒（份额之和 == 惩罚额）', () => {
  const penalty = goalPenalty(100, cfg); // round(100*0.1)=10
  for (const ids of [['A', 'B'], ['A', 'B', 'C'], ['A']]) {
    const shares = apportion(penalty, ids.map((id, i) => ({ id, weight: 1, tie: i })));
    assert.equal(sumVals(shares), penalty);
  }
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
test('竞技初始资金：农民阵营按角色 15/12/8', () => {
  const o = { mode: 'competitive' };
  assert.equal(getInitialBalance('farmer', 3, comp, o), 15);
  assert.equal(getInitialBalance('investor', 3, comp, o), 12);
  assert.equal(getInitialBalance('glutton', 3, comp, o), 8);
});
test('竞技地主初始 = ⌊2 × 农民总资金⌋（按花名册）', () => {
  // 名册 farmer+investor+glutton = 15+12+8 = 35 → 地主 ⌊2×35⌋ = 70
  assert.equal(getInitialBalance('landlord', 3, comp, { mode: 'competitive', farmerTotal: 35 }), 70);
});
test('资本家：开局钱包 = 6n+round(池×0.1)，资金池 = 农民数×20', () => {
  // 3 农民：池 = 3×20 = 60；钱包 = 6×3 + round(60×0.1) = 18+6 = 24（动态钱包吃开局池）
  assert.equal(getInitialBalance('capitalist', 3, comp, { mode: 'competitive' }), 24);
  assert.equal(getInitialPool('capitalist', 3, comp), 60);
  assert.equal(getInitialPool('landlord', 3, comp), null);
});
test('资本家动态钱包 = 6n + round(当前池×0.1)（四舍五入、下限基6n、随池涨跌）', () => {
  assert.equal(capitalistWallet(20, 1, comp), 8);   // 6 + round(2.0) = 8（开局池）
  assert.equal(capitalistWallet(40, 2, comp), 16);  // 12 + round(4.0) = 16
  assert.equal(capitalistWallet(35, 1, comp), 10);  // 6 + round(3.5)=4 → 10（半档进位）
  assert.equal(capitalistWallet(5, 1, comp), 7);    // 6 + round(0.5)=1 → 7
  assert.equal(capitalistWallet(0, 1, comp), 6);    // 池空 → 只剩基 6n
});
test('资本家最小出资 = 1，且可全押（无强制全押、无保留金）', () => {
  assert.equal(getMinStake('capitalist', 3, comp, { mode: 'competitive' }), 1);
  const b = betBounds({ balance: 15, role: 'capitalist', farmerCount: 3, config: comp, mode: 'competitive' });
  assert.equal(b.forceAllIn, false);
  assert.equal(b.min, 1);
  assert.equal(b.max, 15); // 可全押到个人资金上限，无需留保留金
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
  // 竞技地主 greed=2/squeeze=1.5：L=8 → target ⌊8×2⌋=16；pot=10；base=6 → ×1.5=9（乘后债）；担保 n=1 → 减 2n=2 → shortfall=7
  const s = settleRound({
    coinResult: 'heads', bets: { L: 8, A: 1, B: 1 }, balances: { L: 0, A: 5, B: 5 },
    landlordId: 'L', farmerIds: ['A', 'B'], config: comp, debtWaiver: investorWaiver(1, comp),
  });
  assert.equal(s.target, 16);
  assert.equal(s.shortfall, 7);            // 乘后 9 − 担保 2 = 7
  assert.equal(s.debts.A + s.debts.B, 7);  // 剩余 7 由农民补（各余 5，可全补）
});
test('资本家税：按当前池 max(taxMin, round(当前池×10%))，pool≤0 不扣、至多扣到池空', () => {
  assert.equal(computeTax(30, comp), 3);   // round(3.0)=3
  assert.equal(computeTax(25, comp), 3);   // round(2.5)=3（四舍五入进位）
  assert.equal(computeTax(15, comp), 2);   // round(1.5)=2
  assert.equal(computeTax(10, comp), 2);   // round(1.0)=1 → 下限 taxMin=2
  assert.equal(computeTax(1, comp), 1);    // 至多扣到池空（min(pool,税)）
  assert.equal(computeTax(0, comp), 0);
  assert.equal(computeTax(-5, comp), 0);
});
test('资本家征税间隔 = 农民人数，round%interval===0 才扣（round≥1）', () => {
  assert.equal(taxInterval(1), 1);
  assert.equal(taxInterval(4), 4);
  assert.equal(taxInterval(0), 1);         // clamp 到 ≥1
  assert.equal(taxDueThisRound(1, 1), true);   // 1 农民 → 每回合征
  assert.equal(taxDueThisRound(1, 2), false);  // 2 农民 → 回合 1 不征
  assert.equal(taxDueThisRound(2, 2), true);   // 回合 2 征
  assert.equal(taxDueThisRound(4, 2), true);
  assert.equal(taxDueThisRound(3, 2), false);
  assert.equal(taxDueThisRound(0, 1), false);  // round≥1 守卫
});

console.log(`\n全部通过：${passed} 项 ✅`);
