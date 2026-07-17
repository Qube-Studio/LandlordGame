// 正文编辑列（T②a 基础 + T②b 多选/右键/键盘/定位/memo）：标题行、段落块列表（文字/图片/属性条/
// 空行全块型）、块头快速插入、块拖拽排序、末尾添加行、上传/图库、聚焦请求消费。
// T②b：块多选（Ctrl 点/Shift 范围，主选=末位）、右键菜单（插入/复制/剪切/粘贴/删除）、
// Alt+↑↓ 移动主选块、程序化选中 scrollIntoView、Block memo（uid 键 + v 版本号——块数据是
// 原地变异的，对象身份比不出变化，store 每次块编辑 bump v）。
// 剪贴板（Ctrl+C/X/V）与贴图统一在 TutorialEditor 的 window 级裁决器，本组件不再自设 paste 钩子。
// IME 修复（§0.7）：Enter 拆段前查 e.nativeEvent.isComposing——React 合成键盘事件不透传 isComposing，
// 必须从 nativeEvent 上读；legacy 没查，中文输入法选词回车会误拆段，此处修复不复刻。
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  useTedStore, findByUid,
  isImgData, isBarData, textOf, sizeOf, normBar, newBar,
} from './store';
import { listImages } from './api';
import { doUpload, confirmDeleteChapters, copyBlocksToClipboard, pasteFromClipboardAfterBlock, countRender } from './helpers';
import { parseRuns } from '../game/richtext';

const SIZES = [['s', '小'], ['m', '标准'], ['l', '大'], ['xl', '特大']];
const SIZE_PX = { s: 11, m: 13, l: 16, xl: 20 };
const SIZE_LABEL = Object.fromEntries(SIZES);
const BAR_COLORS = [['gold', '金'], ['green', '绿'], ['red', '红'], ['blue', '蓝']];
const BAR_FADES = [['both', '两端'], ['left', '左'], ['right', '右'], ['none', '无']];

// ---- 文字段 ----
function TextBody({ chUid, block }) {
  const taRef = useRef(null);
  const text = textOf(block.data) ?? '';
  const size = sizeOf(block.data);
  const st = () => useTedStore.getState();

  // 高度自适应内容（legacy autoGrow 同款）
  useEffect(() => {
    const ta = taRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.max(46, ta.scrollHeight + 2) + 'px'; }
  }, [text]);

  const onKeyDown = (e) => {
    // IME 合成期直通：合成态的 Enter/Backspace 是在跟输入法对话，不是结构操作
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    const ta = e.target;
    if (e.key === 'Enter' && !e.shiftKey) {
      // 段落即条目：Enter=在光标处拆成两段（Shift+Enter 才是真换行——渲染器会把换行当空格吞掉）
      e.preventDefault();
      st().splitBlock(chUid, block.uid, ta.value.slice(0, ta.selectionStart), ta.value.slice(ta.selectionEnd));
    } else if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      // 行首 Backspace=并入上一文字段（沿用上一段的字号）；上一段是图/条则不并（默认行为也是空操作）
      if (st().mergeBlockUp(chUid, block.uid)) e.preventDefault();
    }
  };
  // 把选区包成 **…**（无选区=插「文字」占位）；离散一步撤回、恢复选区
  const bold = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || '文字';
    st().setBlockText(chUid, block.uid, ta.value.slice(0, s) + '**' + sel + '**' + ta.value.slice(e), null);
    requestAnimationFrame(() => { // 等 React 回写受控值后再恢复选区
      ta.focus();
      try { ta.setSelectionRange(s + 2, s + 2 + sel.length); } catch { /* 忽略 */ }
    });
  };
  const listify = () => {
    if (!text.startsWith('- ')) st().setBlockText(chUid, block.uid, '- ' + text, null);
    taRef.current?.focus();
  };

  return (
    <>
      <textarea
        ref={taRef}
        className="ted-input"
        rows={2}
        value={text}
        onChange={(e) => st().setBlockText(chUid, block.uid, e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="ted-row">
        <button type="button" className="ted-btn sm" title="把选中文字包成 **…**" onClick={bold}>** 金字 **</button>
        <button type="button" className="ted-btn sm" title="在行首插入「- 」" onClick={listify}>列表项</button>
        <span className="ted-flex" />
        {SIZES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`ted-btn sm${size === k ? ' on' : ''}`}
            title={`字号：${label}（${SIZE_PX[k]}px）`}
            onClick={() => st().setBlockSize(chUid, block.uid, k)}
          >{label}</button>
        ))}
      </div>
    </>
  );
}

