// 教程编辑器 2.0 IO 客户端（EDITOR_OVERHAUL §1.1）：对接 vite dev 插件 tools/tutorial-api.vite.mjs。
// 编辑器只存在于 vite dev 下，全部同源请求；失败抛带 code 的 Error——409（乐观锁冲突）由
// store 转成「磁盘已被修改」对话框，其余进状态栏红字。
const BASE = '/__tutorial-api';

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    // fetch 本身失败 = dev 服务器没起/断网，与 HTTP 错误分开表述
    throw Object.assign(new Error('无法连接 vite 开发服务器'), { code: 0 });
  }
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应体（如代理错误页）→ 走状态码兜底 */ }
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`);
    err.code = res.status;
    if (body?.hash) err.hash = body.hash; // 409 附带磁盘最新 hash，强制覆盖时无用、重载时省一次 GET 也不省——仅供诊断
    throw err;
  }
  return body;
}

// → {data, hash, mtime, path}
export const getDoc = () => request(`${BASE}/doc`);

// 乐观锁写盘：baseHash 与磁盘不符 → 409；force=true 强制覆盖。→ {ok, hash, mtime}
export const putDoc = (data, baseHash, force = false) =>
  request(`${BASE}/doc`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, baseHash, force }),
  });

// → {images: [{name, url, size, mtime}]}（新→旧）
export const listImages = () => request(`${BASE}/images`);

// 图片入库（同名覆盖，与 legacy 一致）。→ {url, name}
export const uploadImage = (name, blob) =>
  request(`${BASE}/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });

// 图库删除（磁盘 unlink，**不可撤回**——调用方须先 confirm 并提示引用处）。→ {ok, name}
export const deleteImage = (name) =>
  request(`${BASE}/images?name=${encodeURIComponent(name)}`, { method: 'DELETE' });

// 版式模板库（client/tutorial.templates.json，随 git 走）。→ {templates:[{name, blocks}]}
export const getTemplates = () => request(`${BASE}/templates`);
export const putTemplates = (templates) =>
  request(`${BASE}/templates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates }),
  });
