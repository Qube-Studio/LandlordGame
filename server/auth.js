// 账号注册/登录/会话/在线状态（见 docs/GAME_SPEC.md §2）。
// 密码 scrypt+盐哈希持久化到 data/users.json；会话与在线表保存在内存。

import crypto from 'crypto';
import { loadJson, saveJson } from './storage.js';
import { ERR } from './text.js';

const USERS_FILE = 'users.json';

const users = new Map(Object.entries(loadJson(USERS_FILE, {}))); // username -> {salt, hash, createdAt}
const sessions = new Map();   // token -> username
const userTokens = new Map(); // username -> token（用于顶号）
const onlineSockets = new Map(); // username -> ws

function persistUsers() {
  saveJson(USERS_FILE, Object.fromEntries(users));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function register(username, password) {
  const name = (username ?? '').trim();
  if (!name || name.length > 16) return { error: ERR.usernameLen };
  if (!password || password.length < 4) return { error: ERR.passwordLen };
  if (users.has(name)) return { error: ERR.usernameTaken };
  const salt = crypto.randomBytes(16).toString('hex');
  users.set(name, { salt, hash: hashPassword(password, salt), createdAt: Date.now() });
  persistUsers();
  return { ok: true, username: name };
}

// 登录：校验密码并签发 token。重复登录顶号——旧 token 失效，返回需要踢掉的旧连接。
export function login(username, password) {
  const name = (username ?? '').trim();
  const record = users.get(name);
  if (!record || record.hash !== hashPassword(password ?? '', record.salt)) {
    return { error: ERR.badCredentials };
  }
  const oldToken = userTokens.get(name);
  if (oldToken) sessions.delete(oldToken);
  const kickedSocket = onlineSockets.get(name) ?? null;

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, name);
  userTokens.set(name, token);
  return { ok: true, token, username: name, kickedSocket };
}

export function logout(token) {
  const name = sessions.get(token);
  if (name && userTokens.get(name) === token) userTokens.delete(name);
  sessions.delete(token);
  return { ok: true };
}

export function resolveToken(token) {
  return sessions.get(token) ?? null;
}

// --- 在线状态 ---

// 绑定 WebSocket 为该用户的在线连接；返回被顶掉的旧连接（调用方负责发 kicked 并关闭）。
export function bindSocket(username, ws) {
  const previous = onlineSockets.get(username) ?? null;
  onlineSockets.set(username, ws);
  return previous === ws ? null : previous;
}

export function unbindSocket(username, ws) {
  if (onlineSockets.get(username) === ws) onlineSockets.delete(username);
}

export function listOnline() {
  return [...onlineSockets.keys()];
}
