// 文案访问入口（i18n 预备）：全部玩家可见文案都从这里取。
// 现在只有中文包 zh.js；未来做本地化时在这里按 locale 切换语言包即可，业务代码不动。
// 用法：import { T } from '../text'; → T.challenge.skip / T.summon.button(cost)
import zh from './zh.js';

export const T = zh;
