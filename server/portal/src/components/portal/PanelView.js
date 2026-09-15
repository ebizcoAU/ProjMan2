// PanelView.js — shared Panel implementation (xprojman-44 Module A + B). Used by
// PM's /panel (role='builder') and Builder's /builder/panel (role IN
// ('tradie','foreperson')). Panel itself is a read-only filtered render of
// GET /introductions — Self-Registration and Introduction both already happen
// on the App (portaldesignspec §3.4 module 6); this screen never initiates
// either. "Send Job Award" per row opens an inline project-scoped form —
// the one write this screen does, reusing POST /:id/job-awards unchanged.
'use client';

import { useState } from 'react';
import { PortalCard }    from './PortalCard';
import { PortalEmpty }   from './PortalEmpty';
import { PortalError }   from './PortalError';
import { usePortalData } from './usePortalData';
import { introductionsApi, jobAwardsApi, projectsApi } from '@/lib/api';

const ENGAGEMENT_TYPES = [
  { v: 'independent_fixed',      label: 'Independent — fixed price' },
  { v: 'independent_cost_plus',  label: 'Independent — cost plus' },
  { v: 'employee',                label: 'Employee (shared Cost Plan)' },
];

function SendAwardRow({ contact, roleOffered, onSent }) {
  const [open, setOpen]         = useState(false);
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [engType, setEngType]     = useState('independent_fixed');
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState(null);
  const [sent, setSent]           = useState(false);

  const openForm = async () => {
    setOpen(true);
    if (projects) return;
    try {
      const res = await projectsApi.list();
      setProjects(res?.data?.data?.projects ?? []);
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!projectId) return;
    setBusy(true); setErr(null);
    try {
      await jobAwardsApi.create(projectId, {
        to_user_id: contact.user_id,
        role_offered: roleOffered,
        ...(roleOffered === 'builder' ? { builder_engagement_type: engType } : {}),
      });
      setSent(true);
      onSent?.();
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  if (sent) {
    return <span style={{ fontSize: 13, color: 'var(--green)' }}>Job Award sent</span>;
  }

  if (!open) {
    return (
      <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }} onClick={openForm}>
        Send Job Award
      </button>
    );
  }

  return (
    <form onSubmit={send} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select className="input" style={{ minWidth: 180 }} value={projectId} required
        onChange={(e) => setProjectId(e.target.value)}>
        <option value="">
          {projects === null ? 'Loading projects…' : 'Select project…'}
        </option>
        {(projects || []).map((p) => (
          <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>
        ))}
      </select>
      {roleOffered === 'builder' && (
        <select className="input" value={engType} onChange={(e) => setEngType(e.target.value)}>
          {ENGAGEMENT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy || !projectId}>
        {busy ? 'Sending…' : 'Send'}
      </button>
      <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span style={{ fontSize: 12, color: 'var(--red, #c0392b)' }}>{err}</span>}
    </form>
  );
}

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-AU') : '—');

/**
 * @param {('builder'|'tradieForeperson')} filter — which contact roles this panel shows
 * @param {('builder'|'subcontractor')} sendAs — role_offered value the "Send Job Award" form uses
 * @param {string} title / emptyMessage — copy, differs PM vs Builder
 */
export function PanelView({ filter, sendAs, title, emptyMessage }) {
  const { data, loading, error } = usePortalData(() => introductionsApi.contacts());
  const contacts = data?.data?.contacts ?? [];

  const filtered = contacts.filter((c) =>
    filter === 'builder' ? c.role === 'builder' : ['tradie', 'foreperson'].includes(c.role)
  );

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 14, color: 'var(--dim)', marginTop: 4 }}>
          Introduced contacts only — Self-Registration and Introduction both happen
          on the App. Sending a Job Award here requires picking the project it's for.
        </div>
      </div>

      <PortalCard title={`${filtered.length} contact${filtered.length === 1 ? '' : 's'}`}>
        {filtered.length === 0 ? (
          <PortalEmpty message={emptyMessage} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map((c) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 8, flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{c.full_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                    {c.role} · introduced {fmtDate(c.introduced_at)}
                  </div>
                </div>
                <SendAwardRow contact={c} roleOffered={sendAs} />
              </div>
            ))}
          </div>
        )}
      </PortalCard>
    </div>
  );
}
