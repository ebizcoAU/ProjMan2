// /projects/:id — project detail with the Programme tab (servdesignspec §10, Step 6).
// Stage list from the 18-stage engine: status, hold-point + validation state, advance
// controls, inspector validate, and a cost roll-up. Money fields are simply absent
// from the payload for roles without money.read (server-side redaction), so the tab
// renders whatever it's given.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, stageTemplatesApi, getSavedUser } from '@/lib/api';
import { useTopbarOverride } from '@/components/portal/chrome';
import { taskDisplayName } from '@/components/portal/taskDisplay';
import { ProjectTabs } from './_ProjectTabs';

// Inline per-task completion bar (Programme tab task list). Small enough to sit in a
// single row alongside the task name/assignee.
function TaskBar({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 100, flexShrink: 0 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--b2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: p === 100 ? 'var(--green)' : 'var(--brand)' }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--fm)', color: 'var(--dim)', width: 30, textAlign: 'right' }}>{p}%</span>
    </div>
  );
}

// Sx.x listing order. `code`/`seq` (xprojman-37/38) cover every seeded and
// hand-added task going forward; a handful of legacy device-created rows can still
// have NULL seq (Server's own note, migration_v038) — falls back to start_date/name
// for those so the list is never just raw insertion order.
function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
    if (a.start_date && b.start_date) return new Date(a.start_date) - new Date(b.start_date);
    if (a.start_date) return -1;
    if (b.start_date) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

