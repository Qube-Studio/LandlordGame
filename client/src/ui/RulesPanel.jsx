// 规则面板：顶栏「i」符号按钮 + 下拉面板（与设置面板同挂载范式）。
// 文案 **…** 标记渲染金黄、其余白色（parseRuns 与角色手册共用）；"- "开头的行渲染为缩进列表项。
// 开合走全局 gameStore.panel('rules')：与设置面板/桌沿抽屉互斥；无关闭钮，点外部收起。
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { parseRuns } from '../game/richtext';

// 规则文案（设计者提供，逐段；li: true = 缩进子条目）
const RULES = [
  { t: '游戏分为**农民阵营**和**地主阵营**。每回合开始后，玩家可以自由**下注**，其他玩家不可见。**下注**后，系统会进行**揭牌**，展示每个人**下注**的多少。随后，通过**抛硬币**决定本回合的**胜负**：正面向上则**地主阵营**胜利，反面向上则**农民阵营**胜利，随后进行结算。' },
  { t: '若**地主阵营**胜利，则会根据**贪婪**程度获取基于下注额的**赢资**（如下注额为**10**，贪婪指数为**2**，则会得到**20**的赢资）。' },
  { t: '若桌上的钱不足以支付**赢资**，农民阵营需要**赔偿差额**，差额会被对方的**盘剥**放大（如差额为**10**，盘剥指数为**3**，则需要支付高达**30**的**赔偿**）', li: true },
  { t: '若桌上的钱支付完**赢资**还有剩余，地主阵营会额外**抽成**（如剩余为**10**，提成指数为**50%**，则地主阵营会额外拿走**5**）', li: true },
  { t: '若**农民阵营**胜利，则**阵营**获得地主阵营下注的**全部资金**。' },
  { t: '（这意味着，**无论始终出最少的金额还是全部梭哈都不一定是最优解**。）' },
  { t: '结算完成后，桌上的**资金**或需要的**赔偿**由农民阵营所有玩家**平分**（若无法恰好平分，下注多者会优先拿取多出的资金）。农民阵营可自由分配**资金**和**赔偿**，若某名玩家无法支付被分配到的**赔偿**，则宣告破产（玩家的剩余资金不影响其承担赔偿的多少。若承担了超出支付范围的赔偿并提前破产，地主阵营收到的赔偿金可能少于预期）。同时，地主阵营的角色必须完成自身的**制约**（如税收），若无法完成，可能导致地主阵营破产。' },
  { t: '若一方阵营完全破产，则对方阵营取得游戏胜利。否则继续下一轮下注，直至决出胜负。' },
];

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
        title="游戏规则"
        aria-label="游戏规则"
        aria-expanded={open}
        onClick={() => togglePanel('rules')}
      ><InfoIcon /></button>

      {open && (
        <div className="goal-hud hud-card rules-panel">
          <div className="goal-line hud-card-title">
            <PixelText size={2} color="var(--px-gold)">游戏规则</PixelText>
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
