// 章节树面板（T②a 基础 + T②b 多选/右键/键盘/定位）：
// - 搜索过滤（命中+祖先链、祖先强制展开、命中绿高亮）、全开/全收、+顶层、行内 +子。
// - 多选：Ctrl 点切换、Shift 沿可见序范围选；拖拽/复制/删除前由 store 做「祖先吸收后代」归一化。
// - 键盘（树容器持焦）：↑↓ 走可见序、←→ 收展、F2 行内重命名、Del 批删（≥5 章 confirm）、Ctrl+D 副本。
// - HTML5 拖拽三位置（上 1/4 前、下 1/4 后、中间成子）+ 底部 root-drop 提升顶层；多选拖整组。
// - 行组件 memo（uid 键，标题/计数走值 props——节点对象是原地变异的，身份比不出变化）。
// 监听器/句柄只造一次（§0 坑清单），活值经 getState()/ref。
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTedStore, findByUid, isDescendant } from './store';
import { confirmDeleteChapters, copyChaptersToClipboard, pasteFromClipboardAtChapter, countRender } from './helpers';

// 展开三角（编辑器 chrome 自绘，不借游戏 .tut-tri——那套带过渡动画皮肤）
function Tri({ open }) {
  return (
    <svg className={`ted-tri ${open ? 'open' : ''}`} width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
      <polygon points="2.5,1 2.5,7 6.5,4" />
    </svg>
  );
}

// 搜索命中：标题或正文（含图片 URL/alt、条文字）含关键词，大小写不敏感（legacy 同款）
function matchNode(n, q) {
  if ((n.title || '').toLowerCase().includes(q)) return true;
  for (const b of n.body) {
    const d = b.data;
    const s = typeof d === 'string' ? d : `${d?.img || ''} ${d?.alt || ''} ${d?.text || ''} ${d?.bar || ''}`;
    if (s.toLowerCase().includes(q)) return true;
  }
  return false;
}

