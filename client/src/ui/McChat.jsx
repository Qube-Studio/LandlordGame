// 左下角 Minecraft 风格聊天（聊天 2.0）：
// - 输入条常显：半透明黑框；Enter 或鼠标点击激活（变实并聚焦），Esc 收起并失焦，发送后保持聚焦。
// - 频道前缀：「全部/阵营/系统 >」，Tab 循环切换（防 e.repeat 长按鬼畜）。阵营按身份映射：
//   农民=密谈频道、观战者=观战频道、地主阵营无此频道（阵容恒 1 人，Tab 只在全部↔系统间循环）。
// - 着色：系统=金；阵营频道=整行橙（名字+正文，无前缀）；公开消息按「发送者阵营 vs 我」
//   整行着色——同=绿、异=红、任一方未选角=默认白金。发送者显示为「名字（身份）」。
//
// 淡出/滚动（重构版，DOM 直控 + 帧钟冻结，见 GAME_SPEC 的交互定稿）：
// - 收起态渲染近 COLLAPSED_CAP 条**完整历史**（不再是硬编码末 8）——一屏能放几条由框高与各行高
//   自然决定（消息长→少、短→多）。每条按自身寿命独立倒计时逐条淡出、其余回流；已淡完者 display:none
//   收起（悬停时揭示）。淡出直接由 rAF 写 opacity/display，**不触发 React 重渲染**（渲染只在消息到达/
//   模式切换时发生），避免逐帧重绘整列。
// - 「活跃时钟」activeRef 仅在收起且未悬停时累加；展开/悬停时冻结。**退出聊天 / 悬停撤离**时对**视野内
//   可见的行**重发**错峰淡出租约**（leaseVisible，见下）：可见者先全满显、再逐行淡出（最上/最旧先走），
//   视野外更早的保持隐去。这是关键——帧钟冻结只保留「剩余寿命」，退出时展开态里的旧消息寿命早已耗尽（会
//   瞬消）、展开时发的批量消息 born 相同（会齐淡）；固定取最近 N 条又会把滚出屏外的更早消息也纳入（淡出
//   不从视野开始）。退出的 lease 延到收起布局落定（useLayoutEffect）才量得到收起视野，且**保持用户当前
//   滚动位置**（强制钉底=「退出被拽底」）。
// - **锚点滚动补偿（withAnchor）**：一切批量显示/隐藏（悬停揭示、租约瞬藏屏外行、淡完收行）都会改变视野
//   上方内容高度——改前记住视野内最下一条可见行的屏幕位置、改完调 scrollTop 复位，眼前内容纹丝不动。
//   「拽底」「跳一格」皆源于少了这层补偿。
// - 悬停 = 冻结时钟 + 立即满显整段近历史（含已淡完的，锚点补偿），外观不变实；更早的滚轮**原地上滚**看
//   （滚动条隐藏）。撤离 GRACE_MS 后按视野重发租约恢复淡出；宽限内返回=取消重计。
// - 贴底跟随：仅当用户本就贴底（stickRef）时新消息/回流才钉到底；滚上去读历史后退出**绝不**被拽回底。
// - 展开态：有界可滚动全历史，按频道过滤，实底可见滚动条。
// - localSys 触发 chatFlash 时日志区高亮脉冲一次（并可能被强制切到系统频道）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { isFarmerSide, factionOf, ROLE_LABEL } from '../game/roles';

