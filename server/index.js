import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { GameRoom } from './GameRoom.js';

const app = express();
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const rooms = {}; // roomId -> GameRoom

// REST: create room
app.post('/api/rooms', (req, res) => {
  const roomId = uuid().slice(0, 6).toUpperCase();
  const config = req.body.config ?? {};
  rooms[roomId] = new GameRoom(roomId, config);
  res.json({ roomId });
});

// REST: list rooms (lobby)
app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms).map(r => ({
    roomId: r.roomId,
    phase: r.phase,
    playerCount: Object.keys(r.players).length,
  }));
  res.json(list);
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, roomId, playerId } = msg;

    if (type === 'join_room') {
      const room = rooms[roomId];
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: '房间不存在' })); return; }
      const id = room.addPlayer(ws, msg.name ?? '匿名');
      ws.roomId = roomId;
      ws.send(JSON.stringify({ type: 'joined', playerId: id, state: room.getStateFor(id) }));
      return;
    }

    const room = rooms[ws.roomId];
    if (!room) { ws.send(JSON.stringify({ type: 'error', message: '未加入房间' })); return; }
    const pid = ws.playerId;

    switch (type) {
      case 'assign_role': {
        const result = room.assignRole(pid, msg.role);
        ws.send(JSON.stringify({ type: 'assign_role_result', ...result }));
        room._broadcastState();
        break;
      }
      case 'start_game': {
        const result = room.startGame();
        ws.send(JSON.stringify({ type: 'start_game_result', ...result }));
        break;
      }
      case 'place_bet': {
        const result = room.placeBet(pid, Number(msg.amount));
        ws.send(JSON.stringify({ type: 'place_bet_result', ...result }));
        break;
      }
      case 'request_loan': {
        const result = room.requestLoan(pid, Number(msg.amount), Number(msg.repayRounds));
        ws.send(JSON.stringify({ type: 'request_loan_result', ...result }));
        break;
      }
      case 'approve_loan': {
        const result = room.approveLoan(pid, msg.borrowerId, Number(msg.amount), Number(msg.repayRounds));
        ws.send(JSON.stringify({ type: 'approve_loan_result', ...result }));
        break;
      }
      case 'file_complaint': {
        const result = room.fileComplaint(pid, msg.loanRequestId);
        ws.send(JSON.stringify({ type: 'file_complaint_result', ...result }));
        break;
      }
      case 'forgive_loan': {
        const result = room.forgiveLoan(pid, msg.loanId);
        ws.send(JSON.stringify({ type: 'forgive_loan_result', ...result }));
        break;
      }
      case 'negotiate_propose': {
        const result = room.submitNegotiationProposal(pid, msg.distribution);
        ws.send(JSON.stringify({ type: 'negotiate_propose_result', ...result }));
        break;
      }
      case 'skip_negotiation': {
        room.skipNegotiation();
        break;
      }
      case 'chat': {
        room.chat(pid, msg.message);
        break;
      }
      case 'get_state': {
        ws.send(JSON.stringify({ type: 'state_update', state: room.getStateFor(pid) }));
        break;
      }
      default:
        ws.send(JSON.stringify({ type: 'error', message: `未知消息类型: ${type}` }));
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomId];
    if (room && ws.playerId) room.removePlayer(ws.playerId);
  });
});

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
