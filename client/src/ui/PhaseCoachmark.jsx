// 新手即时教学（O0，仅 quick 模式）：首次进入某阶段时弹一张可关闭、不阻塞的讲解卡。
// 阶段由服务器定时推进，故首次显示即标记已看（不能漏标），phase 变化自动隐藏，"知道了"可提前关。
// 竞技专属阶段(REFLIP)与角色技能不在此（留 O3）。
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useOnboardingStore } from '../store/onboardingStore';
import PixelText from '../assets/pixelfont/PixelText';
import { T } from '../text';

const GUIDE = T.guide;

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
        <span className="coachmark-hint">{T.guide.skipHint}</span>
        <button className="btn small primary" onClick={() => setDismissedPhase(phase)}>{T.guide.ok}</button>
      </div>
    </div>
  );
}
