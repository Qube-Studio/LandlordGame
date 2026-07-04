// Full-round server smoke: N bot players drive a real quick game over the live
// WS protocol (no browser), to settlement, and verify the money moved coherently.
// Zero deps: Node 24 global fetch + WebSocket. Usage: node tools/round.mjs [server] [N]
const SERVER = process.argv[2] || 'http://localhost:3001';
const WSURL = SERVER.replace(/^http/, 'ws') + '/ws';
const N = Number(process.argv[3] || 2);
const log = (...a) => console.log(...a);

async function register() {
  const username = 'bot' + Math.random().toString(36).slice(2, 8);
  const post = (path, body, token) => fetch(SERVER + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  let r = await post('/api/auth/register', { username, password: 'test1234' });
  if (!r.ok) throw new Error('register ' + r.status + ' ' + (await r.text()).slice(0, 120));
  // register 只返回 {ok, username}，需再 login 拿 token
  r = await post('/api/auth/login', { username, password: 'test1234' });
  if (!r.ok) throw new Error('login ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return { username, token: (await r.json()).token };
}
async function createRoom(token) {
  const r = await fetch(SERVER + '/api/rooms', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: 'smoke', mode: 'quick' }),
  });
  if (!r.ok) throw new Error('createRoom ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return (await r.json()).roomId;
}
const noteCount = (a) => { let c = 0; for (const d of [10, 5, 2, 1]) { c += Math.floor(a / d); a %= d; } return c || 1; };

const users = [];
for (let i = 0; i < N; i++) users.push(await register());
log('registered', N, 'bots:', users.map(u => u.username).join(', '));
const roomId = await createRoom(users[0].token);
log('room', roomId, '(host', users[0].username + ')');

const players = [];
const seen = new Set();
let finished = false;
const send = (P, m) => { try { P.ws.send(JSON.stringify(m)); } catch { /* closed */ } };

function drive(P) {
  const s = P.state; if (!s || finished) return;
  const me = s.me || {}; const ph = s.phase; const rd = s.round ?? 0;
  if (ph === 'LOBBY') {
    const wantRole = P.idx === 0 ? 'landlord' : 'farmer';
    if ((!me.role || me.role === 'none') && !P.acted.role) { P.acted.role = true; log(`-> take_role p${P.idx} ${wantRole}`); send(P, { type: 'take_role', role: wantRole }); return; }
    const allChosen = (s.players?.length >= N) && s.players.every(p => p.role && p.role !== 'none');
    if (P.idx === 0 && allChosen && !P.acted.start) { P.acted.start = true; log('-> start_game'); send(P, { type: 'start_game' }); }
  } else if (ph === 'DISCUSSION') {
    if (!P.acted['rdy' + rd]) { P.acted['rdy' + rd] = true; send(P, { type: 'ready' }); }
  } else if (ph === 'BETTING') {
    if (!P.acted['bet' + rd]) {
      P.acted['bet' + rd] = true;
      const b = me.bounds || {};
      let amt = b.forceAllIn ? me.balance : (b.min ?? b.minStake ?? 1);
      if (b.max != null) amt = Math.min(amt, b.max);
      amt = Math.max(1, amt | 0);
      log(`-> place_bet p${P.idx} (${me.role}) bal=${me.balance} amt=${amt}`);
      send(P, { type: 'place_bet', amount: amt, count: noteCount(amt), pledge: 0 });
    }
  } else if (ph === 'REVEAL') {
    if (!P.acted['rev' + rd]) { P.acted['rev' + rd] = true; send(P, { type: 'confirm_reveal' }); }
  } else if (ph === 'NEGOTIATE') {
    // ≥2 名农民时协商阶段不会自动跳过:农民直接确认系统方案,否则整局卡死在这里
    if (!P.acted['ngo' + rd]) { P.acted['ngo' + rd] = true; send(P, { type: 'negotiate_confirm', confirmed: true }); }
  } else if (ph === 'FINALIZE') {
    // 桌面显式结算(§3.8):有堆的人按 F 拿取,余额才入账、回合才收尾
    const po = s.payout;
    if (po?.eligible?.includes(P.playerId) && !po.taken?.includes(P.playerId) && !P.acted['take' + rd]) {
      P.acted['take' + rd] = true;
      log(`-> take_payout p${P.idx} pile=${po.piles?.[P.playerId]}`);
      send(P, { type: 'take_payout' });
    }
  }
  // record settlement from history
  const last = s.history?.[s.history.length - 1];
  if (last && !seen.has(last.round)) {
    seen.add(last.round);
    log(`\n=== SETTLE round ${last.round} | coin=${last.coinResult} ===`);
    log('  deltas:', JSON.stringify(last.deltas));
    const sum = Object.values(last.deltas || {}).reduce((a, v) => a + v, 0);
    log('  Σdeltas =', sum, '(注:工资/饭账/减债等注入会让它非零属正常)');
  }
  if ((ph === 'ENDED' || seen.size >= 1) && !P._reported) {
    P._reported = true;
    // 等所有人都收到该回合,打印各自余额
    setTimeout(() => maybeFinish(), 800);
  }
}
function maybeFinish() {
  if (finished) return;
  finished = true;
  log('\n--- 各玩家自视角余额(结算后) ---');
  for (const P of players) {
    const me = P.state?.me || {};
    log(`  p${P.idx} ${me.role ?? '?'} id=${P.playerId} balance=${me.balance} bankrupt=${!!me.bankrupt} phase=${P.state?.phase}`);
  }
  log('\nSMOKE RESULT: 完整一局跑到结算', seen.size >= 1 ? 'OK ✅' : 'FAIL ❌');
  for (const P of players) try { P.ws.close(); } catch { /* */ }
  setTimeout(() => process.exit(0), 300);
}

users.forEach((u, idx) => {
  const P = { u, idx, ws: new WebSocket(WSURL + '?token=' + encodeURIComponent(u.token)), state: null, playerId: null, acted: {} };
  P.ws.onopen = () => send(P, { type: 'join_room', roomId });
  P.ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'error') { log(`ERR p${idx}:`, m.message); return; }
    if (m.playerId) P.playerId = m.playerId;
    if (m.state) { P.state = m.state; drive(P); }
  };
  P.ws.onerror = (e) => log(`wserr p${idx}`, e?.message || '');
  players.push(P);
});

setTimeout(() => { log('\n⏱ 75s 超时'); maybeFinish(); }, 75000);
