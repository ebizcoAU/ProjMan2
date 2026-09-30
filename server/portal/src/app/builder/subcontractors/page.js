// /builder/subcontractors — the Builder's own subcontractor engagements, line by
// line (xprojman-44 Module C). A row appears when a subcontractor accepts a Job
// Award this Builder sent (JobAwardService.respond, v045). Distinct from the PM's
// aggregate-only /:id/subcontractor-register — this is the Builder's own ledger.
//
// Consent recording: the signed pass-through clause is uploaded through the
// normal Documents pipeline (entity_type='subcontractor_engagement') and then
// its id is posted to .../consent. The server refuses a second recording
// (ALREADY_RECORDED), so there's no replace path here either.
'use client';

import { useEffect, useRef, useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import {
  projectsApi, introductionsApi, documentsApi, subcontractorEngagementsApi,
} from '@/lib/api';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-AU') : '—');

async function downloadDocument(docId) {
  const blob = await documentsApi.fetchBlob(docId);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function ConsentCell({ projectId, eng, onRecorded }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  if (eng.consent_document_id) {
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <span className="badge badge-active">Recorded {fmtDate(eng.consent_recorded_at)}</span>
        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }}
          onClick={() => downloadDocument(eng.consent_document_id).catch((e) => setErr(e.message))}>
          View
        </button>
        {err && <span style={{ fontSize: 12, color: 'var(--red, #c0392b)' }}>{err}</span>}
      </span>
    );
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const up = await documentsApi.upload({
        file, projectId, entityType: 'subcontractor_engagement', entityId: eng.id,
      });
      const docId = up?.data?.data?.document_id;
      if (!docId) throw new Error('Upload did not return a document id');
      await subcontractorEngagementsApi.recordConsent(projectId, eng.id, docId);
      onRecorded();
    } catch (e2) {
      setErr(e2?.response?.data?.message || e2.message || 'Could not record consent');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="badge badge-muted">Not recorded</span>
      <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={onFile} />
      <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy}
        onClick={() => fileRef.current?.click()}>
        {busy ? 'Uploading…' : 'Upload signed consent'}
      </button>
      {err && <span style={{ fontSize: 12, color: 'var(--red, #c0392b)' }}>{err}</span>}
    </span>
  );
}

export default function BuilderSubcontractorsPage() {
  const projects = usePortalData(() => projectsApi.list());
  const contacts = usePortalData(() => introductionsApi.contacts());
  const projectList = projects.data?.data?.projects ?? [];
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    if (!projectId && projectList.length) setProjectId(projectList[0].id);
  }, [projectId, projectList]);

  const [engs, setEngs]       = useState(null);
  const [engErr, setEngErr]   = useState(null);
  const load = async (pid) => {
    if (!pid) return;
    setEngErr(null);
    try {
      const res = await subcontractorEngagementsApi.list(pid);
      setEngs(res?.data?.data?.subcontractor_engagements ?? []);
    } catch (e) {
      setEngs([]);
      setEngErr(e?.response?.data?.message || e.message);
    }
  };
  useEffect(() => { setEngs(null); load(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Names: the engagement row carries subcontractor_user_id; the Builder's own
  // contact book (Panel) is where that person's name already lives.
  const contactRows = contacts.data?.data?.contacts ?? [];
  const nameOf = (eng) => {
    if (eng.subcontractor_name) return eng.subcontractor_name;
    const c = contactRows.find((x) => x.user_id === eng.subcontractor_user_id);
    return c?.full_name || 'Unknown subcontractor';
  };

  const pending = (engs || []).filter((e) => !e.consent_document_id).length;

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Subcontractors
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
        Everyone who has accepted a subcontractor Job Award from you, per job. Record each one&apos;s
        signed pass-through consent here. Until it&apos;s recorded, their identity stays hidden from
        the PM on cost-plus jobs.
      </div>

      {projects.error && <div style={{ marginBottom: 12 }}><PortalError message={projects.error} /></div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }} htmlFor="sub-project">Job</label>
        <select id="sub-project" className="input" style={{ minWidth: 260 }} value={projectId}
          onChange={(e) => setProjectId(e.target.value)} disabled={projects.loading || !projectList.length}>
          {projects.loading && <option value="">Loading jobs…</option>}
          {!projects.loading && !projectList.length && <option value="">No engaged jobs yet</option>}
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>
          ))}
        </select>
        {engs && engs.length > 0 && (
          <span className={`badge ${pending ? 'badge-pending' : 'badge-active'}`}>
            {pending ? `${pending} consent${pending === 1 ? '' : 's'} outstanding` : 'All consents recorded'}
          </span>
        )}
      </div>

      {engErr && <div style={{ marginBottom: 12 }}><PortalError message={engErr} /></div>}

      <PortalCard title="Engagements">
        {!projectId || engs === null ? (
          <PortalEmpty message={projects.loading ? 'Loading…' : 'Pick a job to see its subcontractors.'} />
        ) : engs.length === 0 ? (
          <PortalEmpty message="No subcontractors on this job yet. Send a Job Award from Panel. It appears here once they accept." />
        ) : (
          <PortalTable
            headers={['Subcontractor', 'Trade', 'Engaged', 'Pass-through consent']}
            rows={engs.map((e) => [
              nameOf(e),
              e.trade || '—',
              fmtDate(e.created_at),
              <ConsentCell key="c" projectId={projectId} eng={e} onRecorded={() => load(projectId)} />,
            ])}
          />
        )}
      </PortalCard>
    </div>
  );
}
