// 框选 + 表面跟随拖拽的分派器（§2.1）：**唯一的窗口捕获 pointerdown**（顶层挂一次，活值经 ref），
// 合并了原 SingleGizmo 里的捕获监听——两套捕获监听会打架，这里是唯一入口。
// 事件流：捕获 pointerdown 记 downPos、按 controls.axis||dragging 判 gizmo、清拖拽候选 →
// 物体 r3f onPointerDown（冒泡在后）写入 interaction.candidate → pointermove 超 4px 分派：
// gizmo→不管 / 有候选→表面拖拽 / 画布起点且无候选→框选 → pointerup 后凡发生过框选/拖拽
// 都置 selectionLock 吞随后的 click/onPointerMissed。
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePhotoStore } from './photoStore';
import { selectionLock } from './selectionLock';
import { gizmoRef, interaction } from './interaction';
import { itemRegistry } from './itemRegistry';
import { pickIdsInRect } from './pick';
import { collectSurfaceMeshes, surfaceHitAt } from './placement';

export default function Interactions() {
  const { camera, gl } = useThree();
  const gesture = useRef(null);   // 进行中的手势 {phase:'down'|'drag'|'box', ...}（活值，不进 React state）

  useEffect(() => {
    const st = () => usePhotoStore.getState();
    const el = gl.domElement;

    // 表面拖拽开始：被拖的物成为主选（多选整组随主选平移；未选中的物=先单选再拖）。
    // 底面偏移在此刻锁死至拖拽结束——人物呼吸每帧改 y，实时重算会抖（§2.1）。
    const startDrag = (g) => {
      const store = st();
      const id = interaction.candidate;
      const obj = itemRegistry.get(id);
      const item = store.items.find((it) => it.id === id);
      if (!obj || !item) { gesture.current = null; return; }
      const base = store.selection.includes(id) ? store.selection : [id];
      const sel = [...base.filter((x) => x !== id), id];
      store.setSelection(sel);
      const box = new THREE.Box3().setFromObject(obj);
      g.phase = 'drag';
      g.ref = id;
      g.offY = item.pos[1] - box.min.y;
      g.startPos = {};
      for (const sid of sel) {
        const it = store.items.find((i) => i.id === sid);
        if (it) g.startPos[sid] = [...it.pos];
      }
      g.sel = sel.filter((sid) => g.startPos[sid]);
      g.meshes = collectSurfaceMeshes(new Set(sel));  // 一次收集，期间复用（选中全排除防自命中上浮）
      g.raycaster = new THREE.Raycaster();
      g.moved = false;
    };

    const moveDrag = (g, e) => {
      const hit = surfaceHitAt(e.clientX, e.clientY, camera, g.meshes, g.raycaster, el);
      if (!hit) return;                                // 拖出所有表面 → 停在原地
      // xz 走**相对位移**（首个命中点为基准）：被拖物已从候选集排除，抓取射线穿过它落在身后/
      // 身下的表面上——若把物体原点直接摆到命中点（绝对跟随），高个子人物会在拖拽开始瞬移一大步。
      if (!g.hit0) g.hit0 = hit.point.clone();
      if (!g.moved) st().pushHistory();                // 一次拖拽 = 一步撤回（首次真移动时压栈）
      g.moved = true;
      const p0 = g.startPos[g.ref];
      const dx = hit.point.x - g.hit0.x;
      const dy = hit.point.y + g.offY - p0[1];         // y 是**绝对**贴面：落点 y = hit.y + 底面偏移
      const dz = hit.point.z - g.hit0.z;
      const patches = {};
      for (const sid of g.sel) {
        const s0 = g.startPos[sid];
        patches[sid] = { pos: [s0[0] + dx, s0[1] + dy, s0[2] + dz] };
      }
      g.patches = patches;
      st().applyTransforms(patches);                   // 期间写回不进历史
    };

    const startBox = (g, e) => {
      g.phase = 'box';
      g.x2 = e.clientX; g.y2 = e.clientY;
      interaction.boxActive = true;
      st().setMarquee({ x1: g.x, y1: g.y, x2: g.x2, y2: g.y2 });
    };

    const finishBox = (g, e) => {
      st().setMarquee(null);
      interaction.boxActive = false;
      const r = el.getBoundingClientRect();
      // client 坐标 → 画布坐标（画布铺满视口时 r.left/top=0，减掉是为了鲁棒）
      const rect = { x1: g.x - r.left, y1: g.y - r.top, x2: (g.x2 ?? g.x) - r.left, y2: (g.y2 ?? g.y) - r.top };
      const hits = pickIdsInRect(rect, camera, { width: r.width, height: r.height }, st().items, itemRegistry);
      if (e.ctrlKey || e.metaKey || e.shiftKey) {      // 加选：保留原序，新命中按 items 顺序追加
        const cur = st().selection;
        st().setSelection([...cur, ...hits.filter((h) => !cur.includes(h))]);
      } else {
        st().setSelection(hits);
      }
    };

    const onDown = (e) => {
      // 合并原 SingleGizmo 捕获监听：按在坐标轴上 → 锁一次取消选择（onPointerMissed/onSelect 消费）
      const c = gizmoRef.current;
      const onGizmo = !!(c && (c.axis || c.dragging));
      selectionLock.current = onGizmo;
      interaction.candidate = null;                    // r3f 冒泡在后，物体 onPointerDown 会写入
      gesture.current = null;
      if (e.button !== 0) return;
      if (st().mode !== 'arrange') return;
      gesture.current = { phase: 'down', x: e.clientX, y: e.clientY, onCanvas: e.target === el, gizmo: onGizmo };
    };

    const onMove = (e) => {
      const g = gesture.current;
      if (!g) return;
      if (g.phase === 'down') {
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;   // 4px 阈值
        if (g.gizmo) { gesture.current = null; return; }               // gizmo 拖拽 → 不管
        if (interaction.candidate != null) startDrag(g);
        else if (g.onCanvas) startBox(g, e);
        else { gesture.current = null; return; }
      }
      if (!gesture.current) return;                    // startDrag 可能中止（物已被删）
      if (g.phase === 'drag') moveDrag(g, e);
      else if (g.phase === 'box') {
        g.x2 = e.clientX; g.y2 = e.clientY;
        st().setMarquee({ x1: g.x, y1: g.y, x2: g.x2, y2: g.y2 });
      }
    };

    const onUp = (e) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (g.phase === 'drag') {
        if (g.moved && g.patches) st().applyTransforms(g.patches, true);   // 收尾落账（立即持久化）
        selectionLock.current = true;                  // 吞随后的 click（拖完指针仍悬在物体上）
      } else if (g.phase === 'box') {
        finishBox(g, e);
        selectionLock.current = true;                  // 吞随后的 click/onPointerMissed
      }
    };

    // 指针被系统收走（弹窗/切页签）：拖拽落账在当前位置，框选作废不改选择
    const onCancel = () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (g.phase === 'drag' && g.moved && g.patches) st().applyTransforms(g.patches, true);
      if (g.phase === 'box') { st().setMarquee(null); interaction.boxActive = false; }
    };

    // Esc 优先级链的第一环（PhotoStudio onKey 调用）：框选进行中 → 仅取消框选，选择不动
    interaction.cancelBox = () => {
      const g = gesture.current;
      if (!g || g.phase !== 'box') return false;
      gesture.current = null;
      interaction.boxActive = false;
      st().setMarquee(null);
      selectionLock.current = true;                    // 松手的 click 不许再改选择
      return true;
    };

    // 自动化探针（§2.2⑥，覆盖式写 window）：框选/表面落点的几何计算做成可直调的纯函数硬断言——
    // 合成鼠标拖 3D 有失败先例，E2E 的鼠标全链路只作截图证据。
    if (import.meta.env.DEV) {
      // 框选命中纯函数入口（画布 px 坐标，与 finishBox 完全同一实现）
      window.__photoPick = (x1, y1, x2, y2) => {
        const r = el.getBoundingClientRect();
        return pickIdsInRect({ x1, y1, x2, y2 }, camera, { width: r.width, height: r.height }, st().items, itemRegistry);
      };
      // 表面命中（排除集默认=当前选择集，与表面拖拽同一候选收集）；返回普通对象方便跨进程断言
      window.__photoSurface = (clientX, clientY, excludeIds = null) => {
        const meshes = collectSurfaceMeshes(new Set(excludeIds ?? st().selection));
        const hit = surfaceHitAt(clientX, clientY, camera, meshes, new THREE.Raycaster(), el);
        return hit ? { point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance } : null;
      };
    }

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      if (interaction.cancelBox) { interaction.cancelBox(); interaction.cancelBox = null; }
    };
  }, [camera, gl]);

  return null;
}