// ---- 图片段 ----
function ImgBody({ chUid, block, onUploadTo }) {
  const d = block.data;
  // 记「加载失败的那个 URL」而非布尔：URL 一变自然不等于失败记录 → 直接重试，无需 effect 重置
  const [brokenUrl, setBrokenUrl] = useState(null);
  const st = () => useTedStore.getState();
  return (
    <div className="ted-img-row">
      {d.img && brokenUrl !== d.img
        ? <img className="ted-img-thumb" src={d.img} alt="" onError={() => setBrokenUrl(d.img)} />
        : <div className="ted-img-thumb missing">{d.img ? '加载失败' : '无图'}</div>}
      <div className="ted-img-fields">
        <input
          className="ted-input"
          placeholder="URL（/tutorial/xxx.png 或 http…）"
          value={d.img || ''}
          onChange={(e) => st().setBlockImg(chUid, block.uid, e.target.value, { key: 'img:' + block.uid })}
        />
        <input
          className="ted-input"
          placeholder="替代文字（可选）"
          value={d.alt || ''}
          onChange={(e) => st().setBlockAlt(chUid, block.uid, e.target.value)}
        />
        <div className="ted-row">
          <button type="button" className="ted-btn sm" onClick={() => onUploadTo(block.uid)}>上传图片…</button>
          <button type="button" className="ted-btn sm" title="从已入库图片（client/public/tutorial/）中选择" onClick={() => st().openPicker(chUid, block.uid)}>图库…</button>
        </div>
      </div>
    </div>
  );
}

// ---- 属性条段 ----
// 块内小样：与右侧预览同一套 .rules-bar 全局样式（pixel.css 已在入口加载），逐值一致
function BarSwatch({ data }) {
  const { width, fill, color, fade } = normBar(data);
  return (
    <div className={`rules-bar c-${color} fade-${fade}`}>
      {data.bar ? (
        <span className="rb-label">
          {parseRuns(String(data.bar)).map((r, j) => <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>)}
        </span>
      ) : null}
      <span className="rb-track" style={{ width }}>
        <span className="rb-fill" style={{ width: `${fill}%` }} />
      </span>
    </div>
  );
}

// 数字步进控件：打字时只存不回写（不打断输入），失焦再夹取回显（legacy 同款）
function StepNum({ label, value, step, onCommit }) {
  const [draft, setDraft] = useState(null); // null=显示归一值
  return (
    <span className="ted-bar-step">
      <label>{label}</label>
      <button type="button" className="ted-btn sm" onClick={() => { setDraft(null); onCommit(value - step, false); }}>−</button>
      <input
        className="ted-input ted-bar-num"
        value={draft ?? String(value)}
        onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value, true); }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" className="ted-btn sm" onClick={() => { setDraft(null); onCommit(value + step, false); }}>+</button>
    </span>
  );
}

function BarBody({ chUid, block }) {
  const d = block.data;
  const nb = normBar(d);
  const st = () => useTedStore.getState();
  // typing=true 走合并键（连续打字一步撤回）；步进按钮/芯片是离散一步
  const setNum = (key) => (v, typing) =>
    st().setBarProps(chUid, block.uid, { [key]: v }, typing ? `barnum:${key}:${block.uid}` : null);
  const chips = (label, options, cur, key) => (
    <div className="ted-row">
      <label className="ted-bar-lab">{label}</label>
      {options.map(([k, lab]) => (
        <button
          key={k}
          type="button"
          className={`ted-btn sm${cur === k ? ' on' : ''}`}
          onClick={() => { if (cur !== k) st().setBarProps(chUid, block.uid, { [key]: k }); }}
        >{lab}</button>
      ))}
    </div>
  );
  return (
    <>
      <div className="ted-bar-prev"><BarSwatch data={d} /></div>
      <div className="ted-row">
        <label className="ted-bar-lab">文字</label>
        <input
          className="ted-input"
          placeholder="与条并排的文字（可留空，支持 **金字**）"
          value={d.bar || ''}
          onChange={(e) => st().setBarProps(chUid, block.uid, { bar: e.target.value }, 'bar:' + block.uid)}
        />
      </div>
      <div className="ted-row">
        <StepNum label="长度" value={nb.width} step={12} onCommit={setNum('width')} />
        <StepNum label="填充%" value={nb.fill} step={5} onCommit={setNum('fill')} />
      </div>
      {chips('颜色', BAR_COLORS, nb.color, 'color')}
      {chips('渐隐', BAR_FADES, nb.fade, 'fade')}
    </>
  );
}

