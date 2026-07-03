// 美术注册表：业务组件一律通过 getArt(key) 取资产组件。
// 将来把某个 SVG 换成贴图/精灵图时，只需在这里换实现，业务代码零改动。

import { CoinFace, CubeAvatar, TableSurface, Icon } from './svg/index.jsx';
import { PixelMoneyNote } from './PixelMoneyNote';
// 角色身份图标(玩家自备素材,白色剪影 32²)：地主=城堡 / 资本家=礼帽 / 农民=草帽 / 投资人=眼镜 / 暴食者=厨师帽。
import landlordIcon from './ui/landlord_icon.png';
import capitalistIcon from './ui/capitalist_icon.png';
import farmerIcon from './ui/farmer_icon.png';
import investorIcon from './ui/invester_icon.png';
import gluttonIcon from './ui/glutton.png';

const registry = {
  moneyNote: PixelMoneyNote, // {value, faceDown, locked, debt, width} —— 与 3D 桌面钞票同源
  coin: CoinFace,           // {face: 'heads'|'tails', size}
  avatar: CubeAvatar,       // {expression, role, width}
  tableSurface: TableSurface,
  icon: Icon,               // {name, size}
};

export function getArt(key) {
  const component = registry[key];
  if (!component) throw new Error(`未注册的美术资产: ${key}`);
  return component;
}

// 角色 → 身份图标 URL（单一 swap 点；未选/未知角色为 undefined，调用方回退到文字）。
// 组件 RoleIcon 单独在 RoleIcon.jsx（保持本文件只导出函数/数据，不触发 fast-refresh 警告）。
export const ROLE_ICON = {
  landlord: landlordIcon,
  capitalist: capitalistIcon,
  farmer: farmerIcon,
  investor: investorIcon,
  glutton: gluttonIcon,
};
