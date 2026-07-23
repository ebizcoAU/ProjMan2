// /admin/logs — the login transaction log (dashboardspec §6): filters + CSV export.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi, getToken } from '@/lib/api';

const fmtWhen = (v) => v ? new Date(v).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function AdminLogs() {
  const [f, setF] = useState({ email: '', outcome: '', method: '', from: '', to: '', page: 1 });
  const { data, loading, error } = usePortalData(
    () => adminApi.loginLog({ ...f, limit: 50 }), [f.email, f.outcome, f.method, f.from, f.to, f.page]);

  const entries = data?.data?.entries ?? [];
  const pg = data?.data?.pagination;
  const set = (k, v) => setF(s => ({ ...s, [k]: v, page: 1 }));

  const exportCsv = () => {
    const params = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== 'page'));
    // Same-origin download with the bearer token via a fetch → blob (header can't ride a plain link).
    fetch(`/api/v1/admin/logs/login/export?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.blob()).then(b => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = url; a.download = 'login-log.csv'; a.click();
        URL.revokeObjectURL(url);
      });
  };

  const input = { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 };

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Login Transaction Log</h1>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <PortalCard title="Authentication events (all organisations)">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="email…" value={f.email} onChange={e => set('email', e.target.value)} style={{ ...input, width: 180 }} />
          <select value={f.outcome} onChange={e => set('outcome', e.target.value)} style={input}>
            <option value="">Any outcome</option><option value="success">Success</option><option value="failed">Failed</option>
          </select>
          <select value={f.method} onChange={e => set('method', e.target.value)} style={input}>
            <option value="">Any method</option>{['email', 'google', 'microsoft', 'facebook'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>from</label>
          <input type="date" value={f.from} onChange={e => set('from', e.target.value)} style={input} />
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>to</label>
          <input type="date" value={f.to} onChange={e => set('to', e.target.value)} style={input} />
          <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={exportCsv}>Export CSV</button>
        </div>

        {loading ? <PortalEmpty message="Loading…" />
          : entries.length === 0 ? <PortalEmpty message="No events match" />
          : (
          <>
            <PortalTable
              headers={['When', 'User', 'Org', 'Method', 'Outcome', 'IP', 'Location', 'Device']}
              rows={entries.map(e => [
                <span key="w" style={{ fontFamily: 'var(--fm)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWhen(e.at)}</span>,
                e.email || '—',
                e.organisation || '—',
                e.method,
                <span key="o" className={`badge ${e.outcome === 'failed' ? 'badge-revoked' : 'badge-active'}`}>{e.outcome}</span>,
                <span key="i" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{e.ip || '—'}</span>,
                e.location?.city ? `${e.location.city}, ${e.location.country}` : (e.location?.country || '—'),
                e.device || e.os || '—',
              ])}
            />
            {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="events" onPage={p => setF(s => ({ ...s, page: p }))} />}
          </>
        )}
      </PortalCard>
    </div>
  );
}
