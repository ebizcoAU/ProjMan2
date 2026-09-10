// /finance/pnl — Profit & Loss (xprojman-42 §3, `GET /finance/reports/pnl`).
// Revenue/Expense roots for one period, server-defaulted to the current
// month when no from/to is picked. Sales posting is a known, flagged gap
// (no PM-bills-client write path exists yet — xprojman-42 §10) — an
// org with real expenses but zero recorded revenue is expected, not a bug.
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

export default function ProfitAndLossPage() {
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error } = usePortalData(
    () => financeApi.pnl(range.from || undefined, range.to || undefined),
    [range.from, range.to]
  );
  const report = data?.data;

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 22, color: 'var(--text)', margin: 0 }}>Profit &amp; Loss</h1>
        <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 4 }}>
          Revenue and expenses for a period, from the org&rsquo;s posted journal.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>From</label>
          <input className="input" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>To</label>
          <input className="input" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        {(range.from || range.to) && (
          <button type="button" className="btn" onClick={() => setRange({ from: '', to: '' })}>This month</button>
        )}
      </div>

      {loading ? <PortalEmpty message="Loading…" /> : error ? <PortalError message={error} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="Period" value={`${report.from} → ${report.to}`} color="var(--text)" />
            <PortalKpi label="Revenue" value={money(report.tree.find((n) => n.accType === 'revenue')?.total)} color="var(--green)" />
            <PortalKpi label="Expenses" value={money(report.tree.find((n) => n.accType === 'expense')?.total)} color="var(--red)" />
            <PortalKpi label="Net profit" value={money(report.netProfit)} color={report.netProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>
          <PortalCard title="By account">
            <AccountTreeTable roots={report.tree} emptyMessage="No revenue or expense accounts posted in this period." />
          </PortalCard>
        </>
      )}
    </div>
  );
}
