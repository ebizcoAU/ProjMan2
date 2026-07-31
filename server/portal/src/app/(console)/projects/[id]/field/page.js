// /projects/:id/field — the Field / Team test surface (DIRECTIVE 1 Steps A + D2).
//
// Purpose: give the office a live window onto what the FIELD APP pushes — stage
// progress, per-task tick→verify state, and per-stage hold-point checklists — plus the
// two server-mediated actions the app can't self-serve: verify a ticked task
// (progress.verify) and satisfy a hold-point requirement (the authority the row names).
// Built primarily to exercise/observe the app during integration (xprojman-04, PM
// directive 2026-07-28): flip "Live" on and watch pushes arrive.
//
// Reads: projectsApi.detail(id) (stages + tasks) and fieldApi.holdPoints per expanded
// stage. Writes: fieldApi.verifyTask / satisfyHoldPoint. Every action surfaces the
// server's own verdict inline — a 403 is a valid, informative test result here.
'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, fieldApi, authApi, getSavedUser } from '@/lib/api';
import { ProjectTabs } from '../_ProjectTabs';

// Mirrors HoldPointService.PERMISSION_BY_ROLE (server-side) — which capability a
// requirement's `required_role` demands. Kept small and commented so the button
// enable/disable matches what the server will actually allow.
const SATISFY_PERM = {
  inspector: 'quality.validate',
  siteSupervisor: 'progress.verify',
  accountant: 'tax.approve',
  projectManager: 'programme.write',
};
const STAGE_BADGE = { complete: 'badge-active', in_progress: 'badge-pending' };
const dt = (v) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const short = (v) => v ? String(v).slice(0, 8) : '—';

