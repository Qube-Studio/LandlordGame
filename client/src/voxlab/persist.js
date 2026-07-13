// VoxLab 持久化(仅隔离区):
// - 导入素材的 .vox 字节 → IndexedDB(ObjectURL 刷新即死,字节才是真身;localStorage 放不下几百 KB 的二进制)
// - 场景(摆放物/资产开关) → localStorage JSON(小、同步、够用)
// 全部尽力而为:私隐模式/存储被禁时静默降级为"仅本次会话"。
const DB_NAME = 'voxlab';
const STORE = 'imports';
const SCENE_KEY = 'voxlab.scene';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out?.result ?? out);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[voxlab] IndexedDB 不可用,素材仅本次会话', e);
    return null;
  }
}

export const idbPutImport = (row) => withStore('readwrite', (s) => s.put(row));       // {key, name, bytes}
export const idbDeleteImport = (key) => withStore('readwrite', (s) => s.delete(key));
export async function idbAllImports() {
  const rows = await withStore('readonly', (s) => s.getAll());
  return Array.isArray(rows) ? rows : [];
}

export function saveScene(data) {
  try { localStorage.setItem(SCENE_KEY, JSON.stringify(data)); } catch { /* 存储禁用则不持久 */ }
}
export function loadScene() {
  try { return JSON.parse(localStorage.getItem(SCENE_KEY)) ?? {}; } catch { return {}; }
}
