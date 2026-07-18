// 纯逻辑边界测试（无框架，直接 `node server/test/logic.test.mjs`）。
// 覆盖：apportion 守恒/误差、结算双倍补偿（含付不起/被压垮破产）、农民平分、
// 地主资金目标序列（放缓/封顶）与惩罚、初始资金动态、下注边界。

import assert from 'node:assert/strict';
import { mergeConfig, roomConfig, getInitialBalance, getInitialPool, getMinStake, factionOf, capitalistWallet, summonCost } from '../config.js';
import { apportion } from '../logic/apportion.js';
import { betBounds, settleRound, applyAllocation, allocateDebt } from '../logic/rules.js';
import { relativeGoal, goalPenalty, drawGoalInterval } from '../logic/landlordGoal.js';
import { computeWage, wageDueThisRound, investorWaiver, computeTax, taxInterval, taxDueThisRound, judgeAccusation } from '../logic/competitive.js';
import { createLedger, buildSettleScript, flowsFromParts } from '../logic/payout.js';
import {
  settleSymmetric, splitLandlordSide, phantomReduction, ghostMaxBet, ghostBalance,
  singleSummonCost, summonCooldownOk, summonPenalty, luckyWinProb, singleWage,
} from '../logic/settleSingle.js';
import { wealthOf, pickExecutioner, compensationOf } from '../logic/execution.js';

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
test('资本家征税间隔 = max(2, 农民人数)，round%interval===0 才扣（round≥1）', () => {
  assert.equal(taxInterval(1), 2);         // 1 农民 → 每隔一回合征（下限 2，不退化成每回合抽血）
  assert.equal(taxInterval(4), 4);
  assert.equal(taxInterval(0), 2);         // clamp 到 ≥2
  assert.equal(taxDueThisRound(1, 1), false);  // 1 农民 → 回合 1 不征
  assert.equal(taxDueThisRound(2, 1), true);   // 回合 2 征（每隔一回合）
  assert.equal(taxDueThisRound(1, 2), false);  // 2 农民 → 回合 1 不征
  assert.equal(taxDueThisRound(2, 2), true);   // 回合 2 征
  assert.equal(taxDueThisRound(4, 2), true);
  assert.equal(taxDueThisRound(3, 2), false);
  assert.equal(taxDueThisRound(0, 1), false);  // round≥1 守卫
});
test('对质判定 judgeAccusation：多/少/相等（相等判错）', () => {
  assert.equal(judgeAccusation(10, 6, 'more'), true);   // 敌注 10 > 阵营 6：喊「多」命中
  assert.equal(judgeAccusation(10, 6, 'less'), false);
  assert.equal(judgeAccusation(3, 6, 'less'), true);    // 敌注 3 < 阵营 6：喊「少」命中
  assert.equal(judgeAccusation(3, 6, 'more'), false);
  assert.equal(judgeAccusation(6, 6, 'more'), false);   // 相等 → 无法严格「多/少」，判错
  assert.equal(judgeAccusation(6, 6, 'less'), false);
  assert.equal(judgeAccusation(5, 5, 'bogus'), false);  // 非法方向 → 错
});
test('对质票发放：竞技 accusation.tickets 农民3/投资者2/暴食者0/检察官4，cost 2', () => {
  assert.deepEqual(comp.competitive.accusation.tickets, { farmer: 3, investor: 2, glutton: 0, prosecutor: 4 });
  assert.equal(comp.competitive.accusation.cost, 2);
});
test('检察官（§8.9）：初始资金 4；传唤费 = round(农民数 × 1.5^已传次数)（150% 递增）', () => {
  assert.equal(getInitialBalance('prosecutor', 3, comp, { mode: 'competitive' }), 4);
  assert.equal(factionOf('prosecutor'), 'farmer');
  // nF=2: 2,3,5(4.5),7(6.75),10(10.125)…；nF=3: 3,5(4.5),7(6.75),10；nF=4: 4,6,9,14(13.5)
  assert.deepEqual([0, 1, 2, 3, 4].map(k => summonCost(2, k, comp)), [2, 3, 5, 7, 10]);
  assert.deepEqual([0, 1, 2, 3].map(k => summonCost(3, k, comp)), [3, 5, 7, 10]);
  assert.deepEqual([0, 1, 2, 3].map(k => summonCost(4, k, comp)), [4, 6, 9, 14]);
  assert.equal(summonCost(1, 0, comp), 1);                    // 单农民局首费 1
});
test('税钟锚点（§8.9 传唤重置）：anchor 缺省=0 行为不变；锚定后从锚点重新起算', () => {
  assert.equal(taxDueThisRound(2, 2), true);                  // 旧行为：round%2===0
  assert.equal(taxDueThisRound(2, 2, 0), true);               // anchor 0 与缺省一致
  assert.equal(taxDueThisRound(3, 2, 3), false);              // 刚锚定（本回合传唤）→ 不征
  assert.equal(taxDueThisRound(4, 2, 3), false);              // 锚后 1 回合（间隔 2）→ 不征
  assert.equal(taxDueThisRound(5, 2, 3), true);               // 锚后 2 回合 → 征
  assert.equal(taxDueThisRound(7, 2, 3), true);               // 锚后 4 回合 → 征（周期延续）
});

