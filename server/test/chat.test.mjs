// 聊天健壮性测试（聊天 2.0）：恶意输入清洗、限流、日志上限、频道权限。
// 跑法：node server/test/chat.test.mjs
import assert from 'node:assert/strict';
import { Room } from '../Room.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

function setup() {
  const room = new Room('TEST', '测试房', 'quick', {});
  const a = room.addPlayer('甲', null).playerId;
  const b = room.addPlayer('乙', null).playerId;
  return { room, a, b };
}

test('超长输入截断到 200 字符（绕过客户端 maxLength 的 WS 直发）', () => {
  const { room, a } = setup();
  assert.equal(room.chat(a, 'public', 'x'.repeat(10000)).ok, true);
  assert.equal(room.chatLog[room.chatLog.length - 1].text.length, 200);
});

test('控制字符/换行压成空格（不产生多行消息或不可见字符）', () => {
  const { room, a } = setup();
  const dirty = 'a' + String.fromCharCode(10, 13, 9, 1) + 'b cd';
  assert.equal(room.chat(a, 'public', dirty).ok, true);
  const t = room.chatLog[room.chatLog.length - 1].text;
  assert.equal([...t].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127), false);
  assert.equal(t.includes('a'), true);
  assert.equal(t.includes('d'), true);
});

test('纯空白/纯控制字符消息被拒绝', () => {
  const { room, a } = setup();
  assert.ok(room.chat(a, 'public', '   ').error);
  assert.ok(room.chat(a, 'public', '\n\n\t').error);
  assert.ok(room.chat(a, 'public', '').error);
  assert.ok(room.chat(a, 'public', null).error);
});

test('限流：10s 窗口内第 9 条被拒，窗口过后恢复；各玩家独立计数', () => {
  const { room, a, b } = setup();
  for (let i = 0; i < 8; i++) assert.equal(room.chat(a, 'public', `msg${i}`).ok, true);
  assert.ok(room.chat(a, 'public', '第9条').error, '第 9 条应被限流');
  // 另一个玩家不受影响
  assert.equal(room.chat(b, 'public', '我还能说').ok, true);
  // 时间前进 11s：窗口滑走，恢复发言
  const realNow = Date.now;
  try {
    const base = realNow();
    Date.now = () => base + 11000;
    assert.equal(room.chat(a, 'public', '窗口过了').ok, true);
  } finally { Date.now = realNow; }
});

test('chatLog 上限 200 条（重连回放体积有界）', () => {
  const { room, a } = setup();
  const realNow = Date.now;
  try {
    let t = realNow();
    for (let i = 0; i < 260; i++) {
      Date.now = () => (t += 2000); // 每条隔 2s，避开限流
      assert.equal(room.chat(a, 'public', `m${i}`).ok, true);
    }
  } finally { Date.now = realNow; }
  assert.equal(room.chatLog.length, 200);
  assert.equal(room.chatLog[room.chatLog.length - 1].text, 'm259');
});

test('频道权限：非农民不能发密谈、活跃玩家不能发观战频道、未知频道被拒', () => {
  const { room, a } = setup();
  room.takeRole(a, 'landlord');
  assert.ok(room.chat(a, 'farmer', '偷听').error);
  assert.ok(room.chat(a, 'spectator', '装观众').error);
  assert.ok(room.chat(a, 'hax', '不存在的频道').error);
});

test('观战者发言强制进观战频道（上帝视角不外泄）', () => {
  const { room, a } = setup();
  const p = room.players.get(a);
  p.bankrupt = true;
  assert.equal(room.chat(a, 'public', '我看到你们的牌了').ok, true);
  assert.equal(room.chatLog[room.chatLog.length - 1].channel, 'spectator');
});

console.log(`全部通过：${passed} 项 ✅`);
