// /projects/:id/quality — the office's quality review surface (servdesignspec §12,
// projman-05 gap #3). READ-ONLY: inspections/defects/certificates are captured on
// site (inspector checklist, punch-list, cert upload) and ride /sync/push; this tab
// is the office looking at what came back, not a second way to author it. All three
// reads (inspections+items, defects, certificates) already exist —
// GET /projects/:id/inspections|defects|certificates — no new server endpoints.
'use client';

import { useState, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, qualityApi } from '@/lib/api';
import { ProjectTabs } from '../_ProjectTabs';

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

export default function QualityPage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const inspections = usePortalData(() => qualityApi.inspections(id), [id]);
  const defects = usePortalData(() => qualityApi.defects(id), [id]);
  const certificates = usePortalData(() => qualityApi.certificates(id), [id]);
  const [openId, setOpenId] = useState(null);

  const proj = project.data?.data?.project;
  const stages = project.data?.data?.stages || [];
  const stageById = Object.fromEntries(stages.map((st) => [st.id, `${st.seq}. ${st.name}`]));
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || (proj && 'contract_value' in proj);

  const loading = project.loading || inspections.loading || defects.loading || certificates.loading;
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

      <div style={{ height: 16 }} />

      <PortalCard title="Defects — punch-list">
        {defectRows.length === 0 ? <PortalEmpty message="No defects raised." /> : (
          <Table head={<>
            <Th>Location</Th><Th>Trade</Th><Th>Description</Th><Th>Severity</Th><Th>Status</Th><Th>Assigned to</Th><Th>Due</Th>
          </>}>
            {defectRows.map((dft, i) => (
              <tr key={dft.id} style={{ borderBottom: i < defectRows.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                <Td>{dft.location || '—'}</Td>
                <Td muted>{dft.trade || '—'}</Td>
                <Td>{dft.description || '—'}</Td>
                <Td><span style={{ color: SEVERITY_COLOR[dft.severity] || 'var(--text)', fontWeight: 600 }}>{dft.severity}</span></Td>
                <Td><span className={`badge ${DEFECT_BADGE[dft.status] || 'badge-muted'}`}>{dft.status.replace('_', ' ')}</span></Td>
                <Td muted>{dft.assigned_to_name || (dft.assigned_to ? dft.assigned_to.slice(0, 8) : '—')}</Td>
                <Td muted>{d(dft.due_date)}</Td>
              </tr>
            ))}
          </Table>
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
