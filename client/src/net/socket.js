// WebSocket 单例封装：自动重连、消息分发、活性自检。
// 不直接 import store（处理器由 gameStore 注入），避免循环依赖。

let ws = null;
let currentToken = null;
let reconnectTimer = null;
let closedByUser = false;
let handlers = { onOpen: () => {}, onClose: () => {}, onMessage: () => {} };

// 活性自检：浏览器对「网络突断」常不立即触发 onclose（readyState 仍 OPEN），
// 仅靠 onclose 会卡死不重连。故客户端自发应用级 ping、跟踪最近一次入站时间，
// 超时即判定连接已死并强制重连（协议级 ping/pong 不进 onmessage，无法计数，故需应用级）。
const PING_MS = 15000;   // 应用级 ping 间隔
const WATCH_MS = 5000;   // 看门狗检查间隔
const DEAD_MS = 35000;   // 超过此时长无任何入站 → 判定连接已死（> PING_MS 留余量，健康连接绝不误判）
let lastInboundAt = 0;
let pingTimer = null;
let watchTimer = null;

export function configureSocket(h) {
  handlers = { ...handlers, ...h };
}

export function connectSocket(token) {
  currentToken = token;
  closedByUser = false;
  open();
}

function startKeepalive() {
  stopKeepalive();
  lastInboundAt = Date.now();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* 发送失败交给看门狗处理 */ }
    }
  }, PING_MS);
  watchTimer = setInterval(() => {
    if (ws && Date.now() - lastInboundAt > DEAD_MS) forceReconnect();
  }, WATCH_MS);
}

function stopKeepalive() {
  clearInterval(pingTimer); pingTimer = null;
  clearInterval(watchTimer); watchTimer = null;
}

// 连接已死但浏览器未报 onclose：主动拆除并立即重连，绕过 open() 的 OPEN 闸。
// 置空 dead 的事件回调，防其陈旧 onclose 在新连接建立后乱跑（清空新 ws / 重复重连）。
function forceReconnect() {
  stopKeepalive();
  const dead = ws;
  ws = null;
  if (dead) {
    dead.onclose = null; dead.onmessage = null; dead.onopen = null;
    try { dead.close(); } catch { /* ignore */ }
  }
  handlers.onClose();          // 通知 UI 进入「重连中」
  if (!closedByUser && currentToken) open();
}

function open() {
  if (!currentToken) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const backendHost = import.meta.env.VITE_BACKEND_HOST ?? window.location.host;
  const proto = (import.meta.env.VITE_BACKEND_HOST || window.location.protocol === 'https:') ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${backendHost}/ws?token=${encodeURIComponent(currentToken)}`);

  ws.onopen = () => { startKeepalive(); handlers.onOpen(); };
  ws.onmessage = (event) => {
    lastInboundAt = Date.now();   // 任意入站（含 pong）都刷新活性
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handlers.onMessage(msg);
  };
  ws.onclose = () => {
    stopKeepalive();
    handlers.onClose();
    ws = null;
    if (!closedByUser && currentToken) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(open, 1500);
    }
  };
}

export function sendMsg(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function disconnectSocket() {
  closedByUser = true;
  currentToken = null;
  clearTimeout(reconnectTimer);
  stopKeepalive();
  if (ws) ws.close();
  ws = null;
}