console.log('single（§9 单人模式纯函数）');
test('对称结算：胜方按出资比例瓜分败方总注，守恒；全零注退化均分', () => {
  const r = settleSymmetric({ winnerIds: ['a', 'b'], loserIds: ['c', 'd'], bets: { a: 3, b: 1, c: 5, d: 2 } });
  assert.equal(r.loserTotal, 7);
  assert.equal(sumVals(r.takes), 3 + 1 + 7);              // 收回己注 + 败方总注全部分掉
  assert.ok(r.takes.a - 3 > r.takes.b - 1);               // a 出资多 → 分得多
  assert.deepEqual(r.losses, { c: 5, d: 2 });
  const z = settleSymmetric({ winnerIds: ['a', 'b'], loserIds: ['c'], bets: { a: 0, b: 0, c: 4 } });
  assert.equal(z.takes.a + z.takes.b, 4);                 // 全零注 → 均分（2/2）
  assert.equal(Math.abs(z.takes.a - z.takes.b) <= 1, true);
});
test('多地主侧比例分账：幽灵先收回注金、比例份额进虚空，账目守恒', () => {
  const r = splitLandlordSide({ income: 30, members: [{ id: 'L', bet: 10 }, { id: 'G', bet: 5, ghost: true }], config: cfg });
  assert.equal(r.ghostRefund, 5);                          // 幽灵保底收回注金
  assert.equal(r.shares.G, 5);                             // 幽灵实得 = 注金
  assert.equal(r.shares.L + r.shares.G + r.voided, 30);    // 守恒：核心 + 幽灵 + 虚空 = 总进账
  assert.ok(r.voided > 0);                                 // 幽灵的比例份额确实蒸发
});
test('幻影彩池：敌方实拿按 幽灵注/彩池 等比缩水，不超过原实拿', () => {
  const r = phantomReduction({ takes: { a: 10, b: 6 }, ghostBet: 8, pot: 24, config: cfg });
  assert.equal(r.reductions.a, 3);                         // round(10×8/24)=3
  assert.equal(r.reductions.b, 2);                         // round(6×8/24)=2
  assert.equal(r.total, 5);
  const none = phantomReduction({ takes: { a: 10 }, ghostBet: 0, pot: 24, config: cfg });
  assert.equal(none.total, 0);
});
test('幽灵注金上限：严格小于核心注金，且受自身余额封顶', () => {
  assert.equal(ghostMaxBet(10, 16), 9);
  assert.equal(ghostMaxBet(10, 4), 4);
  assert.equal(ghostMaxBet(1, 16), 0);                     // 核心注 1 → 幽灵只能 0
  assert.equal(ghostBalance(4, cfg), 16);                  // 敌方 4 农民 → 幽灵资金 16
});
test('单人监管：固定费 农民数×2、冷却 农民数 回合、罚 2×费', () => {
  assert.equal(singleSummonCost(3, cfg), 6);
  assert.equal(singleSummonCost(4, cfg), 8);
  assert.equal(summonPenalty(3, cfg), 12);                 // 地主直接损失 2×监管费
  assert.equal(summonCooldownOk(5, 0, 3, cfg), true);      // 从未监管 → 可用
  assert.equal(summonCooldownOk(5, 3, 3, cfg), false);     // 间隔 2 < 3 → 冷却中
  assert.equal(summonCooldownOk(6, 3, 3, cfg), true);      // 间隔 3 ≥ 3 → 可用
});
test('幸运儿概率：+10% 基础、怜悯 +5%/连败封顶 +15%、敌我抵消、夹逼 [0.05,0.95]', () => {
  assert.equal(luckyWinProb({ mine: true }, cfg), 0.6);
  assert.equal(luckyWinProb({ mine: true, myPityLosses: 2 }, cfg), 0.7);   // 0.5+0.10+0.10
  assert.equal(luckyWinProb({ mine: true, myPityLosses: 9 }, cfg), 0.75);  // 怜悯封顶 +0.15
  assert.equal(luckyWinProb({ mine: true, enemy: true }, cfg), 0.5);       // 互相抵消
  assert.equal(luckyWinProb({ enemy: true, enemyPityLosses: 9 }, cfg), 0.25);
  assert.equal(luckyWinProb({}, cfg), 0.5);
});
test('单人工资：每 2 回合发 2+(农民数−1)，非发薪回合为 0', () => {
  assert.equal(singleWage(4, 2, cfg), 5);                  // 4 农民 → 5/人
  assert.equal(singleWage(1, 2, cfg), 2);
  assert.equal(singleWage(4, 3, cfg), 0);                  // 非间隔回合
  assert.equal(singleWage(4, 0, cfg), 0);                  // round≥1 守卫
});
test('单人初始资金/Boss 梯度参数在 config.single 中且可记', () => {
  assert.deepEqual(cfg.single.initialBalance, { farmer: 20, investor: 12, glutton: 6, prosecutor: 4, lucky: 2 });
  assert.equal(cfg.single.boss.initialBalance, 65);
  assert.deepEqual(cfg.single.boss.attrs.base, { greed: 2, squeeze: 2, rake: 0.8 });
  assert.equal(cfg.single.investor.maxPledge, 6);
  assert.equal(cfg.single.glutton.reflips, 3);
});

