// /projects — Project List (portaldesignspec §3.4 module 18, xprojman-28), wired
// against real data AND visually matching the owner-reviewed mockup
// (docs/mocked/portal/project_list.html Screen 1) — org bar, big header, per-project
// dual Schedule/Budget bars, dotted alert chips. The first pass reused the app's
// generic PortalCard/PortalKpi/PortalTable kit, which wired the data but dropped the
// actual reviewed design; this rebuilds the layout with the same CSS variables the
// mockup used (they're already the live app's own tokens, globals.css) instead.
//
// Data source, per owner's call this session: no single endpoint returns per-project
// Schedule%/Budget%/Alert today — `GET /projects/dashboard-summary` is an org-wide
// aggregate (no per-project rows), `GET /projects` has no progress/cost rollup. Chosen
// approach: client-side fan-out, one `projectsApi.detail(id)` per listed project,
// computed here. Acceptable while an org's project count is small (dozens, not
// thousands) — revisit with a real aggregated endpoint if that stops being true.
//
// Schedule% = stages complete / total stages. Budget% = SUM(actual_amount) /
// SUM(estimated_amount) across stages (xprojman-29 §1's own suggested formula) — null,
// not 0, when the caller lacks money.read (`redactStage` strips those columns; same
// "null means hidden, not zero" convention as dashboardSummary's `money` field).
// Alert-level thresholds are a first pass, explicitly provisional — same status
// portaldesignspecification.md §3.4 module 18 already gives this formula. KPI tiles
// are counted from the exact same `rows` array the table renders, so the two can never
// show different numbers (the mockup's own reviewed defect — flagged, not repeated).
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, organisationApi } from '@/lib/api';
import { PROJECT_STATUS_BADGE, PROJECT_STATUS_LABEL } from '@/components/portal/projectStatus';
import { usePortalDialog } from '@/components/portal/PortalDialog';

// Raw project.status badge (xprojman-35). Owner call, 2026-09-05: this used to sit
// twice — once here on the right, once duplicated as a derived "Alert" chip (Draft/
// On track/Watch/At risk) on the left. One badge, on the right, replaces both.
function StatusBadge({ status }) {
  return (
    <span className={`badge ${PROJECT_STATUS_BADGE[status] || 'badge-muted'}`}>
      {PROJECT_STATUS_LABEL[status] || status}
    </span>
  );
}

// Edit (owner report 2026-09-07: no way to correct customer name/brief/land info
// after creation — Cancel/Delete existed, Edit never did), Cancel (any non-terminal
// status, keeps every row per xprojman-35 §0/§1), and Delete (draft only — server
// re-checks progress-claims/job-awards/engagements and 409s with a code this reads
// to give the real reason; see ProjectDeletionService.js).
function ProjectActions({ project, busy, onCancel, onDelete }) {
  const canCancel = !['completed', 'cancelled'].includes(project.status);
  const canDelete = project.status === 'draft';
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <Link href={`/projects/${project.id}/edit`} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }}>
        Edit
      </Link>
      {canCancel && (
        <button type="button" className="btn btn-ghost" disabled={busy}
          style={{ padding: '3px 9px', fontSize: 11 }}
          onClick={() => onCancel(project)}>
          Cancel
        </button>
      )}
      {canDelete && (
        <button type="button" className="btn btn-danger" disabled={busy}
          style={{ padding: '3px 9px', fontSize: 11 }}
          onClick={() => onDelete(project)}>
          Delete
        </button>
      )}
    </div>
  );
}

function DualBar({ label, pct, over }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ width: 46, flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--s4)', overflow: 'hidden' }}>
        {pct != null && <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: 4, background: over ? 'var(--red)' : (label === 'Sched' ? 'var(--cyan)' : 'var(--brand)') }} />}
      </div>
      <span style={{ width: 34, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--fm)', fontSize: 11, color: 'var(--dim)', fontWeight: 600 }}>{pct != null ? `${pct}%` : '—'}</span>
    </div>
  );
}

