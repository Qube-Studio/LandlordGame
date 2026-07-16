// 教程面板（章节模式，2026-07-15）：顶栏「i」按钮 + 下拉面板（与设置面板同挂载范式）。
// 左=章节树：默认全收起；点章节 = 选中（右侧显示其正文）+ 展开其**直接**子章节
// （孙章节保持收起——收起某章节时连同后代一并从展开集合剔除，重开不会带出孙层）。
// 右=选中章节的正文。章节数据在 text/tutorial.json（id/title/body[]/children[]），
// 由专用编辑器脚本维护（scripts/tutorial-editor.mjs），本组件只渲染。
// body 段落两种形态：字符串（**…** 金字、"- " 开头渲染为缩进列表项）
// 或 {img, alt}（图片段落——img 为 URL 路径，图片文件放 client/public/tutorial/ 下）。
// 开合走全局 gameStore.panel('rules')：与设置面板/桌沿抽屉互斥；无关闭钮，点外部收起。
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { parseRuns } from '../game/richtext';
import { T } from '../text';

const CHAPTERS = T.rules.chapters ?? [];

// 树上按 id 找节点（深度不限，编辑器可能建更深的层级）。
function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children ?? [], id);
    if (hit) return hit;
  }
  return null;
}

// 求通向某 id 的祖先 id 链（不含自身；顶层节点返回 []）——手风琴/定位时用来展开整条路径。
function pathTo(nodes, id, acc = []) {
  for (const n of nodes) {
    if (n.id === id) return acc;
    const hit = pathTo(n.children ?? [], id, [...acc, n.id]);
    if (hit) return hit;
  }
  return null;
}

// id 是否为 node 子树内的后代（不含 node 自身）。
function isDescendantId(node, id) {
  for (const c of node.children ?? []) {
    if (c.id === id || isDescendantId(c, id)) return true;
  }
  return false;
}

// 像素「i」符号（内联小 SVG，风格与设置齿轮一致）
function InfoIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="1" width="2" height="2" />
      <rect x="5" y="5" width="3" height="1" />
      <rect x="6" y="5" width="2" height="7" />
      <rect x="5" y="12" width="4" height="1" />
    </svg>
  );
}

// 展开三角：单个右指三角，展开时 CSS 旋转 90°（过渡动画在 .tut-tri）
function Tri({ open }) {
  return (
    <svg className={`tut-tri ${open ? 'open' : ''}`} width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
      <polygon points="2.5,1 2.5,7 6.5,4" />
    </svg>
  );
}

