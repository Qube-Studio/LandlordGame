// 圈上提示层（LOBBY / DISCUSSION / BETTING(已下注) / REVEAL · PC 端 3D 输入模式）：
// 底部木板面板在这些阶段退役（反馈⑪⑫⑯——关键交互放到桌上，吸引玩家看向桌面）。
// 位置走 PromptFloat 统一载体：准备类阶段悬在自己圆圈正上方，BETTING 起自动滑到「西北」
// 让位给圈内钱堆（验收修订②）；点击可点行有受击动效（验收修订⑤）。
// 按键提示走 KeyCap 键帽（阶段五⑤）：空格=半透明黑长条，字母=小方帽；空格触发在 useGameKeys。
// 挂在场景旋转组内（局部系），只读 store、只发 intents——无任何规则计算。
import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import PromptFloat from './PromptFloat';
import { factionOf, ROLE_LABEL } from '../game/roles';
import PixelText from '../assets/pixelfont/PixelText';
import KeyCap from '../assets/pixelfont/KeyCap';
import { T } from '../text';

// 浮字倒计时（读服务端 deadline 绝对毫秒，每 0.5s 刷新）：对质决定窗/交流窗复用。
function FloatCountdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [deadline]);
  return <div className="prompt-line"><PixelText size={2} color="var(--ink-dim)">{T.felt.countdown(left)}</PixelText></div>;
}

// 对质选择器（§8.8）：「敌注 [> / <] 己方总注」——上下叠一个大于/小于，点选敌注比己方阵营总注多(>)/少(<)。
// 两段确认：第一击 accuse_pick 只预选（选中符号变大、另一个略缩暗——pendingDir 服务端广播，队友同步看到），
// 再点已变大的那个才 accuse_resolve 落定；可反复改选。
// interactive=发起者可点；否则只读（队友同步观看），waitFor=正在操作的队友（显示「等待 名（身份）操作」）。
function ChallengePick({ total, deadline, pendingDir = null, interactive = false, waitFor = null, onPick, onConfirm, onCancel }) {
  const op = (dir, glyph) => {
    const picked = pendingDir === dir;
    const dimmed = pendingDir && !picked;
    return (
      <div
        className={`cp-op ${interactive ? 'clickable' : ''} ${picked ? 'picked' : ''} ${dimmed ? 'dimmed' : ''}`}
        onClick={interactive ? () => (picked ? onConfirm(dir) : onPick(dir)) : undefined}
      >
        <PixelText size={2} color="var(--px-gold)">{glyph}</PixelText>
      </div>
    );
  };
  return (
    <div className="challenge-pick">
      <div className="cp-ineq">
        <PixelText size={2} color="var(--danger)">{T.felt.enemyBet}</PixelText>
        <div className="cp-ops">
          {op('more', '>')}
          {op('less', '<')}
        </div>
        <PixelText size={2} color="var(--ink-dim)">{T.felt.factionTotal}</PixelText>
        <PixelText size={2} color="var(--px-gold)">{T.felt.totalMoney(total)}</PixelText>
      </div>
      {interactive && pendingDir && <div className="prompt-line"><PixelText size={2} color="var(--ink-dim)">{T.felt.confirmAgain}</PixelText></div>}
      {deadline && <FloatCountdown deadline={deadline} />}
      {waitFor && <div className="prompt-line"><PixelText size={2} color="var(--ink-dim)">{T.felt.waitFor(waitFor.name, ROLE_LABEL[waitFor.role])}</PixelText></div>}
      {interactive && onCancel && <div className="prompt-line clickable" onClick={onCancel}><PixelText size={2} color="var(--ink-dim)">{T.felt.cancelNoRefund}</PixelText></div>}
    </div>
  );
}

