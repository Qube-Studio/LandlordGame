// 圈上提示层（LOBBY / DISCUSSION / BETTING(已下注) / REVEAL · PC 端 3D 输入模式）：
// 底部木板面板在这些阶段退役（反馈⑪⑫⑯——关键交互放到桌上，吸引玩家看向桌面）。
// 位置走 PromptFloat 统一载体：准备类阶段悬在自己圆圈正上方，BETTING 起自动滑到「西北」
// 让位给圈内钱堆（验收修订②）；点击可点行有受击动效（验收修订⑤）。
// 按键提示走 KeyCap 键帽（阶段五⑤）：空格=半透明黑长条，字母=小方帽；空格触发在 useGameKeys。
// 挂在场景旋转组内（局部系），只读 store、只发 intents——无任何规则计算。
import { useGameStore } from '../store/gameStore';
import PromptFloat from './PromptFloat';
import { factionOf } from '../game/roles';
import PixelText from '../assets/pixelfont/PixelText';
import KeyCap from '../assets/pixelfont/KeyCap';

export default function FeltPrompts({ mySpot }) {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const togglePanel = useGameStore(s => s.togglePanel);
  const betFlight = useGameStore(s => s.betFlight);
  const spaceHeld = useGameStore(s => s.spaceHeld); // 空格行合成按下态（松开才触发）
  const me = state.me;
  if (!me || me.spectator) return null;

  let lines = []; // {text, k?, color, onClick?}
  if (state.phase === 'LOBBY') {
    if (!me.role) {
      lines = [{ text: '选择角色', k: 'R', color: 'var(--px-gold)', onClick: () => togglePanel('roles') }];
    } else if (me.isHost) {
      lines = [
        { text: '开始游戏', k: 'space', color: 'var(--px-gold)', onClick: () => send({ type: 'start_game' }) },
        { text: '改选角色', k: 'R', color: 'var(--ink-dim)', onClick: () => togglePanel('roles') },
      ];
    } else if (!me.lobbyReady) {
      lines = [
        { text: '准备', k: 'space', color: 'var(--px-gold)', onClick: () => send({ type: 'lobby_ready', ready: true }) },
        { text: '改选角色', k: 'R', color: 'var(--ink-dim)', onClick: () => togglePanel('roles') },
      ];
    } else {
      lines = [
        { text: '已准备 · 等待房主开始', color: 'var(--ok)' },
        { text: '取消准备', k: 'space', color: 'var(--ink-dim)', onClick: () => send({ type: 'lobby_ready', ready: false }) },
      ];
    }
  } else if (state.phase === 'DISCUSSION') {
    lines = me.ready
      ? [{ text: '等待所有人准备...', color: 'var(--ink-dim)' }]
      : [{ text: '准备下注！', k: 'space', color: 'var(--px-gold)', onClick: () => send({ type: 'ready' }) }];
  } else if (state.phase === 'BETTING') {
    // 已下注等待他人：浮字保持显示金额（验收修订③；自己钱堆的 ¥ 标签此时让位，Scene3D 侧隐藏）。
    // 飞牌在途不抢戏，落定后浮现；下注操作中（bet==null）浮字由 HandLayer 负责。
    const flying = betFlight && betFlight.round === state.round;
    if (me.bet != null && !flying) lines = [{ text: `已下注 ¥${me.bet}`, color: 'var(--px-gold)' }];
  } else if (state.phase === 'REVEAL') {
    const confirmed = state.players.filter(p => p.confirmed).length;
    const active = state.players.filter(p => factionOf(p.role) && !p.bankrupt).length;
    lines = me.confirmed
      ? [{ text: `已确认 ${confirmed}/${active}`, color: 'var(--ok)' }] // 验收修订④：确认后只留计数
      : [
        { text: '看清了，掷硬币！', k: 'space', color: 'var(--px-gold)', onClick: () => send({ type: 'confirm_reveal' }) },
        { text: `已确认 ${confirmed}/${active}`, color: 'var(--ink-dim)' },
      ];
  }
  if (!lines.length) return null;

  // BETTING 起圈内可能有钱（哪怕当前没有）→ 西北锚点；准备类阶段悬在圈正上方
  const nw = state.phase === 'BETTING' || state.phase === 'REVEAL';
  return (
    <PromptFloat spot={mySpot} nw={nw}>
      {lines.map((l, i) => (
        <div key={i} className={`prompt-line ${l.onClick ? 'clickable' : ''} ${l.k === 'space' && spaceHeld ? 'pressed' : ''}`} onClick={l.onClick}>
          <PixelText size={2} color={l.color}>{l.text}</PixelText>
          {l.k && <KeyCap k={l.k} color={l.color} />}
        </div>
      ))}
    </PromptFloat>
  );
}
