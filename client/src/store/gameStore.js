// 房间/游戏状态镜像 + WebSocket 生命周期。
// state 是服务端 viewFor 的原样镜像，客户端绝不自行计算余额/胜负；
// flights 是飞牌动画的瞬态队列（纯表现）。

import { create } from 'zustand';
import { configureSocket, connectSocket, sendMsg, disconnectSocket } from '../net/socket';

export const useGameStore = create((set, get) => ({
  connected: false,
  joining: false,
  roomId: sessionStorage.getItem('llg_room'),
  playerId: null,
  state: null,
  chat: [],          // {channel, from, name, text, ts}
  toast: null,       // {text, kind}
  kicked: null,      // 被顶号原因
  flights: [],       // {id, value, faceDown, debt, from:{x,y,w,h}, to:{x,y,w,h}}

  connect(token) {
    connectSocket(token);
  },

  disconnect() {
    disconnectSocket();
    sessionStorage.removeItem('llg_room');
    set({ connected: false, joining: false, roomId: null, playerId: null, state: null, chat: [], flights: [] });
  },

  joinRoom(roomId) {
    const id = roomId.trim().toUpperCase();
    sessionStorage.setItem('llg_room', id);
    set({ roomId: id, joining: true });
    sendMsg({ type: 'join_room', roomId: id });
  },

  leaveRoom() {
    sendMsg({ type: 'leave_room' });
    sessionStorage.removeItem('llg_room');
    set({ roomId: null, playerId: null, state: null, chat: [], joining: false, flights: [] });
  },

  send(msg) {
    sendMsg(msg);
  },

  showToast(text, kind = 'error') {
    set({ toast: { text, kind } });
  },
  clearToast() { set({ toast: null }); },
  clearKicked() { set({ kicked: null }); },

  addFlights(items) {
    set(s => ({ flights: [...s.flights, ...items] }));
  },
  removeFlight(id) {
    set(s => ({ flights: s.flights.filter(f => f.id !== id) }));
  },

  _onOpen() {
    set({ connected: true });
    const { roomId } = get();
    if (roomId) {
      set({ joining: true });
      sendMsg({ type: 'join_room', roomId });
    }
  },

  _onClose() {
    set({ connected: false });
  },

  _onMessage(msg) {
    switch (msg.type) {
      case 'joined':
        set({ playerId: msg.playerId, state: msg.state, chat: msg.chatHistory ?? [], joining: false });
        break;
      case 'state':
        set({ state: msg.state });
        break;
      case 'chat':
        set(s => ({ chat: [...s.chat, msg] }));
        break;
      case 'kicked':
        set({ kicked: msg.reason ?? '连接被服务器关闭' });
        break;
      case 'error':
        if (get().joining) {
          // 加入失败（房间不存在/已开始/已满）：回到大厅
          sessionStorage.removeItem('llg_room');
          set({ roomId: null, joining: false });
        }
        get().showToast(msg.message ?? '发生错误');
        break;
      default:
        break;
    }
  },
}));

configureSocket({
  onOpen: () => useGameStore.getState()._onOpen(),
  onClose: () => useGameStore.getState()._onClose(),
  onMessage: (msg) => useGameStore.getState()._onMessage(msg),
});
