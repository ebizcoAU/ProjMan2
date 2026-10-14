// /finance/rcti — RCTI agreements (xprojman-43 §13.3a, v054). A recipient-created tax invoice
// needs a written agreement with the counterparty: a supplier (its supplier invoices) or a
// progress-claim claimant (party_user_id). Only while one is current (not revoked, agreed_at ≤
// today ≤ ends_at) can a claim or invoice be flagged RCTI (RCTI_NO_AGREEMENT otherwise).
// Reads need money.read or po.write; adding a supplier agreement needs money.write or po.write,
// a claimant agreement money.write. The signed copy is an ordinary org-level document for now.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { Warnings }      from '@/components/portal/ClaimWarnings';
import { auDate, errText } from '@/components/portal/ProgressClaimViews';
import { authApi, commercialApi, introductionsApi, documentsApi, rctiApi } from '@/lib/api';

const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const td = { padding: '8px 12px', color: 'var(--text)', fontSize: 13, borderTop: '1px solid var(--b1)' };
const lbl = { display: 'block', fontSize: 11, color: 'var(--dim)', fontWeight: 700, marginBottom: 4 };
const today = () => new Date().toLocaleDateString('en-CA');
const BLANK = { kind: 'supplier', supplier_id: '', party_user_id: '', agreed_at: today(), ends_at: '', note: '', file: null };

function statusOf(a) {
  if (a.revoked_at) return { text: 'revoked', color: 'var(--muted)' };
  if (a.is_current) return { text: 'current', color: 'var(--green)' };
  return a.agreed_at > today() ? { text: 'not started', color: 'var(--amber)' } : { text: 'ended', color: 'var(--muted)' };
}