// 树行（memo）：标题/段数/有无子级全走值 props——节点标题是原地变异的，传节点对象身份比不出变化
const TreeRow = memo(function TreeRow(props) {
  const { uid, depth, title, meta, hasKids, open, primary, msel, hit, dragging, dz, renaming, h } = props;
  countRender('t:' + uid);
  return (
    <div
      className={`ted-tree-item${primary ? ' sel' : ''}${msel && !primary ? ' msel' : ''}${dragging ? ' dragging' : ''}${dz ? ' drop-' + dz : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      data-uid={uid}
      draggable={!renaming}
      onClick={(e) => h.rowClick(e, uid)}
      onContextMenu={(e) => h.rowMenu(e, uid)}
      onDragStart={(e) => h.dragStart(e, uid)}
      onDragEnd={h.dragEnd}
      onDragOver={(e) => h.dragOver(e, uid)}
      onDragLeave={() => h.dragLeave(uid)}
      onDrop={(e) => h.drop(e, uid)}
    >
      {hasKids ? (
        <button
          type="button"
          className="ted-tri-btn"
          aria-label={open ? '收起' : '展开'}
          onClick={(e) => { e.stopPropagation(); h.toggle(uid); }}
        ><Tri open={open} /></button>
      ) : <span className="ted-tri-pad" />}
      {renaming ? (
        <input
          className="ted-input ted-rename"
          defaultValue={title}
          autoFocus
          onFocus={(e) => e.target.select()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.nativeEvent?.isComposing || e.keyCode === 229) return; // IME 纪律：合成期 Enter 归输入法
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); h.renameCommit(uid, e.target.value); }
            else if (e.key === 'Escape') { e.stopPropagation(); h.renameCancel(); }
          }}
          onBlur={(e) => h.renameCommit(uid, e.target.value)}
        />
      ) : (
        <>
          <span className={`ted-tree-title${hit ? ' hit' : ''}`}>{title || '（无标题）'}</span>
          <span className="ted-node-meta">{meta}段</span>
          <button
            type="button"
            className="ted-btn sm ted-node-add"
            title="在其下追加子章节"
            onClick={(e) => { e.stopPropagation(); h.addChild(uid); }}
          >+子</button>
        </>
      )}
    </div>
  );
});

export default function Tree() {
  const chapters = useTedStore((s) => s.chapters);
  const status = useTedStore((s) => s.status);
  const error = useTedStore((s) => s.error);
  const selUid = useTedStore((s) => s.selUid);
  const selChUids = useTedStore((s) => s.selChUids);
  const openUids = useTedStore((s) => s.openUids);
  const query = useTedStore((s) => s.query);
  const selN = useTedStore((s) => s.selN);
  const [dragUids, setDragUids] = useState(null); // 拖动集（多选拖整组）
  const [drop, setDrop] = useState(null);         // {uid, zone:'before'|'after'|'into'} | {root:true}
  const [renameUid, setRenameUid] = useState(null); // F2 行内重命名中的行

  const bodyRef = useRef(null);   // 滚动容器 + 键盘焦点宿主
  const visRef = useRef([]);      // 可见行 uid 序（键盘 ↑↓ / Shift 范围都按它走；effect 里回填）
  const anchorRef = useRef(null); // Shift 范围选的锚（最后一次非 Shift 点击）
  // 状态活值镜像：句柄只造一次（§0 坑清单），镜像只在事件句柄里与 setState 成对写
  //（渲染期写 ref 被 react-hooks/refs 禁止）
  const dragRef = useRef(null);
  const dropRef = useRef(null);
  const renameRef = useRef(null);

  const q = query.trim().toLowerCase();
  // 搜索模式：只显示命中节点 + 其祖先链（祖先强制展开）
  const filter = useMemo(() => {
    if (!q || !chapters) return null;
    const keep = new Set(), forceOpen = new Set(), hits = new Set();
    const mark = (nodes, ancestors) => {
      for (const n of nodes) {
        if (matchNode(n, q)) {
          hits.add(n.uid); keep.add(n.uid);
          ancestors.forEach((a) => { keep.add(a.uid); forceOpen.add(a.uid); });
        }
        mark(n.children, [...ancestors, n]);
      }
    };
    mark(chapters, []);
    return { keep, forceOpen, hits };
  }, [q, chapters]);

  // 行句柄：只造一次；选择/拖拽的活值全部经 getState()/ref 取（§0 坑清单：依赖 props 会拖拽中途被冲）
  const h = useMemo(() => {
    const st = () => useTedStore.getState();
    return {
      rowClick: (e, uid) => {
        bodyRef.current?.focus({ preventScroll: true }); // 键盘导航接力：点了树，↑↓/F2/Del 立即可用
        const s = st();
        if (e.ctrlKey || e.metaKey) { s.ctrlSelect(uid); anchorRef.current = uid; return; }
        if (e.shiftKey) {
          const vis = visRef.current;
          const a = vis.indexOf(anchorRef.current ?? s.selUid ?? uid);
          const b = vis.indexOf(uid);
          if (a < 0 || b < 0) { s.select(uid); anchorRef.current = uid; return; }
          const [lo, hi] = a < b ? [a, b] : [b, a];
          // 点击者放末位=主选；锚不动（连续 Shift 点重算范围）
          s.rangeSelect([...vis.slice(lo, hi + 1).filter((u) => u !== uid), uid], uid);
          return;
        }
        s.select(uid);
        anchorRef.current = uid;
      },
      rowMenu: (e, uid) => {
        e.preventDefault();
        let s = st();
        if (!s.selChUids.includes(uid)) { s.select(uid); anchorRef.current = uid; s = st(); }
        const sel = [...s.selChUids];
        const n = sel.length;
        s.openMenu(e.clientX, e.clientY, [
          { label: '新建子章节', onClick: () => st().addChildChapter(uid) },
          { label: '在其前插入章节', onClick: () => st().insertChapterNear(uid, 'before') },
          { label: '在其后插入章节', onClick: () => st().insertChapterNear(uid, 'after') },
          { sep: true },
          { label: '重命名', hint: 'F2', onClick: () => { renameRef.current = uid; setRenameUid(uid); } },
          { label: n > 1 ? `复制 ${n} 章` : '复制', onClick: () => copyChaptersToClipboard(sel) },
          { label: '粘贴到其后', onClick: () => pasteFromClipboardAtChapter(uid) },
          { label: n > 1 ? `创建 ${n} 章副本` : '创建副本', hint: 'Ctrl+D', onClick: () => st().duplicateChapters(sel) },
          { sep: true },
          { label: n > 1 ? `删除 ${n} 章` : '删除', hint: 'Del', danger: true, onClick: () => confirmDeleteChapters(sel) },
        ]);
      },
      toggle: (uid) => st().toggleOpen(uid),
      addChild: (uid) => st().addChildChapter(uid),
      renameCommit: (uid, val) => {
        if (renameRef.current !== uid) return; // Enter 提交后紧跟的 blur 不再重复提交
        renameRef.current = null;
        setRenameUid(null);
        const s = st();
        if (val !== (findByUid(s.chapters, uid)?.title ?? '')) s.setTitle(uid, val);
        bodyRef.current?.focus();
      },
      renameCancel: () => { renameRef.current = null; setRenameUid(null); bodyRef.current?.focus(); },
      // ---- 拖拽（多选拖整组；zone 判定 legacy 同款：上 1/4 前、下 1/4 后、中间成子） ----
      dragStart: (e, uid) => {
        const s = st();
        const set = s.selChUids.includes(uid) ? [...s.selChUids] : [uid];
        if (!s.selChUids.includes(uid)) s.select(uid);
        dragRef.current = set;
        setDragUids(set);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', uid);
      },
      dragEnd: () => { dragRef.current = null; dropRef.current = null; setDragUids(null); setDrop(null); },
      dragOver: (e, uid) => {
        const ds = dragRef.current;
        if (!ds || ds.includes(uid)) return;
        const s = st();
        const target = findByUid(s.chapters, uid);
        if (!target) return;
        for (const du of ds) { // 目标在拖动集任一子树里 → 拒（不能拖进自身/后代）
          const dn = findByUid(s.chapters, du);
          if (dn && isDescendant(dn, target)) return;
        }
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const y = (e.clientY - r.top) / r.height;
        const zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into';
        const cur = dropRef.current;
        if (!(cur && cur.uid === uid && cur.zone === zone)) {
          dropRef.current = { uid, zone };
          setDrop(dropRef.current);
        }
      },
      dragLeave: (uid) => {
        if (dropRef.current && dropRef.current.uid === uid) { dropRef.current = null; setDrop(null); }
      },
      drop: (e, uid) => {
        e.preventDefault();
        const ds = dragRef.current;
        const zone = dropRef.current && dropRef.current.uid === uid ? dropRef.current.zone : 'into';
        dropRef.current = null;
        setDrop(null);
        if (ds) st().moveChapters(ds, uid, zone);
      },
    };
  }, []);

  // 键盘导航（树容器持焦；重命名输入框内的键不归这里）
  const onKeyDown = (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    if (e.target.closest('input,textarea,select')) return;
    const s = useTedStore.getState();
    const vis = visRef.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!vis.length) return;
      const i = vis.indexOf(s.selUid);
      const uid = i < 0 ? vis[0] : vis[Math.max(0, Math.min(vis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      s.select(uid);
      anchorRef.current = uid;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!s.selUid) return;
      e.preventDefault();
      const n = findByUid(s.chapters, s.selUid);
      if (!n?.children.length) return;
      const isOpen = s.openUids.has(s.selUid);
      if (e.key === 'ArrowRight' ? !isOpen : isOpen) s.toggleOpen(s.selUid);
    } else if (e.key === 'F2') {
      if (s.selUid) { e.preventDefault(); renameRef.current = s.selUid; setRenameUid(s.selUid); }
    } else if (e.key === 'Delete') {
      if (s.selChUids.length) { e.preventDefault(); confirmDeleteChapters(s.selChUids); }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault(); // 别让浏览器收藏页
      if (s.selChUids.length) s.duplicateChapters(s.selChUids);
    }
  };

  // 程序化选中跟随（校验定位/键盘导航/粘贴后选中）：滚到就近可见
  useEffect(() => {
    if (!selN) return; // 0 = 还没有任何选择动作
    const uid = useTedStore.getState().selUid;
    if (!uid) return;
    bodyRef.current?.querySelector(`[data-uid="${uid}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selN]);

  const st = () => useTedStore.getState();
  const selSet = new Set(selChUids);

  // 递归渲染行；顺便收集可见序（键盘/Shift 范围都按它走——effect 里回填 visRef，渲染期不碰 ref）
  const rows = [];
  const visNow = [];
  const rec = (nodes, depth) => {
    nodes.forEach((n) => {
      if (filter && !filter.keep.has(n.uid)) return;
      const open = filter ? filter.forceOpen.has(n.uid) : openUids.has(n.uid);
      visNow.push(n.uid);
      rows.push(
        <TreeRow
          key={n.uid}
          uid={n.uid}
          depth={depth}
          title={n.title}
          meta={n.body.length}
          hasKids={n.children.length > 0}
          open={open}
          primary={selUid === n.uid}
          msel={selSet.has(n.uid)}
          hit={!!filter?.hits.has(n.uid)}
          dragging={!!dragUids?.includes(n.uid)}
          dz={drop && drop.uid === n.uid ? drop.zone : null}
          renaming={renameUid === n.uid}
          h={h}
        />,
      );
      if (open && n.children.length) rec(n.children, depth + 1);
    });
  };
  if (chapters) rec(chapters, 0);

  // 可见序回填（每次渲染后）：事件句柄读 visRef 拿到与当前 DOM 一致的行序
  useEffect(() => { visRef.current = visNow; });

  return (
    <div className="ted-tree">
      <div className="ted-tree-head">
        <span>章节树</span>
        <span className="ted-flex" />
        <button type="button" className="ted-btn sm" title="全部展开" disabled={!chapters} onClick={() => st().openAll()}>全开</button>
        <button type="button" className="ted-btn sm" title="全部收起" disabled={!chapters} onClick={() => st().closeAll()}>全收</button>
        <button type="button" className="ted-btn sm" disabled={!chapters} onClick={() => st().addTopChapter()}>+ 顶层章节</button>
      </div>
      <div className="ted-search">
        <input
          id="ted-search"
          className="ted-input"
          value={query}
          placeholder="搜索标题 / 正文…"
          onChange={(e) => st().setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="ted-btn sm" title="清除搜索 (Esc)" onClick={() => st().setQuery('')}>✕</button>
        )}
      </div>
      {/* tabIndex：键盘导航的焦点宿主（点行时也主动 focus 到这里） */}
      <div className="ted-tree-body" ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown}>
        {status === 'loading' && <div className="ted-pane-hint">载入中…</div>}
        {status === 'error' && (
          <div className="ted-pane-hint err">
            {error}
            <button type="button" className="ted-btn" onClick={() => st().load()}>重试</button>
          </div>
        )}
        {chapters && chapters.length === 0 && <div className="ted-pane-hint">还没有章节。点上方「+ 顶层章节」开始。</div>}
        {filter && filter.keep.size === 0 && <div className="ted-pane-hint">没有匹配「{query.trim()}」的章节。</div>}
        {rows}
        {/* root-drop：拖到树底空白区 = 提升为顶层章节（追加到末尾）；多选拖整组同样适用 */}
        {chapters && chapters.length > 0 && (
          <div
            className={`ted-root-drop${drop?.root ? ' into' : ''}`}
            title="拖到此处 = 移到顶层末尾"
            onDragOver={(e) => {
              if (!dragRef.current) return;
              e.preventDefault();
              if (!dropRef.current?.root) { dropRef.current = { root: true }; setDrop(dropRef.current); }
            }}
            onDragLeave={() => { if (dropRef.current?.root) { dropRef.current = null; setDrop(null); } }}
            onDrop={(e) => {
              e.preventDefault();
              dropRef.current = null;
              setDrop(null);
              if (dragRef.current) st().moveChapters(dragRef.current, null);
            }}
          />
        )}
      </div>
    </div>
  );
}
