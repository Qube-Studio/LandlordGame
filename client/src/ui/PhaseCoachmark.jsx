// 新手即时教学（O0，仅 quick 模式）：首次进入某阶段时弹一张可关闭、不阻塞的讲解卡。
// 阶段由服务器定时推进，故首次显示即标记已看（不能漏标），phase 变化自动隐藏，"知道了"可提前关。
// 竞技专属阶段(REFLIP)与角色技能不在此（留 O3）。
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useOnboardingStore } from '../store/onboardingStore';
import PixelText from '../assets/pixelfont/PixelText';

const GUIDE = {
  LOBBY: { title: '地主 vs 农民（一场不公平的较量）', body: '一人坐庄当地主，其余都是农民，两边规则故意不对称：地主钱包更鼓，但得「以一敌众」赢过所有农民，头上还顶着一份资金目标考核（KPI）。谁先破产谁出局——地主破产，农民翻身；农民全灭，地主通吃。' },
  DISCUSSION: { title: '准备阶段（农民可密谈）', body: '农民们可以凑一起合计合计，开个「密谈频道」地主偷听不到——当然，盟约能撑几回合是另一回事了。短暂喘息后自动开打。' },
  BETTING: { title: '暗注：只露张数，不露金额', body: '你押的钱通通扣着放，别人只数得清你出了「几张牌」，看不见面额。3 张可能值 3，也可能是 1+1+1——张数 ≠ 金额，正好拿来虚张声势，把对手唬得睡不着觉。' },
  CHALLENGE: { title: '对质：抓住敌方的虚张', body: '揭牌前，农民阵营可花对质票指控敌方——赌他的暗注比农民阵营总注「更多还是更少」。猜对了，敌方立刻被迫多结算一次制约（地主的目标 / 资本家的税）；猜错了只是白花票。悬停敌人按 Z（或用下方面板）即可发起。' },
  REVEAL: { title: '亮牌见真章', body: '憋了半天的底牌一起翻开，谁在虚张声势、谁是真有钱，当场见分晓。确认后，命运的硬币就要起飞了。' },
  COIN_FLIP: { title: '硬币是公平的', body: '大量测试表明：这枚硬币绝对公平，正反各 50%，童叟无欺、概不作弊。正面地主胜，反面农民胜——剩下的就交给天意吧。' },
  SETTLE: { title: '该分钱了（数学时间）', body: '地主赢的目标 = ⌊地主下注 × 1.5⌋。要是桌上的钱不够付，差的那部分会「按乘数放大」再由农民拿余额补——押得越少、补得越肉疼。下注前先掂量掂量钱包。' },
  NEGOTIATE: { title: '农民分账（与甩锅）', body: '系统先给了个默认分法，农民们可以互相拖动，重新分配「到手的钱」和「要背的债」。狠一点，债能全压给一个倒霉蛋直接把他送走——同舟共济还是过河拆桥，你们自己掂量。' },
  FINALIZE: { title: '入账时刻', body: '这一回合的盈亏正式记进余额，顺便点名今天有没有人光荣破产。结清之后，下一回合接着来。' },
  ENDED: { title: '尘埃落定', body: '有人被打到破产，胜负就此分晓。房主点「再来一局」可重选角色，给翻盘（或再输一次）一个机会。' },
};

export default function PhaseCoachmark() {
  const phase = useGameStore(s => s.state?.phase);
  const mode = useGameStore(s => s.state?.mode);
  const chatOpen = useGameStore(s => s.chatOpen);
  const enabled = useOnboardingStore(s => s.enabled);
  const hasSeen = useOnboardingStore(s => s.hasSeen);
  const markSeen = useOnboardingStore(s => s.markSeen);
  const [dismissedPhase, setDismissedPhase] = useState(null);

  const key = phase ? `phase:${phase}` : null;
  const guide = phase ? GUIDE[phase] : null;
  // dismissedPhase 绑定到具体阶段：换阶段后旧值 !== 新 phase，自动恢复显示，无需 effect 重置。
  const show = !!(enabled && mode === 'quick' && guide && key && !hasSeen(key) && dismissedPhase !== phase);

  useEffect(() => { if (show && key) markSeen(key); }, [show, key, markSeen]); // 首次看到即标记（写外部 store，非 React state）

  // 按任意键跳过：用捕获阶段抢在所有游戏快捷键（UiLayer/MoneyHand/Scene3D 都在 window 冒泡监听）之前，
  // stopImmediatePropagation 吃掉这一次按键，避免「跳过」顺带触发确认/下注等动作。标记已看后不再出现。
  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; // 放行浏览器/系统组合键，不当作跳过
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return; // 纯修饰键不算
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || chatOpen) return;             // 输入/聊天聚焦时让位
      e.preventDefault();
      e.stopImmediatePropagation();
      setDismissedPhase(phase);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show, phase, chatOpen]);

  if (!show) return null;
  return (
    <div className="coachmark">
      <div className="coachmark-title"><PixelText size={2} color="var(--px-gold)">{guide.title}</PixelText></div>
      <p className="coachmark-body">{guide.body}</p>
      <div className="coachmark-foot">
        <span className="coachmark-hint">按任意键跳过</span>
        <button className="btn small primary" onClick={() => setDismissedPhase(phase)}>知道了</button>
      </div>
    </div>
  );
}
