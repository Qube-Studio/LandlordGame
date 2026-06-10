import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

export default function BankPanel() {
  const state = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const pendingLoans = useGameStore(s => s.pendingLoanRequests);
  const send = useGameStore(s => s.send);
  const [loanAmount, setLoanAmount] = useState('');
  const [repayRounds, setRepayRounds] = useState('3');

  if (!state) return null;
  const { players, loans, config, phase } = state;
  const myPlayer = players.find(p => p.id === playerId);
  const isBank = myPlayer?.role === 'bank';
  const isActive = !myPlayer?.bankrupt && ['landlord', 'farmer'].includes(myPlayer?.role);
  const isLoanBanned = myPlayer?.loanBanned;

  if (phase === 'LOBBY' || phase === 'ENDED') return null;

  const myLoans = loans?.filter(l => l.borrowerId === playerId && !l.forgiven) ?? [];

  const requestLoan = () => {
    const amount = Number(loanAmount);
    const rounds = Number(repayRounds);
    if (amount <= 0 || rounds <= 0) return;
    send({ type: 'request_loan', amount, repayRounds: rounds });
    setLoanAmount('');
  };

  const fileComplaint = (loanRequestId) => {
    send({ type: 'file_complaint', loanRequestId });
  };

  return (
    <div className="bank-panel">
      <h3>银行系统</h3>

      {/* Active player: request loan */}
      {isActive && !isLoanBanned && (
        <div className="loan-request">
          <h4>申请贷款 (利息 {(config.interestRate * 100).toFixed(0)}%/回合)</h4>
          <div className="loan-row">
            <input type="number" className="input small" placeholder="金额" value={loanAmount}
              onChange={e => setLoanAmount(e.target.value)} min="1" />
            <input type="number" className="input small" placeholder="还款回合" value={repayRounds}
              onChange={e => setRepayRounds(e.target.value)} min="1" max="20" />
            <button className="btn" onClick={requestLoan}>申请</button>
          </div>
          {pendingLoans.filter(l => l.borrowerId === playerId).map(l => (
            <div key={l.id} className="pending-loan">
              ⏳ 申请中: ¥{l.amount} / {l.repayRounds}回合
              <button className="btn small warn" onClick={() => fileComplaint(l.id)}>
                投诉 (¥{config.complaintFee})
              </button>
            </div>
          ))}
        </div>
      )}
      {isLoanBanned && <div className="warn-box">⚠️ 债务已被免除，无法再借款</div>}

      {/* My current loans */}
      {myLoans.length > 0 && (
        <div className="my-loans">
          <h4>我的贷款</h4>
          {myLoans.map(l => (
            <div key={l.id} className="loan-item">
              本金 ¥{l.principal} · 欠款 ¥{l.totalOwed?.toFixed(1)} · 剩余 {l.remainingRounds} 回合
            </div>
          ))}
        </div>
      )}

      {/* Bank player: approve pending loans */}
      {isBank && (
        <div className="bank-approve">
          <h4>待审批贷款</h4>
          {pendingLoans.length === 0 && <span className="muted">暂无申请</span>}
          {pendingLoans.map(l => {
            const borrower = players.find(p => p.id === l.borrowerId);
            return (
              <div key={l.id} className="loan-item">
                <span>{borrower?.name ?? l.borrowerId} 申请 ¥{l.amount} / {l.repayRounds}回合</span>
                <button className="btn small ok" onClick={() =>
                  send({ type: 'approve_loan', borrowerId: l.borrowerId, amount: l.amount, repayRounds: l.repayRounds })}>
                  批准
                </button>
              </div>
            );
          })}

          <h4>活跃贷款</h4>
          {(loans ?? []).filter(l => !l.forgiven).map(l => {
            const borrower = players.find(p => p.id === l.borrowerId);
            return (
              <div key={l.id} className="loan-item">
                <span>{borrower?.name} · 欠 ¥{l.totalOwed?.toFixed(1)} · {l.remainingRounds}回合</span>
                <button className="btn small warn" onClick={() => send({ type: 'forgive_loan', loanId: l.id })}>
                  免债
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