// ---- 段落块（块头 + 分型体）。memo：props 全走值/稳定引用；v=块编辑版本号（见 store bump） ----
const Block = memo(function Block(props) {
  const { chUid, block, index, count, primary, msel, dragging, dz, h } = props;
  countRender('b:' + block.uid);
  const d = block.data;
  const kind = isImgData(d) ? 'img' : isBarData(d) ? 'bar' : 'text';
  const [dropFile, setDropFile] = useState(false); // 图片文件悬停高亮
  const st = () => useTedStore.getState();

  const kindLabel = kind === 'img' ? '图片'
    : kind === 'bar' ? '属性条'
      : !(textOf(d) ?? '').trim() ? '空行'
        : '文字' + (sizeOf(d) !== 'm' ? '·' + SIZE_LABEL[sizeOf(d)] : '');

  // 在本段之后插入（快速插入按钮，悬停显现）；focus=文字段落插入后落焦点
  const quick = (data, focus = false) => {
    const uid = st().insertBlock(chUid, index + 1, data);
    if (focus && uid) st().requestFocus(uid, 0);
  };

  // 排序拖拽（同章节内，legacy 同款半高分界）与图片文件拖入共用 wrap 的 drag 事件：
  // 排序进行中一律走排序标记；否则只有图片块认 Files
  const onWrapDragOver = (e) => {
    if (h.dragIndex() != null) {
      if (h.dragIndex() === index) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      h.mark(index, (e.clientY - r.top) > r.height / 2);
    } else if (kind === 'img' && e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      setDropFile(true);
    }
  };
  const onWrapDragLeave = () => { h.unmark(index); setDropFile(false); };
  const onWrapDrop = (e) => {
    if (h.dragIndex() != null) {
      e.preventDefault();
      h.commitDrop(index);
    } else if (kind === 'img') {
      setDropFile(false);
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) { e.preventDefault(); doUpload(f, chUid, block.uid, true); }
    }
  };

  return (
    <div
      className={`ted-block${dragging ? ' dragging' : ''}${dz ? ' drop-' + dz : ''}${dropFile ? ' drop-file' : ''}${primary ? ' primary' : msel ? ' sel' : ''}`}
      data-blk-uid={block.uid}
      onMouseDown={(e) => h.blockDown(e, block.uid)}
      onContextMenu={(e) => h.blockMenu(e, block.uid)}
      onDragOver={onWrapDragOver}
      onDragLeave={onWrapDragLeave}
      onDrop={onWrapDrop}
    >
      <div className="ted-block-head">
        <span
          className="ted-drag-handle"
          title="拖动排序"
          draggable
          onDragStart={(e) => { h.startDrag(index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'b'); }}
          onDragEnd={h.endDrag}
        >⠿</span>
        <span className="ted-block-kind">{kindLabel}</span>
        <span className="ted-flex" />
        <button type="button" className="ted-btn sm ted-quick" title="在本段后插入文字段落" onClick={() => quick('', true)}>+段</button>
        <button type="button" className="ted-btn sm ted-quick" title="在本段后插入属性条" onClick={() => quick(newBar())}>+条</button>
        <button type="button" className="ted-btn sm ted-quick" title="在本段后插入空行（排版留白）" onClick={() => quick('')}>+空行</button>
        <button type="button" className="ted-btn sm ted-quick" title="在本段后插入图片段落" onClick={() => quick({ img: '' })}>+图</button>
        <button type="button" className="ted-btn sm" disabled={index === 0} title="上移（Alt+↑）" onClick={() => st().moveBlock(chUid, index, index - 1)}>↑</button>
        <button type="button" className="ted-btn sm" disabled={index === count - 1} title="下移（Alt+↓）" onClick={() => st().moveBlock(chUid, index, index + 1)}>↓</button>
        <button type="button" className="ted-btn sm danger" title="删除段落" onClick={() => st().removeBlock(chUid, block.uid)}>✕</button>
      </div>
      <div className="ted-block-body">
        {kind === 'text' && <TextBody chUid={chUid} block={block} />}
        {kind === 'img' && <ImgBody chUid={chUid} block={block} onUploadTo={h.uploadTo} />}
        {kind === 'bar' && <BarBody chUid={chUid} block={block} />}
      </div>
    </div>
  );
});

