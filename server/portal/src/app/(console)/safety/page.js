// /safety — cross-project Safety trend (xprojman-48 Phase 7, GET /safety/summary).
// safety.manage only; which projects it covers follows the server's projectScope
// (a Site Supervisor sees their own projects, a PM sees all of them).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi } from '@/lib/api';
import { safetyApi, KIND_LABEL } from '@/lib/safety';
import { SafetyMockBanner } from '@/components/portal/SafetyViews';

const KIND_COLOR = { hazard: 'var(--cyan)', near_miss: 'var(--brand)', incident: 'var(--red)' };
const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function SafetyTrendPage() {
  const perms = usePortalData(() => authApi.permissions());
  const canManage = (perms.data?.data?.permissions || []).includes('safety.manage');
  const projects = usePortalData(() => projectsApi.list());
  const projectList = projects.data?.data?.projects ?? [];
  const nameOf = (pid) => projectList.find((p) => p.id === pid)?.name || 'Project';

  const [range, setRange] = useState({ from: isoDaysAgo(180), to: isoDaysAgo(0), project_id: '' });
  const [data, setData] = useState(null);
  const [err, setErr]   = useState(null);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    setErr(null);
    safetyApi.summary({ ...range, bucket: 'month' })
      .then((res) => { if (live) setData(res?.data?.data || null); })
      .catch((e) => { if (live) setErr(e?.response?.data?.message || e.message); });
    return () => { live = false; };
  }, [canManage, range]);

  if (perms.loading && !perms.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (!canManage) return <div style={{ padding: 20 }}><PortalEmpty message="Safety reporting is for Project Managers and Site Supervisors." /></div>;

  const set = (k) => (e) => setRange((r) => ({ ...r, [k]: e.target.value }));
  const series = data?.series || [];
  const maxMonth = Math.max(1, ...series.map((s) => s.hazard + s.near_miss + s.incident));

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Safety</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        Hazards, near misses and incidents across your projects. Open a project&apos;s Safety tab to investigate and close them.
      </div>
      <SafetyMockBanner />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input className="input" type="date" value={range.from} onChange={set('from')} aria-label="From" />
        <span style={{ color: 'var(--dim)' }}>to</span>
        <input className="input" type="date" value={range.to} onChange={set('to')} aria-label="To" />
        <select className="input" value={range.project_id} onChange={set('project_id')} aria-label="Project">
          <option value="">All projects</option>
          {projectList.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>)}
        </select>
      </div>

      {err && <div style={{ marginBottom: 12 }}><PortalError message={err} /></div>}
      {!data ? <PortalEmpty message="Loading…" /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="Hazards" value={data.totals.by_kind.hazard} color={KIND_COLOR.hazard} />
            <PortalKpi label="Near misses" value={data.totals.by_kind.near_miss} color={KIND_COLOR.near_miss} />
            <PortalKpi label="Incidents" value={data.totals.by_kind.incident} color={KIND_COLOR.incident} />
            <PortalKpi label="Notifiable" value={data.notifiable_count} color="var(--red)" />
            <PortalKpi label="Still open" value={data.totals.by_status.open + data.totals.by_status.in_progress} color="var(--text)" />
            <PortalKpi label="Overdue actions" value={data.overdue_actions.length} color="var(--red)" />
          </div>

          <PortalCard title="By month">
            {series.length === 0 ? <PortalEmpty message="Nothing reported in this range." /> : (
              <div style={{ display: 'grid', gap: 6 }}>
                {series.map((s) => {
                  const total = s.hazard + s.near_miss + s.incident;
                  return (
                    <div key={s.period} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 70, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--fm)' }}>{s.period}</span>
                      <div style={{ flex: 1, display: 'flex', height: 14, background: 'var(--s2)', borderRadius: 3, overflow: 'hidden' }}
                        title={`${s.hazard} hazard · ${s.near_miss} near miss · ${s.incident} incident`}>
                        {['hazard', 'near_miss', 'incident'].map((k) => s[k] > 0 && (
                          <div key={k} style={{ width: `${(s[k] / maxMonth) * 100}%`, background: KIND_COLOR[k] }} />
                        ))}
                      </div>
                      <span style={{ width: 24, fontSize: 12, color: 'var(--text)', textAlign: 'right' }}>{total}</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  {Object.entries(KIND_LABEL).map(([k, l]) => (
                    <span key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ width: 10, height: 10, background: KIND_COLOR[k], borderRadius: 2 }} />{l}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </PortalCard>

          <div style={{ height: 16 }} />

          <PortalCard title="Overdue corrective actions">
            {data.overdue_actions.length === 0 ? <PortalEmpty message="None overdue." /> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {data.overdue_actions.map((a) => (
                    <tr key={a.action_id} style={{ borderTop: '1px solid var(--b2)' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <Link href={`/projects/${a.project_id}/safety`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>{nameOf(a.project_id)}</Link>
                      </td>
                      <td style={{ padding: '8px 12px' }}>{a.action || 'Corrective action'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{a.assigned_to_name || '—'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--red)' }}>due {new Date(a.due_date).toLocaleDateString('en-AU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PortalCard>
        </>
      )}
    </div>
  );
}
