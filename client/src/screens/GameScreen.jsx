import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import Scene3D from '../scene/Scene3D';
import UiLayer from '../ui/UiLayer';
import McChat from '../ui/McChat';
import SeatBar from '../ui/SeatBar';
import InsuranceDropLayer from '../ui/InsuranceDropLayer';
import VictoryOverlay from '../ui/VictoryOverlay';
import { T } from '../text';

// 掷币分镜演出（§3.4）的 UI 侧状态机：Scene3D 进 COIN_FLIP 置 'hide'（收 UI+封锁输入），
// CineRig 归位完成置 'enter'（UI 出场 ≤500ms），这里负责——
// ① 捕获阶段吞掉分镜期的全部按键（不触发任何操作）；'enter' 期任意键=打断出场动画直接就位；
// ② 'enter' 500ms 计时收尾；'hide' 挂 10s 兜底（分镜异常也不把 UI 锁死）；
// ③ 分镜开始时收起聊天并让输入框失焦（免得打字键落进隐藏的输入框）。
function useCineDirector(cine, setCine) {
  useEffect(() => {
    if (cine === 'off') return undefined;
    // stopImmediatePropagation：McChat 的捕获监听每次渲染重挂会排到本监听之后，普通 stopPropagation
    // 拦不住同节点同相位的监听——尤其打断键把 cine 同步置 'off' 后，同一事件继续传下去会被放行。
    // preventDefault：封锁还要盖住浏览器默认动作（Tab 焦点巡航、Enter/Space 激活聚焦元素、文本插入），
    // 但放行组合键/功能键（F5/F12/Ctrl+C…不劫持浏览器）。
    const swallow = (e) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) e.preventDefault();
      e.stopImmediatePropagation();
      if (cine === 'enter') setCine('off');
    };
    const swallowUp = (e) => e.stopImmediatePropagation();
    window.addEventListener('keydown', swallow, true);
    window.addEventListener('keyup', swallowUp, true);
    return () => {
      window.removeEventListener('keydown', swallow, true);
      window.removeEventListener('keyup', swallowUp, true);
    };
  }, [cine, setCine]);

  useEffect(() => {
    if (cine === 'enter') {
      const id = setTimeout(() => setCine('off'), 500);
      return () => clearTimeout(id);
    }
    if (cine === 'hide') {
      // 兜底须明显宽于最慢分镜的自然收尾（restAt 上限 5.2s + 归位 2.4s ≈ 7.6s），只接异常
      const id = setTimeout(() => setCine('enter'), 10000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [cine, setCine]);

  useEffect(() => {
    if (cine !== 'hide') return;
    useGameStore.getState().setChatOpen(false);
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur();
  }, [cine]);
}

export default function GameScreen() {
  const state = useGameStore(s => s.state);
  const connected = useGameStore(s => s.connected);
  const hideUi = useGameStore(s => s.hideUi);
  const cine = useGameStore(s => s.cine);
  const setCine = useGameStore(s => s.setCine);
  useCineDirector(cine, setCine);

  if (!state) {
    return <div className="center-screen dim">{connected ? T.game.entering : T.common.connecting}</div>;
  }
  const single = state.mode === 'single';
  const cineCls = cine === 'hide' ? 'cine-hide' : cine === 'enter' ? 'cine-enter' : '';
  return (
    <div className={`game-screen ${hideUi ? 'ui-hidden' : ''} ${cineCls}`}>
      <Scene3D />
      <UiLayer />
      {/* 单人：无他人可聊，聊天让位给席位条（Tab 也让给切席，§9.6） */}
      {single ? <SeatBar /> : <McChat />}
      <InsuranceDropLayer />
      <VictoryOverlay />
      {/* 电影黑边（常驻挂载才有滑入/滑出过渡；分镜期滑入,出场期滑出,常态收在画外） */}
      <div className="cine-bar cine-bar-top" aria-hidden="true" />
      <div className="cine-bar cine-bar-bottom" aria-hidden="true" />
    </div>
  );
}
