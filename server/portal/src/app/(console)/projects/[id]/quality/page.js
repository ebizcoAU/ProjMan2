// /projects/:id/quality — the office's quality review surface (servdesignspec §12,
// projman-05 gap #3). Inspections/defects/certificates are captured on site
// (inspector checklist, punch-list, cert upload) and ride /sync/push. Inspections
// and certificates are read-only here. Defects can be MANAGED from the office
// (PATCH /projects/:id/defects/:defectId, dbaa649): reassign, reschedule, re-grade,
// move through open → in progress → closed. Gated on quality.write, the same
// permission the sync path uses. Raising a new defect stays on site (no REST create).
'use client';

import { useState, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { usePortalDialog } from '@/components/portal/PortalDialog';
import { projectsApi, qualityApi, authApi } from '@/lib/api';
import { ProjectTabs } from '../_ProjectTabs';
import { ChecklistReview } from '@/components/portal/ChecklistReview';

const RESULT_BADGE = { pending: 'badge-pending', pass: 'badge-active', fail: 'badge-revoked', na: 'badge-muted' };
const DEFECT_BADGE = { open: 'badge-pending', in_progress: 'badge-pending', closed: 'badge-active' };
const SEVERITY_COLOR = { high: 'var(--red)', medium: 'var(--text)', low: 'var(--dim)' };
const dt = (v) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const d = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';

function Th({ children, right }) {
  return <th style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', color: 'var(--dim)', fontSize: 12 }}>{children}</th>;
}
function Td({ children, right, muted }) {
  return <td style={{ padding: '8px 12px', textAlign: right ? 'right' : 'left', color: muted ? 'var(--dim)' : 'var(--text)' }}>{children}</td>;
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

const DEFECT_FIELDS = ['location', 'trade', 'description', 'severity', 'status', 'assigned_to_name', 'due_date'];
const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

function DefectEditor({ projectId, defect, onSaved, onCancel }) {
  const { confirm } = usePortalDialog();
  const [form, setForm] = useState(() => ({
    location: defect.location || '', trade: defect.trade || '', description: defect.description || '',
    severity: defect.severity || 'medium', status: defect.status || 'open',
    assigned_to_name: defect.assigned_to_name || '', due_date: toDateInput(defect.due_date),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Send only what changed; empty text clears to NULL (the columns are nullable).
  const changes = {};
  for (const k of DEFECT_FIELDS) {
    const before = k === 'due_date' ? toDateInput(defect[k]) : (defect[k] ?? '');
    if (form[k] !== before) changes[k] = form[k] === '' && k !== 'severity' && k !== 'status' ? null : form[k];
  }
  const dirty = Object.keys(changes).length > 0;

  const save = async (e) => {
    e.preventDefault();
    if (!dirty) return;
    if (changes.status === 'closed' && !(await confirm(
      'Close this defect? Only do this once the rectification has been checked.',
      { title: 'Close defect', confirmLabel: 'Close defect' }))) return;
    setBusy(true); setErr(null);
    try {
      await qualityApi.patchDefect(projectId, defect.id, changes);
      onSaved();
    } catch (e2) {
      setErr(e2?.response?.data?.message || e2.message || 'Could not save');
    } finally { setBusy(false); }
  };

  const lbl = { fontSize: 12, color: 'var(--dim)', display: 'block', marginBottom: 4 };
  return (
    <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
      <label><span style={lbl}>Location</span><input className="input" value={form.location} onChange={set('location')} /></label>
      <label><span style={lbl}>Trade</span><input className="input" value={form.trade} onChange={set('trade')} /></label>
      <label><span style={lbl}>Assigned to</span><input className="input" value={form.assigned_to_name} onChange={set('assigned_to_name')} placeholder="Name" /></label>
      <label><span style={lbl}>Due</span><input className="input" type="date" value={form.due_date} onChange={set('due_date')} /></label>
      <label><span style={lbl}>Severity</span>
        <select className="input" value={form.severity} onChange={set('severity')}>
          <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
        </select>
      </label>
      <label><span style={lbl}>Status</span>
        <select className="input" value={form.status} onChange={set('status')}>
          <option value="open">open</option><option value="in_progress">in progress</option><option value="closed">closed</option>
        </select>
      </label>
      <label style={{ gridColumn: '1 / -1' }}><span style={lbl}>Description</span>
        <textarea className="input" rows={2} value={form.description} onChange={set('description')} style={{ width: '100%', resize: 'vertical' }} />
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" type="submit" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      </div>
    </form>
  );
}

export default function QualityPage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const inspections = usePortalData(() => qualityApi.inspections(id), [id]);
  const defects = usePortalData(() => qualityApi.defects(id), [id]);
  const certificates = usePortalData(() => qualityApi.certificates(id), [id]);
  const [openId, setOpenId] = useState(null);
  const [editId, setEditId] = useState(null);
  const perms = usePortalData(() => authApi.permissions());
  const canManageDefects = (perms.data?.data?.permissions || []).includes('quality.write');
  const canReviewChecklists = (perms.data?.data?.permissions || []).includes('checklists.manage');

  const proj = project.data?.data?.project;
  const stages = project.data?.data?.stages || [];
  const stageById = Object.fromEntries(stages.map((st) => [st.id, `${st.seq}. ${st.name}`]));
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || (proj && 'contract_value' in proj);

  // First load only. A refetch after a defect save keeps the old data on screen
  // instead of blanking the whole page.
  const loading = [project, inspections, defects, certificates].some((q) => q.loading && !q.data);
  const error = project.error || inspections.error || defects.error || certificates.error;
  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!proj)   return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const inspRows = inspections.data?.data?.inspections || [];
  const defectRows = defects.data?.data?.defects || [];
  const certRows = certificates.data?.data?.certificates || [];

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Inspections" value={inspRows.length} color="var(--text)" />
        <PortalKpi label="Pending inspections" value={inspRows.filter((i) => i.result === 'pending').length} color="var(--cyan)" />
        <PortalKpi label="Open defects" value={defectRows.filter((dft) => dft.status !== 'closed').length} color="var(--red)" />
        <PortalKpi label="Certs lapsing ≤30d" value={certRows.filter((c) => Number(c.lapsing_soon) === 1).length} color="var(--red)" />
      </div>

      <PortalCard title="Inspections">
        {inspRows.length === 0 ? <PortalEmpty message="No inspections recorded yet." /> : (
          <Table head={<>
            <Th>Type</Th><Th>Stage</Th><Th>Result</Th><Th>Inspector</Th><Th>Completed</Th>
          </>}>
            {inspRows.map((insp, i) => (
              <Fragment key={insp.id}>
                <tr
                  onClick={() => setOpenId(openId === insp.id ? null : insp.id)}
                  style={{ borderBottom: i < inspRows.length - 1 || openId === insp.id ? '1px solid var(--b2)' : 'none', cursor: 'pointer' }}>
                  <Td>{insp.type}{insp.is_hold_point ? ' (hold point)' : ''}</Td>
                  <Td muted>{stageById[insp.stage_id] || '—'}</Td>
                  <Td><span className={`badge ${RESULT_BADGE[insp.result] || 'badge-muted'}`}>{insp.result}</span></Td>
                  <Td muted>{insp.inspector_id ? insp.inspector_id.slice(0, 8) : '—'}</Td>
                  <Td muted>{dt(insp.completed_at)}</Td>
                </tr>
                {openId === insp.id && (
                  <tr key={`${insp.id}-items`}>
                    <td colSpan={5} style={{ padding: '4px 12px 14px 24px', background: 'var(--s2)' }}>
                      {(insp.items || []).length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>No checklist items pushed yet.</div>
                      ) : (
                        <Table head={<><Th>#</Th><Th>Description</Th><Th>Result</Th><Th>Note</Th><Th>Photo</Th></>}>
                          {insp.items.map((it) => (
                            <tr key={it.id} style={{ borderBottom: 'none' }}>
                              <Td muted>{it.seq}</Td>
                              <Td>{it.description}</Td>
                              <Td><span className={`badge ${RESULT_BADGE[it.result] || 'badge-muted'}`}>{it.result}</span></Td>
                              <Td muted>{it.note || '—'}</Td>
                              <Td muted>{it.photo_id ? '📷' : '—'}</Td>
                            </tr>
                          ))}
                        </Table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
        {inspRows.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Click a row to view its checklist items.</div>
        )}
      </PortalCard>

      {canReviewChecklists && (
        <>
          <div style={{ height: 16 }} />
          <PortalCard title="Checklists — toolbox talks, pre-starts, internal QA">
            <ChecklistReview projectId={id} stageById={stageById} />
          </PortalCard>
        </>
      )}

      <div style={{ height: 16 }} />

      <PortalCard title="Defects — punch-list">
        {defectRows.length === 0 ? <PortalEmpty message="No defects raised." /> : (
          <Table head={<>
            <Th>Location</Th><Th>Trade</Th><Th>Description</Th><Th>Severity</Th><Th>Status</Th><Th>Assigned to</Th><Th>Due</Th>
          </>}>
            {defectRows.map((dft, i) => (
              <Fragment key={dft.id}>
              <tr
                onClick={canManageDefects ? () => setEditId(editId === dft.id ? null : dft.id) : undefined}
                style={{ borderBottom: i < defectRows.length - 1 || editId === dft.id ? '1px solid var(--b2)' : 'none', cursor: canManageDefects ? 'pointer' : 'default' }}>
                <Td>{dft.location || '—'}</Td>
                <Td muted>{dft.trade || '—'}</Td>
                <Td>{dft.description || '—'}</Td>
                <Td><span style={{ color: SEVERITY_COLOR[dft.severity] || 'var(--text)', fontWeight: 600 }}>{dft.severity}</span></Td>
                <Td><span className={`badge ${DEFECT_BADGE[dft.status] || 'badge-muted'}`}>{dft.status.replace('_', ' ')}</span></Td>
                <Td muted>{dft.assigned_to_name || (dft.assigned_to ? dft.assigned_to.slice(0, 8) : '—')}</Td>
                <Td muted>{d(dft.due_date)}</Td>
              </tr>
              {editId === dft.id && (
                <tr>
                  <td colSpan={7} style={{ padding: '12px 12px 16px 24px', background: 'var(--s2)' }}>
                    <DefectEditor projectId={id} defect={dft}
                      onCancel={() => setEditId(null)}
                      onSaved={async () => { setEditId(null); await defects.refetch(); }} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </Table>
        )}
        {defectRows.length > 0 && canManageDefects && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Click a defect to reassign, reschedule or close it.</div>
        )}
      </PortalCard>

      <div style={{ height: 16 }} />

      <PortalCard title="Certificates">
        {certRows.length === 0 ? <PortalEmpty message="No certificates recorded." /> : (
          <Table head={<>
            <Th>Type</Th><Th>Reference</Th><Th>Issued by</Th><Th>Issued</Th><Th>Expires</Th><Th>&nbsp;</Th>
          </>}>
            {certRows.map((c, i) => (
              <tr key={c.id} style={{ borderBottom: i < certRows.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                <Td>{c.type}</Td>
                <Td muted>{c.reference || '—'}</Td>
                <Td muted>{c.issued_by || '—'}</Td>
                <Td muted>{d(c.issued_at)}</Td>
                <Td muted>{d(c.expires_at)}</Td>
                <Td>{Number(c.lapsing_soon) === 1 && <span className="badge badge-revoked">lapsing ≤30d</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </PortalCard>
    </div>
  );
}
