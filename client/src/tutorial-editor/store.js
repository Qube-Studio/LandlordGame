// 教程编辑器状态（zustand）：uid 文档模型 + 载入/保存（乐观锁）+ 选择/展开 + 撤回栈 + 全部文档编辑动作。
// 撤回范式照抄 photoStore.js（past/future 栈 + coalesceKey/700ms 合并 + HIST_MAX=100 +
// undo 时置空 coalesceKey——权威参考实现，EDITOR_OVERHAUL §0.5），只改快照形状。
// 文档模型（§1.1）：载入时每章/每段包 uid（模块级单调递增；撤回快照保留 uid；serialize 剥掉）。
// React key/选择/剪贴板/定位一律用 uid——数组下标在增删后漂移、章节 id 用户可改，都不可靠。
// T②a 编辑动作统一走「pushHistory → 原地变异 → commit 换顶层引用」三步；
// 逐字节兼容三规则只在【编辑写入路径】生效（serialize 对未编辑块原样写回，零字节变动）：
//   ① m 档字号存纯字符串（setBlockText/setBlockSize 经 mkText 归一）
//   ② alt 空时删键（setBlockAlt）
//   ③ 旧式属性条 {value,max} 仅在用户编辑该块时固化为 {width,fill}（setBarProps 先 fossilize）
import { create } from 'zustand';
import { getDoc, putDoc } from './api';

let uidc = 1;
const fresh = () => 'u' + uidc++;

// 包裹：磁盘章节树 → 编辑器模型 {uid, id, title, rest, body:[{uid,data}], children:[…]}。
// rest 兜住未知键（现库全部节点恰好只有 id/title/body/children，见 unwrap 的键序说明）——
// 未来磁盘文件多出的键原样带回，不被编辑器剥掉。
export function wrapChapter(c) {
  const { id, title, body, children, ...rest } = c ?? {};
  return {
    uid: fresh(),
    id: id ?? '',
    title: title ?? '',
    rest,
    body: (body ?? []).map((data) => ({ uid: fresh(), data })),
    children: (children ?? []).map(wrapChapter),
  };
}

// 剥壳：编辑器模型 → 落盘 JSON。键序固定 id,title,body,children（与现库文件逐字节一致——
// 验收=真文档载入→不动→保存→git diff 为空）。块 data **原样写回**：没编辑过的块一个字节不动。
export function unwrapChapter(n) {
  return {
    id: n.id,
    title: n.title,
    ...n.rest,
    body: n.body.map((b) => b.data),
    children: n.children.map(unwrapChapter),
  };
}

// 树上按 uid 找节点（编辑器树可能任意深）
export function findByUid(nodes, uid) {
  for (const n of nodes ?? []) {
    if (n.uid === uid) return n;
    const hit = findByUid(n.children, uid);
    if (hit) return hit;
  }
  return null;
}

// 定位：返回 {list, index, node, parent}（拖拽移动/复制/删除要拿到所在数组原地 splice）
export function locateByUid(nodes, uid, parent = null) {
  for (let i = 0; i < (nodes ?? []).length; i++) {
    if (nodes[i].uid === uid) return { list: nodes, index: i, node: nodes[i], parent };
    const hit = locateByUid(nodes[i].children, uid, nodes[i]);
    if (hit) return hit;
  }
  return null;
}

export function* walkNodes(nodes) { for (const n of nodes ?? []) { yield n; yield* walkNodes(n.children); } }

// maybe 是否在 node 的子树里（树拖拽禁止拖进自身/后代）
export function isDescendant(node, maybe) {
  for (const c of walkNodes(node.children)) if (c.uid === maybe.uid) return true;
  return false;
}

// 多选归一化（§1.2 祖先吸收后代）：选中集若同时含祖先与其后代，后代被吸收——
// 拖/复制/删都以祖先整棵子树为单位，后代不再单独参与（否则同一节点会被处理两次）。
// 返回文档序（批量移动/复制要按稳定顺序执行）。
export function normalizeSel(chapters, uids) {
  const want = new Set(uids);
  const out = [];
  const rec = (nodes, inAnc) => {
    for (const n of nodes ?? []) {
      const hit = want.has(n.uid);
      if (hit && !inAnc) out.push(n.uid);
      rec(n.children, inAnc || hit);
    }
  };
  rec(chapters, false);
  return out;
}

// 子树章节总数（批删 confirm 阈值：≥5 章才拦一道，其余靠撤回兜底）
export const subtreeCount = (node) => 1 + [...walkNodes(node.children)].length;

