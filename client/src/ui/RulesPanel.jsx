// 教程面板（章节模式，2026-07-15）：顶栏「i」按钮 + 下拉面板（与设置面板同挂载范式）。
// 左=章节树：默认全收起；点章节 = 选中（右侧显示其正文）+ 展开其**直接**子章节
// （孙章节保持收起——收起某章节时连同后代一并从展开集合剔除，重开不会带出孙层）。
// 右=选中章节的正文。章节数据在 text/tutorial.json（id/title/body[]/children[]），
// 由专用编辑器脚本维护，本组件只渲染；body 文案 **…** 金字、"- " 开头渲染为缩进列表项。
// 开合走全局 gameStore.panel('rules')：与设置面板/桌沿抽屉互斥；无关闭钮，点外部收起。
import { useEffect, useState } from 'react';
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

// 像素展开三角（收起 ▸ / 展开 ▾）
function Tri({ open }) {
  return (
    <svg className="tut-tri" width="8" height="8" viewBox="0 0 8 8" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      {open ? (
        <><rect x="1" y="2" width="6" height="2" /><rect x="2" y="4" width="4" height="1" /><rect x="3" y="5" width="2" height="1" /></>
      ) : (
        <><rect x="2" y="1" width="2" height="6" /><rect x="4" y="2" width="1" height="4" /><rect x="5" y="3" width="1" height="2" /></>
      )}
    </svg>
  );
}

// 章节树节点（递归）：只有父节点在展开集合里才渲染子层 → 天然满足「不展开孙章节」。
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
      {open && kids.map(k => (
        <NavNode key={k.id} node={k} depth={depth + 1} openIds={openIds} selectedId={selectedId} onPick={onPick} />
      ))}
    </>
  );
}

export default function RulesPanel() {
  const panel = useGameStore(s => s.panel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const setPanel = useGameStore(s => s.setPanel);
  const open = panel === 'rules';

  // 默认选中第一个主章节、全部收起；面板开合间保留浏览位置（组件常驻挂载）。
  const [selectedId, setSelectedId] = useState(CHAPTERS[0]?.id ?? null);
  const [openIds, setOpenIds] = useState(() => new Set());

  const pick = (node) => {
    setSelectedId(node.id);
    if (!(node.children?.length > 0)) return;
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        // 收起：连同后代剔除——下次展开时子章节回到收起态（不带出孙层）
        const drop = (n) => { next.delete(n.id); (n.children ?? []).forEach(drop); };
        drop(node);
      } else {
        next.add(node.id);
      }
      return next;
    });
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

  return (
    <div className="rules-root">
      <button
        className="hud-icon-btn"
        title={T.rules.title}
        aria-label={T.rules.title}
        aria-expanded={open}
        onClick={() => togglePanel('rules')}
      ><InfoIcon /></button>

      {open && (
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
                  {(current.body ?? []).map((t, i) => {
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
      )}
    </div>
  );
}
