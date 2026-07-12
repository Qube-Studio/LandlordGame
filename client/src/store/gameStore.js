// 房间/游戏状态镜像 + WebSocket 生命周期。
// state 是服务端 viewFor 的原样镜像，客户端绝不自行计算余额/胜负。

import { create } from 'zustand';
import { configureSocket, connectSocket, sendMsg, disconnectSocket } from '../net/socket';
import { T } from '../text';

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
  chatTab: 'all',    // 聊天页签（聊天 2.0）：'all' | 'faction' | 'system'
  chatFlash: 0,      // 聊天区高亮脉冲计数：localSys 重复触发时 +1，McChat 播一次高亮
  spaceHeld: false,  // 空格按住中（浮字合成按下态；松开才触发动作，与鼠标松开判定一致）
  betFlight: null,   // 下注时手牌→桌面的 3D 飞行：{round, items:[{id,value,fromScreen:{x,y}}]}
  myStack: null,     // 自己实际放到桌上的牌（与飞出去的是同一批）：{round, notes:[{id,value,slot}]}
  looks: {},         // 其他玩家头部朝向（任务⑦，高频瞬态，不走全量 state）：{ playerId: {yaw, pitch} }
  panel: null,       // 桌沿抽屉（HUD 2.0）：当前升起的面板 'roles' | 'ledger' | null（收起）
  singleCam: 'walk', // 单人相机（§9.6 交互 v2）：'walk' 全局走动 | 'seat' 附身当前席位（纯表现状态）

  connect(token) {
    connectSocket(token);
  },

  disconnect() {
    disconnectSocket();
    sessionStorage.removeItem('llg_room');
    set({ connected: false, joining: false, roomId: null, playerId: null, state: null, chat: [], chatTab: 'all', chatFlash: 0, insuranceDrops: [], betFlight: null, myStack: null, looks: {}, panel: null });
  },

  joinRoom(roomId) {
    const id = roomId.trim().toUpperCase();
    sessionStorage.setItem('llg_room', id);
    set({ roomId: id, joining: true });
    sendMsg({ type: 'join_room', roomId: id });
  },

  // 单人模式（§9.6）：会话随连接活，不占房间系统——不写 sessionStorage（断线即回大厅，无重连恢复）。
  // 直接进 3D 组队期（SINGLE_SETUP 相位）：选角/幽灵/开局都在桌边席位列完成，无 2D 面板。
  startSingle() {
    set({ roomId: 'SINGLE', joining: true, singleCam: 'walk' });
    sendMsg({ type: 'single_start' });
  },
  setSingleCam(v) { set(s => (s.singleCam === v ? {} : { singleCam: v })); },

  leaveRoom() {
    sendMsg({ type: get().roomId === 'SINGLE' ? 'single_quit' : 'leave_room' });
    sessionStorage.removeItem('llg_room');
    set({ roomId: null, playerId: null, state: null, chat: [], chatTab: 'all', chatFlash: 0, joining: false, insuranceDrops: [], betFlight: null, myStack: null, looks: {}, panel: null, balanceFreeze: null, singleCam: 'walk' });
  },

  send(msg) {
    // 断线时发送会静默失败：给用户明确反馈（高频的 look 不弹，避免刷屏）。
    if (!sendMsg(msg) && msg?.type !== 'look') get().showToast(T.net.reconnecting);
  },

  setChatOpen(v) { set({ chatOpen: v }); },
  setChatTab(v) { set({ chatTab: v }); },
  setSpaceHeld(v) { set(s => (s.spaceHeld === v ? {} : { spaceHeld: v })); },

  // 拿取入账演出（§3.8）：按 F/点击拿取先把右下余额**显示**冻在旧值（服务端余额照常更新），
  // 等 PayoutLayer 的拿取飞行落到蜡烛上再放开——那一刻数字才跳、动画才播（钱没到数字不动）。
  balanceFreeze: null,
  takePayout() {
    const bal = get().state?.me?.balance;
    if (typeof bal === 'number') set({ balanceFreeze: bal });
    get().send({ type: 'take_payout' });
  },
  releaseBalanceFreeze() { set(s => (s.balanceFreeze == null ? {} : { balanceFreeze: null })); },

  // 本地系统消息（聊天 2.0 底座）：仅本端可见，不进服务端、不随重连回放。
  // 同 key 的旧消息被新消息顶掉。flash=true：金框脉冲 + 强制切系统页签。
  // refresh=true：即使同 key 同文案已是最新，也重发（换新 ts）——重置收起态显示计时、重新淡出
  //   （反复触发要每次刷新显示时长时用，如反复点「未选择角色」）；默认 false 时同文案不重发。
  localSys(text, { key, flash = false, refresh = false } = {}) {
    set(s => {
      const patch = flash ? { chatFlash: s.chatFlash + 1, chatTab: 'system' } : {};
      const last = s.chat[s.chat.length - 1];
      if (!refresh && key && last?.localKey === key && last.text === text) return patch;
      const chat = key ? s.chat.filter(m => m.localKey !== key) : s.chat.slice();
      chat.push({ channel: 'public', from: null, name: '', text, ts: Date.now(), system: true, local: true, localKey: key ?? null });
      return { ...patch, chat: chat.slice(-300) };
    });
  },

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
  // 3D 直接下注：牌已被拖到桌上（HandLayer 暂存），确认时无需飞行——这批牌原地成为 myStack。
  placeTableStack({ round, notes }) {
    set({ myStack: { round, notes: notes.map((n, i) => ({ id: n.id, value: n.value, slot: i })) }, betFlight: null });
  },

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
    if (roomId === 'SINGLE') {
      // 单人会话随连接死（服务端无恢复），断线重连=回大厅（v1 取舍：单机局短，重开成本低）。
      set({ roomId: null, playerId: null, state: null, joining: false });
      return;
    }
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
      case 'state': {
        // 单人模式席位切换（§9.6）：me 随 single.seatId 换人 → playerId（3D 场景锚点）必须跟着走，
        // 并清掉上一席位的下注瞬态（myStack/betFlight），否则手牌/桌面堆锚错座位。
        const sid = msg.state?.single?.seatId;
        if (sid && sid !== get().playerId) set({ state: msg.state, playerId: sid, betFlight: null, myStack: null });
        else set({ state: msg.state });
        break;
      }
      case 'chat':
        // 上限 300：恶意刷屏（即便被服务端限流）也不能无限撑大内存/渲染列表
        set(s => ({ chat: [...s.chat, msg].slice(-300) }));
        break;
      case 'look':
        // 他人头部朝向（高频瞬态）：只更新 looks，不触发 state 重渲染逻辑。
        set(s => ({ looks: { ...s.looks, [msg.id]: { yaw: msg.yaw, pitch: msg.pitch } } }));
        break;
      case 'kicked':
        set({ kicked: msg.reason ?? T.net.kicked });
        break;
      case 'error':
        if (msg.code === 'UNAUTHORIZED') {
          // token 失效（常见于服务端重启清空了会话）：提示重新登录，避免无限重连转圈。
          set({ kicked: T.net.expired });
          return;
        }
        if (get().joining) {
          // 加入失败（房间不存在/已开始/已满）：回到大厅
          sessionStorage.removeItem('llg_room');
          set({ roomId: null, joining: false });
        }
        get().showToast(msg.message ?? T.net.error);
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