// ---- 剪贴板哨兵信封（§1.2）：系统剪贴板 text/plain 里装 JSON 信封，粘贴时按 fmt 识别 ----
export const BLOCKS_FMT = 'fate-tutorial-blocks';
export const CHAPTERS_FMT = 'fate-tutorial-chapters';
export const encodeBlocks = (datas) => JSON.stringify({ fmt: BLOCKS_FMT, blocks: datas });
export const encodeChapters = (nodes) => JSON.stringify({ fmt: CHAPTERS_FMT, chapters: nodes.map(unwrapChapter) });
// 文本 → 信封；不是本编辑器的信封返回 null（普通 JSON 文本不会误判：必须恰好带 fmt 哨兵）
export function decodeEnvelope(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith('{') || !s.includes('"fmt"')) return null;
  try {
    const o = JSON.parse(s);
    if (o?.fmt === BLOCKS_FMT && Array.isArray(o.blocks)) return { kind: 'blocks', blocks: o.blocks };
    if (o?.fmt === CHAPTERS_FMT && Array.isArray(o.chapters)) return { kind: 'chapters', chapters: o.chapters };
  } catch { /* 非 JSON → 不是信封 */ }
  return null;
}

// 多行文本 → 段落数组：首尾空行去、中间空行留（=排版空行）。pasteLines 与
// 「无编辑焦点的多行粘贴→追加块」共用同一套裁切规则（§1.2 粘贴裁决顺序第三档）。
export function splitPasteParts(merged) {
  const parts = String(merged).split(/\r?\n/).map((s) => s.trim());
  while (parts.length && !parts[0]) parts.shift();
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.length ? parts : [''];
}

// 新章节 id：全树扫描已用 id，取最小空闲 c1/c2/…（legacy 同款）
function freshChapterId(chapters, used = new Set([...walkNodes(chapters)].map((n) => n.id))) {
  for (let i = 1; ; i++) { const id = 'c' + i; if (!used.has(id)) { used.add(id); return id; } }
}
const emptyChapter = (id, title) => ({ uid: fresh(), id, title, rest: {}, body: [], children: [] });

// ---- 段落形态判别/构造（与 TutorialContent 的渲染约定一致） ----
export const isImgData = (d) => d != null && typeof d === 'object' && 'img' in d;
export const isBarData = (d) => d != null && typeof d === 'object' && 'bar' in d;
// 文字段的文本；非文字段（图/条）返回 null
export const textOf = (d) => {
  if (typeof d === 'string') return d;
  if (d != null && typeof d === 'object' && !isImgData(d) && !isBarData(d)) return String(d.text ?? '');
  return null;
};
export const sizeOf = (d) =>
  (d != null && typeof d === 'object' && !isImgData(d) && !isBarData(d) && ['s', 'l', 'xl'].includes(d.size)) ? d.size : 'm';
// 兼容规则①：m 档存纯字符串，其余存 {text, size}
export const mkText = (t, sz = 'm') => (sz === 'm' ? t : { text: t, size: sz });

