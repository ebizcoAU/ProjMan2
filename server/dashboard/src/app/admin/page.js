// /admin — Overview: platform KPIs, breakdowns, recent logins (dashboardspec §9).
// Account & billing layer only — no project/construction data.
'use client';

import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalHourlyChart } from '@/components/portal/PortalHourlyChart';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

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

  // Only fetched once we know the role, and only for a role that can reach it — an
  // 'account'/'staff' session must never even attempt the other's 403'd endpoint
  // (matches routes/admin.js's requireAdminRole lists, §2/§3 addendum).
  const rev = usePortalData(() => (seesMoney ? adminApi.billing.revenue() : Promise.resolve(null)), [seesMoney]);
  const activity = usePortalData(() => adminApi.activity({ hours: 24 }));

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

          <PortalCard title="Traffic — sessions started per hour (last 24h)">
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 10 }}>
              ProjMan2 has no MQTT broker or other push layer — dropped from Nexus on
              purpose. App, Portal, Dashboard and VeriTrade all stay current by polling;
              this chart is the honest &ldquo;how busy is the platform&rdquo; signal in
              that world, not a broker connection count.
            </div>
            {activity.error ? <PortalError message={activity.error} />
              : activity.data?.data?.series?.length
                ? <PortalHourlyChart series={activity.data.data.series} color="var(--brand)" />
                : <PortalEmpty message="Loading…" />}
          </PortalCard>
        </>
      )}
    </div>
  );
}
