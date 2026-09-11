// /builder/programme/:id — the Builder's own Programme/Line-of-Balance editor
// (portaldesignspec §4.3 "Programme / Line-of-Balance editing", §1.3/§3.2: this
// is Builder's SOLE-AUTHORED table, PM's console view of it is a read, full
// stop). Reuses GET /projects/:id (projectsApi.detail) — the same payload the
// PM console's read-only Programme tab renders — and writes through
// PATCH/POST /projects/:id/stages*, gated server-side by assertProgrammeWriteScope
// (ProjectService.js:259): Stages 1-8 stay PM's regardless of what this UI
// lets you attempt, and 9-18 only accept a write from the ACCEPTED Builder on
// THIS project — a 403 here means the engagement isn't what this session
// thinks it is, not a bug in this page.
//
// Only schedule fields are ever sent (name/milestone/start_date/end_date/seq) —
// never budget/estimated/committed/actual/claimed_amount. The commercial wall
// (§1.4) is a Cost Plan concern, not this screen's; keeping money fields out of
// this payload entirely means there's no path for a schedule edit to
// accidentally touch a cost figure.
//
// Gantt bar + Line-of-Balance: `projects.unit_count` (S1.3) exists, but no
// `modular_units`/per-unit stage table does (schema-relationship-map.md, 2026-
// 09-03) — there is no per-unit data to render swim-lanes against yet. This
// renders the single-timeline Gantt bar (correct for unit_count=1, the common
// case) and flags multi-unit LOB as blocked on schema, not built as a stub.
'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi }   from '@/lib/api';

const STATUSES    = ['not_started', 'in_progress', 'blocked', 'complete', 'skipped'];
const NEXT        = { not_started: 'in_progress', in_progress: 'complete' };
const NEXT_LABEL  = { not_started: 'Start', in_progress: 'Complete' };
const STATUS_BADGE = {
  not_started: 'badge-muted', in_progress: 'badge-pending',
  blocked: 'badge-revoked', complete: 'badge-active', skipped: 'badge-muted',
};
const BAR_COLOR = {
  not_started: 'var(--b2)', in_progress: 'var(--cyan)',
  blocked: 'var(--danger, #bf616a)', complete: 'var(--green)', skipped: 'var(--muted)',
};

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-AU');
};
const toInputDate = (v) => (v ? String(v).slice(0, 10) : '');

// Own-authored Stages 9-18 only — Stages 1-8 render read-only regardless of
// what the server would say, so the UI never dangles an edit control that's
// guaranteed a 403 (assertProgrammeWriteScope, ProjectService.js:259).
const OWN_SEQ_FLOOR = 9;

export default function BuilderProgrammeDetailPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = usePortalData(() => projectsApi.detail(id), [id]);
  const [busy, setBusy]           = useState(null);
  const [actionError, setError]   = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit]           = useState({});
  const [showAdd, setShowAdd]     = useState(false);
  const [addForm, setAddForm]     = useState({ name: '', milestone: '', start_date: '', end_date: '' });

  const d = data?.data;
  const project = d?.project;
  const stages  = d?.stages || [];
  const ownStages = stages.filter((s) => s.seq >= OWN_SEQ_FLOOR);

  const act = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); await refetch(); }
    catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setBusy(null); }
  };

  const startEdit = (st) => {
    setEditingId(st.id);
    setEdit({
      name: st.name || '', milestone: st.milestone || '',
      start_date: toInputDate(st.start_date), end_date: toInputDate(st.end_date),
    });
  };
  const saveEdit = (st) => act(async () => {
    await projectsApi.patchStage(id, st.id, {
      name: edit.name, milestone: edit.milestone || null,
      start_date: edit.start_date || null, end_date: edit.end_date || null,
    });
    setEditingId(null);
  });
  const advance = (st) => act(() => projectsApi.advanceStage(id, st.id, NEXT[st.status]));
  const addStage = (e) => {
    e.preventDefault();
    act(async () => {
      const nextSeq = ownStages.length ? Math.max(...ownStages.map((s) => s.seq)) + 1 : OWN_SEQ_FLOOR;
      await projectsApi.createStage(id, {
        name: addForm.name, seq: nextSeq,
        milestone: addForm.milestone || null,
        start_date: addForm.start_date || null, end_date: addForm.end_date || null,
      });
      setAddForm({ name: '', milestone: '', start_date: '', end_date: '' });
      setShowAdd(false);
    });
  };

  // Gantt bar geometry — proportional against the min/max dated span across
  // own-authored stages. Undated stages render in the list, not on the bar.
  const range = useMemo(() => {
    const dated = ownStages.filter((s) => s.start_date && s.end_date);
    if (dated.length === 0) return null;
    const starts = dated.map((s) => new Date(s.start_date).getTime());
    const ends   = dated.map((s) => new Date(s.end_date).getTime());
    return { min: Math.min(...starts), max: Math.max(...ends) };
  }, [ownStages]);

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!project) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ marginBottom: 4 }}>
        <Link href="/builder/programme" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
          ← Your jobs
        </Link>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
          <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{project.code}</span>{'  '}{project.name}
        </div>
        <div style={{ fontSize: 14, color: 'var(--dim)', marginTop: 4 }}>
          {project.site_address || '—'} · your own Stages 9–18 schedule
        </div>
      </div>

      {project.unit_count > 1 && (
        <div style={{ marginBottom: 12 }}>
          <PortalError message={
            `This job has ${project.unit_count} units — a true Line-of-Balance (per-unit swim-lanes) ` +
            `isn't buildable yet: there's no per-unit stage/task schema (schema-relationship-map.md, ` +
            `2026-09-03). The Gantt below is project-level only until that lands.`
          } />
        </div>
      )}
      {actionError && <div style={{ marginBottom: 12 }}><PortalError message={actionError} /></div>}

      {/* Gantt bar */}
      <PortalCard title="Gantt — your dated stages">
        {!range ? (
          <PortalEmpty message="No dated stages yet — add start/end dates below to see the timeline." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ownStages.filter((s) => s.start_date && s.end_date).map((st) => {
              const span = range.max - range.min || 1;
              const left  = ((new Date(st.start_date).getTime() - range.min) / span) * 100;
              const width = Math.max(2, ((new Date(st.end_date).getTime() - new Date(st.start_date).getTime()) / span) * 100);
              return (
                <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 160, flexShrink: 0, fontSize: 12, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {st.seq}. {st.name}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: 18, background: 'var(--s2)', borderRadius: 4 }}>
                    <div title={`${fmtDate(st.start_date)} → ${fmtDate(st.end_date)}`} style={{
                      position: 'absolute', left: `${left}%`, width: `${width}%`, height: '100%',
                      background: BAR_COLOR[st.status] || 'var(--b2)', borderRadius: 4, minWidth: 4,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PortalCard>

      {/* Read-only PM stages, 1-8 */}
      {stages.some((s) => s.seq < OWN_SEQ_FLOOR) && (
        <PortalCard title="Stages 1–8 — PM's, read only">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {stages.filter((s) => s.seq < OWN_SEQ_FLOOR).map((st) => (
              <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', fontSize: 13, color: 'var(--dim)' }}>
                <span style={{ fontFamily: 'var(--fm)', width: 20 }}>{st.seq}</span>
                <span style={{ flex: 1 }}>{st.name}</span>
                <span className={`badge ${STATUS_BADGE[st.status]}`}>{st.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </PortalCard>
      )}

      {/* Editable own stages, 9-18 */}
      <PortalCard title="Your schedule — Stages 9–18">
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? 'Cancel' : '+ Add stage'}
          </button>
        </div>

        {showAdd && (
          <form onSubmit={addStage} style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
            padding: 12, borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--b1)', marginBottom: 14,
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Name</label>
              <input className="input" value={addForm.name} required
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Frame — north elevation" />
            </div>
            <div style={{ minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Milestone</label>
              <input className="input" value={addForm.milestone}
                onChange={(e) => setAddForm((f) => ({ ...f, milestone: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Start</label>
              <input className="input" type="date" value={addForm.start_date}
                onChange={(e) => setAddForm((f) => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>End</label>
              <input className="input" type="date" value={addForm.end_date}
                onChange={(e) => setAddForm((f) => ({ ...f, end_date: e.target.value }))} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
          </form>
        )}

        {ownStages.length === 0 ? (
          <PortalEmpty message="No stages of your own yet — add the first one above." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ownStages.map((st) => (
              <div key={st.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 8, flexWrap: 'wrap',
              }}>
                <span style={{ fontFamily: 'var(--fm)', fontSize: 13, color: 'var(--muted)', width: 24 }}>{st.seq}</span>

                {editingId === st.id ? (
                  <>
                    <input className="input" style={{ flex: 1, minWidth: 160 }} value={edit.name}
                      onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))} />
                    <input className="input" style={{ width: 140 }} placeholder="Milestone" value={edit.milestone}
                      onChange={(e) => setEdit((s) => ({ ...s, milestone: e.target.value }))} />
                    <input className="input" type="date" value={edit.start_date}
                      onChange={(e) => setEdit((s) => ({ ...s, start_date: e.target.value }))} />
                    <input className="input" type="date" value={edit.end_date}
                      onChange={(e) => setEdit((s) => ({ ...s, end_date: e.target.value }))} />
                    <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 13 }}
                      disabled={busy} onClick={() => saveEdit(st)}>Save</button>
                    <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }}
                      onClick={() => setEditingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{st.name}</div>
                      {st.milestone && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{st.milestone}</div>}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)', width: 190, textAlign: 'right' }}>
                      {fmtDate(st.start_date)} → {fmtDate(st.end_date)}
                    </span>
                    <span className={`badge ${STATUS_BADGE[st.status]}`} style={{ width: 92, justifyContent: 'center' }}>
                      {st.status.replace('_', ' ')}
                    </span>
                    {NEXT[st.status] && (
                      <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }}
                        disabled={busy} onClick={() => advance(st)}>{NEXT_LABEL[st.status]}</button>
                    )}
                    <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }}
                      disabled={busy} onClick={() => startEdit(st)}>Edit</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </PortalCard>
    </div>
  );
}
