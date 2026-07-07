// 富文本微标记（纯函数，表现层共享）：把 **…** 标记拆成 {t, hi} 文本段。
// 高亮段由使用方渲染成金黄（角色手册 RoleWall、规则面板 RulesPanel 共用）。
export function parseRuns(str) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ t: str.slice(last, m.index), hi: false });
    out.push({ t: m[1], hi: true });
    last = re.lastIndex;
  }
  if (last < str.length) out.push({ t: str.slice(last), hi: false });
  return out;
}
