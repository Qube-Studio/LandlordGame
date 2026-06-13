// 美术注册表：业务组件一律通过 getArt(key) 取资产组件。
// 将来把某个 SVG 换成贴图/精灵图时，只需在这里换实现，业务代码零改动。

import { MoneyNote, CoinFace, CubeAvatar, TableSurface, Icon } from './svg/index.jsx';

const registry = {
  moneyNote: MoneyNote,     // {value, faceDown, locked, debt, width}
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
