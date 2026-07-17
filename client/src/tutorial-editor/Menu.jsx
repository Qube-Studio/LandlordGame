// 右键菜单（§1.2）：视图态存 store.menu = {x, y, items}，items 由打开方现造（闭包捎带目标 uid），
// 本组件只管渲染/贴边收纳/关闭时机。关闭：点菜单项、菜单外 mousedown、Esc（全局 Esc 链最高优先）、
// 窗口滚动/缩放/失焦（菜单是贴在坐标上的，页面一动位置就失效）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTedStore } from './store';

export default function ContextMenu() {
  const menu = useTedStore((s) => s.menu);
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // 贴边收纳：先按点击坐标渲染（不可见阶段），量完尺寸再夹进视口——useLayoutEffect 赶在绘制前，无闪跳
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => useTedStore.getState().closeMenu();
    const onDown = (e) => { if (!ref.current?.contains(e.target)) close(); };
    window.addEventListener('mousedown', onDown, true); // 捕获阶段：先于目标自身的点击逻辑判定「点在菜单外」
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div className="ted-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((it, i) => (it.sep
        ? <div key={i} className="ted-menu-sep" />
        : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ted-menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { useTedStore.getState().closeMenu(); it.onClick?.(); }}
          >
            <span>{it.label}</span>
            {it.hint ? <span className="ted-menu-hint">{it.hint}</span> : null}
          </button>
        )))}
    </div>
  );
}
