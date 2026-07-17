// 预览内的图片缩放把手（EDITOR_OVERHAUL §1.2 补充）：选中图片段时，在**右侧预览**（真游戏骨架、
// 真实宽度）的图片右下角浮出把手，拖动即改显示宽度——所见即所得，拖多宽玩家就看多宽。
// 为什么把手不做进 TutorialContent：那是游戏与编辑器共用的渲染器（纯净性铁律），编辑器 chrome 一律
// 留在 .ted-* 命名空间；这里靠 data-ted-uid 锚点查 DOM，用绝对定位浮在 .ted-preview 上。
// 四个实现要点：
//   ① 定位一律**命令式**写 style：measure 跑在 layout effect 里，setState 会被
//      react-hooks/set-state-in-effect 判红，且浮层重渲染毫无必要；
//   ② 拖拽中把手位置跟**指针**算、不读 DOM——预览内容有 100ms 防抖，读 DOM 会让把手一跳一跳；
//   ③ 拖拽中同时把宽度直接写进图片 style（即时反馈），store 那边照常合并成一步撤回，
//      防抖渲染追上后 React 把同值再写一遍，不冲突；
//   ④ 图片滚出 .tut-content 可视区就藏把手（否则会浮在别的段落上）。
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTedStore, findByUid, isImgData, IMG_W } from './store';

export default function ImgResizer({ previewRef }) {
  const selUid = useTedStore((s) => s.selUid);
  const blkUid = useTedStore((s) => s.selBlks.at(-1) ?? null);
  const chapters = useTedStore((s) => s.chapters);
  const ro = useTedStore((s) => s.ro);
  const handleRef = useRef(null);
  const tagRef = useRef(null);
  const dragRef = useRef(null);

  // 选中块是不是「有图的图片段」——是才浮把手（只读态不给）
  const ch = selUid ? findByUid(chapters, selUid) : null;
  const block = ch && blkUid ? (ch.body ?? []).find((b) => b.uid === blkUid) : null;
  const active = !ro && !!block && isImgData(block.data) && !!block.data.img;
  const hasW = !!(block && Number(block.data?.width) > 0);

  const imgEl = useCallback(
    () => (previewRef.current ? previewRef.current.querySelector(`img.tut-img[data-ted-uid="${blkUid}"]`) : null),
    [blkUid, previewRef],
  );

  // override 有值 = 拖拽中（位置/宽度由指针算）；否则从 DOM 量
  const place = useCallback((override) => {
    const h = handleRef.current, tag = tagRef.current, host = previewRef.current;
    if (!h || !tag || !host) return;
    const hide = () => { h.style.display = 'none'; tag.style.display = 'none'; };
    const el = imgEl();
    if (!el) return hide();
    let left, top, w;
    if (override) {
      ({ left, top, w } = override);
    } else {
      const hr = host.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const sc = el.closest('.tut-content');
      if (sc) { // ④ 滚出可视区
        const sr = sc.getBoundingClientRect();
        if (er.bottom < sr.top + 4 || er.top > sr.bottom - 4) return hide();
      }
      left = er.right - hr.left; top = er.bottom - hr.top; w = Math.round(er.width);
    }
    h.style.display = ''; tag.style.display = '';
    h.style.left = `${left}px`; h.style.top = `${top}px`;
    tag.style.left = `${left}px`; tag.style.top = `${top}px`;
    tag.textContent = (override || hasW) ? `${w}px` : `${w}px · 原图`;
    return undefined;
  }, [imgEl, previewRef, hasW]);

  // 每次渲染后重量（选中/内容/宽度变了都会走到；预览内容防抖 100ms 落地时父组件重渲染会带上这里）
  useLayoutEffect(() => { if (active && !dragRef.current) place(); });

  // 预览滚动 / 窗口缩放 / 图片迟到加载 → 重量
  useEffect(() => {
    const host = previewRef.current;
    if (!active || !host) return undefined;
    const sc = host.querySelector('.tut-content');
    const el = imgEl();
    const onAny = () => { if (!dragRef.current) place(); };
    sc?.addEventListener('scroll', onAny, { passive: true });
    window.addEventListener('resize', onAny);
    el?.addEventListener('load', onAny);
    return () => {
      sc?.removeEventListener('scroll', onAny);
      window.removeEventListener('resize', onAny);
      el?.removeEventListener('load', onAny);
    };
  }, [active, imgEl, place, previewRef]);

  if (!active) return null;

  const onDown = (e) => {
    const el = imgEl();
    const host = previewRef.current;
    if (!el || !host) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const hr = host.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    dragRef.current = { x0: e.clientX, w0: er.width, left0: er.right - hr.left, top0: er.bottom - hr.top, el, uid: blkUid, chUid: selUid };
    e.currentTarget.classList.add('on');
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const w = Math.max(IMG_W.lo, Math.min(IMG_W.hi, Math.round(d.w0 + (e.clientX - d.x0))));
    d.el.style.width = `${w}px`;                                    // ③ 即时反馈，不等 100ms 防抖
    place({ left: d.left0 + (w - d.w0), top: d.top0, w });          // ② 位置跟指针
    useTedStore.getState().setBlockWidth(d.chUid, d.uid, w, { key: `imgw:${d.uid}` }); // 一次拖拽=一步撤回
  };
  const onUp = (e) => {
    if (!dragRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    dragRef.current = null;
    e.currentTarget.classList.remove('on');
    place();
  };

  return (
    <>
      <div
        ref={handleRef}
        className="ted-imgres"
        title="拖动调整图片显示宽度（双击 = 恢复原图尺寸）"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => useTedStore.getState().setBlockWidth(selUid, blkUid, null)}
      />
      <div ref={tagRef} className="ted-imgres-tag" />
    </>
  );
}
