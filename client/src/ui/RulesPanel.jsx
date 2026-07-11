// 规则面板：顶栏「i」符号按钮 + 下拉面板（与设置面板同挂载范式）。
// 文案 **…** 标记渲染金黄、其余白色（parseRuns 与角色手册共用）；"- "开头的行渲染为缩进列表项。
// 开合走全局 gameStore.panel('rules')：与设置面板/桌沿抽屉互斥；无关闭钮，点外部收起。
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { parseRuns } from '../game/richtext';
import { T } from '../text';

// 规则文案（设计者提供，逐段；li: true = 缩进子条目）
const RULES = T.rules.items;

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

export default function RulesPanel() {
  const panel = useGameStore(s => s.panel);
  const togglePanel = useGameStore(s => s.togglePanel);
  const setPanel = useGameStore(s => s.setPanel);
  const open = panel === 'rules';

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
          <div className="rules-body">
            {RULES.map((p, i) => (
              <p key={i} className={`rules-p ${p.li ? 'li' : ''}`}>
                {p.li && <span className="rules-dash">-</span>}
                {parseRuns(p.t).map((r, j) => (
                  <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>
                ))}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
