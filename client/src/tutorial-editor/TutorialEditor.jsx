// 教程编辑器 2.0 主界面：工具栏 + 左章节树（Tree）+ 中编辑列（EditCol）+ 右游戏同源预览 + 状态栏。
// chrome 全走 .ted-* 命名空间（EDITOR_OVERHAUL §1.1——pixel.css 的 .btn/.panel 是立体浮雕皮肤，禁止沾）。
// 预览挂完整游戏骨架 .rules-panel.goal-hud.hud-card → .tut-split → nav 占位列 → TutorialContent：
// 面板宽走 pixel.css 同一条 .rules-panel 规则（min(1180px,92vw)）+ 祖先类名齐全
// （.rules-panel .pixel-text{gap:1px} 字距修正依赖它），内容列宽与游戏一致。
// T②b 落在这里的部分：三栏拖宽（persist）、autosave 草稿恢复条、多标签只读锁横幅、校验面板开关、
// 预览 debounce ~100ms + 滚动跟随选中块 + 短暂高亮、window 级剪贴板统一裁决
// （粘贴顺序 §1.2：图片文件 > 哨兵信封 > 含换行文本拆段 > 普通文本入光标）、右键菜单挂载。
// 纯净性：本模块图只触 TutorialContent/PixelText/richtext/store/api——严禁 text/*、gameStore
// （text/zh.js import tutorial.json，一旦触达，每次保存 vite 都会 full-reload 编辑器自己）。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useTedStore, findByUid, normalizeSel, isImgData,
  encodeBlocks, encodeChapters, decodeEnvelope, splitPasteParts,
} from './store';
import { doUpload, pasteName } from './helpers';
import { useTabLock } from './lock';
import Tree from './Tree';
import EditCol from './EditCol';
import ContextMenu from './Menu';
import ValidationPanel from './Validation';
import TutorialContent from '../ui/TutorialContent';
import ImgResizer from './ImgResizer';
import PixelText from '../assets/pixelfont/PixelText';

// 409 冲突对话框：磁盘被他人（legacy 编辑器/另一窗口）改过——不覆盖不丢内存态，交用户裁决
function ConflictModal() {
  const load = useTedStore((s) => s.load);
  const save = useTedStore((s) => s.save);
  const dismissConflict = useTedStore((s) => s.dismissConflict);
  return (
    <div className="ted-modal-mask">
      <div className="ted-modal" role="dialog" aria-label="保存冲突">
        <h3>磁盘文件已被修改</h3>
        <p>教程文档在本编辑器之外被改动过（另一窗口或旧版编辑器）。重新载入会丢弃当前未保存的更改；强制覆盖会丢弃磁盘上的外部改动。</p>
        <div className="ted-modal-btns">
          <button type="button" className="ted-btn" onClick={dismissConflict}>取消</button>
          <button type="button" className="ted-btn" onClick={() => load()}>重新载入</button>
          <button type="button" className="ted-btn danger" onClick={() => save(true)}>强制覆盖</button>
        </div>
      </div>
    </div>
  );
}

// 轻提示（上传结果等）：2.6s 自动隐去；扁平、非游戏 .toast 皮肤。
// 可见性由「已隐去的序号」推导（hiddenN!==toast.n 即显示），effect 里只有异步回调 setState。
function Toast() {
  const toast = useTedStore((s) => s.toast);
  const [hiddenN, setHiddenN] = useState(0);
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setHiddenN(toast.n), 2600);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  const show = hiddenN !== toast.n;
  return <div className={`ted-toast${show ? ' show' : ''}${toast.err ? ' err' : ''}`}>{toast.msg}</div>;
}

// 树上统计章/段数（状态栏显示）
function countDoc(nodes) {
  let ch = 0, blocks = 0;
  const walk = (n) => { ch += 1; blocks += n.body.length; (n.children ?? []).forEach(walk); };
  (nodes ?? []).forEach(walk);
  return { ch, blocks };
}