export const BAR_W = { lo: 24, hi: 400, def: 144 };
export const clampNum = (v, lo, hi) => {
  let n = Math.round(Number(v));
  if (!Number.isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
};
// 属性条归一化（读时折算）：与 TutorialContent 的内联折算逐值一致。
// 为什么不从 TutorialContent 导出共用：那是游戏共享渲染器，为编辑器控件改它要重跑整套渲染基线，
// 这 10 行 clamp 逻辑照抄一份反而是更小的风险面（legacy 同款取舍）。
export function normBar(d) {
  const w0 = Math.round(Number(d?.width));
  const width = Number.isFinite(w0) && w0 > 0 ? Math.max(BAR_W.lo, Math.min(BAR_W.hi, w0)) : BAR_W.def;
  let fill;
  if (d?.fill != null) fill = clampNum(d.fill, 0, 100);
  else if (Number(d?.max) > 0) fill = clampNum((Number(d.value) || 0) / Number(d.max) * 100, 0, 100); // 旧段式折算
  else fill = 0;
  const color = ['gold', 'green', 'red', 'blue'].includes(d?.color) ? d.color : 'gold';
  const fade = ['both', 'left', 'right', 'none'].includes(d?.fade) ? d.fade : 'both';
  return { width, fill, color, fade };
}
// 兼容规则③：旧式 {value,max} 固化为新式 {width,fill}——只在用户编辑该块时调用，读取/序列化不动它
function fossilizeBar(d) {
  if (d.fill == null && d.max != null) {
    const n = normBar(d);
    d.width = n.width; d.fill = n.fill;
    delete d.value; delete d.max;
  }
}
export const newBar = () => ({ bar: '', width: BAR_W.def, fill: 60, color: 'gold', fade: 'both' });

// ---- 撤回栈（photoStore 范式） ----
const HIST_MAX = 100;
export const DRAFT_KEY = 'fate-ted-draft'; // autosave 草稿（localStorage；E2E 也用这个键断言）
let coalesceKey = null, coalesceTime = 0;
let draftTimer = 0; // autosave 草稿 debounce（写入端在文件底部的 subscribe；保存成功时取消并清草稿）
// 块渲染版本号：编辑动作原地变异 block.data（对象身份不变），memo 的 Block 靠 v 的变化感知重渲染。
// v 只活在编辑器模型的包裹层（serialize 只取 b.data，不会落盘）。
const bump = (b) => { b.v = (b.v || 0) + 1; };
let focusN = 0, toastN = 0, selN = 0; // 递增序号：同目标的连续请求也能触发 effect
// 快照捎带焦点+光标（§1.2）：undo/redo 后把光标送回改动发生处。
// 注意时序：pushHistory 在 onChange 里被调时 DOM 已是击键后的值，捕到的 caret 是击键后位置——
// 撤回后文本回到改前、光标落在击键后位置（差一格），被 setSelectionRange 自然夹取，可接受。
const captureFocus = () => {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  const blk = el?.closest?.('[data-blk-uid]');
  if (!blk) return null;
  let s = 0, e = 0;
  try { s = el.selectionStart ?? 0; e = el.selectionEnd ?? s; } catch { /* 非文本控件 */ }
  return { uid: blk.dataset.blkUid, s, e };
};
// 快照保留 uid（structuredClone 深拷贝纯数据树），恢复后选择/定位不失锚
const snap = (get) => ({
  chapters: structuredClone(get().chapters),
  selUid: get().selUid,
  selChUids: [...get().selChUids],
  openUids: [...get().openUids],
  focus: captureFocus(),
});
const applySnap = (s) => ({
  chapters: s.chapters,
  selUid: s.selUid,
  selChUids: [...s.selChUids],
  openUids: new Set(s.openUids),
  selBlks: [], // 块选择不跨撤回保留（块可能已不存在；焦点恢复走 focusReq）
  // 焦点恢复：快照里有改动前的焦点块 → 撤回后光标送回去
  ...(s.focus ? { focusReq: { uid: s.focus.uid, caret: s.focus.s, caretEnd: s.focus.e, n: ++focusN } } : {}),
});

export const useTedStore = create((set, get) => {
  // （内部）提交一次文档变异：换顶层数组引用触发订阅者渲染（节点对象是原地变异的，
  // 撤回安全性由 pushHistory 的 structuredClone 快照保证）
  const commit = (extra = {}) => set({ chapters: [...get().chapters], dirty: true, ...extra });
  // （内部）按 uid 定位段落块
  const blockAt = (chUid, uid) => {
    const ch = findByUid(get().chapters, chUid);
    if (!ch) return null;
    const index = ch.body.findIndex((b) => b.uid === uid);
    return index < 0 ? null : { ch, index, block: ch.body[index] };
  };

  return {
    chapters: null,        // 包 uid 的章节树；null = 未载入
    docRest: {},           // 根对象除 chapters 外的其余键（当前为空对象；保留防剥）
    baseHash: null,        // 乐观锁基准：载入/保存成功时的磁盘 hash
    docPath: '',           // 服务端返回的文档路径（状态栏显示）
    status: 'loading',     // loading | ready | saving | error（error=载入失败，页面级）
    error: null,           // 保存/载入失败信息（状态栏红字；保存失败按钮重新可用，§0 状态可见）
    dirty: false,
    conflict: null,        // 409 冲突：{hash}——弹「磁盘已被修改」对话框（重载 / 强制覆盖）
    selUid: null,          // 主选章节 uid（恒等于 selChUids 末位；旧代码继续读它）
    selChUids: [],         // 多选章节（有序，末位=主选；中栏恒显主选）
    selBlks: [],           // 选中段落块 uid（主选章节内；末位=主选）
    selN: 0,               // 选择序号：同一目标重复定位（校验面板连点）也能触发滚动 effect
    openUids: new Set(),   // 展开章节 uid 集
    past: [], future: [],  // 撤回/重做快照栈
    query: '',             // 树搜索词（视图态，不进撤回历史）
    focusReq: null,        // {uid, caret, caretEnd?, n} 编辑列聚焦请求（拆/并段、快速插入、撤回后落焦点）
    picker: null,          // {chUid, uid} 图库选择器目标块；null=关闭
    toast: null,           // {msg, err, n} 轻提示（上传结果等）
    menu: null,            // {x, y, items} 右键菜单（视图态；items 由打开方现造）
    ro: false,             // 只读（多标签 BroadcastChannel 锁：后开标签只读，可夺锁）
    draftOffer: null,      // {ts} 启动时检测到 autosave 草稿 ≠ 磁盘 → 恢复条

    async load() {
      set({ status: 'loading', error: null, conflict: null });
      try {
        const { data, hash, path } = await getDoc();
        const chapters = (data?.chapters ?? []).map(wrapChapter);
        const rest = { ...data };
        delete rest.chapters;
        // autosave 草稿检测（§1.2）：草稿内容 ≠ 磁盘内容 → 出恢复条（不自动恢复，交用户裁决）。
        // 判据取「doc≠磁盘」的内容比对而非规格字面的 baseHash 比对——最常见的崩溃场景是
        // 磁盘没动（baseHash 相同）但草稿有未保存编辑，hash 判据会漏掉它；baseHash 一并存供诊断。
        let draftOffer = null;
        try {
          const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
          if (d?.doc && JSON.stringify(d.doc) !== JSON.stringify(data)) draftOffer = { ts: d.ts ?? 0 };
        } catch { /* 草稿损坏视同没有 */ }
        coalesceKey = null;
        const selUid = chapters[0]?.uid ?? null;
        set({
          chapters, docRest: rest, baseHash: hash, docPath: path ?? '',
          status: 'ready', dirty: false, conflict: null, draftOffer,
          selUid, selChUids: selUid ? [selUid] : [], selBlks: [],
          openUids: new Set(chapters.map((c) => c.uid)), // 顶层默认展开，孙层收起
          past: [], future: [],
        });
      } catch (e) {
        set({ status: 'error', error: '载入失败：' + e.message });
      }
    },

    // 恢复 autosave 草稿：草稿文档整棵换入、标脏（用户 Ctrl+S 落盘）；baseHash 仍取磁盘当前值，
    // 保存走正常乐观锁——磁盘在草稿之后又被外部改过时照样 409，不会静默覆盖。
    restoreDraft() {
      try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (!d?.doc) { set({ draftOffer: null }); return; }
        const chapters = (d.doc.chapters ?? []).map(wrapChapter);
        const rest = { ...d.doc };
        delete rest.chapters;
        coalesceKey = null;
        const selUid = chapters[0]?.uid ?? null;
        set({
          chapters, docRest: rest, dirty: true, draftOffer: null,
          selUid, selChUids: selUid ? [selUid] : [], selBlks: [],
          openUids: new Set(chapters.map((c) => c.uid)),
          past: [], future: [],
        });
      } catch (e) {
        set({ draftOffer: null });
        get().showToast('草稿恢复失败：' + e.message, true);
      }
    },
    discardDraft() {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* 忽略 */ }
      set({ draftOffer: null });
    },

    // 编辑器模型 → 落盘 JSON（根对象其余键原样保留）
    serialize() {
      const { docRest, chapters } = get();
      return { ...docRest, chapters: (chapters ?? []).map(unwrapChapter) };
    },

    async save(force = false) {
      const s = get();
      if (!s.chapters || s.status === 'saving' || s.status === 'loading') return;
      set({ status: 'saving', error: null });
      try {
        const { hash } = await putDoc(s.serialize(), s.baseHash, force);
        set({ status: 'ready', baseHash: hash, dirty: false, conflict: null });
        // 落盘成功 → 草稿失去意义；顺带取消在途的 debounce 写（迟到的旧草稿=脏数据）
        clearTimeout(draftTimer);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* 忽略 */ }
      } catch (e) {
        if (e.code === 409) {
          // 磁盘被他人（legacy 编辑器/另一窗口）改过：不覆盖、不丢内存态，交用户裁决
          set({ status: 'ready', conflict: { hash: e.hash ?? null } });
          return;
        }
        set({ status: 'ready', error: '保存失败：' + e.message });
      }
    },
    dismissConflict() { set({ conflict: null }); },

    // ---- 选择/展开/搜索（纯视图态，不进撤回历史；快照捎带选择/展开以便恢复时不失锚） ----
    // 章节多选：selChUids 有序、末位=主选（photoStore selection 同款语义）；换主选清块选择。
    select(uid) {
      set({ selUid: uid, selChUids: uid == null ? [] : [uid], selBlks: [], selN: ++selN });
    },
    ctrlSelect(uid) { // Ctrl+点：切换；新加者成主选，移除后主选退到末位
      const cur = get().selChUids;
      const next = cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid];
      set({ selUid: next[next.length - 1] ?? null, selChUids: next, selBlks: [], selN: ++selN });
    },
    rangeSelect(uids, primary) { // Shift+范围：Tree 按可见序算好整段传入
      set({ selUid: primary, selChUids: uids, selBlks: [], selN: ++selN });
    },
    // 块选择（主选章节内）：末位=主选；预览滚动跟随/校验定位都吃 selN 触发
    selectBlocks(uids) { set({ selBlks: uids, selN: ++selN }); },
    toggleOpen(uid) {
      const next = new Set(get().openUids);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      set({ openUids: next });
    },
    openAll() {
      const all = new Set();
      for (const n of walkNodes(get().chapters ?? [])) if (n.children.length) all.add(n.uid);
      set({ openUids: all });
    },
    closeAll() { set({ openUids: new Set() }); },
    setQuery(query) { set({ query }); },
    requestFocus(uid, caret = 0) { set({ focusReq: { uid, caret, n: ++focusN } }); },
    // 程序化定位（校验面板点击/未来的跨章跳转）：展开祖先链 + 清搜索词（过滤会把目标行滤掉）
    // + 选中章节（可带主选块）。三处 scrollIntoView 由订阅 selN 的 effect 消费（树/编辑列/预览）。
    reveal(chUid, blkUid = null) {
      const s = get();
      let chain = null;
      const dig = (nodes, acc) => {
        for (const n of nodes ?? []) {
          if (n.uid === chUid) { chain = acc; return true; }
          if (dig(n.children, [...acc, n.uid])) return true;
        }
        return false;
      };
      dig(s.chapters, []);
      if (!chain) return;
      const openUids = new Set(s.openUids);
      chain.forEach((u) => openUids.add(u));
      set({
        openUids, query: '',
        selUid: chUid, selChUids: [chUid],
        selBlks: blkUid ? [blkUid] : [],
        selN: ++selN,
      });
    },
    openPicker(chUid, uid) { set({ picker: { chUid, uid } }); },
    closePicker() { set({ picker: null }); },
    showToast(msg, err = false) { set({ toast: { msg, err: !!err, n: ++toastN } }); },
    openMenu(x, y, items) { set({ menu: { x, y, items } }); },
    closeMenu() { if (get().menu) set({ menu: null }); },
    setRo(ro) { set({ ro: !!ro }); },

    // ---- 撤回/重做 ----
    // 变更前压栈；同 key 且 700ms 内合并成一步（连续输入算一次撤回）。
    pushHistory(key = null) {
      const now = Date.now();
      if (key && key === coalesceKey && now - coalesceTime < 700) { coalesceTime = now; return; }
      const past = [...get().past, snap(get)];
      if (past.length > HIST_MAX) past.shift();
      set({ past, future: [] });
      coalesceKey = key; coalesceTime = now;
    },
    undo() {
      const past = get().past;
      if (!past.length) return;
      const prev = past[past.length - 1];
      coalesceKey = null; // undo 后下一次同 key 编辑必须开新步，不得并进已撤销的那步
      set({ ...applySnap(prev), past: past.slice(0, -1), future: [...get().future, snap(get)], dirty: true });
    },
    redo() {
      const future = get().future;
      if (!future.length) return;
      const next = future[future.length - 1];
      coalesceKey = null;
      set({ ...applySnap(next), future: future.slice(0, -1), past: [...get().past, snap(get)], dirty: true });
    },

    // ---- 章节树编辑 ----
    setTitle(uid, title) {
      const n = findByUid(get().chapters, uid);
      if (!n) return;
      get().pushHistory('title:' + uid);
      n.title = title;
      commit();
    },
    addTopChapter() {
      get().pushHistory();
      const node = emptyChapter(freshChapterId(get().chapters), '新章节');
      get().chapters.push(node);
      commit({ selUid: node.uid, selChUids: [node.uid], selBlks: [] });
    },
    addChildChapter(parentUid) {
      const p = findByUid(get().chapters, parentUid);
      if (!p) return;
      get().pushHistory();
      const node = emptyChapter(freshChapterId(get().chapters), '新子章节');
      p.children.push(node);
      const openUids = new Set(get().openUids);
      openUids.add(parentUid);
      commit({ selUid: node.uid, selChUids: [node.uid], selBlks: [], openUids });
    },
    // 右键「前插/后插」：与参照章节同级插入空章节
    insertChapterNear(refUid, where) {
      const loc = locateByUid(get().chapters, refUid);
      if (!loc) return;
      get().pushHistory();
      const node = emptyChapter(freshChapterId(get().chapters), '新章节');
      loc.list.splice(where === 'after' ? loc.index + 1 : loc.index, 0, node);
      commit({ selUid: node.uid, selChUids: [node.uid], selBlks: [] });
    },
    // 复制章节：整棵子树深拷贝（unwrap→clone→wrap 顺便换全新 uid）、全员换新 id，插到原位之后
    duplicateChapter(uid) {
      const loc = locateByUid(get().chapters, uid);
      if (!loc) return;
      get().pushHistory();
      const clone = wrapChapter(structuredClone(unwrapChapter(loc.node)));
      const used = new Set([...walkNodes(get().chapters)].map((n) => n.id));
      (function reid(n) { n.id = freshChapterId(null, used); n.children.forEach(reid); })(clone);
      clone.title = (clone.title || '') + '（副本）';
      loc.list.splice(loc.index + 1, 0, clone);
      commit({ selUid: clone.uid, selChUids: [clone.uid], selBlks: [] });
    },
    deleteChapter(uid) { // confirm 由组件负责（DEV 工具原生 confirm 足矣）
      get().deleteChapters([uid]);
    },
    // ---- 章节批量操作（§1.2 多选）：入口先做「祖先吸收后代」归一化 ----
    // 批删：confirm 由组件负责（默认不 confirm 撤回兜底，≥5 章才拦）；这里只管删。
    deleteChapters(uids) {
      const s = get();
      const norm = normalizeSel(s.chapters, uids);
      if (!norm.length) return;
      get().pushHistory();
      for (const uid of norm) {
        const loc = locateByUid(get().chapters, uid);
        if (loc) loc.list.splice(loc.index, 1);
      }
      const after = get();
      const selUid = findByUid(after.chapters, after.selUid) ? after.selUid : (after.chapters[0]?.uid ?? null);
      commit({ selUid, selChUids: selUid ? [selUid] : [], selBlks: [] });
    },
    // 批量副本：每棵子树在原位之后克隆（Ctrl+D）；完成后选中全部副本（主选=最后一个）
    duplicateChapters(uids) {
      const s = get();
      const norm = normalizeSel(s.chapters, uids);
      if (!norm.length) return;
      get().pushHistory();
      const used = new Set([...walkNodes(get().chapters)].map((n) => n.id));
      const cloneUids = [];
      for (const uid of norm) {
        const loc = locateByUid(get().chapters, uid);
        if (!loc) continue;
        const clone = wrapChapter(structuredClone(unwrapChapter(loc.node)));
        (function reid(n) { n.id = freshChapterId(null, used); n.children.forEach(reid); })(clone);
        clone.title = (clone.title || '') + '（副本）';
        loc.list.splice(loc.index + 1, 0, clone);
        cloneUids.push(clone.uid);
      }
      commit({ selUid: cloneUids[cloneUids.length - 1] ?? null, selChUids: cloneUids, selBlks: [] });
    },
    // 批量移动（多选拖拽）：整组按文档序搬运，落点处保持相对顺序；targetUid=null → 提升顶层末尾
    moveChapters(uids, targetUid, zone) {
      const s = get();
      const norm = normalizeSel(s.chapters, uids);
      if (!norm.length) return;
      if (targetUid != null) {
        const tgt = locateByUid(s.chapters, targetUid);
        if (!tgt) return;
        for (const uid of norm) { // 目标不能是拖动集里的节点或其后代
          const src = locateByUid(s.chapters, uid);
          if (!src || src.node.uid === targetUid || isDescendant(src.node, tgt.node)) return;
        }
      }
      get().pushHistory();
      const nodes = [];
      for (const uid of norm) {
        const loc = locateByUid(get().chapters, uid);
        if (loc) { nodes.push(loc.node); loc.list.splice(loc.index, 1); }
      }
      if (targetUid == null) {
        get().chapters.push(...nodes);
        commit({ selUid: norm[norm.length - 1], selChUids: [...norm], selBlks: [] });
        return;
      }
      const t = locateByUid(get().chapters, targetUid);
      if (!t) { get().chapters.push(...nodes); commit(); return; } // 极端情况兜底：至少不丢节点
      if (zone === 'into') {
        t.node.children.push(...nodes);
        const openUids = new Set(get().openUids);
        openUids.add(targetUid);
        commit({ openUids, selUid: norm[norm.length - 1], selChUids: [...norm], selBlks: [] });
      } else {
        t.list.splice(zone === 'after' ? t.index + 1 : t.index, 0, ...nodes);
        commit({ selUid: norm[norm.length - 1], selChUids: [...norm], selBlks: [] });
      }
    },
    // 粘贴章节（哨兵信封）：全树换新 id/uid，插到参照章节之后（无参照 → 顶层末尾）
    pasteChapters(refUid, rawChapters) {
      if (!Array.isArray(rawChapters) || !rawChapters.length) return;
      get().pushHistory();
      const used = new Set([...walkNodes(get().chapters)].map((n) => n.id));
      const clones = rawChapters.map((c) => {
        const node = wrapChapter(structuredClone(c));
        (function reid(n) { n.id = freshChapterId(null, used); n.children.forEach(reid); })(node);
        return node;
      });
      const loc = refUid ? locateByUid(get().chapters, refUid) : null;
      if (loc) loc.list.splice(loc.index + 1, 0, ...clones);
      else get().chapters.push(...clones);
      const cloneUids = clones.map((c) => c.uid);
      commit({ selUid: cloneUids[cloneUids.length - 1], selChUids: cloneUids, selBlks: [] });
    },
    // 树拖拽落点：zone = before | after | into；targetUid=null → root-drop 提升到顶层末尾
    moveChapter(dragUid, targetUid, zone) {
      const s = get();
      const src = locateByUid(s.chapters, dragUid);
      if (!src) return;
      if (targetUid != null) {
        const tgt = locateByUid(s.chapters, targetUid);
        if (!tgt || tgt.node.uid === dragUid || isDescendant(src.node, tgt.node)) return; // 不能拖进自身/后代
      }
      get().pushHistory();
      src.list.splice(src.index, 1); // 先摘除，再按 uid 重新定位目标（索引可能已移位）
      if (targetUid == null) { s.chapters.push(src.node); commit(); return; }
      const t = locateByUid(s.chapters, targetUid);
      if (!t) { src.list.splice(src.index, 0, src.node); commit(); return; } // 极端情况回滚
      if (zone === 'into') {
        t.node.children.push(src.node);
        const openUids = new Set(get().openUids);
        openUids.add(targetUid);
        commit({ openUids });
      } else {
        t.list.splice(zone === 'after' ? t.index + 1 : t.index, 0, src.node);
        commit();
      }
    },

    // ---- 段落块编辑 ----
    insertBlock(chUid, index, data) { // 返回新块 uid（调用方决定要不要 requestFocus）
      const ch = findByUid(get().chapters, chUid);
      if (!ch) return null;
      get().pushHistory();
      const b = { uid: fresh(), data };
      ch.body.splice(Math.max(0, Math.min(ch.body.length, index)), 0, b);
      commit();
      return b.uid;
    },
    removeBlock(chUid, uid) {
      const loc = blockAt(chUid, uid);
      if (!loc) return;
      get().pushHistory();
      loc.ch.body.splice(loc.index, 1);
      commit();
    },
    // 批删块（多选 Del/剪切/右键删除）：一步撤回；删完清块选择
    removeBlocks(chUid, uids) {
      const ch = findByUid(get().chapters, chUid);
      const kill = new Set(uids);
      if (!ch || !ch.body.some((b) => kill.has(b.uid))) return;
      get().pushHistory();
      ch.body = ch.body.filter((b) => !kill.has(b.uid));
      commit({ selBlks: [] });
    },
    // 粘贴块（哨兵信封/文本拆段共用落点）：插到 refUid 之后；refUid 空/不存在 → 章节末尾。
    // datas 深拷贝换新 uid（同一信封可以粘贴多次）；完成后选中全部新块（主选=最后一个）。
    pasteBlocks(chUid, refUid, datas) {
      const ch = findByUid(get().chapters, chUid);
      if (!ch || !Array.isArray(datas) || !datas.length) return;
      get().pushHistory();
      const blocks = datas.map((d) => ({ uid: fresh(), data: structuredClone(d) }));
      const hit = refUid ? ch.body.findIndex((b) => b.uid === refUid) : -1;
      ch.body.splice(hit >= 0 ? hit + 1 : ch.body.length, 0, ...blocks);
      commit({ selBlks: blocks.map((b) => b.uid), selN: ++selN });
    },
    moveBlock(chUid, from, to) { // ↑↓ 与拖拽排序共用；越界忽略
      const ch = findByUid(get().chapters, chUid);
      if (!ch || to < 0 || to >= ch.body.length || from === to) return;
      get().pushHistory();
      const [x] = ch.body.splice(from, 1);
      ch.body.splice(to, 0, x);
      commit();
    },
    // key=null 表示离散一步（金字/列表项按钮不与打字合并——legacy 同款）
    setBlockText(chUid, uid, text, key = 'text:' + uid) {
      const loc = blockAt(chUid, uid);
      if (!loc || textOf(loc.block.data) === null) return;
      get().pushHistory(key);
      loc.block.data = mkText(text, sizeOf(loc.block.data)); // 规则①：m 档回落纯字符串
      bump(loc.block);
      commit();
    },
    setBlockSize(chUid, uid, size) {
      const loc = blockAt(chUid, uid);
      if (!loc || textOf(loc.block.data) === null || sizeOf(loc.block.data) === size) return;
      get().pushHistory();
      loc.block.data = mkText(textOf(loc.block.data) ?? '', size);
      bump(loc.block);
      commit();
    },
    // opts.key：打字合并键；opts.history=false：贴图「追加块+填图」并成一步撤回（legacy 同款）
    setBlockImg(chUid, uid, img, opts = {}) {
      const loc = blockAt(chUid, uid);
      if (!loc || !isImgData(loc.block.data)) return;
      if (opts.history !== false) get().pushHistory(opts.key ?? null);
      loc.block.data.img = img; // 原地变异保住对象里未知键
      bump(loc.block);
      commit();
    },
    setBlockAlt(chUid, uid, alt) {
      const loc = blockAt(chUid, uid);
      if (!loc || !isImgData(loc.block.data)) return;
      get().pushHistory('alt:' + uid);
      if (alt) loc.block.data.alt = alt; else delete loc.block.data.alt; // 规则②：空删键
      bump(loc.block);
      commit();
    },
    setBarProps(chUid, uid, patch, key = null) {
      const loc = blockAt(chUid, uid);
      if (!loc || !isBarData(loc.block.data)) return;
      get().pushHistory(key);
      const d = loc.block.data;
      fossilizeBar(d); // 规则③：编辑时固化旧式 {value,max}
      for (const [k, v] of Object.entries(patch)) {
        d[k] = k === 'width' ? clampNum(v, BAR_W.lo, BAR_W.hi) : k === 'fill' ? clampNum(v, 0, 100) : v;
      }
      bump(loc.block);
      commit();
    },
    // Enter 拆段：两段沿用原字号；焦点落新段行首
    splitBlock(chUid, uid, before, after) {
      const loc = blockAt(chUid, uid);
      if (!loc || textOf(loc.block.data) === null) return null;
      get().pushHistory();
      const sz = sizeOf(loc.block.data);
      loc.block.data = mkText(before, sz);
      bump(loc.block);
      const nb = { uid: fresh(), data: mkText(after, sz) };
      loc.ch.body.splice(loc.index + 1, 0, nb);
      commit({ focusReq: { uid: nb.uid, caret: 0, n: ++focusN } });
      return nb.uid;
    },
    // 行首 Backspace 并段：并入上一文字段、沿用其字号；上一段不是文字段（图/条）→ 不并（返回 null）
    mergeBlockUp(chUid, uid) {
      const loc = blockAt(chUid, uid);
      if (!loc || loc.index === 0 || textOf(loc.block.data) === null) return null;
      const prev = loc.ch.body[loc.index - 1];
      const prevT = textOf(prev.data);
      if (prevT === null) return null;
      get().pushHistory();
      prev.data = mkText(prevT + (textOf(loc.block.data) ?? ''), sizeOf(prev.data));
      bump(prev);
      loc.ch.body.splice(loc.index, 1);
      commit({ focusReq: { uid: prev.uid, caret: prevT.length, n: ++focusN } });
      return { uid: prev.uid, caret: prevT.length };
    },
    // 多行粘贴拆段：merged = 光标处已拼好粘贴文本的整段；首尾空行去、中间空行留（=排版空行）
    pasteLines(chUid, uid, merged) {
      const loc = blockAt(chUid, uid);
      if (!loc || textOf(loc.block.data) === null) return;
      get().pushHistory();
      const sz = sizeOf(loc.block.data);
      const parts = splitPasteParts(merged);
      const blocks = parts.map((p) => ({ uid: fresh(), data: p ? mkText(p, sz) : '' })); // 空行=纯空串段
      loc.ch.body.splice(loc.index, 1, ...blocks);
      const last = blocks[blocks.length - 1];
      commit({ focusReq: { uid: last.uid, caret: parts[parts.length - 1].length, n: ++focusN } });
    },
  };
});

