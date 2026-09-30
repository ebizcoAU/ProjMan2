// /projects/:id/schedule — Job Scheduler, a Gantt-style timeline next to Cost Plan
// (xprojman-39 §4). READ-ONLY v1, as §6/§8 agreed; drag-to-reschedule is deferred.
// Hand-built CSS + one SVG overlay, no chart library (§4: this app has no UI
// framework by design).
//
// Data:
//   - stages + tasks (dates, status, completion, predecessor_id, derived code)
//     come off GET /projects/:id.
//   - per-task estimated/actual cost comes off GET /projects/:id/cost-plan →
//     labour.byTask (Server, xprojman-39 §8). Only fetched for money.read roles;
//     everyone else gets the completion bar without the spend bar.
'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, commercialApi } from '@/lib/api';
import { taskDisplayName } from '@/components/portal/taskDisplay';
import { ProjectTabs } from '../_ProjectTabs';

const ROW_H  = 30;
const LEFT_W = 320;
const DAY_MS = 86400000;

// tasks.status (v038, xprojman-38)
const STATUS_COLOR = {
  not_started: 'var(--dim)',
  in_progress: 'var(--cyan)',
  complete:    'var(--green)',
  cancelled:   'var(--red)',
  n_a:         'var(--b2)',
};
const STATUS_LABEL = {
  not_started: 'Not started', in_progress: 'In progress', complete: 'Complete', cancelled: 'Cancelled', n_a: 'N/A',
};

const toDay = (v) => {
  if (!v) return null;
  const t = Date.parse(String(v).slice(0, 10));
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
};
const fmt = (day) => new Date(day * DAY_MS).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const pct = (n) => Math.max(0, Math.min(100, Math.round(n)));

