// 编辑器共享小工具（T②b）：剪贴板读写、图片入库、批删 confirm 规则、memo 渲染计数探针。
// 放这里而非 store.js：这些都要碰 window/navigator/confirm 等浏览器面，store 保持纯状态。
import {
  useTedStore, findByUid, normalizeSel, subtreeCount,
  encodeBlocks, encodeChapters, decodeEnvelope, splitPasteParts,
} from './store';
import { uploadImage } from './api';

// ---- 渲染计数探针（DEV）：E2E 用它定标 memo 是否生效（编辑一个块不应重渲染其他块/树行） ----
export const countRender = (key) => {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const m = (window.__tedRC ||= {});
    m[key] = (m[key] || 0) + 1;
  }
};

// ---- 图片入库 + 回填块（上传按钮/拖文件/贴图共用）。withHistory=false：贴图「追加块+填图」并成一步撤回 ----
export async function doUpload(file, chUid, uid, withHistory = true) {
  const st = useTedStore.getState();
  try {
    const { url } = await uploadImage(file.name, file);
    useTedStore.getState().setBlockImg(chUid, uid, url, { history: withHistory });
    useTedStore.getState().showToast('已入库 → public' + url);
  } catch (e) {
    st.showToast('上传失败：' + e.message, true);
  }
}

// 剪贴板贴图文件名千篇一律（image.png），换成时间戳名防互相覆盖（legacy 同款）
export function pasteName(file) {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return `paste-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

// ---- 系统剪贴板：右键菜单路径用 navigator.clipboard（Ctrl+C/X/V 走 copy/cut/paste 事件，不经这里） ----
export async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级：无剪贴板权限的环境走 execCommand（隐藏 textarea 选中后 copy）
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}
export async function readClipboard() {
  try { return await navigator.clipboard.readText(); } catch { return null; }
}

// ---- 章节批删（Del 键/右键菜单/标题行按钮共用）：默认不 confirm（撤回兜底），
// 牵连 ≥5 章（含子章节，按祖先吸收后代归一化后计）才拦一道（§1.2） ----
export function confirmDeleteChapters(uids) {
  const st = useTedStore.getState();
  const norm = normalizeSel(st.chapters, uids);
  if (!norm.length) return;
  const total = norm.reduce((n, u) => n + subtreeCount(findByUid(st.chapters, u)), 0);
  if (total >= 5 && !window.confirm(`删除 ${total} 个章节（含子章节）？`)) return;
  st.deleteChapters(norm);
}

// ---- 章节复制到剪贴板（归一化后整棵子树进信封） ----
export async function copyChaptersToClipboard(uids) {
  const st = useTedStore.getState();
  const nodes = normalizeSel(st.chapters, uids).map((u) => findByUid(st.chapters, u)).filter(Boolean);
  if (!nodes.length) return;
  const ok = await writeClipboard(encodeChapters(nodes));
  st.showToast(ok ? `已复制 ${nodes.length} 个章节` : '无法写入剪贴板（浏览器未授权）', !ok);
}

// ---- 段落块复制到剪贴板（右键菜单路径；Ctrl+C 走 copy 事件不经这里） ----
export async function copyBlocksToClipboard(chUid, uids) {
  const st = useTedStore.getState();
  const ch = findByUid(st.chapters, chUid);
  const datas = ch ? ch.body.filter((b) => uids.includes(b.uid)).map((b) => b.data) : [];
  if (!datas.length) return false;
  const ok = await writeClipboard(encodeBlocks(datas));
  st.showToast(ok ? `已复制 ${datas.length} 个段落` : '无法写入剪贴板（浏览器未授权）', !ok);
  return ok;
}

// ---- 右键菜单「粘贴」：与 Ctrl+V 同一套裁决（信封优先），但没有光标语境 → 文本一律成块 ----
export async function pasteFromClipboardAfterBlock(chUid, refUid) {
  const st = useTedStore.getState();
  const txt = await readClipboard();
  if (txt == null) { st.showToast('无法读取剪贴板（浏览器未授权）', true); return; }
  const env = decodeEnvelope(txt);
  if (env?.kind === 'blocks') { st.pasteBlocks(chUid, refUid, env.blocks); return; }
  if (env?.kind === 'chapters') { st.pasteChapters(st.selUid, env.chapters); return; }
  if (txt) st.pasteBlocks(chUid, refUid, splitPasteParts(txt)); // 文本：单行=1 块，多行拆段
}
export async function pasteFromClipboardAtChapter(refUid) {
  const st = useTedStore.getState();
  const txt = await readClipboard();
  if (txt == null) { st.showToast('无法读取剪贴板（浏览器未授权）', true); return; }
  const env = decodeEnvelope(txt);
  if (env?.kind === 'chapters') { st.pasteChapters(refUid, env.chapters); return; }
  if (env?.kind === 'blocks') { st.pasteBlocks(refUid, null, env.blocks); return; } // 块信封 → 该章末尾
  st.showToast('剪贴板里没有章节/段落数据', true);
}
