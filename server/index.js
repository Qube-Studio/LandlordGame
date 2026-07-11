// 接入层：Express REST（账号/大厅）+ ws WebSocket（房间内一切交互）。
// 自身不含游戏规则，只做鉴权与消息分发（见 docs/GAME_SPEC.md §2.4-2.6）。

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { Room } from './Room.js';
import { listModes, getMode } from './modes/index.js';
import { DEFAULT_CONFIG } from './config.js';
import * as auth from './auth.js';
import { ERR, SINGLE } from './text.js';
import { SingleSession, SINGLE_INTENTS } from './single/session.js';

const TEST_MODE = process.env.LLG_TEST === '1'; // 本地测试开关（任务③）：仅 npm run dev 开启

const ALLOWED_ORIGINS = new Set([
  'https://landlord-game-client.vercel.app',
  'http://localhost:5173',
  'http://localhost:3001',
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
]);

// 放行规则：无 Origin（非浏览器）/ 白名单 / 同源（Origin 的 host 与请求 Host 一致）。
// 同源放行是为了支持「前后端同机部署」（如香港服务器，origin=http://<ip或域名>），
// 这类 origin 不在白名单里也应允许，否则 WebSocket 握手会被拒、一直连不上。
function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { if (new URL(origin).host === host) return true; } catch { /* 非法 origin */ }
  return false;
}

const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }) => isAllowedOrigin(req.headers.origin, req.headers.host),
});

const rooms = new Map(); // roomId -> Room

// ---------- REST ----------

function requireAuth(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const username = auth.resolveToken(token);
  if (!username) return res.status(401).json({ error: ERR.authExpired });
  req.username = username;
  req.token = token;
  next();
}

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body ?? {};
  const result = auth.register(username, password);
  if (result.error) return res.status(400).json(result);
  res.status(201).json({ ok: true, username: result.username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const result = auth.login(username, password);
  if (result.error) return res.status(401).json({ error: result.error });
  if (result.kickedSocket) {
    try {
      result.kickedSocket.send(JSON.stringify({ type: 'kicked', reason: ERR.dupLogin }));
      result.kickedSocket.close();
    } catch { /* 旧连接可能已失效 */ }
  }
  res.json({ token: result.token, username: result.username });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  auth.logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.username });
});

app.get('/api/online', (req, res) => {
  const users = auth.listOnline();
  res.json({ count: users.length, users });
});

app.get('/api/modes', (req, res) => {
  res.json(listModes());
});

app.post('/api/rooms', requireAuth, (req, res) => {
  const { name, mode, config } = req.body ?? {};
  const modeDef = getMode(mode ?? 'quick');
  if (!modeDef) return res.status(400).json({ error: ERR.unknownMode });
  if (!modeDef.available) return res.status(400).json({ error: ERR.modeUnavailable(modeDef.label) });
  const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
  rooms.set(roomId, new Room(roomId, name, modeDef.id, config ?? {}));
  res.status(201).json({ roomId });
});

app.get('/api/rooms', requireAuth, (req, res) => {
  res.json([...rooms.values()].map(r => r.lobbySummary()));
});

