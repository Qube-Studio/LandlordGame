// 角色身份图标组件：白色剪影 32² 素材（地主=城堡 / 资本家=礼帽 / 农民=草帽 / 投资人=眼镜 / 暴食者=厨师帽）。
// 数据源单一 swap 点在 registry.jsx#ROLE_ICON；未选/未知角色返回 null，调用方回退到文字。
import { ROLE_ICON } from './registry';

export function RoleIcon({ role, size = 15, className = '', title }) {
  const src = ROLE_ICON[role];
  if (!src) return null;
  return (
    <img
      className={`role-icon ${className}`}
      src={src}
      width={size}
      height={size}
      alt={title ?? role}
      title={title}
      draggable={false}
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  );
}

export default RoleIcon;