// One project's Schedule%/Budget%/current-stage/Alert from its own stages array.
function computeProgress(project, stages) {
  const total = stages.length;
  const complete = stages.filter((s) => s.status === 'complete').length;
  const schedulePct = total ? Math.round((complete / total) * 100) : null;
  const current = stages.find((s) => s.status !== 'complete') || stages[stages.length - 1] || null;

  const seesMoney = stages.length > 0 && stages.some((s) => 'estimated_amount' in s);
  let budgetPct = null;
  if (seesMoney) {
    const estimated = stages.reduce((s, st) => s + (Number(st.estimated_amount) || 0), 0);
    const actual     = stages.reduce((s, st) => s + (Number(st.actual_amount) || 0), 0);
    budgetPct = estimated > 0 ? Math.round((actual / estimated) * 100) : null;
  }

  let alertKey;
  if (project.status === 'draft' || total === 0) alertKey = 'draft';
  else if (project.status === 'on_hold') alertKey = 'watch';
  // xprojman-35: cancelled/inactive projects aren't "at risk" or "on track" — the
  // StatusBadge already tells the real story, this chip should just stay out of the way.
  else if (project.status === 'cancelled' || project.status === 'inactive') alertKey = 'hidden';
  else if (budgetPct == null) alertKey = 'hidden';
  else {
    const gap = budgetPct - schedulePct;
    alertKey = gap >= 15 ? 'at_risk' : gap >= 5 ? 'watch' : 'on_track';
  }

  return { schedulePct, budgetPct, currentStage: current, totalStages: total, alertKey };
}

async function loadProjectsWithProgress() {
  const [{ data: listData }, orgResult] = await Promise.all([
    projectsApi.list({ limit: 100 }),
    organisationApi.get().catch(() => null),
  ]);
  // GET /organisation nests the row one level deeper than the other list/detail
  // endpoints: { success, data: { organisation: {...}, counts: {...} } }, not
  // { success, data: {...} } — checked against the actual route, not assumed.
  const orgName = orgResult?.data?.data?.organisation?.name;
  const projects = listData?.data?.projects ?? [];
  const details = await Promise.all(projects.map((p) => projectsApi.detail(p.id).catch(() => null)));
  const rows = projects.map((p, i) => {
    const stages = details[i]?.data?.data?.stages ?? [];
    return { ...p, ...computeProgress(p, stages) };
  });
  return { data: { rows, orgName } };
}

