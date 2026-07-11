// 单人模式编排器整局集成测试（GAME_SPEC §9）。跑法：node server/test/single.test.mjs
// rng 注入确定性序列：resolve() 消耗 1 次、requestReflip() 再消耗 1 次。
// 无幸运儿时 p=0.5：rng<0.5=队胜（tails）、≥0.5=队负（heads）。

import assert from 'node:assert/strict';
import { SingleTable } from '../single/SingleTable.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
const rngSeq = (...vals) => { let i = 0; return () => vals[Math.min(i, vals.length - 1) === i ? i++ : (vals.length - 1)]; };
const seq = (...vals) => { let i = 0; return () => { const v = vals[Math.min(i, vals.length - 1)]; i++; return v; }; };

test('基础回合·队胜：全队分掉彩池、ALLOCATE 确认后入账、Boss 损失其注', () => {
  const t = new SingleTable({ teamRoles: ['farmer', 'farmer'], rng: seq(0.0) });
  assert.equal(t.view().phase, 'COMMAND');
  assert.equal(t.setBet('s0', 3).ok, true);
  assert.equal(t.setBet('s1', 2).ok, true);
  const r = t.resolve();
  assert.equal(r.phase, 'ALLOCATE');                        // 两席位且有收益 → 开分账窗
  assert.equal(r.teamWin, true);
  const done = t.confirmAllocate();
  assert.equal(done.phase, 'COMMAND');                      // 落账进下一回合
  const v = t.view();
  assert.equal(v.round, 2);
  // steward Boss 押 round(65×0.35)=23；队胜彩池 3+2+23=28 全归农民队（等分），Boss −23
  assert.equal(v.boss.balance, 65 - 23);
  assert.equal(v.seats[0].balance + v.seats[1].balance, 20 + 20 + 23); // 队伍净 +bossBet
});

test('队负 + 分账守恒：篡改总量被拒；把债全压给一人 → 他破产、队友保全', () => {
  const t = new SingleTable({ teamRoles: ['farmer', 'farmer'], rng: seq(0.99) });
  t.setBet('s0', 3); t.setBet('s1', 2);
  const r = t.resolve();
  assert.equal(r.teamWin, false);
  assert.equal(r.phase, 'ALLOCATE');                        // 有缺口债务 → 可协商
  const plan = t.view().pendingPlan;
  const debtTotal = Object.values(plan.debts).reduce((a, b) => a + b, 0);
  assert.ok(debtTotal > 0);                                 // G2/S2：target 46 > pot 28 → 有债
  // 篡改总量 → 拒
  assert.match(t.allocate({ takes: plan.takes, debts: { s0: debtTotal + 1, s1: 0 } }).error, /守恒/);
  // 全压 s0 → 落账
  const done = t.allocate({ takes: plan.takes, debts: { s0: debtTotal, s1: 0 } });
  assert.equal(done.ok, true);
  const v = t.view();
  // s1 只损失注金 2（+回合2工资尚未到：round1 无工资）；s0 扛下全部债
  assert.equal(v.seats[1].balance, 20 - 2);
  assert.ok(v.seats[0].balance < v.seats[1].balance);
});

test('工资：偶数回合每席位 +（2+(n−1)），破产判定前发放', () => {
  const t = new SingleTable({ teamRoles: ['farmer', 'farmer'], rng: seq(0.0, 0.0) });
  t.setBet('s0', 1); t.setBet('s1', 1); t.resolve(); t.confirmAllocate();   // 回合1 无工资
  const before = t.view().seats.map(s => s.balance);
  t.setBet('s0', 1); t.setBet('s1', 1); t.resolve(); t.confirmAllocate();   // 回合2 发 2+(2−1)=3
  const after = t.view().seats.map(s => s.balance);
  // 回合2 队胜：Boss 押 round(42×0.35)=15，两人各分 7/8（apportion）+ 工资 3
  assert.equal(after[0] + after[1], before[0] + before[1] + 15 + 3 * 2);
});

test('检察官监管：费进虚空、Boss 罚 2×费、同回合唯一、冷却=农民数回合', () => {
  // 单席检察官（n=1 → 费2、罚4；初始 4 够 2+1）
  const t = new SingleTable({ teamRoles: ['prosecutor'], rng: seq(0.99, 0.99, 0.99) });
  const s = t.summonBoss('s0');
  assert.equal(s.ok, true);
  assert.equal(s.cost, 2);
  assert.equal(t.view().seats[0].balance, 2);               // 4−2 进虚空
  assert.match(t.summonBoss('s0').error, /已监管/);          // 同回合唯一
  t.setBet('s0', 1);
  const r1 = t.resolve();                                    // 队负：注金进 Boss + 罚金落地
  const v1 = t.view();
  // Boss：押23 队负拿走彩池24 + 债…再扣罚 4；只验罚金事件与冷却
  assert.ok(t.lastRoundResult.events.some(e => e.type === 'summonPenalty' && e.amount === 4));
  assert.equal(v1.summon.cooldownOk, false);                 // 冷却 1 回合（n=1）→ 回合2 不可用
  void r1;
});

