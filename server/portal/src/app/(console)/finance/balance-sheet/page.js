// /finance/balance-sheet — Assets/Liabilities/Equity as of a date
// (xprojman-42 §3, `GET /finance/reports/balance-sheet`). Retained Earnings
// (a top-level equity root in the seeded template, not nested under Owner's
// Equity — see OrgFinanceService.balanceSheet's own comment) is a plugged
// figure, cumulative net P&L to date — not a separate posted account.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { AccountTreeTable } from '@/components/portal/AccountTreeTable';
import { usePortalData } from '@/components/portal/usePortalData';
import { financeApi } from '@/lib/api';

const money = (v) => (v == null ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }));

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState('');
  const { data, loading, error } = usePortalData(() => financeApi.balanceSheet(asOf || undefined), [asOf]);
  const report = data?.data;

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 22, color: 'var(--text)', margin: 0 }}>Balance Sheet</h1>
        <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 4 }}>
          Assets, liabilities, and equity as of a date, from the org&rsquo;s posted journal.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>As of</label>
          <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        {asOf && <button type="button" className="btn" onClick={() => setAsOf('')}>Today</button>}
      </div>

      {loading ? <PortalEmpty message="Loading…" /> : error ? <PortalError message={error} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="As of" value={report.asOf} color="var(--text)" />
            <PortalKpi label="Assets" value={money(report.totals.asset)} color="var(--brand)" />
            <PortalKpi label="Liabilities" value={money(report.totals.liability)} color="var(--amber)" />
            <PortalKpi label="Equity" value={money(report.totals.equity)} color="var(--dim)" />
            <PortalKpi label="Balanced" value={report.balanced ? 'Yes' : 'No'} color={report.balanced ? 'var(--green)' : 'var(--red)'} />
          </div>
          <PortalCard title="By account">
            <AccountTreeTable roots={report.tree} emptyMessage="No asset, liability, or equity accounts posted yet." />
          </PortalCard>
        </>
      )}
    </div>
  );
}
