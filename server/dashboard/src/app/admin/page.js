// /admin — Overview: platform KPIs, breakdowns, recent logins (dashboardspec §9).
// Account & billing layer only — no project/construction data.
'use client';

import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtWhen = (v) => v ? new Date(v).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function Bars({ data, keyField = 'role', color = 'var(--blue)' }) {
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map(d => (
        <div key={d[keyField]} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 130, fontSize: 13, color: 'var(--dim)', textAlign: 'right' }}>
            {String(d[keyField]).replace(/([A-Z])/g, ' $1')}
          </span>
          <div style={{ flex: 1, height: 18, background: 'var(--s3)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(d.count / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
          <span style={{ width: 40, fontFamily: 'var(--fm)', fontSize: 13, color: 'var(--text)' }}>{d.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminOverview() {
  const me = usePortalData(() => adminApi.me());
  const { data, loading, error } = usePortalData(() => adminApi.stats());

  const role = me.data?.data?.role;
  const seesMoney = role === 'admin' || role === 'account';
  const seesLoginLog = role === 'admin' || role === 'staff';

  // Only fetched once we know the role, and only for a role that can reach it — an
  // 'account'/'staff' session must never even attempt the other's 403'd endpoint
  // (matches routes/admin.js's requireAdminRole lists, §2/§3 addendum).
  const rev = usePortalData(() => (seesMoney ? adminApi.billing.revenue() : Promise.resolve(null)), [seesMoney]);
  const log = usePortalData(() => (seesLoginLog ? adminApi.loginLog({ limit: 12 }) : Promise.resolve(null)), [seesLoginLog]);

  const s = data?.data;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Platform Overview</h1>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 20 }}>Accounts, authentication and billing across all organisations.</div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      {loading ? <PortalEmpty message="Loading…" /> : s && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="Organisations" value={s.organisations.total} color="var(--text)" sub={`+${s.organisations.new30} in 30d`} />
            <PortalKpi label="User accounts" value={s.users.total} color="var(--text)" sub={`${s.users.active} active`} />
            <PortalKpi label="Active sessions" value={s.sessions.active} color="var(--green)" />
            <PortalKpi label="Active devices" value={s.devices.active} color="var(--cyan)" sub={`${s.devices.active24h} in 24h`} />
            {seesMoney && <PortalKpi label="MRR" value={money(rev.data?.data?.mrr)} color="var(--brand)" />}
            <PortalKpi label="Trials expiring 30d" value={s.organisations.trialsExpiring} color="var(--yellow)" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <PortalCard title="Accounts by role"><Bars data={s.users.byRole} keyField="role" color="var(--blue)" /></PortalCard>
            <PortalCard title="Logins by method (30d)">
              {s.logins30d.byMethod.length ? <Bars data={s.logins30d.byMethod} keyField="method" color="var(--teal)" />
                : <PortalEmpty message="No logins in the last 30 days" />}
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--dim)' }}>
                {s.logins30d.success} success · <span style={{ color: 'var(--red)' }}>{s.logins30d.failed} failed</span> (30d)
                {!s.geoEnabled && <span style={{ marginLeft: 8, opacity: .7 }}>· geolocation not configured</span>}
              </div>
            </PortalCard>
          </div>

          {seesLoginLog && (
            <PortalCard title="Recent authentication events">
              {log.data?.data?.entries?.length ? (
                <PortalTable
                  headers={['When', 'User', 'Org', 'Method', 'Outcome', 'IP', 'Location']}
                  rows={log.data.data.entries.map(e => [
                    <span key="w" style={{ fontFamily: 'var(--fm)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWhen(e.at)}</span>,
                    e.email || '—',
                    e.organisation || '—',
                    e.method,
                    <span key="o" className={`badge ${e.outcome === 'failed' ? 'badge-revoked' : 'badge-active'}`}>{e.outcome}</span>,
                    <span key="i" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{e.ip || '—'}</span>,
                    e.location?.city ? `${e.location.city}, ${e.location.country}` : (e.location?.country || '—'),
                  ])}
                />
              ) : <PortalEmpty message="No recent events" />}
            </PortalCard>
          )}
        </>
      )}
    </div>
  );
}
