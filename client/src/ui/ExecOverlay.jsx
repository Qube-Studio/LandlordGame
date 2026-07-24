// 处决判决罩层（§3.9 批次2·B 视角，纯表现层）：我是焦点破产者且判决落定 →
// 瞬间黑屏 → 浮现红字「死亡」/白字「赦免」→ 停 3s → 死亡：黑屏与字渐渐隐去（进入死亡视角，
// UI 减除由 .exec-dead 类负责）；赦免：**不隐去**，滞留到整个处决流程结束（phase 离开 EXECUTION），
// 页脚倒计时+提示，期间聊天区锁定系统频道播报后续判决（McChat 自管）。
// 本地状态机驱动（服务端只广播 lastResult；3s 结果窗与 executionResultMs 对齐但不依赖它）。
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { T } from '../text';

const WORD_MS = 3000;   // 字驻留时长（与服务端 executionResultMs 同源心跳，本地独立计时）
const FADE_MS = 800;    // 死亡路径的渐隐时长

export default function ExecOverlay() {
  const playerId = useGameStore(s => s.playerId);
  const phase = useGameStore(s => s.state?.phase);
  const lastResult = useGameStore(s => s.state?.execution?.lastResult ?? null);
  const deadline = useGameStore(s => s.state?.execution?.deadline ?? null);

  // 本地演出状态：null | {outcome:'executed'|'pardoned', stage:'word'|'hold'|'fade'}
  const [show, setShow] = useState(null);
  const seenRef = useRef(0); // 已消费的判决数（lastResult 广播对象引用会变，用 results 计数配对不可靠——以 targetId+时间戳窗口判重）
  const timerRef = useRef(0);

  // 判决落定且目标是我 → 启动演出（同一笔只触发一次：燃后置 seen 标记）
  useEffect(() => {
    if (!lastResult || lastResult.targetId !== playerId) return undefined;
    const key = `${lastResult.targetId}:${lastResult.outcome}:${lastResult.compensation}`;
    if (seenRef.current === key) return undefined;
    seenRef.current = key;
    setShow({ outcome: lastResult.outcome, stage: 'word' });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShow(s => (s ? { ...s, stage: s.outcome === 'executed' ? 'fade' : 'hold' } : s));
    }, WORD_MS);
    return undefined;
  }, [lastResult, playerId]);

  // 赦免滞留的放行是**渲染期派生**：hold 且相位已离开 EXECUTION → 视作 fade（不在 effect 里改 state）
  const stage = show ? (show.stage === 'hold' && phase !== 'EXECUTION' ? 'fade' : show.stage) : null;

  // 渐隐结束卸载罩层（死亡视角/常态接管）
  useEffect(() => {
    if (stage !== 'fade') return undefined;
    const t = setTimeout(() => setShow(null), FADE_MS);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!show) return null;
  const dead = show.outcome === 'executed';
  return (
    <div className={`exec-overlay ${stage === 'fade' ? 'fading' : ''}`}>
      <div className={`exec-word ${dead ? 'dead' : 'pardon'}`}>
        {dead ? T.execution.deathWord : T.execution.pardonWord}
      </div>
      {stage === 'hold' && (
        <div className="exec-hold-foot">
          <span>{T.execution.holdHint}</span>
          {deadline && <HoldCountdown deadline={deadline} />}
        </div>
      )}
    </div>
  );
}

// 滞留页脚倒计时（下一焦点的决断窗；聊天系统频道同步播报各笔判决）
function HoldCountdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [deadline]);
  return <span className="exec-hold-count">{T.execution.holdCountdown(left)}</span>;
}