export default function SchedulePage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const proj   = project.data?.data?.project;
  const stages = project.data?.data?.stages || [];
  const tasks  = project.data?.data?.tasks || [];
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || (proj && 'contract_value' in proj);

  const costPlan = usePortalData(
    () => (seesMoney ? commercialApi.costPlan(id) : Promise.resolve({ data: null })),
    [id, seesMoney],
  );
  const byTask = useMemo(() => {
    const rows = costPlan.data?.data?.labour?.byTask || [];
    return Object.fromEntries(rows.map((r) => [r.task_id, r]));
  }, [costPlan.data]);

  // Rows: each stage, then its tasks in seq order. Tasks with no stage go last.
  const { rows, minDay, maxDay, undated } = useMemo(() => {
    const out = [];
    const byStage = {};
    for (const t of tasks) (byStage[t.stage_id || '_none'] ||= []).push(t);
    for (const list of Object.values(byStage)) {
      list.sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || String(a.created_at).localeCompare(String(b.created_at)));
    }
    const ordered = [...stages].sort((a, b) => a.seq - b.seq);
    for (const st of ordered) {
      const ts = byStage[st.id] || [];
      const starts = [toDay(st.start_date), ...ts.map((t) => toDay(t.start_date))].filter((x) => x !== null);
      const ends   = [toDay(st.end_date),   ...ts.map((t) => toDay(t.end_date))].filter((x) => x !== null);
      out.push({ kind: 'stage', id: st.id, label: `${st.seq}. ${st.name}`, status: st.status,
        start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null });
      for (const t of ts) out.push({ kind: 'task', task: t });
    }
    for (const t of byStage._none || []) out.push({ kind: 'task', task: t });

    const all = out.flatMap((r) => r.kind === 'stage'
      ? [r.start, r.end]
      : [toDay(r.task.start_date), toDay(r.task.end_date)]).filter((x) => x !== null);
    const undatedCount = out.filter((r) => r.kind === 'task' && (toDay(r.task.start_date) === null || toDay(r.task.end_date) === null)).length;
    return {
      rows: out,
      minDay: all.length ? Math.min(...all) : null,
      maxDay: all.length ? Math.max(...all) : null,
      undated: undatedCount,
    };
  }, [stages, tasks]);

  if (project.loading && !project.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const spanDays = minDay === null ? 0 : maxDay - minDay + 1;
  const dayPx = spanDays ? Math.max(3, Math.min(28, Math.floor(900 / spanDays))) : 10;
  const timelineW = Math.max(600, spanDays * dayPx + 40);
  const x = (day) => (day - minDay) * dayPx;

  // Month ticks along the header.
  const ticks = [];
  if (minDay !== null) {
    const d0 = new Date(minDay * DAY_MS);
    let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1));
    while (Math.floor(m.getTime() / DAY_MS) <= maxDay) {
      const day = Math.floor(m.getTime() / DAY_MS);
      if (day >= minDay) ticks.push({ day, label: m.toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
  }
  const today = Math.floor(Date.now() / DAY_MS);

  // Predecessor arrows: end of the predecessor bar → start of this bar.
  const rowIndex = {};
  rows.forEach((r, i) => { if (r.kind === 'task') rowIndex[r.task.id] = i; });
  const arrows = [];
  if (minDay !== null) {
    rows.forEach((r, i) => {
      if (r.kind !== 'task' || !r.task.predecessor_id) return;
      const j = rowIndex[r.task.predecessor_id];
      if (j === undefined) return;
      const pEnd = toDay(rows[j].task.end_date);
      const tStart = toDay(r.task.start_date);
      if (pEnd === null || tStart === null) return;
      const x1 = x(pEnd + 1), y1 = j * ROW_H + ROW_H / 2;
      const x2 = x(tStart),   y2 = i * ROW_H + ROW_H / 2;
      const late = tStart <= pEnd; // starts before its predecessor finishes
      const elbow = x1 + 6; // step out of the predecessor, drop to this row, run to the bar
      arrows.push({ key: r.task.id, late, d: `M${x1},${y1} H${elbow} V${y2} H${x2 - 1}` });
    });
  }

  return (
    <div style={{ padding: 20, maxWidth: 1400 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 8, borderRadius: 2, background: STATUS_COLOR[k] }} />{v}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, background: 'var(--text)' }} />% complete
        </span>
        {seesMoney && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 3, background: 'var(--brand)' }} />% of budget spent
          </span>
        )}
        {undated > 0 && <span className="badge badge-pending">{undated} task{undated === 1 ? '' : 's'} without dates</span>}
      </div>

      <PortalCard title="Job Scheduler">
        {rows.length === 0 ? (
          <PortalEmpty message="No stages or tasks yet." />
        ) : minDay === null ? (
          <PortalEmpty message="Nothing is dated yet. Add start and end dates to tasks to see them on the timeline." />
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--b1)', borderRadius: 6 }}>
            <div style={{ width: LEFT_W + timelineW, position: 'relative' }}>
              {/* Header */}
              <div style={{ display: 'flex', height: 28, borderBottom: '1px solid var(--b1)', background: 'var(--s2)' }}>
                <div style={{ width: LEFT_W, flex: 'none', position: 'sticky', left: 0, zIndex: 3, background: 'var(--s2)',
                  padding: '6px 10px', fontSize: 12, color: 'var(--dim)', borderRight: '1px solid var(--b1)' }}>
                  Stage / task
                </div>
                <div style={{ position: 'relative', width: timelineW }}>
                  {ticks.map((t) => (
                    <span key={t.day} style={{ position: 'absolute', left: x(t.day) + 4, top: 7, fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div style={{ position: 'relative' }}>
                {/* month gridlines + today line, behind the bars */}
                <div style={{ position: 'absolute', left: LEFT_W, top: 0, width: timelineW, height: rows.length * ROW_H, pointerEvents: 'none' }}>
                  {ticks.map((t) => (
                    <div key={t.day} style={{ position: 'absolute', left: x(t.day), top: 0, bottom: 0, borderLeft: '1px dashed var(--b2)' }} />
                  ))}
                  {today >= minDay && today <= maxDay && (
                    <div title="Today" style={{ position: 'absolute', left: x(today), top: 0, bottom: 0, borderLeft: '2px solid var(--brand)', opacity: 0.5 }} />
                  )}
                </div>

                {rows.map((r, i) => {
                  if (r.kind === 'stage') {
                    return (
                      <div key={`s-${r.id}`} style={{ display: 'flex', height: ROW_H, background: 'var(--s2)', borderTop: i ? '1px solid var(--b2)' : 'none' }}>
                        <div style={{ width: LEFT_W, flex: 'none', position: 'sticky', left: 0, zIndex: 2, background: 'var(--s2)',
                          padding: '6px 10px', fontSize: 13, fontWeight: 700, color: 'var(--text)', borderRight: '1px solid var(--b1)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.label}>
                          {r.label}
                        </div>
                        <div style={{ position: 'relative', width: timelineW }}>
                          {r.start !== null && r.end !== null && (
                            <div title={`${fmt(r.start)} – ${fmt(r.end)}`} style={{ position: 'absolute', left: x(r.start), top: 12,
                              width: Math.max(dayPx, (r.end - r.start + 1) * dayPx), height: 6, background: 'var(--text)', opacity: 0.35, borderRadius: 3 }} />
                          )}
                        </div>
                      </div>
                    );
                  }
                  const t = r.task;
                  const s = toDay(t.start_date), e = toDay(t.end_date);
                  const cost = byTask[t.id];
                  const spent = cost && Number(cost.estimated) > 0 ? (Number(cost.actual) / Number(cost.estimated)) * 100 : null;
                  const color = STATUS_COLOR[t.status] || 'var(--dim)';
                  const tip = [
                    `${t.code ? `${t.code} ` : ''}${taskDisplayName(t)}`,
                    s !== null && e !== null ? `${fmt(s)} – ${fmt(e)}` : 'No dates',
                    `${STATUS_LABEL[t.status] || t.status || '—'} · ${pct(t.completion || 0)}% complete`,
                    spent !== null ? `${pct(spent)}% of budget spent${spent > 100 ? ' (over)' : ''}` : null,
                  ].filter(Boolean).join('\n');
                  return (
                    <div key={t.id} style={{ display: 'flex', height: ROW_H, borderTop: '1px solid var(--b2)' }}>
                      <div style={{ width: LEFT_W, flex: 'none', position: 'sticky', left: 0, zIndex: 2, background: 'var(--s1)',
                        padding: '6px 10px 6px 24px', fontSize: 12, color: 'var(--text)', borderRight: '1px solid var(--b1)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tip}>
                        {t.code && <span style={{ fontFamily: 'var(--fm)', color: 'var(--dim)', marginRight: 6 }}>{t.code}</span>}
                        {taskDisplayName(t)}
                      </div>
                      <div style={{ position: 'relative', width: timelineW }}>
                        {s !== null && e !== null ? (
                          <div title={tip} style={{ position: 'absolute', left: x(s), top: 5, width: Math.max(dayPx, (e - s + 1) * dayPx), height: 20 }}>
                            <div style={{ position: 'absolute', inset: 0, top: 0, height: 12, borderRadius: 3, background: color,
                              opacity: t.status === 'n_a' || t.status === 'cancelled' ? 0.45 : 0.85 }} />
                            {/* completion */}
                            <div style={{ position: 'absolute', left: 0, top: 13, height: 3, width: '100%', background: 'var(--b2)', borderRadius: 2 }}>
                              <div style={{ height: 3, width: `${pct(t.completion || 0)}%`, background: 'var(--text)', borderRadius: 2 }} />
                            </div>
                            {/* spend */}
                            {spent !== null && (
                              <div style={{ position: 'absolute', left: 0, top: 17, height: 3, width: '100%', background: 'var(--b2)', borderRadius: 2 }}>
                                <div style={{ height: 3, width: `${pct(spent)}%`, background: spent > 100 ? 'var(--red)' : 'var(--brand)', borderRadius: 2 }} />
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ position: 'absolute', left: 8, top: 7, fontSize: 11, color: 'var(--dim)' }}>no dates</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* predecessor links */}
                <svg width={timelineW} height={rows.length * ROW_H}
                  style={{ position: 'absolute', left: LEFT_W, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
                  <defs>
                    <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0,0 L6,3 L0,6 z" fill="var(--dim)" />
                    </marker>
                    <marker id="gantt-arrow-late" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0,0 L6,3 L0,6 z" fill="var(--red)" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path key={a.key} d={a.d} fill="none" stroke={a.late ? 'var(--red)' : 'var(--dim)'} strokeWidth="1.2"
                      markerEnd={`url(#${a.late ? 'gantt-arrow-late' : 'gantt-arrow'})`} />
                  ))}
                </svg>
              </div>
            </div>
          </div>
        )}
        {rows.length > 0 && minDay !== null && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            Read-only. Change dates on the task itself. A red link means a task starts before the task it waits on has finished.
          </div>
        )}
      </PortalCard>
    </div>
  );
}
