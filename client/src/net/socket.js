// WebSocket 单例封装：自动重连、消息分发。
// 不直接 import store（处理器由 gameStore 注入），避免循环依赖。

let ws = null;
let currentToken = null;
let reconnectTimer = null;
let closedByUser = false;
let handlers = { onOpen: () => {}, onClose: () => {}, onMessage: () => {} };

export function configureSocket(h) {
  handlers = { ...handlers, ...h };
}

export function connectSocket(token) {
  currentToken = token;
  closedByUser = false;
  open();
}

function open() {
  if (!currentToken) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const backendHost = import.meta.env.VITE_BACKEND_HOST ?? window.location.host;
  const proto = (import.meta.env.VITE_BACKEND_HOST || window.location.protocol === 'https:') ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${backendHost}/ws?token=${encodeURIComponent(currentToken)}`);

  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handlers.onMessage(msg);
  };
  ws.onclose = () => {
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
  if (ws) ws.close();
  ws = null;
}
