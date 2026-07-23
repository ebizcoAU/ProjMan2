// /projects/:id — project detail with the Programme tab (servdesignspec §10, Step 6).
// Stage list from the 18-stage engine: status, hold-point + validation state, advance
// controls, inspector validate, and a cost roll-up. Money fields are simply absent
// from the payload for roles without money.read (server-side redaction), so the tab
// renders whatever it's given.
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, stageTemplatesApi, getSavedUser } from '@/lib/api';
import { ProjectTabs } from './_ProjectTabs';

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

  const d = data?.data;
  const project = d?.project;
  const stages = d?.stages || [];
  const role = (getSavedUser() || {})?.role;
  const canValidate = role === 'inspector';
  const seesMoney = stages.some(st => 'estimated_amount' in st) || (project && 'contract_value' in project);

  const act = async (fn) => {
    setBusy(true); setActionError(null);
    try { await fn(); await refetch(); }
    catch (err) { setActionError(err?.response?.data?.message || err.message); }
    finally { setBusy(null); }
  };
  const advance = (st) => act(() => projectsApi.advanceStage(id, st.id, NEXT[st.status]));
  const validate = (st, result) => act(() => projectsApi.validateStage(id, st.id, result, null));
  const instantiate = (templateId) => act(() => projectsApi.instantiate(id, templateId));

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!project) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const done = stages.filter(s => s.status === 'complete').length;
  const roll = (col) => stages.reduce((sum, s) => sum + (Number(s[col]) || 0), 0);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
          <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{project.code}</span>{'  '}{project.name}
        </div>
        <div style={{ fontSize: 14, color: 'var(--dim)', marginTop: 4 }}>
          {project.site_address || '—'} · {project.customer_name || 'no customer'} · {project.status}
        </div>
      </div>

      <ProjectTabs id={id} seesMoney={seesMoney} />

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
              return (
                <div key={st.id}>
                  {st.part && st.part !== prevPart && (
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                      color: 'var(--muted)', margin: '10px 0 4px' }}>
                      Part {st.part} · {PART_NAME[st.part]}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 8 }}>
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
                        disabled={busy} onClick={() => advance(st)}>
                        {NEXT_LABEL[st.status]}
                      </button>
                    )}
                    {/* Inspector validate on a hold point */}
                    {canValidate && st.is_hold_point && !st.is_validated && (
                      <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 13 }}
                        disabled={busy} onClick={() => validate(st, 'pass')}>
                        Validate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </PortalCard>
      )}
    </div>
  );
}
