// /admin/finance/pnl — Profit & Loss, tree-formatted (Revenue/Expenses roots →
// category → leaf account, one amount column per level), modelled on ../ihms's
// own P&L report layout. Period picker: 3 period-TYPE buttons (Month/Quarter/AU
// Financial Year) each with its own Last/Next navigation — switching type resets
// to "this" period of that type; Last/Next shifts by one unit of the SAME type
// (owner's 2026-09-05 ask). GST toggle is a display-only choice — same journal,
// FinanceService just backs GST out of the GST-bearing leaves when 'exclusive'.
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
// NEVER d.toISOString().slice(0,10) here — that converts to UTC, but every
// Date below is built in LOCAL time (new Date(y, m, day)). For any timezone
// ahead of UTC (all of Australia), that silently shifts every boundary back
// one calendar day (1 Sep local midnight -> 31 Aug UTC). Format from the
// LOCAL getters instead, so the string matches the calendar day intended.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// AU financial year: 1 Jul – 30 Jun. `fyStartYear` is the calendar year Jul 1 falls in.
function fyStartYear(d) { return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; }

// One unit (month/quarter/FY) shifted by `offset` units from "this" period, per type.
function periodFor(type, offset) {
  const now = new Date();
  if (type === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { from: iso(d), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }
  if (type === 'quarter') {
    const totalQ = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) + offset;
    const y = Math.floor(totalQ / 4), q = totalQ % 4;
    return { from: iso(new Date(y, q * 3, 1)), to: iso(new Date(y, q * 3 + 3, 0)) };
  }
  // 'fy'
  const y = fyStartYear(now) + offset;
  return { from: iso(new Date(y, 6, 1)), to: iso(new Date(y + 1, 5, 30)) };
}

const TYPES = [
  { k: 'month',   label: 'This Month',          nav: 'month' },
  { k: 'quarter', label: 'This Quarter',         nav: 'Quarter' },
  { k: 'fy',      label: 'This Financial Year',  nav: 'Financial Year' },
];

const chip = { padding: '5px 12px', borderRadius: 999, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 13, cursor: 'pointer' };
const chipOn = { ...chip, background: 'var(--brand)', color: '#fff', borderColor: 'var(--brand)' };
const navBtn = { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 13, cursor: 'pointer' };

export default function AdminFinancePnl() {
  const [periodType, setPeriodType] = useState('month');
  const [offset, setOffset] = useState(0);
  const [gstMode, setGstMode] = useState('inclusive');

  const { from, to } = useMemo(() => periodFor(periodType, offset), [periodType, offset]);

  function selectType(k) { setPeriodType(k); setOffset(0); }

  const { data, loading, error } = usePortalData(
    () => adminApi.finance.pnl({ from, to, gst_mode: gstMode }), [from, to, gstMode]
  );
  const d = data?.data;
  const tree = d?.tree ?? [];
  const revenueTotal = tree.find((n) => n.accType === 'revenue')?.total ?? 0;
  const expenseTotal = tree.find((n) => n.accType === 'expense')?.total ?? 0;
  const gst = d?.gst;
  const activeType = TYPES.find((t) => t.k === periodType);

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Profit &amp; Loss</h1>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 20 }}>
        Computed live from the Finance ledger — every posted expense, payroll run and subscription payment.
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <button key={t.k} style={periodType === t.k ? chipOn : chip} onClick={() => selectType(t.k)}>{t.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <button style={navBtn} onClick={() => setOffset((o) => o - 1)}>◀ Last {activeType.nav}</button>
        <div style={{ fontSize: 13, color: 'var(--dim)', minWidth: 200, textAlign: 'center' }}>
          Period: {d ? `${fmtDate(d.from)} – ${fmtDate(d.to)}` : `${fmtDate(from)} – ${fmtDate(to)}`}
        </div>
        <button style={navBtn} onClick={() => setOffset((o) => o + 1)}>Next {activeType.nav} ▶</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Total revenue" value={money(revenueTotal)} color="var(--green)" />
        <PortalKpi label="Total expenses" value={money(expenseTotal)} color="var(--red)" />
        <PortalKpi label="Net profit" value={money(d?.netProfit)} color={(d?.netProfit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Chart of accounts</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={gstMode === 'inclusive' ? chipOn : chip} onClick={() => setGstMode('inclusive')}>GST Inclusive</button>
          <button style={gstMode === 'exclusive' ? chipOn : chip} onClick={() => setGstMode('exclusive')}>GST Exclusive</button>
        </div>
      </div>
      <PortalCard>
        {loading ? <PortalEmpty message="Loading…" />
          : tree.length === 0 ? <PortalEmpty message="No activity posted for this period" />
          : <PortalAccountTree roots={tree} summaryLabel="Net Profit" summaryValue={d.netProfit} depthColumns />}
      </PortalCard>

      {gst && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>GST &amp; PAYG (this period)</div>
          <PortalCard>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, fontSize: 13 }}>
              <div style={{ color: 'var(--dim)' }}>GST must pay (collected on subscription revenue)</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--fm)' }}>{money(gst.collected)}</div>
              <div style={{ color: 'var(--dim)' }}>GST from purchase (input tax credit)</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--fm)' }}>{money(gst.paid)}</div>
              <div style={{ borderTop: '1px solid var(--b2)', paddingTop: 6, fontWeight: 600 }}>Net GST payable</div>
              <div style={{ borderTop: '1px solid var(--b2)', paddingTop: 6, textAlign: 'right', fontFamily: 'var(--fm)', fontWeight: 600 }}>
                {money(gst.netPayable)}
              </div>
              <div style={{ color: 'var(--dim)' }}>Tax withholding in PAYG</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--fm)' }}>{money(gst.paygWithheld)}</div>
              <div style={{ borderTop: '2px solid var(--b1)', paddingTop: 8, fontWeight: 700, color: 'var(--brand)' }}>
                Total payable to ATO (BAS)
              </div>
              <div style={{ borderTop: '2px solid var(--b1)', paddingTop: 8, textAlign: 'right', fontFamily: 'var(--fm)', fontWeight: 700, color: 'var(--brand)' }}>
                {money(gst.totalBasPayable)}
              </div>
            </div>
          </PortalCard>
        </div>
      )}
    </div>
  );
}