export default function RctiAgreementsPage() {
  const { data, loading, error, refetch } = usePortalData(async () => {
    const [pm, ag, sup, ct] = await Promise.all([
      authApi.permissions().catch(() => null),
      rctiApi.list().catch(() => null),
      commercialApi.suppliers().catch(() => null),
      introductionsApi.contacts().catch(() => null),
    ]);
    return { data: {
      perms: pm?.data?.data?.permissions || [],
      agreements: ag?.data?.data?.rcti_agreements || null,
      suppliers: sup?.data?.data?.suppliers || [],
      claimants: (ct?.data?.data?.contacts || []).filter((c) => c.role === 'builder'),
    } };
  });
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [warnings, setWarnings] = useState([]);

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;

  const { perms, agreements, suppliers, claimants } = data.data;
  const canRead = perms.includes('money.read') || perms.includes('po.write');
  const canSupplier = perms.includes('money.write') || perms.includes('po.write');
  const canClaimant = perms.includes('money.write');
  if (!canRead || !agreements) {
    return <div style={{ padding: 20 }}><PortalError message="RCTI agreements need the money.read or po.write permission." /></div>;
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.files ? e.target.files[0] || null : e.target.value }));

  const run = async (key, fn) => {
    setBusy(key); setErr(null); setWarnings([]);
    try { const res = await fn(); setWarnings(res?.data?.warnings || []); await refetch(); return true; }
    catch (e) { setErr(errText(e)); return false; }
    finally { setBusy(null); }
  };
  const create = async (e) => {
    e.preventDefault();
    const ok = await run('create', async () => {
      let documentId;
      if (form.file) {
        const up = await documentsApi.upload({ file: form.file, kind: 'general' });
        documentId = up?.data?.data?.document_id;
      }
      return rctiApi.create({
        ...(form.kind === 'supplier' ? { supplier_id: form.supplier_id } : { party_user_id: form.party_user_id }),
        agreed_at: form.agreed_at, ends_at: form.ends_at || undefined,
        document_id: documentId, note: form.note.trim() || undefined,
      });
    });
    if (ok) setForm(BLANK);
  };
  const revoke = (a) => run(`rv:${a.id}`, () => rctiApi.revoke(a.id));
  const canAdd = canSupplier || canClaimant;
  const kindAllowed = form.kind === 'supplier' ? canSupplier : canClaimant;

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>RCTI agreements</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, maxWidth: 760 }}>
        With a recipient-created tax invoice (RCTI), you issue the tax invoice for what a supplier or subcontractor
        supplies you, instead of them invoicing you. The ATO requires a written agreement with each of them first.
        Record it here, then tick RCTI on their claims or invoices. The ATO wording on the export is not yet checked.
      </div>

      {err && <div style={{ marginBottom: 12 }}><PortalError message={err} /></div>}
      <Warnings list={warnings} />

      {canAdd && (
        <PortalCard title="Add an agreement">
          <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={lbl}>With</label>
              <select className="input" value={form.kind} onChange={set('kind')}>
                {canSupplier && <option value="supplier">A supplier</option>}
                {canClaimant && <option value="claimant">A Builder who claims (progress claims)</option>}
              </select>
            </div>
            {form.kind === 'supplier' ? (
              <div>
                <label style={lbl}>Supplier</label>
                <select className="input" required value={form.supplier_id} onChange={set('supplier_id')} style={{ minWidth: 220 }}>
                  <option value="">Pick a supplier</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.abn ? ` (ABN ${s.abn})` : ''}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label style={lbl}>Builder</label>
                <select className="input" required value={form.party_user_id} onChange={set('party_user_id')} style={{ minWidth: 220 }}>
                  <option value="">Pick a Builder from your panel</option>
                  {claimants.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={lbl}>Agreed on</label>
              <input className="input" type="date" required value={form.agreed_at} onChange={set('agreed_at')} />
            </div>
            <div>
              <label style={lbl}>Ends (optional)</label>
              <input className="input" type="date" value={form.ends_at} min={form.agreed_at} onChange={set('ends_at')} />
            </div>
            <div>
              <label style={lbl}>Signed agreement (recommended)</label>
              <input type="file" accept=".pdf,image/*" onChange={set('file')} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={lbl}>Note (optional)</label>
              <input className="input" maxLength={300} value={form.note} onChange={set('note')} style={{ width: '100%' }} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={!!busy || !kindAllowed
              || !(form.kind === 'supplier' ? form.supplier_id : form.party_user_id)}>
              {busy === 'create' ? 'Saving…' : 'Add agreement'}
            </button>
          </form>
        </PortalCard>
      )}

      <PortalCard title={`Agreements${agreements.length ? ` · ${agreements.length}` : ''}`}>
        {agreements.length === 0 ? <PortalEmpty message="No RCTI agreements yet." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--s2)' }}>
                <th style={th}>With</th><th style={th}>Agreed</th><th style={th}>Ends</th>
                <th style={th}>Signed copy</th><th style={th}>Status</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {agreements.map((a) => {
                  const st = statusOf(a);
                  const mayRevoke = !a.revoked_at && (a.supplier_id ? canSupplier : canClaimant);
                  return (
                    <tr key={a.id}>
                      <td style={td}>
                        {a.supplier_name || a.party_name || '—'}{' '}
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>({a.supplier_id ? 'supplier' : 'claimant'})</span>
                        {a.note && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.note}</div>}
                      </td>
                      <td style={td}>{auDate(a.agreed_at)}</td>
                      <td style={td}>{a.ends_at ? auDate(a.ends_at) : 'Open-ended'}</td>
                      <td style={td}>{a.document_id ? 'On file' : <span style={{ color: 'var(--amber)' }}>None (warning)</span>}</td>
                      <td style={{ ...td, color: st.color, fontWeight: 700 }}>{st.text}</td>
                      <td style={td}>
                        {mayRevoke && (
                          <button className="btn" disabled={!!busy} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => revoke(a)}>
                            {busy === `rv:${a.id}` ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Revoking stops new RCTI flags. Claims and invoices already flagged keep theirs.
        </div>
      </PortalCard>
    </div>
  );
}
