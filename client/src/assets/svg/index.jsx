// 全部美术资产（临时 SVG 版）。颜色一律走主题 CSS 变量。
// 业务组件不要直接 import 这里——经 assets/registry.jsx 取用，方便将来整体替换为贴图。

// ---------- 钱牌 ----------
// value: 面额(10/5/2/1)；faceDown: 反面朝上；locked: 保留金锁定；debt: 债务牌(红)
export function MoneyNote({ value = 1, faceDown = false, locked = false, debt = false, width = 64 }) {
  const height = width * 1.4;
  const main = debt ? 'var(--danger)' : 'var(--gold)';
  if (faceDown) {
    return (
      <svg width={width} height={height} viewBox="0 0 64 90" aria-label="钱牌（反面）">
        <rect x="2" y="2" width="60" height="86" rx="6" fill="var(--bg-2)" stroke="var(--line-strong)" strokeWidth="2" />
        <rect x="8" y="8" width="48" height="74" rx="3" fill="none" stroke="var(--line)" strokeWidth="1.5" />
        <path d="M8 22 L56 60 M8 38 L56 76 M8 54 L40 82 M24 8 L56 34 M40 8 L56 20" stroke="var(--line)" strokeWidth="1" />
        <rect x="22" y="33" width="20" height="20" fill="var(--bg-1)" stroke="var(--gold-dim)" strokeWidth="1.5" />
        <text x="32" y="48" textAnchor="middle" fontSize="13" fill="var(--gold-dim)">地</text>
      </svg>
    );
  }
  return (
    <svg width={width} height={height} viewBox="0 0 64 90" aria-label={`${debt ? '债务' : '钱牌'} ${value}`}>
      <rect x="2" y="2" width="60" height="86" rx="6" fill="var(--bg-2)" stroke={main} strokeWidth="2" />
      <rect x="7" y="7" width="50" height="76" rx="3" fill="none" stroke="var(--line)" strokeWidth="1" />
      <path d="M7 28 H57 M7 62 H57" stroke="var(--line)" strokeWidth="1" />
      <text x="12" y="22" fontSize="12" fill={main}>{debt ? `-${value}` : value}</text>
      <text x="52" y="79" fontSize="12" fill={main} textAnchor="end">{debt ? `-${value}` : value}</text>
      <text x="32" y="53" textAnchor="middle" fontSize="26" fontWeight="700" fill={main}>
        {debt ? `-${value}` : value}
      </text>
      <text x="32" y="76" textAnchor="middle" fontSize="8" fill="var(--ink-dim)">{debt ? 'DEBT' : 'YUAN'}</text>
      {locked && (
        <g>
          <rect x="2" y="2" width="60" height="86" rx="6" fill="var(--bg-0)" opacity="0.55" />
          <rect x="24" y="40" width="16" height="13" rx="2" fill="none" stroke="var(--ink-dim)" strokeWidth="2" />
          <path d="M27 40 v-5 a5 5 0 0 1 10 0 v5" fill="none" stroke="var(--ink-dim)" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}

// ---------- 硬币 ----------
// face: 'heads'(正面=地主) | 'tails'(反面=农民)
export function CoinFace({ face = 'heads', size = 96 }) {
  const heads = face === 'heads';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label={heads ? '硬币正面' : '硬币反面'}>
      <circle cx="50" cy="50" r="46" fill="var(--bg-2)" stroke="var(--gold)" strokeWidth="4" />
      <circle cx="50" cy="50" r="37" fill="none" stroke="var(--gold-dim)" strokeWidth="1.5" strokeDasharray="4 3" />
      {heads ? (
        <g>
          <path d="M35 30 L40 38 L50 28 L60 38 L65 30 L65 42 L35 42 Z" fill="var(--gold)" />
          <text x="50" y="70" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--gold)">王</text>
        </g>
      ) : (
        <g>
          <path d="M50 26 C44 32 44 38 50 44 C56 38 56 32 50 26 Z" fill="var(--farmer)" />
          <path d="M50 44 V52 M42 36 C46 40 48 42 50 44 M58 36 C54 40 52 42 50 44" stroke="var(--farmer)" strokeWidth="2" fill="none" />
          <text x="50" y="74" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--farmer)">禾</text>
        </g>
      )}
    </svg>
  );
}