export default function ProjectsPage() {
  const { data, loading, error, refetch } = usePortalData(loadProjectsWithProgress, []);
  const [busyId, setBusyId]     = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const { confirm } = usePortalDialog();

  async function handleCancel(project) {
    const ok = await confirm(
      `Cancel "${project.name}"? This keeps every record (invoices, purchase orders, contracts) — it only marks the project as called off.`,
      { title: 'Cancel project', confirmLabel: 'Cancel project' }
    );
    if (!ok) return;
    setActionErr(null);
    setBusyId(project.id);
    try {
      await projectsApi.cancel(project.id);
      await refetch();
    } catch (err) {
      setActionErr(err?.message || 'Could not cancel this project.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(project) {
    const ok = await confirm(
      `Permanently delete "${project.name}"? This removes every related record and cannot be undone. Use Cancel instead if any work has actually started.`,
      { title: 'Delete project', confirmLabel: 'Delete permanently', danger: true }
    );
    if (!ok) return;
    setActionErr(null);
    setBusyId(project.id);
    try {
      await projectsApi.remove(project.id);
      await refetch();
    } catch (err) {
      setActionErr(err?.message || 'Could not delete this project.');
    } finally {
      setBusyId(null);
    }
  }

  // usePortalData's own load() already unwraps one `.data` level
  // (`setData(result?.data ?? result)`) — loadProjectsWithProgress returns
  // `{ data: { rows, orgName } }` to match that convention, so the hook's own
  // `data` state here IS `{ rows, orgName }` directly, not `{ data: { rows... } }`.
  // Reading `data?.data?.rows` (one level too deep) was the actual bug: every
  // fetch genuinely succeeded, this only ever failed to find the array in the
  // already-correct result.
  const rows = data?.rows ?? [];
  const orgName = data?.orgName;
  const kpi = {
    total:  rows.length,
    active: rows.filter((r) => r.status === 'active').length,
    atRisk: rows.filter((r) => r.alertKey === 'at_risk').length,
    watch:  rows.filter((r) => r.alertKey === 'watch').length,
  };

  return (
    <div style={{ padding: 20, maxWidth: 1080 }}>
      {/* ── Org identity strip ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: 'var(--bdim)', border: '1px solid var(--bbright)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
        }}>🏗️</div>
        <div>
          <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 15.5, color: 'var(--text)' }}>
            {orgName || '—'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--fm)' }}>
            Organisation <b style={{ color: 'var(--dim)', fontWeight: 600 }}>→</b> Projects
          </div>
        </div>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--fm)', fontSize: 12, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            Office console
          </div>
          <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 25, color: 'var(--text)', letterSpacing: '-.01em', margin: 0 }}>
            Your Projects
          </h1>
          <div style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: '62ch', marginTop: 3 }}>
            Every job you&rsquo;re running, with where each one stands in the 18-stage lifecycle.
          </div>
        </div>
        <Link href="/projects/new" className="btn btn-primary">+ New Project</Link>
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, marginBottom: 14 }}>
        {[
          ['Total projects', kpi.total, 'var(--text)'],
          ['Active', kpi.active, 'var(--green)'],
          ['At risk', kpi.atRisk, 'var(--red)'],
          ['Watch', kpi.watch, 'var(--yellow)'],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ fontFamily: 'var(--fm)', fontSize: 24, fontWeight: 600, color }}>{value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      {actionErr && <div style={{ marginBottom: 12 }}><PortalError message={actionErr} /></div>}

      {/* ── Project rows ───────────────────────────────────────────────── */}
      <div style={{ background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Projects</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
            <span style={{ width: 190 }}></span><span style={{ width: 190 }}>Schedule vs Budget</span><span style={{ width: 120 }}></span><span style={{ width: 100, textAlign: 'right' }}>Status</span>
          </div>
        </div>

        {loading ? (
          <PortalEmpty message="Loading…" />
        ) : rows.length === 0 ? (
          <PortalEmpty message="No projects yet. Create the first one above." />
        ) : rows.map((p, i) => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '13px 4px',
            borderBottom: i < rows.length - 1 ? '1px solid var(--s4)' : 'none',
          }}>
            <div style={{ width: 190, flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--fm)', fontSize: 12, color: 'var(--brand)', fontWeight: 700 }}>
                <Link href={`/projects/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{p.code}</Link>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                <Link href={`/projects/${p.id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{p.name}</Link>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{p.customer_name || '—'}</div>
              <ProjectActions project={p} busy={busyId === p.id} onCancel={handleCancel} onDelete={handleDelete} />
            </div>

            <div style={{ flex: 1, minWidth: 190 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
                {p.currentStage
                  ? <>Stage <b style={{ color: 'var(--dim)', fontWeight: 700 }}>{p.currentStage.seq}</b>/{p.totalStages} — {p.currentStage.name}
                      {p.status === 'on_hold' && <span style={{ color: 'var(--yellow)', fontWeight: 700 }}> (on hold)</span>}</>
                  : <span style={{ fontStyle: 'italic' }}>Not yet a project — brief captured</span>}
              </div>
              <DualBar label="Sched" pct={p.schedulePct} />
              <DualBar label="Budget" pct={p.budgetPct} over={p.budgetPct != null && p.schedulePct != null && p.budgetPct > p.schedulePct + 15} />
            </div>

            <div style={{ width: 120, flexShrink: 0, fontSize: 12.5, color: 'var(--dim)' }}>{p.site_address || '—'}</div>
            <div style={{ width: 100, flexShrink: 0, textAlign: 'right' }}><StatusBadge status={p.status} /></div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          The <b style={{ color: 'var(--dim)' }}>Budget</b> bar turns red when spend is running
          significantly ahead of Schedule — the classic overrun signal. Thresholds are a first
          pass, not a locked formula (portaldesignspecification.md §3.4 module 18).
        </div>
      </div>
    </div>
  );
}
