// 预览内的直接操纵层（EDITOR_OVERHAUL §1.2）：主选块在**右侧预览**（真游戏骨架、真实缩放）上浮出把手——
//   ✥ 移动把手（任意块，左上角）：拖拽写 {dx,dy} 位置微调（translate 不占流位、不挤兄弟块）；双击=复位。
//   ◢ 缩放把手（图片块，右下角）：拖拽写显示宽度；双击=恢复原图尺寸。
// 为什么不做进 TutorialContent：那是游戏共用渲染器（纯净性铁律），编辑器 chrome 一律 .ted-*——
// 这里靠 data-ted-uid 锚点查 DOM、绝对定位浮在 .ted-preview 上。
// 实现要点（血泪版）：
//   ① 定位一律**命令式**写 style：measure 在 layout effect 里，setState 会触 react-hooks/set-state-in-effect；
//   ② 拖拽中位置跟**指针**算、别读防抖中的 DOM；本组件把目标 style 直写做即时反馈（React 防抖渲染
//      追上后写同值，不冲突）；
//   ③ zoom 舞台下 getBoundingClientRect/鼠标都是缩放后视口坐标（定位天然对），但写回逻辑值要 ÷scale；
//   ④ 元素滚出 .tut-content 可视区就藏把手。
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTedStore, findByUid, isImgData, IMG_W, nudgeOf } from './store';

