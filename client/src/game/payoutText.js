// 结算调整步（§3.8 adjust.source）→ 桌面浮动标签文案（文案在 text/zh.js payoutSteps 段）。
// 未收录的新机制回落到服务端下发的 label——服务端加新 adjust 步无需改客户端也有可读文案。
import { T } from '../text';

export const PAYOUT_LABEL = T.payoutSteps;

export const labelForStep = (step) => PAYOUT_LABEL[step.source] ?? step.label ?? step.source ?? '';