// ---- 处决窗纯逻辑（§3.9）：行刑者遴选 + 赔偿口径 ----
test('处决：wealthOf 口径（资本家=池、其余=余额）', () => {
  assert.equal(wealthOf({ role: 'farmer', balance: 7 }), 7);
  assert.equal(wealthOf({ role: 'capitalist', balance: 3, pool: 20 }), 20);
  assert.equal(wealthOf({ role: 'landlord', balance: null }), 0);
});
test('处决：pickExecutioner 敌对阵营最富活人、并列取小座位、跳过破产/观战、全灭 null', () => {
  const t = { role: 'farmer' }; // 目标是农民 → 行刑者来自地主阵营
  const mk = (role, balance, seat, extra = {}) => ({ role, balance, seat, bankrupt: false, spectator: false, ...extra });
  // 地主侧只有一人时=那个人
  assert.equal(pickExecutioner(t, [mk('landlord', 5, 0), mk('farmer', 99, 1)]).seat, 0);
  // 目标是地主 → 农民侧最富；并列取小座位
  const lt = { role: 'landlord' };
  const picked = pickExecutioner(lt, [mk('landlord', 99, 0), mk('farmer', 8, 2), mk('farmer', 8, 1), mk('glutton', 3, 3)]);
  assert.equal(picked.seat, 1);
  // 破产/观战跳过；资本家按池比较（池大过农民余额）
  const capT = { role: 'farmer' };
  const c = pickExecutioner(capT, [mk('capitalist', 1, 0, { pool: 50 })]);
  assert.equal(c.role, 'capitalist');
  assert.equal(pickExecutioner(t, [mk('landlord', 9, 0, { bankrupt: true }), mk('landlord', 9, 1, { spectator: true })]), null);
});
test('处决：compensationOf（普通=余额缩水、资本家=池缩水、下限 0）', () => {
  assert.equal(compensationOf({ role: 'farmer', balance: 0 }, 4, undefined), 4);
  assert.equal(compensationOf({ role: 'farmer', balance: -3 }, 4, undefined), 7);     // 深负也补回
  assert.equal(compensationOf({ role: 'farmer', balance: 6 }, 4, undefined), 0);      // 本轮没输 → 0
  assert.equal(compensationOf({ role: 'capitalist', balance: 8, pool: 0 }, 8, 40), 40); // 池口径，无视余额
  assert.equal(compensationOf({ role: 'capitalist', pool: 50 }, 0, 40), 0);
});

console.log(`\n全部通过：${passed} 项 ✅`);
