// /projects/:id/handover — the PM's view of the client's final sign-off, S18.14
// (xprojman-51, v050). The pack is every project document of a handover kind (OC, BA3,
// manuals, warranties, as-built, certificates); the server computes its pack_hash.
// - Current pack: the documents, the short hash, and "Print sign-off form" (F1 (b)).
// - Paper fallback: upload the client's signed form + the short hash printed on it; the
//   server only counts it if that hash is the current pack's (else PACK_CHANGED).
// - Sign-off history: every row frozen on arrival, newest first, with is_current.
// The assisted sign-off on the PM's device is the App's screen; it lands here as history.
// Stage 18 can't complete until an accepted sign-off matches the current pack.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi, handoverApi, documentsApi } from '@/lib/api';
import { ProjectTabs } from '../_ProjectTabs';

const KIND = { occupation_certificate: 'Occupation certificate', ba3: 'BA3', manual: 'Manual', warranty: 'Warranty',
  as_built: 'As-built', certificate: 'Certificate' };
const METHOD = { assisted_device: 'Signed on the PM’s device', paper_upload: 'Paper form, uploaded', client_self: 'Signed by the client online' };
// API DATETIMEs are 'YYYY-MM-DD HH:MM:SS' wall-clock; the 'T' makes every browser parse them.
const dt = (v) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const th = { padding: '6px 10px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const td = { padding: '6px 10px', color: 'var(--text)', fontSize: 13, borderTop: '1px solid var(--b1)' };
const lbl = { display: 'block', fontSize: 11, color: 'var(--dim)', fontWeight: 700, marginBottom: 4 };

async function openDocument(id) {
  const blob = await documentsApi.fetchBlob(id);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// A printable one-page form bound to this exact pack: the manifest, the full hash, and the
// short hash large enough to read back when the scan is uploaded (Portal's F1 (b) design).
function printForm(project, pack) {
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = pack.manifest.map((m) => `<tr><td>${esc(KIND[m.kind] || m.kind)}</td><td>${esc(m.file_name)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Handover sign-off ${esc(project.code)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #999;padding:6px 8px;text-align:left}.short{font:700 36px ui-monospace,monospace;letter-spacing:4px;border:2px solid #111;display:inline-block;padding:6px 14px}
.full{font:11px ui-monospace,monospace;word-break:break-all;color:#444}.line{border-bottom:1px solid #111;height:34px;margin:18px 0 4px}.cap{font-size:12px;color:#444}
.box{display:inline-block;width:14px;height:14px;border:1px solid #111;margin-right:6px;vertical-align:middle}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">Print</button>
<h1>Client handover sign-off (S18.14)</h1><div>${esc(project.code)} ${esc(project.name)}</div>
<p>I have received and reviewed the handover pack listed below (${pack.document_count} document${pack.document_count === 1 ? '' : 's'}).</p>
<table><tr><th>Type</th><th>Document</th></tr>${rows}</table>
<p>Pack code (enter this when uploading the signed form):</p><div class="short">${esc(pack.short)}</div>
<p class="full">Full pack hash: ${esc(pack.pack_hash)}</p>
<p><span class="box"></span>I accept the handover &nbsp;&nbsp; <span class="box"></span>I do not accept, for these reasons:</p>
<div class="line"></div><div class="line"></div>
<div class="line"></div><div class="cap">Client name</div>
<div class="line"></div><div class="cap">Client signature</div>
<div class="line"></div><div class="cap">Date</div>
<div class="line"></div><div class="cap">Witness (Project Manager)</div>
</body></html>`);
  w.document.close();
}

function PaperUpload({ projectId, pack, latest, onDone }) {
  const blank = { file: null, short: '', decision: 'accepted', reasons: '', signer: '', signedAt: '' };
  const [f, setF] = useState(blank);
  const [staged, setStaged] = useState(null); // { sid, docId } once the scan is uploaded, reused on retry
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const shortOk = /^[0-9a-f]{8}$/i.test(f.short.trim());
  const ready = (f.file || staged) && shortOk && f.signer.trim() && f.signedAt && (f.decision === 'accepted' || f.reasons.trim());

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let s = staged;
      if (!s) {
        // The scan is uploaded first, against the sign-off id it's about to belong to.
        const sid = crypto.randomUUID();
        const up = await documentsApi.upload({ file: f.file, projectId, entityType: 'client_signoff', entityId: sid });
        s = { sid, docId: up?.data?.data?.document_id };
        setStaged(s);
      }
      await handoverApi.createSignoff(projectId, {
        id: s.sid, method: 'paper_upload', pack_hash_short: f.short.trim().toLowerCase(), decision: f.decision,
        decline_reasons: f.decision === 'declined' ? f.reasons.trim() : undefined,
        signer_name: f.signer.trim(), signed_at: `${f.signedAt.replace('T', ' ')}:00`,
        signature_document_id: s.docId, supersedes_id: latest?.id || undefined,
      });
      setF(blank); setStaged(null);
      onDone();
    } catch (e) {
      const code = e?.response?.data?.code || e?.code;
      // A stored-but-not-counted row is frozen; the next attempt must be a new sign-off.
      if (code === 'PACK_CHANGED' || code === 'SIGNOFF_FROZEN') setStaged(null);
      setErr(code === 'PACK_CHANGED'
        ? `The form is for a different pack (the current code is ${pack?.short || '—'}). Print the current form and have the client sign it again.`
        : errMsg(e));
      if (code === 'PACK_CHANGED') onDone();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
      <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
        For a client who wasn’t on site to sign on the device: print the form, have them sign it, then upload the scan
        with the pack code printed on it.
      </div>
      <label><span style={lbl}>Signed form (scan or photo)</span>
        <input type="file" accept=".pdf,image/*" disabled={!!staged}
          onChange={(e) => setF((x) => ({ ...x, file: e.target.files?.[0] || null }))} />
        {staged && <span style={{ fontSize: 12, color: 'var(--dim)' }}> Scan uploaded.</span>}</label>
      <label><span style={lbl}>Pack code printed on the form (8 characters)</span>
        <input className="input" value={f.short} maxLength={8} onChange={set('short')}
          style={{ fontFamily: 'var(--fm)', maxWidth: 160, borderColor: f.short && !shortOk ? 'var(--red)' : undefined }} /></label>
      <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
        {['accepted', 'declined'].map((d) => (
          <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name="decision" checked={f.decision === d} onChange={() => setF((x) => ({ ...x, decision: d }))} />
            {d === 'accepted' ? 'Client accepted' : 'Client declined'}
          </label>
        ))}
      </div>
      {f.decision === 'declined' && (
        <label><span style={lbl}>Reasons, as written on the form</span>
          <textarea className="input" rows={3} value={f.reasons} onChange={set('reasons')} /></label>
      )}
      <label><span style={lbl}>Client name</span><input className="input" maxLength={120} value={f.signer} onChange={set('signer')} /></label>
      <label><span style={lbl}>Date and time signed</span>
        <input className="input" type="datetime-local" value={f.signedAt} onChange={set('signedAt')} style={{ maxWidth: 240 }} /></label>
      {err && <PortalError message={err} />}
      <div><button className="btn btn-primary" disabled={busy || !ready} onClick={submit}>{busy ? 'Saving…' : 'Record paper sign-off'}</button></div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>A sign-off is frozen once recorded. You are recorded as the witness.</div>
    </div>
  );
}

function SignoffRow({ s }) {
  return (
    <div style={{ borderTop: '1px solid var(--b1)', padding: '10px 0', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: s.decision === 'accepted' ? 'var(--green)' : 'var(--red)' }}>
          {s.decision === 'accepted' ? 'Accepted' : 'Declined'}</span>
        <span>by {s.signer_name}</span>
        <span style={{ color: 'var(--dim)' }}>· {dt(s.signed_at)} · {METHOD[s.method] || s.method}</span>
        {s.witnessed_by?.name && <span style={{ color: 'var(--dim)' }}>· witness {s.witnessed_by.name}</span>}
        <span className="badge" style={{ marginLeft: 'auto' }}>Frozen</span>
        {s.is_current ? <span className="badge badge-active">Current</span>
          : !s.counted ? <span className="badge badge-revoked">Not counted: the pack had changed</span>
          : <span className="badge">Superseded, or the pack has changed since</span>}
      </div>
      {s.decision === 'declined' && s.decline_reasons && (
        <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{s.decline_reasons}</div>
      )}
      <div style={{ marginTop: 4, display: 'flex', gap: 10, fontSize: 12, color: 'var(--dim)' }}>
        <span style={{ fontFamily: 'var(--fm)' }}>pack {String(s.pack_hash || '').slice(0, 8)}</span>
        {(s.documents || []).map((d) => (
          <button key={d.id} type="button" className="btn btn-ghost" style={{ padding: '1px 8px', fontSize: 12 }}
            onClick={() => openDocument(d.id)}>{s.method === 'paper_upload' ? 'View scan' : 'View signature'}</button>
        ))}
      </div>
    </div>
  );
}

export default function ProjectHandoverPage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const perms = usePortalData(() => authApi.permissions());
  const canWitness = (perms.data?.data?.permissions || []).includes('handover.witness');
  const [pack, setPack] = useState(null);
  const [signoffs, setSignoffs] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [p, s] = await Promise.all([handoverApi.pack(id), handoverApi.signoffs(id)]);
      setPack(p?.data?.data || null);
      setSignoffs(s?.data?.data?.client_signoffs || []);
    } catch (e) { setErr(errMsg(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (project.loading && !project.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  const proj = project.data?.data?.project;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;
  const stages = project.data?.data?.stages || [];
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || 'contract_value' in proj;
  const stage18 = stages.find((st) => Number(st.seq) === 18);

  const latest = signoffs?.[0] || null;
  const current = signoffs?.find((s) => s.is_current) || null;
  // The last counted acceptance no longer matches: something was added to or removed from the pack.
  const lastAccepted = signoffs?.find((s) => s.counted && s.decision === 'accepted');
  const packChanged = lastAccepted && !lastAccepted.is_current && !current;
  const hasPack = pack && pack.document_count > 0;

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />
      {err && <div style={{ marginBottom: 12 }}><PortalError message={err} /></div>}

      <div style={{ fontSize: 13, marginBottom: 12, padding: '8px 12px', borderRadius: 4, background: 'var(--s2)',
        borderLeft: `3px solid ${current?.decision === 'accepted' ? 'var(--green)' : 'var(--amber)'}` }}>
        {current?.decision === 'accepted'
          ? <>The client accepted the current handover pack on {dt(current.signed_at)}. Stage 18 can complete once the occupation certificate (S18.3) is validated.</>
          : <>Stage 18 can’t complete until the client accepts the current handover pack (S18.14). This step is satisfied by the client’s sign-off, not manually.</>}
        {stage18 && <span style={{ color: 'var(--dim)' }}> · Stage 18: {stage18.status || '—'}</span>}
      </div>
      {packChanged && (
        <div style={{ fontSize: 13, marginBottom: 12, padding: '8px 12px', borderRadius: 4, color: '#fff', background: 'var(--red)' }}>
          The pack changed since the client signed. A new sign-off is needed.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16 }}>
        <PortalCard title="Current handover pack">
          {!pack ? <PortalEmpty message="Loading…" /> : !hasPack ? (
            <PortalEmpty message="No handover documents yet. Upload them on the Documents tab with a handover type (occupation certificate, BA3, manual, warranty, as-built, certificate)." />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--fm)', fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>{pack.short}</span>
                <span style={{ fontSize: 12, color: 'var(--dim)' }}>{pack.document_count} document{pack.document_count === 1 ? '' : 's'}</span>
                <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => printForm(proj, pack)}>Print sign-off form</button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Type</th><th style={th}>Document</th></tr></thead>
                <tbody>
                  {pack.manifest.map((m) => (
                    <tr key={m.document_id}>
                      <td style={td}>{KIND[m.kind] || m.kind}</td>
                      <td style={td}><button type="button" className="btn btn-ghost" style={{ padding: 0, border: 0 }}
                        onClick={() => openDocument(m.document_id)}>{m.file_name}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                Adding or deleting a handover document changes the pack code, and a signed pack then needs signing again.
                Manage documents on the <Link href={`/projects/${id}/documents`} style={{ color: 'var(--brand)' }}>Documents</Link> tab.
              </div>
            </>
          )}
        </PortalCard>

        <PortalCard title="Client sign-offs">
          {!signoffs ? <PortalEmpty message="Loading…" /> : !signoffs.length ? (
            <PortalEmpty message="No sign-off yet. The PM takes it on the App at handover, or records a paper form here." />
          ) : signoffs.map((s) => <SignoffRow key={s.id} s={s} />)}
          {latest?.decision === 'declined' && (
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10 }}>
              Raise a defect for each reason in the App (S18.7), then take a new sign-off once they’re fixed.
            </div>
          )}
        </PortalCard>
      </div>

      {canWitness && hasPack && (
        <>
          <div style={{ height: 16 }} />
          <PortalCard title="Record a paper sign-off">
            <PaperUpload projectId={id} pack={pack} latest={latest} onDone={load} />
          </PortalCard>
        </>
      )}
    </div>
  );
}