// 章节树节点（递归）：子层始终渲染（裁进可折叠容器），靠 .tut-subtree.open 的 grid 高度过渡做展开/收起动画。
function NavNode({ node, depth, openIds, selectedId, onPick }) {
  const kids = node.children ?? [];
  const open = openIds.has(node.id);
  const sel = selectedId === node.id;
  return (
    <>
      <div
        className={`tut-nav-item ${sel ? 'sel' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onPick(node)}
      >
        {kids.length > 0 ? <Tri open={open} /> : <span className="tut-tri-pad" />}
        <PixelText size={2} color={sel ? 'var(--px-gold)' : 'var(--ink-dim)'}>{node.title}</PixelText>
      </div>
      {kids.length > 0 && (
        <div className={`tut-subtree ${open ? 'open' : ''}`}>
          <div className="tut-subtree-inner">
            {kids.map(k => (
              <NavNode key={k.id} node={k} depth={depth + 1} openIds={openIds} selectedId={selectedId} onPick={onPick} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function RulesPanel() {
  const panel = useGameStore(s => s.panel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const setPanel = useGameStore(s => s.setPanel);
  const open = panel === 'rules';

  // 默认选中第一个主章节、全部收起；面板开合间状态常驻（组件不卸载）→ 重开教程回到上次章节。
  const [selectedId, setSelectedId] = useState(CHAPTERS[0]?.id ?? null);
  const [openIds, setOpenIds] = useState(() => new Set());
  // 分支记忆：章节 id → { open:[子树内展开的后代id...], sel:被选中的子章节id|null }。
  // 折叠（含手风琴自动收起）时快照该分支的完整展开结构 + 选中项；下次展开整体恢复（一次性，恢复后清除）。
  const branchMem = useRef({});

  const isTop = (id) => CHAPTERS.some(c => c.id === id);
  const topAncestorOf = (id) => { const a = pathTo(CHAPTERS, id); return a && a.length ? a[0] : id; };

  // 快照 node 子树内的展开结构与选中项（读当前 openIds/selectedId）
  const capture = (node) => {
    const open = [...openIds].filter(id => isDescendantId(node, id));
    const sel = (selectedId && isDescendantId(node, selectedId)) ? selectedId : null;
    if (open.length || sel) branchMem.current[node.id] = { open, sel };
    else delete branchMem.current[node.id];
  };
  // 把 node 的记忆结构加回 next（过滤已删节点），返回记住的选中项；一次性，取后即清
  const restore = (node, next) => {
    const mem = branchMem.current[node.id];
    if (!mem) return null;
    mem.open.forEach(id => { if (findNode(CHAPTERS, id)) next.add(id); });
    delete branchMem.current[node.id];
    return (mem.sel && findNode(CHAPTERS, mem.sel)) ? mem.sel : null;
  };

  const pick = (node) => {
    if (!(node.children?.length > 0)) { setSelectedId(node.id); return; } // 叶子：仅选中

    if (openIds.has(node.id)) {
      // 折叠本章节：先快照子树展开结构+选中项，再移除自身+后代
      capture(node);
      const next = new Set(openIds);
      const drop = (n) => { next.delete(n.id); (n.children ?? []).forEach(drop); };
      drop(node);
      setOpenIds(next);
      setSelectedId(node.id);
      return;
    }

    // 展开
    let next;
    if (isTop(node.id)) {
      // 手风琴仅对顶层生效：收起其他顶层（+其后代）。先快照被收起的另一顶层的结构。
      const topSel = topAncestorOf(selectedId);
      const topNode = topSel && topSel !== node.id ? findNode(CHAPTERS, topSel) : null;
      if (topNode) capture(topNode);
      next = new Set([node.id]);
    } else {
      // 子章节：普通独立展开，不收起同层兄弟
      next = new Set(openIds);
      next.add(node.id);
    }

    // 恢复本节点记忆的展开结构 + 定位到记住的选中子章节（无记忆则选中本节点）
    const sel = restore(node, next);
    setOpenIds(next);
    setSelectedId(sel ?? node.id);
  };

  // 点面板/按钮以外任意处收起（捕获阶段，同设置面板）
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest('.rules-root')) return;
      setPanel(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, setPanel]);

  const current = selectedId ? findNode(CHAPTERS, selectedId) : null;

  // 离场动画：open→false 时保持挂载播完退场再卸载。visible 常驻挂载态，closing=正在退场。
  // 渲染期同步补挂（打开即挂载，React 允许对同组件在渲染中 setState）；卸载在遮罩退场动画结束时。
  const [visible, setVisible] = useState(open);
  if (open && !visible) setVisible(true);
  const closing = visible && !open;

  return (
    <div className="rules-root">
      <button
        className="hud-icon-btn"
        title={T.rules.title}
        aria-label={T.rules.title}
        aria-expanded={open}
        onClick={() => togglePanel('rules')}
      ><InfoIcon /></button>

      {visible && (
        // 居中大框 + 背景高斯模糊遮罩；点遮罩空白处（非面板本体）收起。closing 播退场，动画结束卸载。
        <div
          className={`rules-overlay ${closing ? 'closing' : ''}`}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setPanel(null); }}
          onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) setVisible(false); }}
        >
        <div className="goal-hud hud-card rules-panel">
          <div className="goal-line hud-card-title">
            <PixelText size={2} color="var(--px-gold)">{T.rules.title}</PixelText>
          </div>
          <div className="tut-split">
            <div className="tut-nav">
              {CHAPTERS.map(c => (
                <NavNode key={c.id} node={c} depth={0} openIds={openIds} selectedId={selectedId} onPick={pick} />
              ))}
            </div>
            <div className="tut-content">
              {current ? (
                <>
                  <div className="tut-content-title">
                    <PixelText size={2} color="var(--px-gold)">{current.title}</PixelText>
                  </div>
                  {(current.body ?? []).map((item, i) => {
                    if (item && typeof item === 'object' && item.img) {
                      return <img key={i} className="tut-img" src={item.img} alt={item.alt ?? ''} draggable={false} />;
                    }
                    const t = String(item);
                    const li = t.startsWith('- ');
                    const text = li ? t.slice(2) : t;
                    return (
                      <p key={i} className={`rules-p ${li ? 'li' : ''}`}>
                        {li && <span className="rules-dash">-</span>}
                        {parseRuns(text).map((r, j) => (
                          <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>
                        ))}
                      </p>
                    );
                  })}
                </>
              ) : (
                <p className="rules-p">{T.rules.emptyHint}</p>
              )}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
