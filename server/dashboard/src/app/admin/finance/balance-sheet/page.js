// /admin/finance/balance-sheet — Assets = Liabilities + Equity, as of a date,
// tree-formatted (same PortalAccountTree as the P&L). Computed live from
// fin_journal (FinanceService.balanceSheet) — retained earnings is not a posted
// account, it's all-time net profit not yet formally transferred, the plug that
// makes the sheet balance.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalAccountTree } from '@/components/portal/PortalAccountTree';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminFinanceBalanceSheet() {
  const [asOf, setAsOf] = useState(today());
  const { data, loading, error } = usePortalData(() => adminApi.finance.balanceSheet({ as_of: asOf }), [asOf]);
  const d = data?.data;
  const tree = d?.tree ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Balance Sheet</h1>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 20 }}>Account balances as of a date — computed live from the Finance ledger.</div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>As of<br />
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
      </div>

      {loading ? <PortalEmpty message="Loading…" /> : d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="Total assets" value={money(d.totals.asset)} color="var(--text)" />
            <PortalKpi label="Total liabilities" value={money(d.totals.liability)} color="var(--red)" />
            <PortalKpi label="Total equity" value={money(d.totals.equity)} color="var(--cyan)" sub={`incl. ${money(d.retainedEarnings)} retained earnings`} />
            <PortalKpi label="Balanced" value={d.balanced ? '✓ Yes' : '✗ No'} color={d.balanced ? 'var(--green)' : 'var(--red)'} />
          </div>

          <PortalCard title="Chart of accounts">
            {tree.length === 0 ? <PortalEmpty message="No accounts" /> : <PortalAccountTree roots={tree} />}
          </PortalCard>
        </>
      )}
    </div>
  );
}
