// 校验面板（§1.2）：三类问题——坏图（编辑器自己 new Image() 预载，不依赖真组件）、空章节、
// 未知块字段。点击问题行 → store.reveal 定位（展开祖先+清搜索+选中章/块；树、编辑列、预览
// 三处 scrollIntoView 由各自订阅 selN 的 effect 消费）。
import { useEffect, useState } from 'react';
import { useTedStore, isImgData, isBarData, isRowData } from './store';

// 已知字段白名单（与 TutorialContent 的渲染约定一致；bar 的 value/max 是旧段式，规则③容忍不算未知；
// dx/dy=位置微调，任意块可带）
const NUDGE = ['dx', 'dy'];
const KNOWN_TEXT = new Set(['text', 'size', ...NUDGE]);
const KNOWN_IMG = new Set(['img', 'alt', 'width', ...NUDGE]);
const KNOWN_BAR = new Set(['bar', 'width', 'fill', 'color', 'fade', 'value', 'max', ...NUDGE]);
const KNOWN_ROW = new Set(['row', 'widths', 'valign', ...NUDGE]);
// 图片探活缓存（模块级：面板反复开合、章节增删不重测同一 URL；「重新检查」清掉它）
const imgCache = new Map(); // url → 'ok' | 'bad'
const probing = new Set(); // 探活在途去重：面板每次渲染都重扫，别为同一 URL 反复 new Image()
// 探活结果的订阅表（模块级）：Image 回调必须能把「任何还挂着的面板」拍醒重渲染。
// 不能用 effect 作用域的 alive 标志——effect 每次渲染都重跑（StrictMode 还会立刻假卸载一次），
// 在途探活的回调抓到的是早已失效的旧闭包，结果只进缓存不触发渲染，面板会卡死在「N 张图检查中…」。
const probeListeners = new Set();
function probeImg(url) {
  if (probing.has(url) || imgCache.has(url)) return;
  probing.add(url);
  const done = (state) => () => {
    probing.delete(url);
    imgCache.set(url, state);
    probeListeners.forEach((ping) => ping());
  };
  const im = new Image();
  im.onload = done('ok');
  im.onerror = done('bad');
  im.src = url;
}

function scan(chapters) {
  const issues = [];
  const pending = new Set(); // 未探活过的图片 URL
  const rec = (nodes, path) => {
    for (const n of nodes ?? []) {
      const p = path ? `${path} › ${n.title || '（无标题）'}` : (n.title || '（无标题）');
      if (!n.body.length && !n.children.length) {
        issues.push({ kind: '空章节', chUid: n.uid, blkUid: null, text: p });
      }
      // 单块校验（多列段的格子复用：at 带列/格定位，问题仍锚到宿主 row 块）
      const checkOne = (d, at, chUid, blkUid, allowRow) => {
        if (typeof d === 'string') return;
        if (d == null || typeof d !== 'object' || Array.isArray(d)) {
          issues.push({ kind: '坏块', chUid, blkUid, text: `${at} —— 段落不是文字/图片/属性条/多列` });
          return;
        }
        if (isRowData(d)) {
          if (!allowRow) { issues.push({ kind: '坏块', chUid, blkUid, text: `${at} —— 多列段不可嵌套` }); return; }
          const bad = Object.keys(d).filter((k) => !KNOWN_ROW.has(k));
          if (bad.length) issues.push({ kind: '未知字段', chUid, blkUid, text: `${at} —— ${bad.join('、')}` });
          d.row.forEach((col, c) => {
            const cells = Array.isArray(col) ? col : [col];
            cells.forEach((cell, k) => checkOne(cell, `${at} 第${c + 1}列格${k + 1}`, chUid, blkUid, false));
          });
          return;
        }
        const known = isImgData(d) ? KNOWN_IMG : isBarData(d) ? KNOWN_BAR : KNOWN_TEXT;
        const bad = Object.keys(d).filter((k) => !known.has(k));
        if (bad.length) issues.push({ kind: '未知字段', chUid, blkUid, text: `${at} —— ${bad.join('、')}` });
        if (isImgData(d) && d.img) {
          const c = imgCache.get(d.img);
          if (c === 'bad') issues.push({ kind: '坏图', chUid, blkUid, text: `${at} —— ${d.img}` });
          else if (!c) pending.add(d.img);
        }
      };
      n.body.forEach((b, i) => checkOne(b.data, `${p} · 第${i + 1}段`, n.uid, b.uid, true));
      rec(n.children, p);
    }
  };
  rec(chapters, '');
  return { issues, pending: [...pending] };
}

export default function ValidationPanel({ onClose }) {
  const chapters = useTedStore((s) => s.chapters);
  const [, force] = useState(0); // 探活结果落在模块级缓存（非 React 状态）→ 计数器逼一次重渲染重扫
  // 每次渲染都重扫（全树 ~40 节点，廉价）——比 useMemo+人造依赖诚实；探活去重靠 probing 集合
  const { issues, pending } = scan(chapters);

  // 订阅探活结果（只挂一次；卸载即退订）+ 每次渲染把新出现的 URL 交给模块级探活（自带去重）
  useEffect(() => {
    const ping = () => force((n) => n + 1);
    probeListeners.add(ping);
    return () => probeListeners.delete(ping);
  }, []);
  useEffect(() => { pending.forEach(probeImg); });

  const recheck = () => { imgCache.clear(); force((n) => n + 1); };

  return (
    <div className="ted-valpanel">
      <div className="ted-valpanel-head">
        <span>校验：{issues.length ? `${issues.length} 个问题` : '没有发现问题'}{pending.length ? `（${pending.length} 张图检查中…）` : ''}</span>
        <span className="ted-flex" />
        <button type="button" className="ted-btn sm" title="清掉图片探活缓存重新检查" onClick={recheck}>重新检查</button>
        <button type="button" className="ted-btn sm" onClick={onClose}>✕</button>
      </div>
      <div className="ted-valpanel-body">
        {issues.map((it, i) => (
          <button
            key={i}
            type="button"
            className="ted-val-row"
            title="点击定位"
            onClick={() => useTedStore.getState().reveal(it.chUid, it.blkUid)}
          >
            <span className={`ted-val-kind${it.kind === '坏图' || it.kind === '坏块' ? ' bad' : ''}`}>{it.kind}</span>
            <span className="ted-val-text">{it.text}</span>
          </button>
        ))}
        {!issues.length && !pending.length && <div className="ted-pane-hint">文档结构、块字段与图片链接都正常。</div>}
      </div>
    </div>
  );
}