const NEXT = { not_started: 'in_progress', in_progress: 'complete' };
const NEXT_LABEL = { not_started: 'Start', in_progress: 'Complete' };
const STATUS_BADGE = {
  not_started: 'badge-muted', in_progress: 'badge-pending',
  blocked: 'badge-revoked', complete: 'badge-active', skipped: 'badge-muted',
};
const PART_NAME = { A: 'Design & Approvals', B: 'Approvals & Permits', C: 'Construction', D: 'Fit-out & Finishes', E: 'Completion' };
const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = usePortalData(() => projectsApi.detail(id), [id]);
  const templates = usePortalData(() => stageTemplatesApi.list());
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Owner correction 2026-09-05: task_detail.html's drill-down (Notes/Attachments/POs)
  // was reachable ONLY via the Field tab's "tick & verify" test table — a page built
  // for watching the App push data live, not for everyday task browsing. Programme is
  // the tab people actually land on; each stage now expands to its own task list.
  //
  // Owner correction 2026-09-07: a task click first opened a popup — reverted, since
  // this is a page people spend real time in (editing, viewing/marking up documents),
  // not a quick-glance. Now navigates to the full /tasks/:taskId page, same as before
  // that popup existed, just reachable from Programme instead of only from Field.
  //
  // Owner report 2026-09-07: coming back from a task detail page collapsed whatever
  // stage was open, losing the user's place — this component remounts fresh on every
  // navigation, so plain useState can't survive it. Persisted per-project in
  // sessionStorage (a per-viewer UI convenience, not real data — no reason to round-trip
  // it through the server) and restored on mount, with a one-time scroll-into-view so
  // returning actually lands back where they were, not just "technically still open".
  const openStageKey = `pm2-openStage-${id}`;
  const [openStage, setOpenStageState] = useState(() => {
    if (typeof window === 'undefined') return null;
    try { return sessionStorage.getItem(openStageKey) || null; } catch { return null; }
  });
  const setOpenStage = (stageId) => {
    setOpenStageState(stageId);
    try {
      if (stageId) sessionStorage.setItem(openStageKey, stageId);
      else sessionStorage.removeItem(openStageKey);
    } catch { /* private-browsing or storage disabled — state still works for this render */ }
  };
  const stageRefs = useRef({});
  const restoredScroll = useRef(false);
  const [addTaskStage, setAddTaskStage] = useState(null);
  const [addTaskName, setAddTaskName] = useState('');
  const [addTaskPredecessor, setAddTaskPredecessor] = useState('');
  const [addTaskBusy, setAddTaskBusy] = useState(false);
  const [addTaskErr, setAddTaskErr] = useState(null);

  const d = data?.data;
  const project = d?.project;
  const stages = d?.stages || [];
  const tasks = d?.tasks || [];
  const role = (getSavedUser() || {})?.role;
  const canValidate = role === 'inspector';
  const seesMoney = stages.some(st => 'estimated_amount' in st) || (project && 'contract_value' in project);

  // Owner ask 2026-09-07: replaces the generic "Projects" topbar title with the
  // actual project identity — this IS the header now, the page body doesn't repeat it.
  useTopbarOverride({
    title: project ? `${project.code}  ${project.name}` : null,
    subtitle: project ? `${project.site_address || '—'} · ${project.customer_name || 'no customer'} · ${project.status}` : null,
  });

  // One-time scroll restore once the stage list has actually loaded — must run before
  // the loading/error early returns below so this hook's call order never changes.
  useEffect(() => {
    if (restoredScroll.current || loading) return;
    restoredScroll.current = true;
    if (openStage && stageRefs.current[openStage]) {
      stageRefs.current[openStage].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [loading, openStage]);

  const act = async (fn) => {
    setBusy(true); setActionError(null);
    try { await fn(); await refetch(); }
    catch (err) { setActionError(err?.response?.data?.message || err.message); }
    finally { setBusy(null); }
  };
  const advance = (st) => act(() => projectsApi.advanceStage(id, st.id, NEXT[st.status]));
  const validate = (st, result) => act(() => projectsApi.validateStage(id, st.id, result, null));
  const instantiate = (templateId) => act(() => projectsApi.instantiate(id, templateId));

  const submitAddTask = async (e, stageId) => {
    e.preventDefault();
    if (!addTaskName.trim()) return;
    setAddTaskBusy(true); setAddTaskErr(null);
    try {
      await projectsApi.createTask(id, {
        stage_id: stageId, name: addTaskName.trim(),
        ...(addTaskPredecessor ? { predecessor_id: addTaskPredecessor } : {}),
      });
      setAddTaskStage(null); setAddTaskName(''); setAddTaskPredecessor('');
      await refetch();
    } catch (err) {
      setAddTaskErr(err?.response?.data?.message || err.message || 'Could not add task');
    } finally {
      setAddTaskBusy(false);
    }
  };

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!project) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const done = stages.filter(s => s.status === 'complete').length;
  const roll = (col) => stages.reduce((sum, s) => sum + (Number(s[col]) || 0), 0);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <ProjectTabs id={id} seesMoney={seesMoney} />
        <Link href={`/projects/${id}/edit`} className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 12.5, marginBottom: 16 }}>
          Edit project
        </Link>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Stages complete" value={`${done} / ${stages.length}`} color="var(--green)" />
        <PortalKpi label="Hold points" value={stages.filter(s => s.is_hold_point).length} color="var(--cyan)" />
        {seesMoney && <PortalKpi label="Estimated" value={money(roll('estimated_amount'))} color="var(--text)" />}
        {seesMoney && <PortalKpi label="Claimed" value={money(roll('claimed_amount'))} color="var(--brand)" />}
      </div>

      {actionError && <div style={{ marginBottom: 12 }}><PortalError message={actionError} /></div>}

      {/* Empty → offer instantiation */}
      {stages.length === 0 ? (
        <PortalCard title="Programme">
          <PortalEmpty message="No programme yet. Instantiate one from a template:" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', paddingBottom: 12 }}>
            {(templates.data?.data?.templates || []).map(t => (
              <button key={t.id} className="btn btn-primary" disabled={busy}
                onClick={() => instantiate(t.id)}>
                {t.name} ({t.stage_count})
              </button>
            ))}
          </div>
        </PortalCard>
      ) : (
        <PortalCard title="Programme — 18-stage lifecycle">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stages.map((st, i) => {
              const prevPart = stages[i - 1]?.part;
              const stageTasks = sortTasks(tasks.filter((t) => t.stage_id === st.id));
              const isOpen = openStage === st.id;
              return (
                <div key={st.id}>
                  {st.part && st.part !== prevPart && (
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                      color: 'var(--muted)', margin: '10px 0 4px' }}>
                      Part {st.part} · {PART_NAME[st.part]}
                    </div>
                  )}
                  <div ref={(el) => { stageRefs.current[st.id] = el; }}
                    onClick={() => setOpenStage(isOpen ? null : st.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
                    background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: isOpen ? '8px 8px 0 0' : 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', width: 12, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ fontFamily: 'var(--fm)', fontSize: 13, color: 'var(--muted)', width: 24 }}>{st.seq}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        {st.name}
                        {st.is_hold_point && (
                          <span title="Hold point — needs inspector validation" style={{
                            marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--cyan)',
                            border: '1px solid var(--cyandim)', borderRadius: 4, padding: '1px 5px' }}>
                            HOLD {st.is_validated ? '✓' : '⏳'}
                          </span>
                        )}
                      </div>
                      {st.milestone && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{st.milestone}</div>}
                    </div>
                    {stageTasks.length > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--fm)' }}>
                        {stageTasks.filter((t) => Number(t.completion) >= 100).length}/{stageTasks.length} tasks
                      </span>
                    )}
                    {seesMoney && (
                      <span style={{ fontFamily: 'var(--fm)', fontSize: 12, color: 'var(--dim)', width: 110, textAlign: 'right' }}>
                        {money(st.estimated_amount)}
                      </span>
                    )}
                    <span className={`badge ${STATUS_BADGE[st.status]}`} style={{ width: 92, justifyContent: 'center' }}>
                      {st.status.replace('_', ' ')}
                    </span>
                    {/* Advance */}
                    {NEXT[st.status] && (
                      <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }}
                        disabled={busy} onClick={(e) => { e.stopPropagation(); advance(st); }}>
                        {NEXT_LABEL[st.status]}
                      </button>
                    )}
                    {/* Inspector validate on a hold point */}
                    {canValidate && st.is_hold_point && !st.is_validated && (
                      <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 13 }}
                        disabled={busy} onClick={(e) => { e.stopPropagation(); validate(st, 'pass'); }}>
                        Validate
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div style={{ border: '1px solid var(--b1)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '4px 12px 10px 46px' }}>
                      {stageTasks.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 0' }}>No tasks on this stage yet.</div>
                      ) : stageTasks.map((t) => (
                        <Link key={t.id} href={`/projects/${id}/tasks/${t.id}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--s4)',
                            opacity: t.status === 'n_a' ? 0.45 : 1, textDecoration: 'none' }}>
                          {t.code && <span style={{ fontFamily: 'var(--fm)', fontSize: 11, color: 'var(--muted)', width: 34, flexShrink: 0 }}>{t.code}</span>}
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--brand)', fontWeight: 600, textDecoration: t.status === 'n_a' ? 'line-through' : 'none' }}>{taskDisplayName(t)}</span>
                          <span style={{ fontSize: 12, color: 'var(--dim)' }}>{t.assigned_to_name || '—'}</span>
                          {t.status === 'n_a' ? <span className="badge badge-revoked" style={{ fontSize: 10 }}>N/A</span> : <TaskBar pct={t.completion} />}
                          {t.verified_by && <span className="badge badge-active" style={{ fontSize: 10 }}>verified</span>}
                        </Link>
                      ))}

                      {addTaskStage === st.id ? (
                        <form onSubmit={(e) => submitAddTask(e, st.id)} onClick={(e) => e.stopPropagation()}
                          style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0', flexWrap: 'wrap' }}>
                          <input autoFocus required placeholder="Task name" value={addTaskName}
                            onChange={(e) => setAddTaskName(e.target.value)}
                            style={{ flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s2)', color: 'var(--text)', fontSize: 13 }} />
                          <select value={addTaskPredecessor} onChange={(e) => setAddTaskPredecessor(e.target.value)}
                            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s2)', color: 'var(--text)', fontSize: 12.5 }}>
                            <option value="">No prerequisite</option>
                            {stageTasks.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} — ` : ''}{taskDisplayName(t)}</option>)}
                          </select>
                          <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} disabled={addTaskBusy}>
                            {addTaskBusy ? 'Adding…' : 'Add'}
                          </button>
                          <button type="button" className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}
                            onClick={() => { setAddTaskStage(null); setAddTaskErr(null); }}>
                            Cancel
                          </button>
                          {addTaskErr && <div style={{ width: '100%' }}><PortalError message={addTaskErr} /></div>}
                        </form>
                      ) : (
                        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, marginTop: 6 }}
                          onClick={(e) => { e.stopPropagation(); setAddTaskStage(st.id); setAddTaskName(''); setAddTaskPredecessor(''); setAddTaskErr(null); }}>
                          + Add task
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PortalCard>
      )}
    </div>
  );
}
