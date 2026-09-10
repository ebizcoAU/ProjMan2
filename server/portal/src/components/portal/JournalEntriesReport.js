// JournalEntriesReport.js — shared body for /finance/expenses and
// /finance/sales (xprojman-42 §3, `GET /finance/reports/{expenses,sales}`):
// same flat, leaf-level journal-entry listing, differing only in accType,
// title/description, and which side of the entry to read as `amount`
// (already resolved server-side, OrgFinanceService.listEntries).
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { usePortalData } from '@/components/portal/usePortalData';

const money = (v) => (v == null ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }));
const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '7px 12px', color: 'var(--text)', fontSize: 13 };
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--fm)' };

export function JournalEntriesReport({ title, description, color, fetchFn, emptyMessage }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error } = usePortalData(
    () => fetchFn(range.from || undefined, range.to || undefined),
    [range.from, range.to]
  );
  const report = data?.data;
  const entries = report?.entries || [];
  const total = entries.reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 22, color: 'var(--text)', margin: 0 }}>{title}</h1>
        <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 4 }}>{description}</div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="Period" value={`${report.from} → ${report.to}`} color="var(--text)" />
            <PortalKpi label="Total" value={money(total)} color={color} />
            <PortalKpi label="Entries" value={entries.length} color="var(--text)" />
          </div>
          <PortalCard title="Transactions">
            {entries.length === 0 ? <PortalEmpty message={emptyMessage} /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                      <th style={th}>Date</th>
                      <th style={th}>Account</th>
                      <th style={th}>Project</th>
                      <th style={th}>Memo</th>
                      <th style={thR}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={e.id} style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                        <td style={{ ...td, color: 'var(--muted)' }}>{e.entry_date}</td>
                        <td style={td}>{e.account_name}</td>
                        <td style={{ ...td, color: 'var(--muted)' }}>{e.project_name || '—'}</td>
                        <td style={{ ...td, color: 'var(--muted)' }}>{e.memo || '—'}</td>
                        <td style={tdR}>{money(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PortalCard>
        </>
      )}
    </div>
  );
}
