// /admin/finance/pnl — Profit & Loss, tree-formatted (Revenue/Expenses roots →
// category → leaf account, rolled-up subtotal at every level), modelled on
// ../ihms's own P&L report layout. One period per view, same as ihms's own
// `/getAcc/:fromdt/:todt` — a quick preset picker resolves to a from/to range.
'use client';

import { useState, useMemo } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalAccountTree } from '@/components/portal/PortalAccountTree';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const iso = (d) => d.toISOString().slice(0, 10);

function periodRange(preset) {
  const now = new Date();
  if (preset === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  if (preset === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    return { from: iso(new Date(now.getFullYear(), q * 3, 1)), to: iso(now) };
  }
  if (preset === 'year') {
    return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  }
  return null; // custom — caller supplies from/to directly
}

const PRESETS = [
  { k: 'month', label: 'This Month' },
  { k: 'quarter', label: 'This Quarter' },
  { k: 'year', label: 'This Year' },
  { k: 'custom', label: 'Custom' },
];

export default function AdminFinancePnl() {
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customTo, setCustomTo] = useState(iso(new Date()));

  const { from, to } = useMemo(() => (preset === 'custom' ? { from: customFrom, to: customTo } : periodRange(preset)), [preset, customFrom, customTo]);

  const { data, loading, error } = usePortalData(() => adminApi.finance.pnl({ from, to }), [from, to]);
  const d = data?.data;
  const tree = d?.tree ?? [];
  const revenueTotal = tree.find((n) => n.accType === 'revenue')?.total ?? 0;
  const expenseTotal = tree.find((n) => n.accType === 'expense')?.total ?? 0;

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Profit &amp; Loss</h1>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 20 }}>
        Computed live from the Finance ledger — every posted expense, payroll run and subscription payment.
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESETS.map((p) => (
          <button key={p.k} className={`chip${preset === p.k ? ' on' : ''}`} onClick={() => setPreset(p.k)}>{p.label}</button>
        ))}
        {preset === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 13 }} />
            <span style={{ color: 'var(--dim)' }}>to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 13 }} />
          </>
        )}
      </div>
      {d && <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16 }}>Period: {fmtDate(d.from)} – {fmtDate(d.to)}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Total revenue" value={money(revenueTotal)} color="var(--green)" />
        <PortalKpi label="Total expenses" value={money(expenseTotal)} color="var(--red)" />
        <PortalKpi label="Net profit" value={money(d?.netProfit)} color={(d?.netProfit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      <PortalCard title="Chart of accounts">
        {loading ? <PortalEmpty message="Loading…" />
          : tree.length === 0 ? <PortalEmpty message="No activity posted for this period" />
          : <PortalAccountTree roots={tree} summaryLabel="Net Profit" summaryValue={d.netProfit} />}
      </PortalCard>
    </div>
  );
}
