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
  flights: [],       // {id, value, faceDown, debt, from:{x,y,w,h}, to:{x,y,w,h}} —— 仅用于结算回收的 2D 飞行
  chatOpen: false,   // 左下角聊天输入是否展开（也用于屏蔽游戏快捷键）
  betFlight: null,   // 下注时手牌→桌面的 3D 飞行：{round, items:[{id,value,fromScreen:{x,y}}]}
  myStack: null,     // 自己实际放到桌上的牌（与飞出去的是同一批）：{round, notes:[{id,value,slot}]}
  looks: {},         // 其他玩家头部朝向（任务⑦，高频瞬态，不走全量 state）：{ playerId: {yaw, pitch} }

  connect(token) {
    connectSocket(token);
  },

  disconnect() {
    disconnectSocket();
    sessionStorage.removeItem('llg_room');
    set({ connected: false, joining: false, roomId: null, playerId: null, state: null, chat: [], flights: [], betFlight: null, myStack: null, looks: {} });
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
    set({ roomId: null, playerId: null, state: null, chat: [], joining: false, flights: [], betFlight: null, myStack: null, looks: {} });
  },

  send(msg) {
    sendMsg(msg);
  },

  setChatOpen(v) { set({ chatOpen: v }); },

  // 下注：记录这批牌（同一批既用于 3D 飞行，飞行结束后留在桌上作为 myStack）
  startBetFlight({ round, items }) {
    set({
      betFlight: { round, items },
      myStack: { round, notes: items.map((it, i) => ({ id: it.id, value: it.value, slot: i })) },
    });
  },
  finalizeBetFlight() { set({ betFlight: null }); },

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
        // 初次加入 / 测试模式附身切换都会收到 joined：重置下注瞬态，避免自己的桌面堆叠残留上一身份的牌。
        set({ playerId: msg.playerId, state: msg.state, chat: msg.chatHistory ?? [], joining: false, betFlight: null, myStack: null });
        break;
      case 'state':
        set({ state: msg.state });
        break;
      case 'chat':
        set(s => ({ chat: [...s.chat, msg] }));
        break;
      case 'look':
        // 他人头部朝向（高频瞬态）：只更新 looks，不触发 state 重渲染逻辑。
        set(s => ({ looks: { ...s.looks, [msg.id]: { yaw: msg.yaw, pitch: msg.pitch } } }));
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