const FADE_MS = 3000;        // 普通消息收起态可见时长（活跃时间累计，非墙钟）
const SYS_FADE_MS = 5000;    // 系统消息更久（破产/等待提示等更需被看到）
const FADE_OUT_MS = 1500;    // 临期渐隐时长：opacity 在最后这段由满降到 0
const GRACE_MS = 1500;       // 悬停撤离后多久恢复逐条淡出
const COLLAPSED_CAP = 100;   // 收起态最多渲染的近历史条数（悬停可原地滚这些；更早的进展开态看）
const STAG = 350;            // 逐行淡出的错峰间隔 ms（视野内最上/最旧先淡）
const lifeOf = (m) => (m.system ? SYS_FADE_MS : FADE_MS);
const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function McChat() {
  const state = useGameStore(s => s.state);
  const chat = useGameStore(s => s.chat);
  const playerId = useGameStore(s => s.playerId);
  const send = useGameStore(s => s.send);
  const open = useGameStore(s => s.chatOpen);
  const setOpen = useGameStore(s => s.setChatOpen);
  const chatTab = useGameStore(s => s.chatTab);
  const setChatTab = useGameStore(s => s.setChatTab);
  const chatFlash = useGameStore(s => s.chatFlash);

  const [text, setText] = useState('');

  // 逐条淡出全程 DOM 直控（rAF 写各行 style），故这些都是 ref、不进 render——render 不读它们，
  // 只在消息到达/模式切换时发生，逐帧淡出不重渲染整列。
  const activeRef = useRef(0);        // 累计活跃时间 ms（仅收起且未悬停时累加）
  const bornRef = useRef({});         // uk → 入场活跃时刻
  const lifeRef = useRef({});         // uk → 寿命 ms
  const lineEls = useRef(new Map());  // uk → 行 DOM 元素（rAF 直改其 opacity/display）
  const hoverRef = useRef(false);     // 收起态悬停：冻结时钟 + 满显（供回看/滚动）
  const graceRef = useRef(0);         // 撤离宽限计时句柄
  const stickRef = useRef(true);      // 是否贴底（决定新消息/回流是否自动钉到底）
  const leasePendingRef = useRef(false); // 关闭聊天后：待收起布局落定再按视野重发错峰租约
  const inputRef = useRef(null);
  const logRef = useRef(null);

  const me = state.players.find(p => p.id === playerId);
  const isSpec = !!(me?.bankrupt || me?.spectator); // 观战者：有上帝视角，发言只进观战频道
  const myFaction = factionOf(me?.role);
  const canReadFarmer = isFarmerSide(me?.role) || isSpec; // 读密谈：农民阵营 + 观战者
  const canPostFarmer = isFarmerSide(me?.role) && !isSpec; // 发密谈：仅在场农民阵营
  const factionChannel = canPostFarmer ? 'farmer' : isSpec ? 'spectator' : null;
  const tabIds = ['all', ...(factionChannel ? ['faction'] : []), 'system'];
  const tab = chatTab === 'faction' && !factionChannel ? 'all' : chatTab;
  const tabLabel = tab === 'system' ? '系统' : tab === 'faction' ? (isSpec ? '观战' : '阵营') : '全部';
  const tabColor = tab === 'system' ? 'var(--ink-faint)' : tab === 'faction' ? 'var(--warn)' : 'var(--ink-dim)';
  const sendChannel = tab === 'faction' ? factionChannel : (isSpec ? 'spectator' : 'public');
  const readonly = tab === 'system';

  const accessible = chat.filter(m =>
    m.channel === 'public'
    || (m.channel === 'farmer' && canReadFarmer)
    || (m.channel === 'spectator' && isSpec),
  );
  const inTab = m => (tab === 'system' ? !!m.system
    : tab === 'faction' ? m.channel === factionChannel && !m.system
      : true);
  const keyOf = (m) => `${m.ts}:${m.from ?? m.localKey ?? 'sys'}:${m.channel}`;
  // 稳定唯一 key：同 keyOf 撞车（同毫秒同人同频道）加序号。render 与 born-effect 用同序列 → uk 一致。
  const keyed = (list) => {
    const seen = {}; const out = [];
    for (const m of list) {
      const base = keyOf(m);
      const n = (seen[base] = (seen[base] ?? 0) + 1);
      out.push([m, n > 1 ? `${base}#${n}` : base]);
    }
    return out;
  };

  // 渲染集：展开=按频道过滤全历史；收起=近 COLLAPSED_CAP 条（含已淡完的，rAF 置 display:none，悬停揭示）
  const collapsedList = accessible.slice(-COLLAPSED_CAP);
  const rendered = open ? accessible.filter(inTab) : collapsedList;

  // 维护近历史每条的入场时刻/寿命（rAF 据此算剩余淡出）；渲染集变动时增删。
  useEffect(() => {
    const b = bornRef.current, l = lifeRef.current, keep = new Set();
    for (const [m, uk] of keyed(collapsedList)) {
      keep.add(uk);
      if (b[uk] === undefined) b[uk] = activeRef.current; // 收起态新到消息：入场即计时（自然逐条淡出）
      l[uk] = lifeOf(m);
    }
    for (const k of Object.keys(b)) if (!keep.has(k)) { delete b[k]; delete l[k]; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);

  // 锚点滚动补偿：批量显示/隐藏会改变视野上方的内容高度，若不补偿 scrollTop，眼前的消息会整体位移
  // （用户报的「拽底」「跳一格」皆源于此）。做法：改前记住视野内**最下**一条可见行的屏幕位置（淡出从上往下走，
  // 底部最稳），fn 改完后把 scrollTop 调整回去——眼前内容纹丝不动。绝不强制钉底。
  const withAnchor = useCallback((fn) => {
    const log = logRef.current;
    if (!log) { fn(); return; }
    const lr = log.getBoundingClientRect();
    let ref = null, refTop = 0;
    for (const [, el] of lineEls.current) { // Map 插入序 = 消息序（旧→新）：最后命中者即视野内最下一条
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > lr.top + 1 && r.top < lr.bottom - 1) { ref = el; refTop = r.top; }
    }
    fn();
    if (ref && ref.style.display !== 'none') {
      const d = ref.getBoundingClientRect().top - refTop;
      if (d) log.scrollTop += d;
    }
  }, []);

  // 淡出帧钟：仅收起态跑 rAF 直写各行 opacity/display；展开态清除行内样式让 React 满显、不跑钟。
  useEffect(() => {
    if (open) {
      hoverRef.current = false;
      clearTimeout(graceRef.current);
      lineEls.current.forEach(el => { el.style.opacity = ''; el.style.display = ''; });
      return undefined;
    }
    let raf = 0, last = 0;
    const loop = (now) => {
      if (!last) last = now;
      let dt = now - last; last = now;
      if (dt > 250) dt = 250;                    // 后台/掉帧不让时钟暴冲（回来一次淡掉一大片）
      const frozen = hoverRef.current;
      if (!frozen) activeRef.current += dt;      // 悬停冻结时钟：保留各消息真实剩余寿命
      const A = activeRef.current;
      const toHide = [];                         // 本帧淡完的行：攒起来一次隐（未贴底时需锚点补偿，防跳位）
      for (const [uk, el] of lineEls.current) {
        if (frozen) { el.style.display = ''; el.style.opacity = '1'; continue; } // 满显整段快照
        const remain = (lifeRef.current[uk] ?? FADE_MS) - (A - (bornRef.current[uk] ?? A));
        if (remain <= 0) { if (el.style.display !== 'none') toHide.push(el); }   // 淡完收起，其余回流
        else { el.style.display = ''; el.style.opacity = String(Math.max(0, Math.min(1, remain / FADE_OUT_MS))); }
      }
      if (toHide.length) {
        // 贴底时钉底本身就抵消位移；未贴底（读史中）必须补偿，否则上方行塌陷把眼前内容拽跳一格
        if (stickRef.current) toHide.forEach(el => { el.style.display = 'none'; });
        else withAnchor(() => toHide.forEach(el => { el.style.display = 'none'; }));
      }
      const el = logRef.current;
      if (el && stickRef.current && !frozen) el.scrollTop = el.scrollHeight;     // 贴底才钉底；滚上去读史不拽回
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, withAnchor]);

  // 错峰淡出租约（**视野版**）：只对当前视野内可见的行发租约——此刻全满显、再逐行淡出（最上/最旧先走）；
  // 视野外（已滚出屏）的**当场隐去**（否则可见者淡完后它们会「回流」重现）并锚点补偿滚动（瞬藏屏外行会塌陷
  // 上方高度，不补偿=眼前消息跳位）。退出聊天 / 悬停撤离共用。**必须按视野测量**——固定取最近 N 条会把已滚
  // 出屏外的更早消息也纳入，导致「淡出不是从视野里的消息开始」。
  const leaseVisible = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    const lr = log.getBoundingClientRect();
    const A = activeRef.current, born = bornRef.current, life = lifeRef.current;
    const vis = [], others = [];
    for (const [uk, el] of lineEls.current) {
      const r = el.getBoundingClientRect();
      // 视野内且未隐藏=可见（悬停已 reveal 全部，故此处按 rect 判定即可）
      if (el.style.display !== 'none' && r.bottom > lr.top + 1 && r.top < lr.bottom - 1) vis.push([uk, r.top]);
      else others.push(uk);
    }
    vis.sort((x, y) => x[1] - y[1]); // 从上到下 = 最旧→最新
    vis.forEach(([uk], i) => { born[uk] = A + i * STAG + FADE_OUT_MS - (life[uk] ?? FADE_MS); });
    // 视野外立即隐去（born 置成已过期 + 当场改 display 并补偿——留给 rAF 下一帧改会先跳一下）
    withAnchor(() => {
      for (const uk of others) {
        born[uk] = A - (life[uk] ?? FADE_MS) - 1;
        const el = lineEls.current.get(uk);
        if (el) el.style.display = 'none';
      }
    });
  }, [withAnchor]);

  // 收起态悬停：进入=冻结 + 立即满显（含已隐藏）**并锚点补偿**——揭示的旧消息在上方撑高，不补偿会把眼前
  // 内容拽走（此前钉底的做法本身就是「拽底」）；撤离=GRACE_MS 后按视野重发错峰租约并恢复淡出，返回则取消。
  const onEnter = () => {
    if (open) return;
    clearTimeout(graceRef.current);
    hoverRef.current = true;
    withAnchor(() => lineEls.current.forEach(el => { el.style.display = ''; el.style.opacity = '1'; }));
  };
  const onLeave = () => {
    if (open) return;
    clearTimeout(graceRef.current);
    graceRef.current = setTimeout(() => { leaseVisible(); hoverRef.current = false; }, GRACE_MS);
  };
  useEffect(() => () => clearTimeout(graceRef.current), []); // 卸载清理宽限计时

  // 关闭聊天：收起 + 清输入 + 失焦；淡出租约延到收起布局落定后按视野重发（见下 useLayoutEffect）——
  // 此刻仍是展开布局，量不到收起视野，直接 leaseVisible 会从屏外更早消息开淡。
  const closeChat = useCallback(() => { setOpen(false); setText(''); inputRef.current?.blur(); leasePendingRef.current = true; }, [setOpen]);

  // 退出聊天落定：收起 DOM 就绪后（paint 前、rAF 首帧前）按视野重发错峰租约——**保持用户当前滚动位置**
  // （强制钉底=「退出被拽底」），淡出从他正看着的那片视野里最旧那条开始；贴底与否按现位置重新测量。
  useLayoutEffect(() => {
    if (open || !leasePendingRef.current) return;
    leasePendingRef.current = false;
    const log = logRef.current;
    if (log) stickRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    leaseVisible();
  }, [open, leaseVisible]);

  // 展开自动聚焦输入
  useEffect(() => { if (open && !readonly) inputRef.current?.focus(); }, [open, readonly, tab]);
  // 展开/切频道：跳到底并视为贴底
  useEffect(() => { const el = logRef.current; if (open && el) { el.scrollTop = el.scrollHeight; stickRef.current = true; } }, [open, tab]);
  // 展开态新消息：仅当本就贴底才自动跟随（读历史时不被拽到底）；收起态跟随由帧钟处理
  useEffect(() => { const el = logRef.current; if (open && el && stickRef.current) el.scrollTop = el.scrollHeight; }, [open, rendered.length]);

  // 展开态：点击聊天区以外任意处 = 收起（否则日志区残留展开态）
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest('.mc-chat')) return;
      closeChat();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, closeChat]);

  // 收起态：Enter 激活输入（确认类动作已全部让位给空格，Enter 是空闲键）
  useEffect(() => {
    if (open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Enter') return;
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Tab 循环频道（**收起态也生效**——常显输入条前缀即反馈）/ Esc 收起（仅展开态）。挂 window 捕获阶段：
  // 系统频道输入框禁用、失焦时元素级监听接不到键，Esc 也必须在此处理否则只读频道下关不掉聊天。
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();     // 收起态也拦掉浏览器焦点循环
        if (e.repeat) return;   // 长按 Tab 不鬼畜连切
        const cur = Math.max(0, tabIds.indexOf(tab));
        setChatTab(tabIds[(cur + 1) % tabIds.length]);
      } else if (e.key === 'Escape' && open) {
        closeChat();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // 高亮脉冲（localSys 重复触发/强制切频道时）：WAAPI 一次性动画，连触自然覆盖重播
  const flashInited = useRef(false);
  useEffect(() => {
    if (!flashInited.current) { flashInited.current = true; return; }
    if (!chatFlash || REDUCED || !logRef.current?.animate) return;
    logRef.current.animate([
      { boxShadow: '0 0 0 2px rgba(232,194,90,0.9), inset 0 0 22px rgba(232,194,90,0.35)', offset: 0.12 },
      { boxShadow: '0 0 0 0 rgba(232,194,90,0)' },
    ], { duration: 700, easing: 'ease-out' });
  }, [chatFlash]);

  // 回车：有内容=发送并**保持聚焦**（连续发言）；空框=退出焦点（收起+逐条淡出）
  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (t && !readonly) { send({ type: 'chat', channel: sendChannel, text: t }); setText(''); inputRef.current?.focus(); }
    else closeChat();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Tab' || e.key === 'Escape') return; // 交给 window 捕获层（循环频道/收起）
    e.stopPropagation();
  };

  return (
    <div className={`mc-chat ${open ? 'open' : ''}`}>
      <div
        className="mc-chat-log"
        ref={logRef}
        // 点击日志区：收起→展开；展开→焦点收回输入框（避免「已失焦却仍展开」的尴尬态）
        onClick={() => { if (open) inputRef.current?.focus(); else setOpen(true); }}
        onScroll={() => { const el = logRef.current; if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {/* 内层做底部锚定（margin-top:auto）——比 :first-child 稳，不受 display:none 首条影响 */}
        <div className="mc-chat-log-inner">
          {keyed(rendered).map(([m, uk]) => {
            // ref 内联回调（挂载写 lineEls、卸载删除）：其体在 commit 执行、不在 render，故不触发
            // react-hooks/refs；渲染不频繁（仅消息到达/切模式），detach/reattach 抖动可忽略。
            // opacity/display 由 rAF 直写，此处不设 style。
            const cb = (el) => { if (el) lineEls.current.set(uk, el); else lineEls.current.delete(uk); };
            // 系统播报（破产/等待提示等）：无发送者，整行金字
            if (m.system) {
              return (
                <div key={uk} ref={cb} className="mc-chat-line system">
                  <PixelText size={2} wrap color="var(--px-gold)">{m.text}</PixelText>
                </div>
              );
            }
            // 着色走 PixelText color prop（其根元素带内联 currentColor，CSS 类着色压不过）。
            // 发送者显示「名字（身份）」；身份按当前花名册实时查（历史消息随角色变化，可接受）。
            const sender = state.players.find(p => p.id === m.from);
            const shownName = sender?.role ? `${m.name}（${ROLE_LABEL[sender.role]}）` : m.name;
            // 阵营频道：整行橙（名字+正文，无前缀——可见者必为己方）；观战频道保留〔观战〕。
            if (m.channel === 'farmer' || m.channel === 'spectator') {
              const fac = m.channel === 'farmer';
              return (
                <div key={uk} ref={cb} className="mc-chat-line">
                  {!fac && <PixelText size={2} className="mc-tag" color="var(--ink-dim)">〔观战〕</PixelText>}
                  <PixelText size={2} className="mc-from" color={fac ? 'var(--warn)' : 'var(--px-gold)'}>{shownName}</PixelText>
                  <PixelText size={2} className="mc-body" wrap color={fac ? 'var(--warn)' : 'var(--ink)'}>{m.text}</PixelText>
                </div>
              );
            }
            // 公开频道：按发送者阵营相对我着色——同=绿 / 异=红 / 任一方未选角=默认白金
            const senderFaction = factionOf(sender?.role);
            const rel = myFaction && senderFaction ? (senderFaction === myFaction ? 'friend' : 'foe') : '';
            const tone = rel === 'friend' ? 'var(--ok)' : rel === 'foe' ? 'var(--danger)' : null;
            return (
              <div key={uk} ref={cb} className="mc-chat-line">
                <PixelText size={2} className="mc-from" color={tone ?? 'var(--px-gold)'}>{shownName}</PixelText>
                <PixelText size={2} className="mc-body" wrap color={tone ?? 'var(--ink)'}>{m.text}</PixelText>
              </div>
            );
          })}
        </div>
      </div>

      {/* 输入条常显：半透明黑框，点击/Enter 激活变实；前缀=当前频道名，Tab 循环 */}
      <form className="mc-chat-input" onSubmit={submit} onMouseDown={() => !open && setOpen(true)}>
        <span className="mc-prefix">
          <PixelText size={2} color={tabColor}>{tabLabel}</PixelText>
          <PixelText size={2} color="var(--ink-dim)">{'>'}</PixelText>
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          disabled={readonly}
          placeholder={readonly ? '无法在该频道发送消息' : ''}
          maxLength={200}
        />
      </form>
    </div>
  );
}