// ---- 只读守卫（§1.2 多标签锁）：后开标签 ro=true 时，全部改文档/落盘动作单点拦截为空操作。
// 包一层胜过在每个动作里手写 if(ro)——新增动作只要进这张表，漏网面小得多。
// 纯视图动作（选择/展开/搜索/菜单/toast）不拦：只读标签仍可浏览。
const RO_BLOCKED = [
  'setTitle', 'addTopChapter', 'addChildChapter', 'insertChapterNear', 'duplicateChapter',
  'deleteChapter', 'deleteChapters', 'duplicateChapters', 'moveChapters', 'pasteChapters', 'moveChapter',
  'insertBlock', 'removeBlock', 'removeBlocks', 'moveBlock', 'pasteBlocks',
  'setBlockText', 'setBlockSize', 'setBlockImg', 'setBlockAlt', 'setBarProps',
  'splitBlock', 'mergeBlockUp', 'pasteLines',
  'undo', 'redo', 'save', 'restoreDraft',
];
{
  const acts = useTedStore.getState();
  const patch = {};
  for (const k of RO_BLOCKED) {
    const fn = acts[k];
    patch[k] = (...args) => (useTedStore.getState().ro ? null : fn(...args));
  }
  useTedStore.setState(patch);
}

// ---- autosave 草稿写入端（§1.2）：脏文档变更 debounce 800ms 落 localStorage。
// 只读标签不写（编辑动作已被守卫，双保险）；保存成功清草稿（save() 里做）；
// undo 回到与磁盘一致的内容时草稿仍会写，但 load() 的恢复条判据是内容比对，不会误弹。
useTedStore.subscribe((s, prev) => {
  if (!s.dirty || s.ro || !s.chapters) return;
  if (s.chapters === prev.chapters && s.docRest === prev.docRest) return; // 只对文档变更起搏
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const cur = useTedStore.getState();
    if (!cur.dirty || cur.ro || !cur.chapters) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ baseHash: cur.baseHash, doc: cur.serialize(), ts: Date.now() }));
    } catch { /* 配额满/隐私模式——草稿是尽力而为 */ }
  }, 800);
});

// 自动化探针（同 __photoStore 先例）：E2E 经此读状态/驱动动作
if (import.meta.env.DEV && typeof window !== 'undefined') window.__tedStore = useTedStore;