export default function ImgResizer({ previewRef, scale = 1 }) {
  const selUid = useTedStore((s) => s.selUid);
  const blkUid = useTedStore((s) => s.selBlks.at(-1) ?? null);
  const chapters = useTedStore((s) => s.chapters);
  const ro = useTedStore((s) => s.ro);
  const resRef = useRef(null);   // 缩放把手
  const movRef = useRef(null);   // 移动把手
  const tagRef = useRef(null);   // 数值标签
  const dragRef = useRef(null);  // {kind:'resize'|'move', ...}

  const ch = selUid ? findByUid(chapters, selUid) : null;
  const block = ch && blkUid ? (ch.body ?? []).find((b) => b.uid === blkUid) : null;
  const active = !ro && !!block;                                       // 任意主选块都有移动把手
  const imgActive = active && isImgData(block.data) && !!block.data.img; // 图片块才有缩放把手
  const hasW = !!(block && Number(block.data?.width) > 0);

  const anchorEl = useCallback(
    () => (previewRef.current ? previewRef.current.querySelector(`[data-ted-uid="${blkUid}"]`) : null),
    [blkUid, previewRef],
  );

  // 从 DOM 量三个浮件的位置；drag 期间 tag 文案由拖拽逻辑更新
  const place = useCallback(() => {
    const host = previewRef.current, mv = movRef.current, rs = resRef.current, tag = tagRef.current;
    if (!host || !mv || !tag) return;
    const hide = () => { mv.style.display = 'none'; tag.style.display = 'none'; if (rs) rs.style.display = 'none'; };
    const el = anchorEl();
    if (!el) return hide();
    const hr = host.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const sc = el.closest('.tut-content');
    if (sc) { // ④ 滚出可视区
      const sr = sc.getBoundingClientRect();
      if (er.bottom < sr.top + 4 || er.top > sr.bottom - 4) return hide();
    }
    mv.style.display = '';
    mv.style.left = `${er.left - hr.left}px`;
    mv.style.top = `${er.top - hr.top}px`;
    tag.style.display = '';
    tag.style.left = `${er.right - hr.left}px`;
    tag.style.top = `${er.bottom - hr.top}px`;
    if (rs) {
      rs.style.display = imgActive ? '' : 'none';
      rs.style.left = `${er.right - hr.left}px`;
      rs.style.top = `${er.bottom - hr.top}px`;
    }
    if (!dragRef.current) {
      const n = nudgeOf(block.data);
      const off = (Number.isFinite(n.dx) && n.dx) || (Number.isFinite(n.dy) && n.dy)
        ? `位移 ${n.dx || 0},${n.dy || 0}` : null;
      if (imgActive) {
        const wLogical = Math.round(er.width / scale);
        tag.textContent = (hasW ? `${wLogical}px` : `${wLogical}px · 原图`) + (off ? ` · ${off}` : '');
      } else {
        tag.textContent = off ?? '';
        tag.style.display = off ? '' : 'none';
      }
    }
    return undefined;
  }, [anchorEl, previewRef, imgActive, hasW, scale, block]);

  useLayoutEffect(() => { if (active && !dragRef.current) place(); });

  useEffect(() => {
    const host = previewRef.current;
    if (!active || !host) return undefined;
    const sc = host.querySelector('.tut-content');
    const el = anchorEl();
    const onAny = () => { if (!dragRef.current) place(); };
    sc?.addEventListener('scroll', onAny, { passive: true });
    host.addEventListener('scroll', onAny, { passive: true });
    window.addEventListener('resize', onAny);
    el?.addEventListener('load', onAny);
    return () => {
      sc?.removeEventListener('scroll', onAny);
      host.removeEventListener('scroll', onAny);
      window.removeEventListener('resize', onAny);
      el?.removeEventListener('load', onAny);
    };
  }, [active, anchorEl, place, previewRef]);

  if (!active) return null;

  // ---- 缩放（图片宽度）----
  const resDown = (e) => {
    const el = anchorEl();
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: 'resize', x0: e.clientX, w0: el.getBoundingClientRect().width, el, uid: blkUid, chUid: selUid };
    e.currentTarget.classList.add('on');
  };
  const resMove = (e) => {
    const d = dragRef.current;
    if (!d || d.kind !== 'resize') return;
    const wL = Math.max(IMG_W.lo, Math.min(IMG_W.hi, Math.round((d.w0 + (e.clientX - d.x0)) / scale)));
    d.el.style.width = `${wL}px`;
    place();
    if (tagRef.current) tagRef.current.textContent = `${wL}px`;
    useTedStore.getState().setBlockWidth(d.chUid, d.uid, wL, { key: `imgw:${d.uid}` });
  };
  // ---- 移动（位置微调 dx/dy）----
  const movDown = (e) => {
    const el = anchorEl();
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const n = nudgeOf(block.data);
    dragRef.current = {
      kind: 'move', x0: e.clientX, y0: e.clientY,
      dx0: Number.isFinite(n.dx) ? n.dx : 0, dy0: Number.isFinite(n.dy) ? n.dy : 0,
      el, uid: blkUid, chUid: selUid,
    };
    e.currentTarget.classList.add('on');
  };
  const movMove = (e) => {
    const d = dragRef.current;
    if (!d || d.kind !== 'move') return;
    const nx = Math.round(d.dx0 + (e.clientX - d.x0) / scale);
    const ny = Math.round(d.dy0 + (e.clientY - d.y0) / scale);
    d.el.style.transform = `translate(${nx}px, ${ny}px)`; // 即时反馈
    place();
    if (tagRef.current) { tagRef.current.style.display = ''; tagRef.current.textContent = `位移 ${nx},${ny}`; }
    useTedStore.getState().setBlockNudge(d.chUid, d.uid, nx, ny, { key: `nudge:${d.uid}` });
  };
  const up = (e) => {
    if (!dragRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    dragRef.current = null;
    e.currentTarget.classList.remove('on');
    place();
  };

  return (
    <>
      <div
        ref={movRef}
        className="ted-movres"
        title="拖动微调位置（不挤压其他段落；双击 = 复位）"
        onPointerDown={movDown}
        onPointerMove={movMove}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => useTedStore.getState().setBlockNudge(selUid, blkUid, 0, 0)}
      >✥</div>
      {imgActive && (
        <div
          ref={resRef}
          className="ted-imgres"
          title="拖动调整图片显示宽度（双击 = 恢复原图尺寸）"
          onPointerDown={resDown}
          onPointerMove={resMove}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={() => useTedStore.getState().setBlockWidth(selUid, blkUid, null)}
        />
      )}
      <div ref={tagRef} className="ted-imgres-tag" />
    </>
  );
}
