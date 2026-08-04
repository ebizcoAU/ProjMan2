// /dashboard — the Portal console landing page (portaldesignspec §3.1).
//
// Thin by design: ONE call to GET /projects/dashboard-summary, which is permission-aware and
// project-scoped server-side. The original directive had the Portal assemble this from the
// per-project reads — an N+1 that also put a budget summary in front of every tenant user.
// Neither happens here:
//   • money arrives as `null` when the caller lacks `money.read` (§7.2.1), and the block is then
//     HIDDEN rather than rendered as $0 — a zero would read as "this job is worth nothing".
//   • the counts are already narrowed to what the caller may reach, so a foreperson's dashboard
//     shows their own jobs and a PM's shows the portfolio, with no client-side filtering.
//
// Charts are deliberately absent: `recharts` is not in the portal stack (deps are next/react/
// react-dom) and there is no PortalChart in the kit. Numbers on the existing PortalKpi cards are
// honest and ship today; adding a charting dependency is a separate decision.
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

export default function DashboardPage() {
  const { data, loading, error } = usePortalData(() => projectsApi.dashboardSummary(), []);
  const d = data?.data || data;

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!d)      return <div style={{ padding: 20 }}><PortalEmpty message="No dashboard data." /></div>;

  const p = d.projects || {};
  const df = d.defects || {};
  const st = d.stages || {};

  // Anything that needs attention gets a warning colour; a quiet dashboard stays neutral rather
  // than lighting up in red for zero problems.
  const attn = (n) => (n > 0 ? 'var(--warn, #d08770)' : 'var(--cyan)');
  const bad  = (n) => (n > 0 ? 'var(--danger, #bf616a)' : 'var(--cyan)');

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Dashboard
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
        Across the projects you can reach.
      </div>

      {d.job_awards?.pending_for_me > 0 && (
        <div style={{ marginBottom: 16 }}>
          <PortalCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 14, color: 'var(--text)' }}>
                You have <strong>{d.job_awards.pending_for_me}</strong> pending job invitation
                {d.job_awards.pending_for_me === 1 ? '' : 's'}.
              </div>
              <Link href="/job-awards" style={{ fontSize: 13, color: 'var(--cyan)' }}>Review →</Link>
            </div>
          </PortalCard>
        </div>
      )}

      <PortalCard title="Projects">
        <div style={grid(140)}>
          <PortalKpi label="Total"     value={p.total ?? 0} />
          <PortalKpi label="Active"    value={p.by_status?.active ?? 0} />
          <PortalKpi label="On hold"   value={p.by_status?.on_hold ?? 0} color={attn(p.by_status?.on_hold)} />
          <PortalKpi label="Draft"     value={p.by_status?.draft ?? 0} />
          <PortalKpi label="Completed" value={p.by_status?.completed ?? 0} />
          <PortalKpi label="Overdue"   value={p.overdue ?? 0} color={bad(p.overdue)}
                     sub={p.overdue > 0 ? 'past due date' : ''} />
        </div>
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <Link href="/projects" style={{ color: 'var(--cyan)' }}>All projects →</Link>
        </div>
      </PortalCard>

      <div style={{ marginTop: 16 }}>
        <PortalCard title="Site quality">
          <div style={grid(140)}>
            <PortalKpi label="Open defects"   value={df.open ?? 0} color={attn(df.open)} />
            <PortalKpi label="In progress"    value={df.in_progress ?? 0} />
            <PortalKpi label="High severity"  value={df.high_severity ?? 0} color={bad(df.high_severity)} />
            <PortalKpi label="Overdue"        value={df.overdue ?? 0} color={bad(df.overdue)} />
            <PortalKpi label="Hold points"    value={d.hold_points?.open_blocking ?? 0}
                       color={bad(d.hold_points?.open_blocking)}
                       sub={d.hold_points?.open_blocking > 0 ? 'blocking progress' : ''} />
            <PortalKpi label="Blocked stages" value={st.blocked ?? 0} color={attn(st.blocked)} />
          </div>
        </PortalCard>
      </div>

      {/* Rendered only for a money.read holder — the server sends null otherwise (§7.2.1). */}
      {d.money && (
        <div style={{ marginTop: 16 }}>
          <PortalCard title="Commercial">
            <div style={grid(200)}>
              <PortalKpi label="Contract value" value={money(d.money.contract_value_total)}
                         sub="excludes archived" />
            </div>
          </PortalCard>
        </div>
      )}
    </div>
  );
}