// ---------- 玩家形象：偏真人身体 + 大号正方体头套 ----------
// expression: idle | ready | bet | win | lose | bankrupt
const FACES = {
  idle: (
    <g stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <circle cx="-11" cy="-4" r="2.4" fill="var(--ink)" stroke="none" />
      <circle cx="11" cy="-4" r="2.4" fill="var(--ink)" stroke="none" />
      <path d="M-7 9 H7" />
    </g>
  ),
  ready: (
    <g stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <circle cx="-11" cy="-4" r="2.4" fill="var(--ink)" stroke="none" />
      <circle cx="11" cy="-4" r="2.4" fill="var(--ink)" stroke="none" />
      <path d="M-8 7 Q0 13 8 7" />
    </g>
  ),
  bet: (
    <g stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d="M-15 -5 H-6 M6 -5 H15" />
      <path d="M-6 9 Q2 11 8 6" />
    </g>
  ),
  win: (
    <g stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d="M-15 -3 L-11 -7 L-7 -3 M7 -3 L11 -7 L15 -3" />
      <path d="M-9 6 Q0 16 9 6" />
    </g>
  ),
  lose: (
    <g stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d="M-14 -6 L-8 -2 M14 -6 L8 -2" />
      <path d="M-8 11 Q0 5 8 11" />
      <path d="M-12 2 L-12 8" stroke="var(--ink-dim)" />
    </g>
  ),
  bankrupt: (
    <g stroke="var(--ink-dim)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d="M-14 -7 L-8 -1 M-8 -7 L-14 -1 M8 -7 L14 -1 M14 -7 L8 -1" />
      <ellipse cx="0" cy="10" rx="4" ry="5" />
    </g>
  ),
};

export function CubeAvatar({ expression = 'idle', role = 'farmer', width = 96 }) {
  const accent = role === 'landlord' ? 'var(--landlord)' : 'var(--farmer)';
  const height = width * 1.25;
  return (
    <svg width={width} height={height} viewBox="0 0 120 150" aria-label="玩家">
      {/* 身体（偏真人：肩颈/躯干/手臂） */}
      <path d="M30 150 V120 Q30 102 46 98 L60 95 L74 98 Q90 102 90 120 V150 Z"
        fill="var(--bg-3)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M30 124 Q22 128 20 144 L20 150 H32 M90 124 Q98 128 100 144 L100 150 H88"
        fill="var(--bg-3)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M52 98 L60 112 L68 98" fill="none" stroke="var(--line)" strokeWidth="1.5" />
      {/* 正方体头套：右侧面 + 顶面 + 正面 */}
      <path d="M92 28 L104 18 V74 L92 86 Z" fill="var(--bg-1)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M28 28 L40 18 H104 L92 28 Z" fill="var(--bg-2)" stroke="var(--line-strong)" strokeWidth="2" />
      <rect x="28" y="28" width="64" height="58" fill="var(--bg-2)" stroke="var(--ink)" strokeWidth="2.5" />
      {/* 角色色带 */}
      <rect x="28" y="30" width="64" height="5" fill={accent} />
      {role === 'landlord' && <path d="M52 18 L56 10 L60 16 L64 8 L68 16 L72 10 L76 18 Z" fill={accent} transform="translate(-4 0)" />}
      {/* 表情（以头套正面中心为原点） */}
      <g transform="translate(60 60)">{FACES[expression] ?? FACES.idle}</g>
    </svg>
  );
}

// ---------- 桌面 ----------
export function TableSurface() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 62" preserveAspectRatio="none" aria-label="赌桌">
      <defs>
        <linearGradient id="tbl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--bg-3)" />
          <stop offset="1" stopColor="var(--bg-1)" />
        </linearGradient>
      </defs>
      <rect x="0.6" y="0.6" width="98.8" height="60.8" rx="3" fill="url(#tbl)" stroke="var(--line-strong)" strokeWidth="0.7" />
      <rect x="3.4" y="3" width="93.2" height="56" rx="2" fill="none" stroke="var(--line)" strokeWidth="0.35" />
      <ellipse cx="50" cy="31" rx="20" ry="11" fill="none" stroke="var(--gold-dim)" strokeWidth="0.4" strokeDasharray="1.6 1.2" />
      <text x="50" y="33.4" textAnchor="middle" fontSize="5" fill="var(--gold-dim)" opacity="0.85">押 注 区</text>
    </svg>
  );
}

// ---------- 图标 ----------
const ICON_PATHS = {
  exit: 'M9 4 H5 a1 1 0 0 0 -1 1 v14 a1 1 0 0 0 1 1 h4 M15 8 l4 4 -4 4 M19 12 H9',
  copy: 'M8 8 h10 v12 H8 Z M6 16 H5 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1 h10 a1 1 0 0 1 1 1 v1',
  send: 'M3 12 L21 4 L15 21 L11.5 13.5 Z M11.5 13.5 L21 4',
  mic: 'M12 3 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -6 0 V6 a3 3 0 0 1 3 -3 Z M6 11 a6 6 0 0 0 12 0 M12 17 v4 M8 21 h8',
  lock: 'M7 11 V8 a5 5 0 0 1 10 0 v3 M5 11 h14 v9 H5 Z',
  refresh: 'M20 12 a8 8 0 1 1 -2.3 -5.6 M18 3 v4 h-4',
  users: 'M9 12 a3.5 3.5 0 1 0 0 -7 a3.5 3.5 0 0 0 0 7 Z M3 20 c0 -3.5 2.7 -5.5 6 -5.5 s6 2 6 5.5 M16 5.5 a3.5 3.5 0 0 1 0 6.8 M17.5 14.8 c2.2 0.7 3.5 2.4 3.5 5.2',
};

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name] ?? ''} />
    </svg>
  );
}