// ---------- WebSocket ----------

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const username = auth.resolveToken(url.searchParams.get('token'));
  if (!username) {
    ws.send(JSON.stringify({ type: 'error', message: ERR.notLoggedIn, code: 'UNAUTHORIZED' }));
    ws.close();
    return;
  }
  ws.username = username;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const kicked = auth.bindSocket(username, ws);
  if (kicked) {
    try {
      kicked.send(JSON.stringify({ type: 'kicked', reason: ERR.dupLogin }));
      kicked.close();
    } catch { /* 旧连接可能已失效 */ }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type } = msg;

    if (type === 'join_room') {
      const room = rooms.get((msg.roomId ?? '').toUpperCase());
      if (!room) { send(ws, { type: 'error', message: ERR.roomNotFound }); return; }
      const result = room.addPlayer(username, ws);
      if (result.error) { send(ws, { type: 'error', message: result.error }); return; }
      ws.roomId = room.roomId;
      ws.playerId = result.playerId;
      send(ws, {
        type: 'joined',
        playerId: result.playerId,
        state: room.viewFor(result.playerId),
        chatHistory: room.chatHistoryFor(result.playerId),
      });
      return;
    }

    // 应用级保活：客户端用它做活性自检（见 client/src/net/socket.js）。无需房间。
    if (type === 'ping') { send(ws, { type: 'pong' }); return; }

    // ---------- 单人模式（§9.6）：会话随连接活，不占房间系统 ----------
    if (type === 'single_start') {
      ws.singleSession?.destroy();
      try {
        ws.singleSession = new SingleSession({
          teamRoles: msg.teamRoles, persona: msg.persona, ghost: !!msg.ghost,
          configOverrides: msg.config ?? {},
          send: (m) => send(ws, m),
        });
      } catch {
        send(ws, { type: 'error', message: SINGLE.errBadTeam });
        return;
      }
      send(ws, { type: 'joined', playerId: ws.singleSession.seatId, state: ws.singleSession.view(), chatHistory: [] });
      return;
    }
    if (ws.singleSession) {
      if (type === 'single_quit') { ws.singleSession.destroy(); ws.singleSession = null; return; }
      if (SINGLE_INTENTS.has(type)) {
        const r = ws.singleSession.handle(type, msg);
        if (r?.error) send(ws, { type: 'error', message: r.error });
        return;
      }
    }

    const room = rooms.get(ws.roomId);
    if (!room) { send(ws, { type: 'error', message: ERR.noRoomJoined }); return; }
    const pid = ws.playerId;
    let result;

    switch (type) {
      case 'leave_room':
        result = room.leave(pid);
        ws.roomId = null;
        ws.playerId = null;
        break;
      case 'take_role': result = room.takeRole(pid, msg.role); break;
      case 'start_game': result = room.startGame(pid); break;
      case 'ready': result = room.setReady(pid); break;
      case 'lobby_ready': result = room.setLobbyReady(pid, !!msg.ready); break; // 大厅准备（协调信号，不门槛开局）
      case 'place_bet': result = room.placeBet(pid, Number(msg.amount), Number(msg.count), Number(msg.pledge)); break; // pledge：竞技投资人手牌投保（§8.3）
      case 'confirm_reveal': result = room.confirmReveal(pid); break;
      case 'request_reflip': result = room.requestReflip(pid); break;                        // 竞技暴食者重掷（§8.4）
      case 'pass_reflip': result = room.passReflip(pid); break;                              // 竞技暴食者放弃重掷
      case 'negotiate_transfer': result = room.negotiateTransfer(pid, msg.toId, msg.kind, Number(msg.amount)); break;
      case 'transfer_ticket': result = room.transferTicket(pid, msg.toId, Number(msg.n)); break;      // 对质票转赠（§8.8，NEGOTIATE）
      case 'negotiate_confirm': result = room.negotiateConfirm(pid, msg.confirmed); break;
      case 'summon': result = room.summon(pid); break;                                               // 检察官：传唤（§8.9，BETTING 下注前）
      case 'accuse': result = room.accuse(pid, msg.targetId); break;                                  // 对质：发起指控（§8.8）
      case 'accuse_pick': result = room.accusePick(pid, msg.dir); break;                              // 对质：预选方向（两段确认第一击，队友可见）
      case 'accuse_resolve': result = room.accuseResolve(pid, msg.dir); break;                        // 对质：落定 多/少
      case 'accuse_cancel': result = room.accuseCancel(pid); break;                                   // 对质：取消（票不退，回决定窗）
      case 'challenge_skip': result = room.challengeSkip(pid); break;                                 // 对质：投票跳过
      case 'take_payout': result = room.takePayout(pid); break;                              // 桌面显式结算：拿取（§3.8）
      case 'chat': result = room.chat(pid, msg.channel ?? 'public', msg.text); break;
      case 'set_emote': result = room.setEmote(pid, msg.emote ?? null); break; // 任务⑧ 预留：手动表情
      case 'look':
        room.setLook(pid, Number(msg.yaw), Number(msg.pitch)); // 任务⑦：高频中继，不回错误
        return;
      case 'dev_fill': // 任务③ 本地测试：补满真实测试玩家
        if (!TEST_MODE) { send(ws, { type: 'error', message: ERR.testModeOff }); return; }
        result = room.devFill();
        break;
      case 'dev_act_as': { // 任务③ 本地测试：附身控制某个玩家，单人玩全部角色
        if (!TEST_MODE) { send(ws, { type: 'error', message: ERR.testModeOff }); return; }
        const r = room.possess(ws, msg.playerId);
        if (r.error) { send(ws, { type: 'error', message: r.error }); return; }
        ws.playerId = msg.playerId;
        send(ws, {
          type: 'joined',
          playerId: msg.playerId,
          state: room.viewFor(msg.playerId),
          chatHistory: room.chatHistoryFor(msg.playerId),
        });
        return;
      }
      case 'restart_game': result = room.restartGame(pid); break;
      case 'get_state':
        send(ws, { type: 'state', state: room.viewFor(pid) });
        return;
      case 'voice_join':
      case 'voice_leave':
      case 'voice_signal':
        // 语音联机预留接口（docs/GAME_SPEC.md §2.5）
        send(ws, { type: 'error', message: ERR.voiceNotImplemented, code: 'NOT_IMPLEMENTED' });
        return;
      default:
        send(ws, { type: 'error', message: ERR.unknownMsgType(type) });
        return;
    }
    if (result?.error) send(ws, { type: 'error', message: result.error });
  });

  ws.on('close', () => {
    auth.unbindSocket(username, ws);
    const room = rooms.get(ws.roomId);
    if (room && ws.playerId) room.handleDisconnect(ws.playerId);
  });
});

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

// 心跳：清理失联连接
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, DEFAULT_CONFIG.heartbeatSec * 1000);

// 清扫：空房间立即回收；全员离线超过 5 分钟的房间回收
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.isEmpty() || (room.allOffline() && now - room.lastActivity > 5 * 60 * 1000)) {
      room.destroy();
      rooms.delete(id);
    }
  }
}, 60 * 1000);

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