test('幸运儿：p=0.6 起步、连败怜悯 +5%、敌胜扣 1、队胜清零', () => {
  // 厚资金垫（G2/S2 盘剥一回合就能压死默认身板，本测试只验概率/怜悯管线）
  const t = new SingleTable({
    teamRoles: ['farmer', 'lucky'], rng: seq(0.61, 0.64),
    configOverrides: { single: { initialBalance: { farmer: 60, lucky: 30 } } },
  });
  t.setBet('s0', 2); t.setBet('s1', 1);
  t.resolve();                                               // 0.61 ≥ 0.6 → 败；怜悯=1
  if (t.view().phase === 'ALLOCATE') t.confirmAllocate();
  let v = t.view();
  assert.equal(v.pityLosses, 1);
  assert.equal(v.seats[1].balance, 30 - 1 - 1 - 27);         // 注金1 + 被动扣1 + inverseBet 分到的债27
  t.setBet('s0', 2); t.setBet('s1', 1);
  t.resolve();                                               // p=0.65，0.64 < 0.65 → 胜！怜悯救场
  if (t.view().phase === 'ALLOCATE') t.confirmAllocate();
  v = t.view();
  assert.equal(v.pityLosses, 0);                             // 队胜清零
});

test('暴食者：败局开重掷窗、继承当次概率、次数 3 递减、饭账每回合固定扣', () => {
  const t = new SingleTable({ teamRoles: ['farmer', 'glutton'], rng: seq(0.99, 0.0) });
  t.setBet('s0', 2); t.setBet('s1', 1);
  const r = t.resolve();
  assert.equal(r.phase, 'REFLIP');                           // 败局 + 有重掷次数
  const rr = t.requestReflip('s1');                          // 0.0 < 0.5 → 重掷翻盘
  assert.equal(rr.teamWin, true);
  if (t.view().phase === 'ALLOCATE') t.confirmAllocate();
  const v = t.view();
  assert.equal(v.seats[1].reflipsLeft, 2);                   // 3−1
  assert.equal(v.seats[1].mealDebt, 1);                      // 饭账无视输赢照扣
});

test('幽灵：队胜实拿缩水（幻影进虚空）、Boss 胜时幽灵份额进虚空、幽灵资金恒定', () => {
  const mk = (ghost, coin) => {
    const t = new SingleTable({ teamRoles: ['farmer', 'farmer'], boss: { ghost }, rng: seq(coin) });
    t.setBet('s0', 3); t.setBet('s1', 2);
    t.resolve();
    if (t.view().phase === 'ALLOCATE') t.confirmAllocate();
    return t;
  };
  const win0 = mk(false, 0.0), win1 = mk(true, 0.0);
  const team = (t) => t.view().seats.reduce((x, s) => x + s.balance, 0);
  // 队胜局幽灵是**中性**的：彩池膨胀了幽灵注金、幻影缩水又恰好收回等额 → 实拿=无幽灵基线。
  // （「实拿变少」是相对膨胀后的彩池而言；幽灵的威胁在败局的目标膨胀，见下半段。）
  assert.equal(team(win1), team(win0));
  const ph = win1.lastRoundResult.events.find(e => e.type === 'phantom');
  assert.equal(ph.voided, win1.lastRoundResult.ghostBet);   // 蒸发额 = 幽灵注金（守恒）
  assert.equal(win1.view().boss.ghostBalance, 8);            // 敌方2农民×4；永远收回注金 → 恒定
  const lose0 = mk(false, 0.99), lose1 = mk(true, 0.99);
  assert.ok(lose1.view().boss.balance < lose0.view().boss.balance); // 幽灵份额蒸发 → Boss 实得更少
  assert.ok(lose1.lastRoundResult.events.some(e => e.type === 'ghostVoid'));
  // 但阵营总注更大 → 队伍被榨得更狠
  assert.ok(team(lose1) <= team(lose0));
});

test('终局：Boss 打空 → team 胜；全席位破产 → boss 胜', () => {
  const t = new SingleTable({ teamRoles: ['farmer'], boss: { initialBalance: 1 }, rng: seq(0.0) });
  t.setBet('s0', 5);
  const r = t.resolve();                                     // Boss 资金1 < 2×最小注 → 强制全押1、队胜 → 0 → ENDED
  assert.equal(r.phase, 'ENDED');
  assert.equal(r.winner, 'team');
  const t2 = new SingleTable({ teamRoles: ['lucky'], boss: { initialBalance: 65 }, rng: seq(0.99, 0.99) });
  // lucky 初始2（最小注保留1 → 只能押1）：败局分债扣光 + 被动扣1 → ≤0 破产 → boss 胜
  t2.setBet('s0', 1);
  const r2 = t2.resolve();
  assert.equal(r2.phase, 'ENDED');
  assert.equal(r2.winner, 'boss');
});

console.log(`\n全部通过：${passed} 项 ✅`);
void rngSeq;