// ---- 图库选择器（模态） ----
function ImagePicker() {
  const picker = useTedStore((s) => s.picker);
  // 结果里带上 for（对应哪次打开）：渲染期用 for!==picker 推导「载入中」，effect 里不做同步 setState
  const [result, setResult] = useState({ for: null, status: 'ready', images: [], error: null });
  useEffect(() => {
    if (!picker) return undefined;
    let alive = true;
    listImages()
      .then((j) => { if (alive) setResult({ for: picker, status: 'ready', images: j.images ?? [], error: null }); })
      .catch((e) => { if (alive) setResult({ for: picker, status: 'error', images: [], error: e.message }); });
    return () => { alive = false; };
  }, [picker]);
  if (!picker) return null;
  const state = result.for === picker ? result : { status: 'loading', images: [], error: null };
  const st = useTedStore.getState();
  const pick = (im) => {
    st.setBlockImg(picker.chUid, picker.uid, im.url); // 离散一步撤回
    st.closePicker();
  };
  return (
    <div className="ted-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) st.closePicker(); }}>
      <div className="ted-modal ted-picker" role="dialog" aria-label="图库">
        <div className="ted-picker-head">
          <span>图库（client/public/tutorial/）</span>
          <span className="ted-flex" />
          <button type="button" className="ted-btn sm" onClick={() => st.closePicker()}>✕</button>
        </div>
        <div className="ted-pick-grid">
          {state.status === 'loading' && <div className="ted-pane-hint">载入中…</div>}
          {state.status === 'error' && <div className="ted-pane-hint err">图库加载失败：{state.error}</div>}
          {state.status === 'ready' && state.images.length === 0 && (
            <div className="ted-pane-hint">图库为空——先用「上传图片…」或 Ctrl+V 贴图入库。</div>
          )}
          {state.images.map((im) => (
            <div key={im.name} className="ted-pick-cell" title={im.name} onClick={() => pick(im)}>
              <img className="ted-pick-thumb" src={im.url} alt="" loading="lazy" />
              <div className="ted-pick-name">{im.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- 标题行 ----
function TitleField({ chapter }) {
  const st = () => useTedStore.getState();
  return (
    <div className="ted-title-field">
      <label>标题</label>
      <input className="ted-input" value={chapter.title} onChange={(e) => st().setTitle(chapter.uid, e.target.value)} />
      <button type="button" className="ted-btn sm" title="复制本章节及其全部子章节，插到其后" onClick={() => st().duplicateChapter(chapter.uid)}>复制章节</button>
      {/* 批删规则（§1.2）统一适用：<5 章不 confirm（撤回兜底），≥5 章拦一道 */}
      <button type="button" className="ted-btn sm danger" onClick={() => confirmDeleteChapters([chapter.uid])}>删除章节</button>
    </div>
  );
}

// ---- 编辑列主体 ----
export default function EditCol({ chapter }) {
  const colRef = useRef(null);
  const fileRef = useRef(null);
  const uploadTargetRef = useRef(null); // {chUid, uid} 待接收上传的图片块
  const focusReq = useTedStore((s) => s.focusReq);
  const selBlks = useTedStore((s) => s.selBlks);
  const selN = useTedStore((s) => s.selN);
  const [blkDrag, setBlkDrag] = useState(null);  // 排序拖拽中的块下标
  const [blkDrop, setBlkDrop] = useState(null);  // {index, after} 落点标记
  // 活值镜像（句柄稳定是 Block memo 的前提）：只在事件句柄里与 setState 成对写
  //（渲染期写 ref 被 react-hooks/refs 禁止）
  const dragIdxRef = useRef(null);
  const dropRef = useRef(null);

  const chUid = chapter?.uid ?? null;

  // 聚焦请求消费（拆/并段、快速插入、撤回焦点恢复）：等块渲染完成再找 DOM（uid 是 'uN'，无需转义）
  useEffect(() => {
    if (!focusReq) return;
    const el = colRef.current?.querySelector(`[data-blk-uid="${focusReq.uid}"] textarea, [data-blk-uid="${focusReq.uid}"] input`);
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(focusReq.caret, focusReq.caretEnd ?? focusReq.caret); } catch { /* 非文本控件忽略 */ }
  }, [focusReq]);

  // 程序化选中跟随（校验定位/粘贴后选中主选块）：滚到就近可见
  useEffect(() => {
    if (!selN) return; // 0 = 还没有任何选择动作
    const uid = useTedStore.getState().selBlks.at(-1);
    if (!uid) return;
    colRef.current?.querySelector(`[data-blk-uid="${uid}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selN]);

  // 块句柄：每章节造一次（deps=[chUid]）；拖拽/选择活值经 ref/getState——句柄稳定是 Block memo 的前提
  const h = useMemo(() => {
    if (!chUid) return null;
    const st = () => useTedStore.getState();
    const idxOf = (uid) => {
      const ch = findByUid(st().chapters, chUid);
      return ch ? ch.body.findIndex((b) => b.uid === uid) : -1;
    };
    return {
      // 选择：Ctrl 点切换、Shift 沿 body 序范围（锚=当前主选）、平点单选（不抢输入焦点）
      blockDown: (e, uid) => {
        if (e.button !== 0) return; // 右键选择交给 onContextMenu
        // 选块=剪贴板语境移到块：Ctrl/Shift 点会 preventDefault（不落文字光标），焦点可能还留在
        // 树容器里——那样 Ctrl+C 会误走章节信封（window 级裁决器先查树持焦）。主动卸掉树焦点。
        if (document.activeElement?.closest?.('.ted-tree')) document.activeElement.blur();
        const s = st();
        const cur = s.selBlks;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault(); // 选择手势，别落文字光标
          s.selectBlocks(cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]);
          return;
        }
        if (e.shiftKey) {
          e.preventDefault();
          const ch = findByUid(s.chapters, chUid);
          if (!ch) return;
          const order = ch.body.map((b) => b.uid);
          const a = order.indexOf(cur[cur.length - 1] ?? uid);
          const b = order.indexOf(uid);
          if (a < 0 || b < 0) { s.selectBlocks([uid]); return; }
          const [lo, hi] = a < b ? [a, b] : [b, a];
          s.selectBlocks([...order.slice(lo, hi + 1).filter((u) => u !== uid), uid]); // 点击者=主选（末位）
          return;
        }
        if (!(cur.length === 1 && cur[0] === uid)) s.selectBlocks([uid]);
      },
      blockMenu: (e, uid) => {
        if (e.target.closest('input,textarea')) return; // 输入控件里保留浏览器原生文本菜单
        e.preventDefault();
        let s = st();
        if (!s.selBlks.includes(uid)) { s.selectBlocks([uid]); s = st(); }
        const sel = [...s.selBlks];
        const n = sel.length;
        const insertAfter = (data, focus = false) => {
          const nu = st().insertBlock(chUid, idxOf(uid) + 1, data);
          if (focus && nu) st().requestFocus(nu, 0);
        };
        s.openMenu(e.clientX, e.clientY, [
          { label: '其后插入：文字段落', onClick: () => insertAfter('', true) },
          { label: '其后插入：属性条', onClick: () => insertAfter(newBar()) },
          { label: '其后插入：空行', onClick: () => insertAfter('') },
          { label: '其后插入：图片', onClick: () => insertAfter({ img: '' }) },
          { sep: true },
          { label: n > 1 ? `复制 ${n} 块` : '复制', onClick: () => copyBlocksToClipboard(chUid, sel) },
          {
            label: n > 1 ? `剪切 ${n} 块` : '剪切',
            onClick: async () => { if (await copyBlocksToClipboard(chUid, sel)) st().removeBlocks(chUid, sel); },
          },
          { label: '粘贴到其后', onClick: () => pasteFromClipboardAfterBlock(chUid, uid) },
          { sep: true },
          { label: n > 1 ? `删除 ${n} 块` : '删除', danger: true, onClick: () => st().removeBlocks(chUid, sel) },
        ]);
      },
      // 排序拖拽（落点换算 legacy 同款：after 折算 + 摘除位修正）
      dragIndex: () => dragIdxRef.current,
      startDrag: (i) => { dragIdxRef.current = i; setBlkDrag(i); },
      endDrag: () => { dragIdxRef.current = null; dropRef.current = null; setBlkDrag(null); setBlkDrop(null); },
      mark: (index, after) => {
        const d = dropRef.current;
        if (!(d && d.index === index && d.after === after)) {
          dropRef.current = { index, after };
          setBlkDrop(dropRef.current);
        }
      },
      unmark: (index) => {
        if (dropRef.current && dropRef.current.index === index) { dropRef.current = null; setBlkDrop(null); }
      },
      commitDrop: (index) => {
        const from = dragIdxRef.current;
        const after = dropRef.current?.index === index ? dropRef.current.after : false;
        dragIdxRef.current = null;
        dropRef.current = null;
        setBlkDrag(null); setBlkDrop(null);
        if (from == null) return;
        let to = index + (after ? 1 : 0);
        if (from < to) to--;
        if (from !== to) st().moveBlock(chUid, from, to);
      },
      // 上传按钮：记住目标块再唤起文件选择框（change 时机才知道选了什么）
      uploadTo: (uid) => {
        uploadTargetRef.current = { chUid, uid };
        if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); }
      },
    };
  }, [chUid]);

  // Alt+↑↓ 移动主选块（焦点在块内输入框时优先跟焦点走）；IME 合成期直通
  const onColKeyDown = (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !chapter) return;
    const s = useTedStore.getState();
    const uid = document.activeElement?.closest?.('[data-blk-uid]')?.dataset.blkUid ?? s.selBlks.at(-1);
    if (!uid) return;
    const i = chapter.body.findIndex((b) => b.uid === uid);
    if (i < 0) return;
    e.preventDefault();
    s.moveBlock(chUid, i, i + (e.key === 'ArrowDown' ? 1 : -1));
  };

  if (!chapter) {
    return (
      <div className="ted-editcol" ref={colRef}>
        <div className="ted-pane-hint">选择左侧章节以编辑其正文。</div>
        <ImagePicker />
      </div>
    );
  }

  const st = () => useTedStore.getState();
  const onFilePicked = (e) => {
    const f = e.target.files?.[0];
    const t = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (f && t) doUpload(f, t.chUid, t.uid, true);
  };

  // 末尾添加行（legacy 同款四按钮；+文字段落插入后落焦点）
  const append = (data, focus = false) => {
    const uid = st().insertBlock(chUid, chapter.body.length, data);
    if (focus && uid) st().requestFocus(uid, 0);
  };

  const primaryBlk = selBlks[selBlks.length - 1];
  const selSet = new Set(selBlks);

  return (
    <div className="ted-editcol" ref={colRef} onKeyDown={onColKeyDown}>
      <div className="ted-editcol-hint">**金字** · 「- 」列表 · Enter拆段 · 空行=留白 · Ctrl+V贴图 · Ctrl/Shift点块=多选</div>
      <TitleField chapter={chapter} />
      {chapter.body.map((b, i) => (
        <Block
          key={b.uid}
          chUid={chUid}
          block={b}
          v={b.v || 0}
          index={i}
          count={chapter.body.length}
          primary={primaryBlk === b.uid}
          msel={selSet.has(b.uid)}
          dragging={blkDrag === i}
          dz={blkDrop && blkDrop.index === i ? (blkDrop.after ? 'after' : 'before') : null}
          h={h}
        />
      ))}
      <div className="ted-add-row">
        <button type="button" className="ted-btn" onClick={() => append('', true)}>+ 文字段落</button>
        <button type="button" className="ted-btn" onClick={() => append({ img: '' })}>+ 图片段落</button>
        <button type="button" className="ted-btn" title="插入自定长度的分段属性条/进度条" onClick={() => append(newBar())}>+ 属性条</button>
        <button type="button" className="ted-btn" title="排版留白：渲染为一个空行" onClick={() => append('')}>+ 空行</button>
      </div>
      <input type="file" ref={fileRef} accept="image/*" style={{ display: 'none' }} onChange={onFilePicked} />
      <ImagePicker />
    </div>
  );
}
