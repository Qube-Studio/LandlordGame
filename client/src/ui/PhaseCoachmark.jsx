// 新手即时教学（O0，仅 quick 模式）：首次进入某阶段时弹一张可关闭、不阻塞的讲解卡。
// 阶段由服务器定时推进，故首次显示即标记已看（不能漏标），phase 变化自动隐藏，"知道了"可提前关。
// 竞技专属阶段(REFLIP)与角色技能不在此（留 O3）。
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useOnboardingStore } from '../store/onboardingStore';
import PixelText from '../assets/pixelfont/PixelText';

const GUIDE = {
  LOBBY: { title: '地主 vs 农民', body: '一人当地主、其余当农民，两边规则不对称：地主资金更厚，但要同时赢过所有农民，还背着资金目标考核。地主破产→农民胜；农民全部破产→地主胜。' },
  DISCUSSION: { title: '准备阶段', body: '农民可在此商量战术（农民密谈频道地主看不到）。所有人点「准备」后进入下注。' },
  BETTING: { title: '暗注：只露张数', body: '你下的钱面朝下，别人只看到「几张牌」、看不到金额。3 张可能是 ¥3，也可能是 ¥1+1+1——张数不等于金额，正好用来虚张声势或试探对手。' },
  REVEAL: { title: '亮牌', body: '各家下注在此公开。确认后开始掷硬币。' },
  COIN_FLIP: { title: '硬币是公平的', body: '正反结果在掷之前服务器就已 50/50 定好——翻滚动画只是把结果「演」出来，不影响胜负。正面地主胜，反面农民胜。' },
  SETTLE: { title: '怎么分钱', body: '地主胜的目标 = ⌊地主下注 × 1.5⌋。桌面钱不够付目标时，差额会「按乘数放大」由农民用余额补——押得越少、补得越狠。' },
  NEGOTIATE: { title: '农民协商', body: '系统给了默认分配，农民可在彼此间拖动重新分配「分到的钱」和「要背的债」。注意：债务能全压给一名队友把他压破产——合作还是甩锅，你们自己定。' },
  FINALIZE: { title: '入账结算', body: '这一回合的盈亏正式记入余额，并判定是否有人破产，随后进入下一回合。' },
  ENDED: { title: '对局结束', body: '一方被打到破产即决出胜负。房主可「再来一局」重新选角色。' },
};

export default function PhaseCoachmark() {
  const phase = useGameStore(s => s.state?.phase);
  const mode = useGameStore(s => s.state?.mode);
  const enabled = useOnboardingStore(s => s.enabled);
  const hasSeen = useOnboardingStore(s => s.hasSeen);
  const markSeen = useOnboardingStore(s => s.markSeen);
  const [dismissedPhase, setDismissedPhase] = useState(null);

  const key = phase ? `phase:${phase}` : null;
  const guide = phase ? GUIDE[phase] : null;
  // dismissedPhase 绑定到具体阶段：换阶段后旧值 !== 新 phase，自动恢复显示，无需 effect 重置。
  const show = !!(enabled && mode === 'quick' && guide && key && !hasSeen(key) && dismissedPhase !== phase);

  useEffect(() => { if (show && key) markSeen(key); }, [show, key, markSeen]); // 首次看到即标记（写外部 store，非 React state）

  if (!show) return null;
  return (
    <div className="coachmark">
      <div className="coachmark-title"><PixelText size={2} color="var(--px-gold)">{guide.title}</PixelText></div>
      <p className="coachmark-body">{guide.body}</p>
      <button className="btn small primary" onClick={() => setDismissedPhase(phase)}>知道了</button>
    </div>
  );
}
