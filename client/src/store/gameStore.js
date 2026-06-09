import { create } from 'zustand';

export const useGameStore = create((set, get) => ({
  ws: null,
  connected: false,
  roomId: null,
  playerId: null,
  gameState: null,
  chatMessages: [],
  bankruptChat: [],
  pendingLoanRequests: [],
  error: null,

  setWs: (ws) => set({ ws }),
  setConnected: (v) => set({ connected: v }),

  connect: (roomId, playerName) => {
    const wsUrl = `ws://${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ connected: true, error: null });
      ws.send(JSON.stringify({ type: 'join_room', roomId, name: playerName }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      get().handleMessage(msg);
    };

    ws.onclose = () => set({ connected: false });
    ws.onerror = () => set({ error: '连接失败' });

    set({ ws, roomId });
  },

  handleMessage: (msg) => {
    const { type } = msg;

    if (type === 'joined') {
      set({ playerId: msg.playerId, gameState: msg.state });
    } else if (type === 'state_update') {
      set({ gameState: msg.state });
    } else if (type === 'chat') {
      if (msg.channel === 'public') {
        set(s => ({ chatMessages: [...s.chatMessages.slice(-99), msg] }));
      } else if (msg.channel === 'bankrupt') {
        set(s => ({ bankruptChat: [...s.bankruptChat.slice(-99), msg] }));
      }
    } else if (type === 'loan_requested') {
      set(s => ({ pendingLoanRequests: [...s.pendingLoanRequests, msg.loanRequest] }));
    } else if (type === 'loan_approved' || type === 'loan_rejected') {
      set(s => ({
        pendingLoanRequests: s.pendingLoanRequests.filter(l => l.id !== msg.loanRequestId),
      }));
    } else if (type === 'error') {
      set({ error: msg.message });
    }
    // All state-changing events also trigger a get_state request
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN && ['settlement', 'game_started', 'loan_granted', 'loan_forgiven'].includes(type)) {
      ws.send(JSON.stringify({ type: 'get_state' }));
    }
  },

  send: (msg) => {
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  },

  clearError: () => set({ error: null }),
}));
