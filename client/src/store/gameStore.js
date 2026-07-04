// 房间/游戏状态镜像 + WebSocket 生命周期。
// state 是服务端 viewFor 的原样镜像，客户端绝不自行计算余额/胜负。

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
  insuranceDrops: [],// 投资人投保确认后，保单牌一张张掉出屏幕（不上桌）的瞬态队列
  chatOpen: false,   // 左下角聊天输入是否展开（也用于屏蔽游戏快捷键）
  betFlight: null,   // 下注时手牌→桌面的 3D 飞行：{round, items:[{id,value,fromScreen:{x,y}}]}
  myStack: null,     // 自己实际放到桌上的牌（与飞出去的是同一批）：{round, notes:[{id,value,slot}]}
  looks: {},         // 其他玩家头部朝向（任务⑦，高频瞬态，不走全量 state）：{ playerId: {yaw, pitch} }
  panel: null,       // 桌沿抽屉（HUD 2.0）：当前升起的面板 'roles' | 'ledger' | null（收起）

  connect(token) {
    connectSocket(token);
  },

  disconnect() {
    disconnectSocket();
    sessionStorage.removeItem('llg_room');
    set({ connected: false, joining: false, roomId: null, playerId: null, state: null, chat: [], insuranceDrops: [], betFlight: null, myStack: null, looks: {}, panel: null });
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
    set({ roomId: null, playerId: null, state: null, chat: [], joining: false, insuranceDrops: [], betFlight: null, myStack: null, looks: {}, panel: null });
  },

  send(msg) {
    // 断线时发送会静默失败：给用户明确反馈（高频的 look 不弹，避免刷屏）。
    if (!sendMsg(msg) && msg?.type !== 'look') get().showToast('连接已断开，正在重连…');
  },

  setChatOpen(v) { set({ chatOpen: v }); },

  // 桌沿抽屉：呼出/收起选角墙与账本（纯表现状态，不进服务器）。
  setPanel(v) { set({ panel: v }); },
  togglePanel(v) { set(s => ({ panel: s.panel === v ? null : v })); },

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

  dropInsurance(items) {
    set(s => ({ insuranceDrops: [...s.insuranceDrops, ...items] }));
  },
  removeInsuranceDrop(id) {
    set(s => ({ insuranceDrops: s.insuranceDrops.filter(d => d.id !== id) }));
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
        if (msg.code === 'UNAUTHORIZED') {
          // token 失效（常见于服务端重启清空了会话）：提示重新登录，避免无限重连转圈。
          set({ kicked: '登录已过期，请重新登录' });
          return;
        }
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
