// /builder/dashboard — the Builder console landing page. Same permission-aware
// aggregate as the PM console's dashboard (GET /projects/dashboard-summary,
// scoped server-side to Builder's own `assigned` engagement — §4.3), copy and
// the invitation link adjusted for the Builder console's own paths.
'use client';

import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi }   from '@/lib/api';

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
    .format(Number(n) || 0);

const grid = (min) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  gap: 12,
});

export default function BuilderDashboardPage() {
  const { data, loading, error } = usePortalData(() => projectsApi.dashboardSummary(), []);
  const d = data?.data || data;

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!d)      return <div style={{ padding: 20 }}><PortalEmpty message="No dashboard data." /></div>;

  const p = d.projects || {};
  const df = d.defects || {};

  const attn = (n) => (n > 0 ? 'var(--warn, #d08770)' : 'var(--cyan)');
  const bad  = (n) => (n > 0 ? 'var(--danger, #bf616a)' : 'var(--cyan)');

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Dashboard
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
        Across the jobs you're engaged on.
      </div>

      {d.job_awards?.pending_for_me > 0 && (
        <div style={{ marginBottom: 16 }}>
          <PortalCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 14, color: 'var(--text)' }}>
                You have <strong>{d.job_awards.pending_for_me}</strong> pending job invitation
                {d.job_awards.pending_for_me === 1 ? '' : 's'}.
              </div>
              <Link href="/builder/job-awards" style={{ fontSize: 13, color: 'var(--cyan)' }}>Review →</Link>
            </div>
          </PortalCard>
        </div>
      )}

      <PortalCard title="Jobs">
        <div style={grid(140)}>
          <PortalKpi label="Total"     value={p.total ?? 0} />
          <PortalKpi label="Active"    value={p.by_status?.active ?? 0} />
          <PortalKpi label="On hold"   value={p.by_status?.on_hold ?? 0} color={attn(p.by_status?.on_hold)} />
          <PortalKpi label="Completed" value={p.by_status?.completed ?? 0} />
          <PortalKpi label="Overdue"   value={p.overdue ?? 0} color={bad(p.overdue)}
                     sub={p.overdue > 0 ? 'past due date' : ''} />
        </div>
      </PortalCard>

      <div style={{ marginTop: 16 }}>
        <PortalCard title="Site quality">
          <div style={grid(140)}>
            <PortalKpi label="Open defects"  value={df.open ?? 0} color={attn(df.open)} />
            <PortalKpi label="In progress"   value={df.in_progress ?? 0} />
            <PortalKpi label="High severity" value={df.high_severity ?? 0} color={bad(df.high_severity)} />
            <PortalKpi label="Overdue"       value={df.overdue ?? 0} color={bad(df.overdue)} />
          </div>
        </PortalCard>
      </div>

      {/* Rendered only for a money.read/write holder — the server sends null otherwise. */}
      {d.money && (
        <div style={{ marginTop: 16 }}>
          <PortalCard title="Commercial">
            <div style={grid(200)}>
              <PortalKpi label="Contract value" value={money(d.money.contract_value_total)}
                         sub="your engaged jobs" />
            </div>
          </PortalCard>
        </div>
      )}
    </div>
  );
}
