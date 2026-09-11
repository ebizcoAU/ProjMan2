// /projects/:id/documents — the Documents repository (xprojman-28 §2), unblocked
// 2026-09-11 by Server's `GET /documents?project_id=` (DocumentService.listByProject,
// commit dbaa649). Phases 1-3 per the doc: Browse (list, filterable by kind/entity),
// Upload (office-side, no owning entity required — resolves to kind 'general'),
// View/download (stream bytes). Phase 4 (organise by stage/unit) stays deferred, same
// gap the doc named (no modular_units to key on).
'use client';

import { useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalDialog } from '@/components/portal/PortalDialog';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, documentsApi } from '@/lib/api';
import { ProjectTabs } from '../_ProjectTabs';

// Mirrors DocumentService's KINDS/ENTITY_TYPES (server/api/src/services/DocumentService.js)
// — a plain display label map, not re-validated client-side (the server is the source
// of truth; an unrecognised value here just falls back to itself).
const KIND_LABEL = {
  general: 'General', inspection_photo: 'Inspection photo', defect_photo: 'Defect photo',
  certificate: 'Certificate', site_diary_photo: 'Site diary photo', delivery_docket: 'Delivery docket',
  task_document: 'Task document', task_quote: 'Task quote',
};
const ENTITY_LABEL = {
  inspection_item: 'Inspection', defect: 'Defect', certificate: 'Certificate',
  site_diary: 'Site diary', delivery: 'Delivery', task: 'Task', task_quote: 'Task quote',
};
const UPLOAD_KINDS = ['general', 'certificate', 'delivery_docket', 'task_document'];

const bytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const dt = (v) => (v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const td = { padding: '7px 12px', color: 'var(--text)', fontSize: 13 };

export default function DocumentsPage() {
  const { id } = useParams();
  const { confirm } = usePortalDialog();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const docs = usePortalData(() => documentsApi.listByProject(id), [id]);
  const fileRef = useRef(null);
  const [kindFilter, setKindFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [uploadKind, setUploadKind] = useState('general');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionErr, setActionErr] = useState(null);

  const proj = project.data?.data?.project;
  const stages = project.data?.data?.stages || [];
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || (proj && 'contract_value' in proj);

  const loading = project.loading || docs.loading;
  const error = project.error || docs.error;
  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!proj)   return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const all = docs.data?.data?.documents || [];
  const kinds = [...new Set(all.map((d) => d.kind))].sort();
  const entities = [...new Set(all.map((d) => d.entity_type).filter(Boolean))].sort();
  const rows = all.filter((d) =>
    (!kindFilter || d.kind === kindFilter) &&
    (!entityFilter || d.entity_type === entityFilter));

  const download = async (doc) => {
    setBusyId(doc.document_id); setActionErr(null);
    try {
      const blob = await documentsApi.fetchBlob(doc.document_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = doc.original_filename || 'file';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setActionErr(err?.response?.data?.message || err.message || 'Could not download');
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (doc) => {
    const ok = await confirm(`"${doc.original_filename || 'This document'}" will be removed from the repository.`, {
      title: 'Delete document?', confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    setBusyId(doc.document_id); setActionErr(null);
    try {
      await documentsApi.remove(doc.document_id);
      await docs.refetch();
    } catch (err) {
      setActionErr(err?.response?.data?.message || err.message || 'Could not delete');
    } finally {
      setBusyId(null);
    }
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true); setUploadErr(null);
    try {
      await documentsApi.upload({ file, projectId: id, kind: uploadKind });
      if (fileRef.current) fileRef.current.value = '';
      await docs.refetch();
    } catch (err) {
      setUploadErr(err?.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />

      <PortalCard title="Upload">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>File</label>
            <input ref={fileRef} type="file" className="input" style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>Kind</label>
            <select className="input" style={{ width: 170 }} value={uploadKind} onChange={(e) => setUploadKind(e.target.value)}>
              {UPLOAD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={uploading} onClick={upload}>
            {uploading ? 'Uploading…' : '+ Upload'}
          </button>
        </div>
        {uploadErr && <div style={{ marginTop: 10 }}><PortalError message={uploadErr} /></div>}
      </PortalCard>

      <div style={{ height: 12 }} />

      <PortalCard title={`Documents${rows.length ? ` · ${rows.length}` : ''}`}>
        {all.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <select className="input" style={{ width: 170 }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="">All kinds</option>
              {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}
            </select>
            <select className="input" style={{ width: 170 }} value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="">All entities</option>
              {entities.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e] || e}</option>)}
            </select>
          </div>
        )}

        {actionErr && <div style={{ marginBottom: 10 }}><PortalError message={actionErr} /></div>}

        {rows.length === 0 ? (
          <PortalEmpty message={all.length === 0 ? 'No documents on this project yet.' : 'No documents match this filter.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                  <th style={th}>File</th>
                  <th style={th}>Kind</th>
                  <th style={th}>Entity</th>
                  <th style={th}>Size</th>
                  <th style={th}>Uploaded by</th>
                  <th style={th}>Uploaded</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => (
                  <tr key={d.document_id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                    <td style={td}>{d.original_filename || '(unnamed)'}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{KIND_LABEL[d.kind] || d.kind}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{d.entity_type ? (ENTITY_LABEL[d.entity_type] || d.entity_type) : '—'}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{bytes(d.size_bytes)}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{d.uploaded_by_name || '—'}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{dt(d.created_at)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn" style={{ padding: '3px 8px', fontSize: 11.5, marginRight: 6 }}
                        disabled={busyId === d.document_id} onClick={() => download(d)}>
                        {busyId === d.document_id ? '…' : 'Download'}
                      </button>
                      <button type="button" className="btn" style={{ padding: '3px 8px', fontSize: 11.5, color: 'var(--red)' }}
                        disabled={busyId === d.document_id} onClick={() => doDelete(d)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PortalCard>
    </div>
  );
}
