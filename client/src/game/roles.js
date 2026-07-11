// 角色/阵营（表现层共享）。与服务端 config.js#factionOf 对应（§8）。
// 地主阵营 = {landlord, capitalist}，农民阵营 = {farmer, investor, glutton, prosecutor}。
// 全部角色文案（名称/单字章/一句话说明/角色手册）已集中到 text/zh.js 的 roles 段——
// 改文案去那里；本文件只保留阵营逻辑并原样再导出，几十个引用点不用动。
import { T } from '../text';

export const ROLE_LABEL = T.roles.label;
export const ROLE_GLYPH = T.roles.glyph;
export const ROLE_DESC = T.roles.desc;
export const ROLE_SHEET = T.roles.sheet;

const FACTION = { landlord: 'landlord', capitalist: 'landlord', farmer: 'farmer', investor: 'farmer', glutton: 'farmer', prosecutor: 'farmer' };
export const factionOf = (role) => FACTION[role] ?? null;
export const isLandlordSide = (role) => factionOf(role) === 'landlord';
export const isFarmerSide = (role) => factionOf(role) === 'farmer';

// 竞技模式的两侧可选角色（LOBBY 选角用）。
export const LANDLORD_SIDE_ROLES = ['landlord', 'capitalist'];
export const FARMER_SIDE_ROLES = ['farmer', 'investor', 'glutton', 'prosecutor'];

// 对质票（§8.8，与服务端 config.competitive.accusation 对应）：每角色**按局**发放，农民阵营专属。
// 猜对敌方暗注「比阵营总注多/少」→ 强制敌方立刻多结算一次制约（地主目标 / 资本家税）。
export const ACCUSE_TICKETS = { farmer: 3, investor: 2, glutton: 0, prosecutor: 4 };
export const ACCUSE_COST = 2;
