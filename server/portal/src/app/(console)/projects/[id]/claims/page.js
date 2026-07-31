// /projects/:id/claims — Progress Claims workspace (P7a §7.2/§10.6, portaldesignspec §3.4 #7).
// The Builder→PM billing workflow: Builder submits (claims.submit); PM approves/declines then
// pays (claims.approve). Submit runs the §10.6 claim-freeze server-side (a claim against an
// unvalidated hold-point stage is refused, CLAIM_BLOCKED). Actions are gated on the caller's
// real permission set (GET /auth/permissions), so a PM sees approve/pay, a Builder sees submit.
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, commercialApi, authApi } from '@/lib/api';
import { ProjectTabs }   from '../_ProjectTabs';

const money = (v) => v == null || v === '' ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const STATUS_COLOR = { submitted: 'var(--amber)', approved: 'var(--green)', paid: 'var(--brand)', declined: 'var(--red)' };
function Pill({ text }) {
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11,
    fontWeight: 700, color: '#fff', background: STATUS_COLOR[text] || 'var(--muted)' }}>{text}</span>;
}
const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '8px 12px', color: 'var(--text)', fontSize: 13 };
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--fm)' };

export default function ClaimsPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = usePortalData(async () => {
    const [d, cl, pm] = await Promise.all([
      projectsApi.detail(id),
      commercialApi.progressClaims(id).catch(() => null),
      authApi.permissions().catch(() => null),
    ]);
    return { data: {
      project: d?.data?.data?.project,
      stages:  d?.data?.data?.stages || [],
      claims:  cl?.data?.data?.claims || [],
      perms:   pm?.data?.data?.permissions || [],
    } };
  }, [id]);

  const [form, setForm] = useState({ stage_id: '', amount: '', note: '' });
  const [busy, setBusy] = useState(null);
  const [actionError, setError] = useState(null);

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;

  const project = data?.data?.project;
  if (!project) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const { stages, claims, perms } = data.data;
  const seesMoney = perms.includes('money.read') || perms.includes('claims.submit') || perms.includes('claims.approve');
  const canSubmit  = perms.includes('claims.submit');
  const canApprove = perms.includes('claims.approve');
  const stageName = (sid) => { const st = stages.find(s => s.id === sid); return st ? `${st.seq}. ${st.name}` : '—'; };

  const act = async (key, fn) => {
    setBusy(key); setError(null);
    try { await fn(); await refetch(); }
    catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setBusy(null); }
  };
  const submit = (e) => {
    e.preventDefault();
    act('submit', async () => {
      await commercialApi.submitClaim(id, {
        amount: Number(form.amount), stage_id: form.stage_id || undefined, note: form.note || undefined,
      });
      setForm({ stage_id: '', amount: '', note: '' });
    });
  };

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{project.code}</span>{'  '}{project.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />

      {actionError && <div style={{ marginBottom: 12 }}><PortalError message={actionError} /></div>}

      {canSubmit && (
        <PortalCard title="Submit a progress claim">
          <form onSubmit={submit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>Stage (optional)</label>
              <select className="input" value={form.stage_id} onChange={(e) => setForm(f => ({ ...f, stage_id: e.target.value }))} style={{ minWidth: 220 }}>
                <option value="">— project-level —</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>Amount</label>
              <input className="input" type="number" min="0" step="0.01" value={form.amount}
                onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} required style={{ width: 140 }} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>Note (optional)</label>
              <input className="input" value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy === 'submit' || !form.amount} style={{ padding: '9px 18px' }}>
              {busy === 'submit' ? 'Submitting…' : 'Submit claim'}
            </button>
          </form>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            A claim against a stage that sits behind an unvalidated hold point is refused (claim freeze, §10.6).
          </div>
        </PortalCard>
      )}

      <div style={{ height: 16 }} />

      <PortalCard title={`Progress claims${claims.length ? ` · ${claims.length}` : ''}`}>
        {claims.length === 0 ? (
          <PortalEmpty message="No progress claims yet." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                  <th style={th}>Claim#</th><th style={th}>Stage</th><th style={th}>Status</th>
                  <th style={thR}>Amount</th><th style={thR}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: i < claims.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                    <td style={{ ...td, fontFamily: 'var(--fm)' }}>#{c.claim_number}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{c.stage_id ? stageName(c.stage_id) : '—'}</td>
                    <td style={td}><Pill text={c.status} /></td>
                    <td style={tdR}>{money(c.amount)}</td>
                    <td style={{ ...tdR }}>
                      {canApprove && c.status === 'submitted' && (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-primary" disabled={!!busy} style={{ padding: '5px 12px', fontSize: 12 }}
                            onClick={() => act(`ap:${c.id}`, () => commercialApi.approveClaim(id, c.id, true))}>Approve</button>
                          <button className="btn" disabled={!!busy} style={{ padding: '5px 12px', fontSize: 12 }}
                            onClick={() => act(`dc:${c.id}`, () => commercialApi.approveClaim(id, c.id, false))}>Decline</button>
                        </span>
                      )}
                      {canApprove && c.status === 'approved' && (
                        <button className="btn btn-primary" disabled={!!busy} style={{ padding: '5px 12px', fontSize: 12 }}
                          onClick={() => act(`pay:${c.id}`, () => commercialApi.payClaim(id, c.id))}>
                          {busy === `pay:${c.id}` ? 'Paying…' : 'Record payment'}</button>
                      )}
                      {(c.status === 'paid' || c.status === 'declined') && <span style={{ color: 'var(--muted)' }}>—</span>}
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
