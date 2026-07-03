// 酒馆账本（HUD 2.0，新功能）：逐轮历史记录查询，从桌沿抽屉升起。
// 数据 = 服务端 viewFor 下发的 history（已按隐私过滤：他人 balancesAfter 仅观战/终局可见，
// 资金池字段仅资本家本人可见）——客户端只排版，不做任何规则计算。
// 交互：一行一轮（最新在上），点击摊开该轮明细；打开抽屉时默认摊开最新一轮。
import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import PixelText from '../assets/pixelfont/PixelText';
import { coinFaceTexture } from '../scene/textures';
import { EVENT_TEXT } from '../game/settleText';
import { P, shade } from '../assets/palette';

// 硬币面小图标：直接取 3D 硬币的同一张画布（单一真源），只算一次。
let COIN_URLS = null;
function coinUrls() {
  if (!COIN_URLS) {
    COIN_URLS = {
      heads: coinFaceTexture('heads').image.toDataURL(),
      tails: coinFaceTexture('tails').image.toDataURL(),
    };
  }
  return COIN_URLS;
}

const OK_INK = shade(P.ok, -30); // 羊皮纸上的深绿（与 WageHud 同法）

function Row({ h, players, myId, open, onToggle, showBalances }) {
  const nameOf = (id) => players.find(p => p.id === id)?.name ?? '?';
  const my = h.deltas?.[myId];
  const heads = h.coinResult === 'heads';
  return (
    <div className={`ledger-entry ${open ? 'open' : ''}`}>
      <button className="ledger-row" onClick={onToggle}>
        <span className="ledger-round"><PixelText size={2} color="var(--c-wood-900)">{`R${h.round}`}</PixelText></span>
        <img className="ledger-coin" src={coinUrls()[heads ? 'heads' : 'tails']} alt="" draggable={false} />
        <span className="ledger-side"><PixelText size={2} color={heads ? 'var(--c-wood-900)' : OK_INK}>{heads ? '地主胜' : '农民胜'}</PixelText></span>
        <span className="ledger-pot"><PixelText size={2} color="var(--c-parch-ink)">{`彩池 ¥${h.pot ?? 0}`}</PixelText></span>
        <span className="ledger-my">
          {my != null && <PixelText size={2} color={my >= 0 ? OK_INK : 'var(--c-wax)'}>{`我 ${my >= 0 ? `+${my}` : my}`}</PixelText>}
        </span>
        <span className="ledger-tags">
          {h.landlordPenalty > 0 && <span className="ledger-tag danger">罚</span>}
          {h.newlyBankrupt?.length > 0 && <span className="ledger-tag danger">破产</span>}
        </span>
      </button>
      {open && (
        <div className="ledger-detail">
          {(h.events ?? []).map((e, i) => <p key={i} className="ledger-line">{EVENT_TEXT[e.type]?.(e) ?? ''}</p>)}
          {h.bets && Object.keys(h.bets).length > 0 && (
            <div className="settle-detail">
              {Object.entries(h.bets).map(([id, b]) => <span key={id}>{nameOf(id)} 押 <b className="gold">{b}</b></span>)}
            </div>
          )}
          {h.deltas && (
            <div className="settle-detail">
              {Object.entries(h.deltas).map(([id, d]) => <span key={id} className={d >= 0 ? 'ok' : 'danger'}>{nameOf(id)} {d >= 0 ? `+${d}` : d}</span>)}
            </div>
          )}
          {h.landlordGoalValue != null && (h.landlordPenalty > 0
            ? <p className="ledger-line danger">地主未达目标 ¥{h.landlordGoalValue}，罚 ¥{h.landlordPenalty} 平分给农民</p>
            : <p className="ledger-line ok">地主达成目标 ¥{h.landlordGoalValue}</p>)}
          {h.debtWaiver > 0 && <p className="ledger-line ok">投资人担保免除了 ¥{h.debtWaiver} 债务</p>}
          {h.wagePaid && Object.keys(h.wagePaid).length > 0 && (
            <p className="ledger-line ok">发工资：{Object.entries(h.wagePaid).map(([id, v]) => `${nameOf(id)} +${v}`).join('、')}</p>
          )}
          {h.allowanceCharged && Object.keys(h.allowanceCharged).length > 0 && (
            <p className="ledger-line danger">扣饭账：{Object.entries(h.allowanceCharged).map(([id, v]) => `${nameOf(id)} −${v}`).join('、')}</p>
          )}
          {h.uncovered > 0 && <p className="ledger-line dim">仍有 ¥{h.uncovered} 缺口无人能补</p>}
          {h.newlyBankrupt?.length > 0 && <p className="ledger-line danger">{h.newlyBankrupt.map(nameOf).join('、')} 破产了</p>}
          {showBalances && h.balancesAfter && (
            <div className="settle-detail">
              {Object.entries(h.balancesAfter).map(([id, b]) => <span key={id}>{nameOf(id)}：¥{b}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LedgerBook() {
  const state = useGameStore(s => s.state);
  const playerId = useGameStore(s => s.playerId);
  const setPanel = useGameStore(s => s.setPanel);
  const history = state.history ?? [];
  // 打开抽屉时默认摊开最新一轮（抽屉关闭即卸载，重开会重新对准最新）。
  const [openRound, setOpenRound] = useState(history.length ? history[history.length - 1].round : null);
  const rows = [...history].reverse(); // 最新在上（轮数有限，无需缓存）
  const showBalances = !!(state.me?.spectator || state.phase === 'ENDED');
  return (
    <div className="drawer ledger">
      <div className="drawer-title">
        <PixelText size={2} color="var(--c-wood-900)">{`酒馆账本 · 已记 ${history.length} 轮`}</PixelText>
        <div className="drawer-title-right">
          {!showBalances && history.length > 0 && (
            <span className="drawer-hint"><PixelText size={2} color="var(--c-wood-900)">他人余额保密</PixelText></span>
          )}
          <button className="drawer-x" onClick={() => setPanel(null)} title="收起 (L / Esc)">✕</button>
        </div>
      </div>
      <div className="drawer-body ledger-body">
        {rows.length === 0
          ? <div className="ledger-empty"><PixelText size={2} color="var(--c-parch-ink)">还没有账——第一轮结算后,这里会记下每一笔。</PixelText></div>
          : rows.map(h => (
            <Row
              key={h.round} h={h} players={state.players} myId={playerId}
              open={openRound === h.round}
              onToggle={() => setOpenRound(openRound === h.round ? null : h.round)}
              showBalances={showBalances}
            />
          ))}
      </div>
    </div>
  );
}