function Th({ children, right }) {
  return <th style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', color: 'var(--dim)', fontSize: 12 }}>{children}</th>;
}
function Td({ children, right, muted }) {
  return <td style={{ padding: '8px 12px', textAlign: right ? 'right' : 'left', color: muted ? 'var(--dim)' : 'var(--text)', verticalAlign: 'middle' }}>{children}</td>;
}
function Table({ head, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Progress({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--b2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: p === 100 ? 'var(--green)' : 'var(--cyan)' }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--dim)', width: 34, textAlign: 'right' }}>{p}%</span>
    </div>
  );
}
function ActionBtn({ children, onClick, disabled, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{
        padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6,
        border: '1px solid var(--b1)', cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--dim)' : 'var(--brand)', background: 'var(--s1)',
        opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}

export default function FieldPage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const perms = usePortalData(() => authApi.permissions(), []);
  const [live, setLive] = useState(false);
  const [openStage, setOpenStage] = useState(null);
  const [holdPoints, setHoldPoints] = useState({}); // stageId -> { loading, rows, error }
  const [busy, setBusy] = useState(null);            // entity id currently acting
  const [flash, setFlash] = useState({});            // entity id -> { ok, msg }
  const [tick, setTick] = useState(0);               // bumped by the live timer

  const savedUser = typeof window !== 'undefined' ? getSavedUser() : null;
  const permList = perms.data?.data?.permissions || [];
  const canVerify = permList.includes('progress.verify');
  const canSatisfy = (role) => !SATISFY_PERM[role] || permList.includes(SATISFY_PERM[role]);

  const loadHoldPoints = useCallback(async (stageId) => {
    setHoldPoints((m) => ({ ...m, [stageId]: { ...(m[stageId] || {}), loading: true } }));
    try {
      const res = await fieldApi.holdPoints(id, stageId);
      setHoldPoints((m) => ({ ...m, [stageId]: { loading: false, rows: res.data?.data?.requirements || [], error: null } }));
    } catch (err) {
      setHoldPoints((m) => ({ ...m, [stageId]: { loading: false, rows: [], error: err.message } }));
    }
  }, [id]);

  const toggleStage = (stageId) => {
    if (openStage === stageId) { setOpenStage(null); return; }
    setOpenStage(stageId);
    if (!holdPoints[stageId]) loadHoldPoints(stageId);
  };

  // Live "watch" — poll the project detail (and any expanded stage's hold points) so
  // an app push shows up without a manual reload.
  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => setTick((t) => t + 1), 8000);
    return () => clearInterval(iv);
  }, [live]);
  useEffect(() => {
    if (tick === 0) return;
    project.refetch();
    if (openStage) loadHoldPoints(openStage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function act(entityId, fn, okMsg) {
    setBusy(entityId);
    setFlash((f) => ({ ...f, [entityId]: undefined }));
    try {
      await fn();
      setFlash((f) => ({ ...f, [entityId]: { ok: true, msg: okMsg } }));
      await project.refetch();
      if (openStage) await loadHoldPoints(openStage);
    } catch (err) {
      setFlash((f) => ({ ...f, [entityId]: { ok: false, msg: err.message || 'Failed' } }));
    } finally {
      setBusy(null);
    }
  }

  const proj = project.data?.data?.project;
  const stages = project.data?.data?.stages || [];
  const tasks = project.data?.data?.tasks || [];
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || (proj && 'contract_value' in proj);
  const stageLabel = Object.fromEntries(stages.map((st) => [st.id, `${st.seq}. ${st.name}`]));

  if (project.loading && !proj) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const ticked = tasks.filter((t) => Number(t.completion) >= 100);
  const verified = tasks.filter((t) => t.verified_by);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />

      {/* Control bar — who you are (drives which actions are enabled) + the live watch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Signed in as <b style={{ color: 'var(--text)' }}>{savedUser?.full_name || '—'}</b>
          {savedUser?.role ? <span className="badge badge-muted" style={{ marginLeft: 6 }}>{savedUser.role}</span> : null}
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live <span style={{ fontSize: 11 }}>(auto-refresh 8s)</span>
        </label>
        <ActionBtn onClick={() => { project.refetch(); if (openStage) loadHoldPoints(openStage); }}>Refresh</ActionBtn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Stages complete" value={stages.filter((s) => s.status === 'complete').length} unit={`/ ${stages.length}`} color="var(--green)" />
        <PortalKpi label="Stages in progress" value={stages.filter((s) => s.status === 'in_progress').length} color="var(--cyan)" />
        <PortalKpi label="Tasks ticked" value={ticked.length} unit={`/ ${tasks.length}`} color="var(--text)" />
        <PortalKpi label="Tasks verified" value={verified.length} unit={`/ ${ticked.length}`} color="var(--green)" />
      </div>

      {/* ── Stages + hold-point checklists ─────────────────────────────────────── */}
      <PortalCard title="Stages & hold points">
        {stages.length === 0 ? <PortalEmpty message="No programme instantiated yet." /> : (
          <Table head={<>
            <Th>Seq</Th><Th>Stage</Th><Th>Part</Th><Th>Status</Th><Th>Hold point</Th>
          </>}>
            {stages.map((st, i) => (
              <Fragment key={st.id}>
                <tr onClick={() => toggleStage(st.id)}
                  style={{ borderBottom: i < stages.length - 1 || openStage === st.id ? '1px solid var(--b2)' : 'none', cursor: 'pointer' }}>
                  <Td muted>{st.seq}</Td>
                  <Td>{st.name}</Td>
                  <Td muted>{st.part || '—'}</Td>
                  <Td><span className={`badge ${STAGE_BADGE[st.status] || 'badge-muted'}`}>{(st.status || 'not_started').replace('_', ' ')}</span></Td>
                  <Td>{st.is_hold_point
                    ? <span className={`badge ${st.is_validated ? 'badge-active' : 'badge-pending'}`}>{st.is_validated ? 'validated' : 'awaiting'}</span>
                    : <span style={{ color: 'var(--dim)' }}>—</span>}</Td>
                </tr>
                {openStage === st.id && (
                  <tr key={`${st.id}-hp`}>
                    <td colSpan={5} style={{ padding: '6px 12px 14px 24px', background: 'var(--s2)' }}>
                      {(() => {
                        const hp = holdPoints[st.id];
                        if (!hp || hp.loading) return <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>Loading hold points…</div>;
                        if (hp.error) return <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 0' }}>{hp.error}</div>;
                        if (!hp.rows.length) return <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>No hold-point requirements on this stage.</div>;
                        return (
                          <Table head={<><Th>Requirement</Th><Th>Authority</Th><Th>Type</Th><Th>Blocks</Th><Th>Status</Th><Th right>&nbsp;</Th></>}>
                            {hp.rows.map((r) => {
                              const open = r.status !== 'satisfied';
                              const allowed = canSatisfy(r.required_role);
                              const f = flash[r.id];
                              return (
                                <tr key={r.id} style={{ borderBottom: 'none' }}>
                                  <Td>{r.label}{Number(r.jurisdiction) === 1 ? <span className="badge badge-muted" style={{ marginLeft: 6 }}>jurisdiction</span> : null}</Td>
                                  <Td muted>{r.required_role}</Td>
                                  <Td muted>{(r.inspection_type || '').replace('_', ' ') || '—'}</Td>
                                  <Td>{Number(r.blocks_progress) === 1 ? <span className="badge badge-revoked">blocking</span> : <span style={{ color: 'var(--dim)' }}>no</span>}</Td>
                                  <Td><span className={`badge ${open ? 'badge-pending' : 'badge-active'}`}>{r.status || 'open'}</span></Td>
                                  <Td right>
                                    {open ? (
                                      <ActionBtn
                                        disabled={!allowed || busy === r.id}
                                        title={allowed ? `Satisfy as ${r.required_role}` : `Needs ${SATISFY_PERM[r.required_role]} (${r.required_role})`}
                                        onClick={() => act(r.id, () => fieldApi.satisfyHoldPoint(id, st.id, r.id), 'Satisfied')}>
                                        {busy === r.id ? '…' : 'Satisfy'}
                                      </ActionBtn>
                                    ) : <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>}
                                    {f && <div style={{ fontSize: 11, marginTop: 4, color: f.ok ? 'var(--green)' : 'var(--red)' }}>{f.msg}</div>}
                                  </Td>
                                </tr>
                              );
                            })}
                          </Table>
                        );
                      })()}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
        {stages.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Click a stage to view its hold-point checklist.</div>}
      </PortalCard>

      <div style={{ height: 16 }} />

      {/* ── Tasks: tick (app) → verify (here) ──────────────────────────────────── */}
      <PortalCard title="Tasks — tick & verify">
        {tasks.length === 0 ? <PortalEmpty message="No tasks pushed from the field yet." /> : (
          <Table head={<>
            <Th>Task</Th><Th>Stage</Th><Th>Assigned</Th><Th>Progress</Th><Th>Verified</Th><Th right>&nbsp;</Th>
          </>}>
            {tasks.map((t, i) => {
              const done = Number(t.completion) >= 100;
              const isVerified = !!t.verified_by;
              const f = flash[t.id];
              return (
                <tr key={t.id} style={{ borderBottom: i < tasks.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                  <Td>{t.name}</Td>
                  <Td muted>{stageLabel[t.stage_id] || '—'}</Td>
                  <Td muted>{t.assigned_to_name || short(t.assigned_to)}</Td>
                  <Td><Progress pct={t.completion} /></Td>
                  <Td>{isVerified
                    ? <span className="badge badge-active" title={dt(t.verified_at)}>verified · {short(t.verified_by)}</span>
                    : done ? <span className="badge badge-pending">awaiting verify</span>
                    : <span style={{ color: 'var(--dim)' }}>—</span>}</Td>
                  <Td right>
                    {done && !isVerified ? (
                      <ActionBtn
                        disabled={!canVerify || busy === t.id}
                        title={canVerify ? 'Verify this ticked task' : 'Needs progress.verify (Site Supervisor)'}
                        onClick={() => act(t.id, () => fieldApi.verifyTask(id, t.id), 'Verified')}>
                        {busy === t.id ? '…' : 'Verify'}
                      </ActionBtn>
                    ) : null}
                    {f && <div style={{ fontSize: 11, marginTop: 4, color: f.ok ? 'var(--green)' : 'var(--red)' }}>{f.msg}</div>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </PortalCard>
    </div>
  );
}