// ---- 三栏拖宽（§1.2 布局）：宽度存 localStorage；拖动以按下瞬间为基准算增量 ----
const COLS_KEY = 'fate-ted-cols';
const LIM = { tree: [180, 460, 250], edit: [300, 680, 400] }; // [min, max, 默认]
const clampW = (v, [lo, hi, def]) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def);
function loadCols() {
  try {
    const c = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
    return { tree: clampW(c?.tree, LIM.tree), edit: clampW(c?.edit, LIM.edit) };
  } catch { return { tree: LIM.tree[2], edit: LIM.edit[2] }; }
}
function Gutter({ onStart, onDrag, onEnd }) {
  const downX = useRef(null);
  return (
    <div
      className="ted-gutter"
      onPointerDown={(e) => { e.preventDefault(); downX.current = e.clientX; onStart(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (downX.current != null) onDrag(e.clientX - downX.current); }}
      onPointerUp={(e) => {
        if (downX.current == null) return;
        downX.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
        onEnd();
      }}
    />
  );
}

// 值防抖：预览重排跟在输入后 ~100ms（§1.2 性能定标），存盘/撤回不经过这里
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function TutorialEditor() {
  const chapters = useTedStore((s) => s.chapters);
  const status = useTedStore((s) => s.status);
  const error = useTedStore((s) => s.error);
  const dirty = useTedStore((s) => s.dirty);
  const conflict = useTedStore((s) => s.conflict);
  const docPath = useTedStore((s) => s.docPath);
  const selUid = useTedStore((s) => s.selUid);
  const selN = useTedStore((s) => s.selN);
  const ro = useTedStore((s) => s.ro);
  const draftOffer = useTedStore((s) => s.draftOffer);
  const canUndo = useTedStore((s) => s.past.length > 0);
  const canRedo = useTedStore((s) => s.future.length > 0);
  const [valOpen, setValOpen] = useState(false);
  const [cols, setCols] = useState(loadCols);
  const colsRef = useRef(cols);  // 活值镜像：只在 applyCols 里与 setState 成对写（渲染期写 ref 被禁）
  const colsBase = useRef(cols); // 拖动起点快照（onStart 时记）
  const applyCols = (next) => { colsRef.current = next; setCols(next); };
  const previewRef = useRef(null);
  const stageRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(1);
  const lock = useTabLock(); // 多标签 BroadcastChannel 锁：后开标签只读，lock.current.seize() 夺锁

  // 首载（StrictMode 双跑幂等：load 只是重复 GET）
  useEffect(() => { useTedStore.getState().load(); useTedStore.getState().loadTemplates(); }, []);

  // 全局快捷键（§0.7 键盘纪律）：IME 合成期直通；Ctrl+S/Z/Y/F 即使焦点在输入框也接管
  // （Ctrl+F 属全局命令而非文本编辑键，legacy 同款全局拦截——浏览器查找对编辑器无意义）。
  // Esc 链（§1.2）：右键菜单 → 模态（图库 → 冲突框）→ 搜索清词。监听器只挂一次，动作经 getState() 取活值。
  useEffect(() => {
    const onKey = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const st = useTedStore.getState();
      if (e.key === 'Escape') {
        if (st.menu) { st.closeMenu(); return; }
        if (st.picker) { st.closePicker(); return; }
        if (st.tplGallery) { st.closeTplGallery(); return; }
        if (st.conflict) { st.dismissConflict(); return; }
        const search = document.getElementById('ted-search');
        if (document.activeElement === search && st.query) st.setQuery('');
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); st.save(); }
      else if (k === 'f') {
        e.preventDefault();
        const search = document.getElementById('ted-search');
        search?.focus(); search?.select();
      } else if (k === 'z' && e.shiftKey) { e.preventDefault(); st.redo(); }
      else if (k === 'z') { e.preventDefault(); st.undo(); }
      else if (k === 'y') { e.preventDefault(); st.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 未保存守卫：带脏改动关页/刷新时浏览器弹确认
  useEffect(() => {
    const onBefore = (e) => {
      if (useTedStore.getState().dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  // ---- window 级剪贴板统一裁决（§1.2）。监听器只挂一次，活值经 getState()。
  // 复制/剪切：输入框文字选区或页面文字选区 → 浏览器默认；树容器持焦 → 章节信封；有块选择 → 块信封。
  // 粘贴顺序：① 图片文件 ② 哨兵信封 ③ 含换行文本拆段 ④ 普通文本入光标（浏览器默认）。
  useEffect(() => {
    const onCopyCut = (e) => {
      const st = useTedStore.getState();
      if (!st.chapters || !e.clipboardData) return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.selectionStart !== ae.selectionEnd) return; // 文字选区归浏览器
      if (String(document.getSelection?.() || '')) return; // 预览区文字选区归浏览器
      const doCut = e.type === 'cut' && !st.ro; // 只读标签的「剪切」退化为复制
      if (ae?.closest?.('.ted-tree') && st.selChUids.length) {
        const nodes = normalizeSel(st.chapters, st.selChUids).map((u) => findByUid(st.chapters, u)).filter(Boolean);
        if (!nodes.length) return;
        e.clipboardData.setData('text/plain', encodeChapters(nodes));
        e.preventDefault();
        if (doCut) st.deleteChapters(st.selChUids); // 剪切不 confirm：剪贴板+撤回双兜底
        return;
      }
      if (st.selBlks.length && st.selUid) {
        const ch = findByUid(st.chapters, st.selUid);
        const datas = ch ? ch.body.filter((b) => st.selBlks.includes(b.uid)).map((b) => b.data) : [];
        if (!datas.length) return;
        e.clipboardData.setData('text/plain', encodeBlocks(datas));
        e.preventDefault();
        if (doCut) st.removeBlocks(st.selUid, st.selBlks);
      }
    };
    const onPaste = (e) => {
      const st = useTedStore.getState();
      if (!st.chapters || st.ro) return;
      // ① 图片文件：焦点在图片块内 → 换该块的图；否则当前章节末尾追加图片段（追加+填图=一步撤回）
      const file = [...(e.clipboardData?.items || [])]
        .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
        .find((f) => f && f.type.startsWith('image/'));
      const ch = st.selUid ? findByUid(st.chapters, st.selUid) : null;
      if (file) {
        if (!ch) return;
        e.preventDefault();
        let target = null;
        const blkEl = document.activeElement?.closest?.('[data-blk-uid]');
        if (blkEl) {
          const b = ch.body.find((x) => x.uid === blkEl.dataset.blkUid);
          if (b && isImgData(b.data)) target = b.uid;
        }
        let withHistory = true;
        if (!target) { target = st.insertBlock(ch.uid, ch.body.length, { img: '' }); withHistory = false; }
        if (target) doUpload(new File([file], pasteName(file), { type: file.type }), ch.uid, target, withHistory);
        return;
      }
      const txt = e.clipboardData?.getData('text/plain') ?? '';
      // ② 哨兵信封（本编辑器复制的章节/块）：即使焦点在输入框也按结构粘贴——信封 JSON 入正文永远不是本意
      const env = decodeEnvelope(txt);
      if (env) {
        e.preventDefault();
        if (env.kind === 'chapters') { st.pasteChapters(st.selUid, env.chapters); return; }
        if (!ch) return;
        const blkEl = document.activeElement?.closest?.('[data-blk-uid]');
        st.pasteBlocks(ch.uid, blkEl?.dataset.blkUid ?? st.selBlks.at(-1) ?? null, env.blocks);
        return;
      }
      // ③ 含换行文本：块 textarea 内 → 光标处拆段；无输入焦点但选了章节 → 主选块后（无则末尾）成块
      if (/\r|\n/.test(txt)) {
        const ae = document.activeElement;
        const blkEl = ae?.closest?.('[data-blk-uid]');
        if (ae?.tagName === 'TEXTAREA' && blkEl) {
          e.preventDefault();
          st.pasteLines(st.selUid, blkEl.dataset.blkUid, ae.value.slice(0, ae.selectionStart) + txt + ae.value.slice(ae.selectionEnd));
          return;
        }
        if (!/^(INPUT|TEXTAREA)$/.test(ae?.tagName || '') && ch) {
          e.preventDefault();
          st.pasteBlocks(ch.uid, st.selBlks.at(-1) ?? null, splitPasteParts(txt));
        }
        return; // 标题/URL 等单行输入框：浏览器默认（input 自己吞换行）
      }
      // ④ 普通文本 → 浏览器默认入光标
    };
    window.addEventListener('copy', onCopyCut);
    window.addEventListener('cut', onCopyCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopyCut);
      window.removeEventListener('cut', onCopyCut);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // 预览等比缩放：面板按游戏满宽（--tut-panel-max）真实渲染（换行/布局所见即所得），整体 scale 适配预览列宽。
  // 单一真源：满宽读游戏 CSS 变量，游戏改尺寸编辑器自动跟随。scale ≤1（不放大），预览列窄就缩、宽就 1:1。
  useEffect(() => {
    const host = previewRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const panelW = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--tut-panel-max');
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : 1180;
    };
    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const avail = host.clientWidth - 36; // .ted-preview 左右 padding 各 18
        setPreviewScale(Math.max(0.25, Math.min(1, avail / panelW())));
      });
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(host);
    recompute();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const sel = selUid ? findByUid(chapters, selUid) : null;

  // 预览快照（uid 对齐锚点）+ ~100ms 防抖：连续打字时预览重排跟在后面，编辑列不被拖慢
  const previewSnap = useMemo(() => {
    const node = selUid ? findByUid(chapters, selUid) : null;
    if (!node) return null;
    return { title: node.title, titleSize: node.rest?.titleSize, body: node.body.map((b) => b.data), uids: node.body.map((b) => b.uid) };
  }, [chapters, selUid]);
  const shown = useDebounced(previewSnap, 100);
  const chapterView = useMemo(() => (shown ? { title: shown.title, titleSize: shown.titleSize, body: shown.body } : null), [shown]);

  // 预览滚动跟随选中块 + 短暂高亮（§1.2）：selN 触发（同一块重复定位也再滚一次）；
  // 预览内容防抖落后 ~100ms，所以也依赖 shown——内容落地后再补一次定位
  useEffect(() => {
    if (!selN || !shown) return undefined;
    const uid = useTedStore.getState().selBlks.at(-1);
    if (!uid) return undefined;
    const host = previewRef.current;
    const el = host?.querySelector(`[data-ted-uid="${uid}"]`);
    if (!el || !host) return undefined;
    // 手动滚（不用 el.scrollIntoView）：预览面板在 zoom 舞台内，scrollIntoView 在 zoom 祖先下定位失准；
    // 用视口 rect 差直接调 host.scrollTop（host 未缩放，rect 已含 zoom，差值即正确滚动量）。
    const er = el.getBoundingClientRect(), hr = host.getBoundingClientRect(), m = 12;
    if (er.top < hr.top + m) host.scrollTop += er.top - hr.top - m;
    else if (er.bottom > hr.bottom - m) host.scrollTop += er.bottom - hr.bottom + m;
    el.classList.add('ted-flash');
    const id = setTimeout(() => el.classList.remove('ted-flash'), 1200);
    return () => clearTimeout(id);
  }, [selN, shown]);

  const { ch, blocks } = countDoc(chapters);

  const reload = () => {
    // DEV 工具，原生 confirm 足矣（legacy 同款交互）
    if (!dirty || window.confirm('放弃未保存的更改，重新从磁盘载入？')) useTedStore.getState().load();
  };

  const persistCols = () => {
    try { localStorage.setItem(COLS_KEY, JSON.stringify(colsRef.current)); } catch { /* 忽略 */ }
  };

  return (
    <div className="ted-root">
      <div className="ted-toolbar">
        <span className="ted-title">教程编辑器 2.0</span>
        <button type="button" className="ted-btn" disabled={!canUndo || ro} onClick={() => useTedStore.getState().undo()}>撤回</button>
        <button type="button" className="ted-btn" disabled={!canRedo || ro} onClick={() => useTedStore.getState().redo()}>重做</button>
        <button type="button" className={`ted-btn${valOpen ? ' on' : ''}`} disabled={!chapters} onClick={() => setValOpen((v) => !v)}>校验</button>
        <button type="button" className="ted-btn" title="版式库：把设计好的排版存起来，到处一键插入" onClick={() => useTedStore.getState().openTplGallery()}>版式</button>
        <span className="ted-toolbar-gap" />
        <button type="button" className="ted-btn" disabled={status === 'loading'} onClick={reload}>重新载入</button>
        <button
          type="button"
          className="ted-btn primary"
          disabled={status !== 'ready' || !chapters || ro}
          onClick={() => useTedStore.getState().save()}
        >{status === 'saving' ? '保存中…' : '保存 (Ctrl+S)'}</button>
      </div>

      {/* 多标签锁横幅：后开标签只读，可夺锁（原持锁窗口即转只读） */}
      {ro && (
        <div className="ted-bar ted-robar">
          <span>另一窗口正在编辑此文档——本标签处于只读模式。</span>
          <button type="button" className="ted-btn sm" onClick={() => lock.current.seize()}>夺锁编辑</button>
        </div>
      )}
      {/* autosave 草稿恢复条：草稿内容 ≠ 磁盘时出现（上次会话崩溃/没保存）；只读标签不显示（恢复被守卫拦截） */}
      {draftOffer && !ro && (
        <div className="ted-bar ted-draftbar">
          <span>检测到未保存的自动草稿（{draftOffer.ts ? new Date(draftOffer.ts).toLocaleString() : '时间未知'}）——上次可能没保存就退出了。</span>
          <button type="button" className="ted-btn sm" onClick={() => useTedStore.getState().restoreDraft()}>恢复草稿</button>
          <button type="button" className="ted-btn sm" onClick={() => useTedStore.getState().discardDraft()}>丢弃</button>
        </div>
      )}

      <div className="ted-main" style={{ '--ted-tree-w': cols.tree + 'px', '--ted-edit-w': cols.edit + 'px' }}>
        <Tree />
        <Gutter
          onStart={() => { colsBase.current = colsRef.current; }}
          onDrag={(dx) => applyCols({ ...colsBase.current, tree: clampW(colsBase.current.tree + dx, LIM.tree) })}
          onEnd={persistCols}
        />
        <EditCol chapter={sel} />
        <Gutter
          onStart={() => { colsBase.current = colsRef.current; }}
          onDrag={(dx) => applyCols({ ...colsBase.current, edit: clampW(colsBase.current.edit + dx, LIM.edit) })}
          onEnd={persistCols}
        />

        {/* 预览：完整游戏骨架按游戏满宽真实渲染（宽度/换行/字距逐像素一致），外层 stage 整体等比缩放
            适配预览列宽——教程框在游戏里改多大，这里就按比例显示多大。入场动画由 editor.css 反污染关闭。
            选中图片段时 ImgResizer 在此浮出缩放把手（编辑器 chrome，不进共享渲染器；缩放比传入以换算拖拽量） */}
        <div className="ted-preview" ref={previewRef}>
          <ImgResizer previewRef={previewRef} scale={previewScale} />
          <div className="ted-stage" ref={stageRef} style={{ zoom: previewScale }}>
            <div className="goal-hud hud-card rules-panel">
              <div className="goal-line hud-card-title">
                <PixelText size={2} color="var(--px-gold)">教程</PixelText>
              </div>
              <div className="tut-split">
                <div className="tut-nav ted-nav-ghost" aria-hidden="true" />
                <TutorialContent
                  chapter={chapterView}
                  fallback={<p className="rules-p">未选择章节。</p>}
                  renderEmptyImg={(item, i) => <div className="ted-img-empty" data-ted-uid={shown?.uids[i]}>图片路径为空</div>}
                  blockProps={(i) => ({ 'data-ted-uid': shown?.uids[i] })}
                />
              </div>
            </div>
          </div>
          <div className="ted-preview-scale" title="预览缩放比（教程框按游戏满宽渲染后整体缩放适配）">{Math.round(previewScale * 100)}%</div>
        </div>
      </div>

      {valOpen && <ValidationPanel onClose={() => setValOpen(false)} />}

      <div className="ted-statusbar">
        <span>{docPath || '（未载入）'}</span>
        <span>{ch} 章 · {blocks} 段</span>
        <span className={ro ? 'ted-status-err' : ''}>{ro ? '只读（另一窗口持锁）' : '可编辑'}</span>
        <span className={error ? 'ted-status-err' : dirty ? 'ted-status-dirty' : ''}>
          {error ? error : status === 'saving' ? '保存中…' : status === 'loading' ? '载入中…' : dirty ? '有未保存更改' : '已保存'}
        </span>
      </div>

      {conflict && <ConflictModal />}
      <ContextMenu />
      <Toast />
    </div>
  );
}