export default function FeltPrompts({ mySpot, players, spots, playerId }) {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const togglePanel = useGameStore(s => s.togglePanel);
  const localSys = useGameStore(s => s.localSys);
  const betFlight = useGameStore(s => s.betFlight);
  const spaceHeld = useGameStore(s => s.spaceHeld); // 空格行合成按下态（松开才触发）
  const me = state.me;
  if (!me || me.spectator) return null;

  let lines = [];       // 主浮字 {text, k?, color, onClick?, quiet?} | {deadline}（倒计时行）
  let custom = null;    // 自定义主浮字内容（对质选择器等，替代 lines 渲染）
  let secondary = null; // 副浮字（大厅房主已准备后，东北方「开始游戏 [S]」）
  if (state.phase === 'LOBBY') {
    const ready = !!me.lobbyReady;
    const hasRole = !!me.role;
    // 空格/点击「准备」：未选角不发 lobby_ready，改发去重系统提示（refresh 每次重置显示计时，无金框——反馈⑦）
    const onReady = () => {
      if (!hasRole) { localSys(T.common.noRoleYet, { key: 'norole', refresh: true }); return; }
      send({ type: 'lobby_ready', ready: !ready });
    };
    lines = [
      // 已准备附身份（反馈④）、不再跟空格键帽（刚才「准备！」已提示过——反馈二轮②）；
      // 未选角把主行压暗且设 quiet（默认光标、无悬停/按下/受击态——反馈⑦）
      { text: ready ? T.felt.readyWithRole(ROLE_LABEL[me.role]) : T.felt.ready, k: ready ? undefined : 'space', color: ready ? 'var(--ok)' : hasRole ? 'var(--px-gold)' : 'var(--ink-dim)', onClick: onReady, quiet: !hasRole },
      { text: hasRole ? T.felt.changeRole : T.felt.chooseRole, k: 'R', color: hasRole ? 'var(--ink-dim)' : 'var(--px-gold)', onClick: () => togglePanel('roles') },
    ];
    // 房主已准备：主浮字滑西北让位，东北浮现「开始游戏 [S]」（仅房主已准备可开局，见 useGameKeys）
    if (me.isHost && ready) {
      secondary = [{ text: T.felt.startGame, k: 'S', color: 'var(--px-gold)', onClick: () => send({ type: 'start_game' }) }];
    }
  } else if (state.phase === 'DISCUSSION') {
    // 短喘息（反馈②）：纯过场，到点自动进下注，玩家无需任何操作（无跳过入口）。
    lines = [{ text: T.felt.nextRound, color: 'var(--ink-dim)' }];
  } else if (state.phase === 'BETTING') {
    // 已下注等待他人：浮字保持显示金额（验收修订③；自己钱堆的 ¥ 标签此时让位，Scene3D 侧隐藏）。
    // 飞牌在途不抢戏，落定后浮现；下注操作中（bet==null）浮字由 HandLayer 负责。
    const flying = betFlight && betFlight.round === state.round;
    if (me.bet != null && !flying) lines = [{ text: T.felt.betPlaced(me.bet), color: 'var(--px-gold)' }];
    // 下注倒计时（timing.betMs，到点未下注自动押最小注）：已下注跟在主浮字下；
    // 下注操作中主浮字区归 HandLayer（圈正上方），倒计时挂东北副浮字避让，不与手牌提示叠字。
    if (state.betDeadline) {
      if (me.bet != null) lines.push({ deadline: state.betDeadline });
      else secondary = [{ deadline: state.betDeadline }];
    }
    // 检察官·传唤（§8.9）：东北副浮字（主浮字区归 HandLayer）——下注前可传，费用随次数 150% 递增。
    if (me.role === 'prosecutor' && !me.spectator) {
      if (me.canSummon) {
        secondary = [...(secondary ?? []), { text: T.felt.summonBtn(me.summonCost), k: 'C', color: 'var(--px-gold)', onClick: () => send({ type: 'summon' }) }];
      } else if (me.usedSummonThisRound) {
        secondary = [...(secondary ?? []), { text: T.felt.summoned, color: 'var(--ok)' }];
      }
    }
  } else if (state.phase === 'CHALLENGE') {
    // 对质窗（§8.8）：全在自己圈上的浮字里做（指控入口即「指控敌方 [Z]」，不悬停敌方模型）。均带倒计时（ch.deadline）。
    const ch = state.challenge;
    const total = ch?.factionTotal;
    const acc = ch?.accusation;
    const dl = ch?.deadline;
    if (me.myAccusation) {
      // 发起者（交流窗）：敌注 [> / <] 己方总注 选择器（两段确认）+ 倒计时 + 取消。
      custom = <ChallengePick total={total} deadline={dl} interactive pendingDir={acc?.pendingDir ?? null}
        onPick={(dir) => send({ type: 'accuse_pick', dir })}
        onConfirm={(dir) => send({ type: 'accuse_resolve', dir })}
        onCancel={() => send({ type: 'accuse_cancel' })} />;
    } else if (acc) {
      const iAmTarget = acc.targetId === me.id;
      if (iAmTarget) {
        lines = [{ text: T.felt.beingAccused, color: 'var(--danger)' }, { deadline: dl }];
      } else if (factionOf(me.role) === 'farmer') {
        // 队友：同步观看发起者的选择器（只读，含预选态）+「等待 名（身份）操作」+ 倒计时。
        const accuser = state.players.find(p => p.id === acc.accuserId);
        custom = <ChallengePick total={total} deadline={dl} pendingDir={acc.pendingDir ?? null} waitFor={accuser} />;
      } else {
        lines = [{ text: T.felt.accusingYou, color: 'var(--ink-dim)' }, { deadline: dl }];
      }
    } else if (factionOf(me.role) === 'farmer') {
      // 决定窗：指控敌方 [Z] / 跳过（跳过后显示已跳 N/M）+ 阵营总注 + 倒计时。
      const farmers = state.players.filter(p => state.roundFarmerIds?.includes(p.id) && factionOf(p.role) === 'farmer');
      const skipped = farmers.filter(p => p.challengeSkip).length;
      lines = [
        { text: T.felt.factionTotalLine(total), color: 'var(--ink-dim)' },
        me.canAccuse
          ? { text: T.felt.accuseEnemy, k: 'Z', color: 'var(--px-gold)', onClick: () => send({ type: 'accuse', targetId: ch?.targetId }) }
          : { text: me.usedSummonThisRound ? T.felt.summonedNoAccuse : T.felt.notEnoughTickets, color: 'var(--ink-dim)' }, // 无 quiet：纯信息行要能戳着玩（受击推板）
        me.challengeSkip
          ? { text: T.felt.skippedCount(skipped, farmers.length), color: 'var(--ok)' }
          : { text: T.common.skip, color: 'var(--ink-dim)', onClick: () => send({ type: 'challenge_skip' }) },
        { deadline: dl },
      ];
    } else {
      lines = [{ text: T.felt.decidingAccuse, color: 'var(--ink-dim)' }, { deadline: dl }];
    }
  } else if (state.phase === 'REVEAL') {
    const confirmed = state.players.filter(p => p.confirmed).length;
    const active = state.players.filter(p => factionOf(p.role) && !p.bankrupt).length;
    lines = me.confirmed
      ? [{ text: T.felt.confirmedCount(confirmed, active), color: 'var(--ok)' }] // 验收修订④：确认后只留计数
      : [
        { text: T.felt.revealGo, k: 'space', color: 'var(--px-gold)', onClick: () => send({ type: 'confirm_reveal' }) },
        { text: T.felt.confirmedCount(confirmed, active), color: 'var(--ink-dim)' },
      ];
    // 确认倒计时（timing.revealConfirmMs）：到点自动全员确认进掷币。
    if (state.revealDeadline) lines.push({ deadline: state.revealDeadline });
  }
  // 大厅里别的已准备玩家：在他们各自圈上显示绿字「已准备（身份）」（反馈②④）。用 local 姿态各自独立。
  const others = state.phase === 'LOBBY' && Array.isArray(players)
    ? players
      .map((p, i) => ({ p, spot: spots?.[i] }))
      .filter(({ p, spot }) => p.id !== playerId && p.lobbyReady && p.role && spot)
    : [];

  if (!lines.length && !custom && !secondary && !others.length) return null;

  // quiet 行：默认光标、无 clickable 三态、不参与受击（.quiet 见 CSS 与 PromptFloat#pushFloat 排除），但 onClick 仍触发。
  // {deadline} 行 → 渲染倒计时组件。
  const row = (l, i) => {
    if (l.deadline) return <FloatCountdown key={i} deadline={l.deadline} />;
    return (
      <div
        key={i}
        className={`prompt-line ${l.quiet ? 'quiet' : l.onClick ? 'clickable' : ''} ${l.k === 'space' && spaceHeld && !l.quiet ? 'pressed' : ''}`}
        onClick={l.onClick}
      >
        <PixelText size={2} color={l.color}>{l.text}</PixelText>
        {l.k && <KeyCap k={l.k} color={l.color} />}
      </div>
    );
  };

  // BETTING 起圈内可能有钱（哪怕当前没有）→ 西北锚点；房主已准备时主浮字也让位到西北（给东北的开局浮字腾位）
  const nw = state.phase === 'BETTING' || state.phase === 'CHALLENGE' || state.phase === 'REVEAL' || !!secondary;
  return (
    <>
      {(custom || lines.length > 0) && <PromptFloat spot={mySpot} nw={nw}>{custom || lines.map(row)}</PromptFloat>}
      {secondary && (
        <PromptFloat spot={mySpot} ne local intro>{secondary.map(row)}</PromptFloat>
      )}
      {others.map(({ p, spot }) => (
        <PromptFloat key={p.id} spot={spot} local>
          <div className="prompt-line"><PixelText size={2} color="var(--ok)">{T.felt.readyWithRole(ROLE_LABEL[p.role])}</PixelText></div>
        </PromptFloat>
      ))}
    </>
  );
}
