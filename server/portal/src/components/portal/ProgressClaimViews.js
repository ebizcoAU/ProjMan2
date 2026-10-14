// ProgressClaimViews.js — the x43 R3 (v054) add-ons to Builder → payer progress claims:
// the opt-in Security of Payment template (§13.3), the RCTI flag (§13.3a) and retention
// (§14 O5). Contract of record: xprojman-43 §15 R3 build log.
//
// Every SOP template and period is UNVERIFIED (no solicitor has reviewed them, §14 O2).
// The server only warns, and these screens must say "warning" / "unverified" and never
// suggest a claim is legally valid because it used a template.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PortalCard } from '@/components/portal/PortalCard';
import { PortalEmpty } from '@/components/portal/PortalEmpty';
import { Warnings } from '@/components/portal/ClaimWarnings';
import { commercialApi, documentsApi, projectsApi, sopApi } from '@/lib/api';

export const money = (v) => (v == null || v === '' ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }));
// The API sends mysql2 wall-clock strings ('YYYY-MM-DD HH:MM:SS') or plain dates.
export const auDate = (v) => {
  if (!v) return '—';
  const s = String(v);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
const lbl = { display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 4 };
const badge = (bg) => ({ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
  color: '#fff', background: bg, marginRight: 4, whiteSpace: 'nowrap' });

// A server error as one readable line. SOP_TEMPLATE_INCOMPLETE lists the missing fields.
const FIELD_LABEL = { work_description: 'description of the work', amount: 'amount', reference_date: 'reference date',
  supporting_statement: 'supporting statement' };
export function errText(err) {
  const d = err?.response?.data;
  if (d?.code === 'SOP_TEMPLATE_INCOMPLETE' && d.details?.missing?.length) {
    return `This SOP template needs: ${d.details.missing.map((f) => FIELD_LABEL[f] || f).join(', ')}.`;
  }
  return d?.message || err?.message || 'Something went wrong';
}

export const SOP_DISCLAIMER = 'Warning: the Security of Payment templates and due periods are unverified. '
  + 'No solicitor has reviewed them yet, so using one does not make a claim valid under the Act. '
  + 'Get legal advice before relying on it.';

export function SopNotice({ children }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text)', background: 'var(--s2)', borderLeft: '3px solid var(--amber)',
      borderRadius: 4, padding: '6px 10px', margin: '8px 0' }}>
      {SOP_DISCLAIMER}{children ? <> {children}</> : null}
    </div>
  );
}

const periodText = (p) => (!p ? 'No due periods on file for this state.'
  : `Payment schedule due ${p.schedule_days} ${p.business_days ? 'business ' : ''}days after the claim is served, `
    + `payment ${p.payment_days} ${p.business_days ? 'business ' : ''}days after${p.verified ? '' : ' (unverified)'}. `
    + (p.business_days ? 'Weekends are skipped, public holidays are not.' : ''));

/**
 * The opt-in SOP part of the submit form. value: { sop_state, work_description, reference_date,
 * supporting_statement_document_id, supporting_statement_name }. Blank sop_state = not an SOP claim.
 */
export function SopFields({ templates, siteState, value, onChange, projectId }) {
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState(null);
  const t = templates.find((x) => x.state === value.sop_state);
  const needs = (f) => !!t?.required_fields?.includes(f);
  const set = (k, v) => onChange({ ...value, [k]: v });

  const upload = async (file) => {
    if (!file) return;
    setUploading(true); setUpErr(null);
    try {
      const res = await documentsApi.upload({ file, projectId, kind: 'general' });
      onChange({ ...value, supporting_statement_document_id: res?.data?.data?.document_id || null, supporting_statement_name: file.name });
    } catch (err) { setUpErr(errText(err)); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ width: '100%', borderTop: '1px solid var(--b2)', paddingTop: 10, marginTop: 4 }}>
      <label style={lbl}>Security of Payment claim (optional, template unverified)</label>
      <select className="input" value={value.sop_state} onChange={(e) => set('sop_state', e.target.value)} style={{ minWidth: 220 }}>
        <option value="">Not an SOP claim</option>
        {templates.map((x) => <option key={x.state} value={x.state}>{x.state}: {x.act_name}{x.verified ? '' : ' (unverified)'}</option>)}
      </select>
      {t && (
        <>
          <SopNotice />
          {siteState && t.state !== siteState && (
            <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>
              Warning: the site is in {siteState}, but you picked the {t.state} template.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 2, minWidth: 260 }}>
              <label style={lbl}>Description of the work{needs('work_description') ? ' *' : ''}</label>
              <textarea className="input" rows={2} maxLength={1000} value={value.work_description}
                onChange={(e) => set('work_description', e.target.value)} style={{ width: '100%' }}
                placeholder="The construction work or goods and services this claim is for" />
            </div>
            <div>
              <label style={lbl}>Reference date{needs('reference_date') ? ' *' : ''}</label>
              <input className="input" type="date" value={value.reference_date} onChange={(e) => set('reference_date', e.target.value)} />
            </div>
            {needs('supporting_statement') && (
              <div>
                <label style={lbl}>Supporting statement *</label>
                <input type="file" accept=".pdf,image/*" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {uploading ? 'Uploading…' : value.supporting_statement_name ? `Attached: ${value.supporting_statement_name}` : 'The head contractor\'s statement about paying its subcontractors'}
                </div>
                {upErr && <div style={{ fontSize: 11, color: 'var(--red)' }}>{upErr}</div>}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            Statement added to the claim: <em>“{t.statement_text}”</em>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{periodText(t.period)}</div>
        </>
      )}
    </div>
  );
}

const payeeContracts = (contracts) => contracts.filter((c) => c.party_type !== 'client');
const contractLabel = (c) => `${c.title || c.party_name || c.party_type} (${c.party_type}, ${Number(c.retention_pct || 0)}% retention)`;

/** Contract + retention fields; value: { contract_id, retention_withheld }. Blank retention = the contract's %. */
export function RetentionFields({ contracts, value, onChange, amount }) {
  const list = payeeContracts(contracts);
  if (!list.length) return null;
  const c = list.find((x) => x.id === value.contract_id);
  const dflt = c && Number(amount) > 0 ? Math.round(Number(amount) * Number(c.retention_pct)) / 100 : null;
  return (
    <>
      <div>
        <label style={lbl}>Contract (for retention)</label>
        <select className="input" value={value.contract_id} onChange={(e) => onChange({ ...value, contract_id: e.target.value })} style={{ minWidth: 220 }}>
          <option value="">None</option>
          {list.map((x) => <option key={x.id} value={x.id}>{contractLabel(x)}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Retention withheld (ex GST)</label>
        <input className="input" type="number" min="0" step="0.01" value={value.retention_withheld} style={{ width: 150 }}
          placeholder={dflt != null ? `default ${dflt.toFixed(2)}` : '0.00'}
          onChange={(e) => onChange({ ...value, retention_withheld: e.target.value })} />
      </div>
    </>
  );
}

// Body fields for submit/approve: only what was filled in.
export function retentionBody({ contract_id, retention_withheld }) {
  const out = {};
  if (contract_id) out.contract_id = contract_id;
  if (retention_withheld !== '' && retention_withheld != null) out.retention_withheld = Number(retention_withheld);
  return out;
}

/** Badges for the claim list row. */
export function ClaimBadges({ claim }) {
  return (
    <>
      {claim.sop_state && <span style={badge('var(--amber)')} title="Security of Payment template (unverified)">SOP {claim.sop_state}</span>}
      {!!claim.rcti_issued && <span style={badge('var(--brand)')} title="Recipient-created tax invoice">RCTI</span>}
      {Number(claim.retention_withheld) > 0 && <span style={badge('var(--muted)')}>Retention {money(claim.retention_withheld)}</span>}
    </>
  );
}

/**
 * The expanded row: SOP details + payment schedule, retention at approval, RCTI flag.
 * rctiAgreement: the current agreement with this claimant, or null.
 */
export function ClaimExtras({ projectId, claim, canApprove, contracts, rctiAgreement, onDone }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [sched, setSched] = useState({ scheduled_amount: claim.scheduled_amount ?? claim.amount, schedule_reason: claim.schedule_reason || '' });
  const [ret, setRet] = useState({ contract_id: claim.contract_id || '', retention_withheld: '' });

  const run = async (key, fn) => {
    setBusy(key); setErr(null); setWarnings([]);
    try { const res = await fn(); setWarnings(res?.data?.warnings || []); await onDone(); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(null); }
  };
  const short = Number(sched.scheduled_amount) < Number(claim.amount) - 0.005;
  const net = Number(claim.amount) - Number(claim.retention_withheld || 0);

  return (
    <div style={{ padding: '10px 12px', background: 'var(--s2)', fontSize: 13, color: 'var(--text)' }}>
      {err && <div style={{ color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <Warnings list={warnings} />

      {claim.note && <div style={{ marginBottom: 8 }}><span style={{ color: 'var(--dim)' }}>Note:</span> {claim.note}</div>}

      {claim.sop_state && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Security of Payment ({claim.sop_state}, template unverified)</div>
          <SopNotice />
          {claim.sop_statement && <div style={{ marginBottom: 4 }}><em>“{claim.sop_statement}”</em></div>}
          {claim.work_description && <div><span style={{ color: 'var(--dim)' }}>Work:</span> {claim.work_description}</div>}
          <div><span style={{ color: 'var(--dim)' }}>Reference date:</span> {auDate(claim.reference_date)}</div>
          <div>
            <span style={{ color: 'var(--dim)' }}>Payment schedule due:</span> {auDate(claim.schedule_due_at)}{' · '}
            <span style={{ color: 'var(--dim)' }}>Payment due:</span> {auDate(claim.payment_due_at)}{' '}
            <span style={{ color: 'var(--amber)' }}>(unverified periods, a guide only)</span>
          </div>
          {claim.scheduled_at ? (
            <div style={{ marginTop: 4 }}>
              <span style={{ color: 'var(--dim)' }}>Payment schedule:</span> {money(claim.scheduled_amount)} on {auDate(claim.scheduled_at)}
              {claim.schedule_reason ? ` (reason: ${claim.schedule_reason})` : ''}
            </div>
          ) : canApprove && claim.status !== 'declined' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
              <div>
                <label style={lbl}>Scheduled amount</label>
                <input className="input" type="number" min="0" max={claim.amount} step="0.01" value={sched.scheduled_amount} style={{ width: 150 }}
                  onChange={(e) => setSched((s) => ({ ...s, scheduled_amount: e.target.value }))} />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={lbl}>Reason{short ? ' * (paying less than claimed)' : ''}</label>
                <input className="input" maxLength={500} value={sched.schedule_reason} style={{ width: '100%' }}
                  onChange={(e) => setSched((s) => ({ ...s, schedule_reason: e.target.value }))} />
              </div>
              <button className="btn" disabled={!!busy || sched.scheduled_amount === '' || (short && !sched.schedule_reason.trim())}
                onClick={() => run('sched', () => commercialApi.scheduleClaim(projectId, claim.id, {
                  scheduled_amount: Number(sched.scheduled_amount), schedule_reason: sched.schedule_reason.trim() || undefined }))}>
                {busy === 'sched' ? 'Saving…' : 'Record payment schedule'}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Retention</div>
        {Number(claim.retention_withheld) > 0 ? (
          <div>{money(claim.retention_withheld)} withheld. {claim.status === 'paid' ? 'Paid' : 'Payment will be'} {money(net)} (amount less retention).</div>
        ) : <div style={{ color: 'var(--muted)' }}>None withheld.</div>}
        {canApprove && claim.status === 'submitted' && payeeContracts(contracts).length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
            <RetentionFields contracts={contracts} value={ret} onChange={setRet} amount={claim.amount} />
            <button className="btn btn-primary" disabled={!!busy}
              onClick={() => run('approve', () => commercialApi.approveClaim(projectId, claim.id, true, retentionBody(ret)))}>
              {busy === 'approve' ? 'Approving…' : 'Approve with this retention'}
            </button>
          </div>
        )}
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>RCTI (recipient-created tax invoice)</div>
        <div style={{ color: 'var(--muted)', marginBottom: 6 }}>
          {rctiAgreement
            ? `Current agreement with the claimant since ${auDate(rctiAgreement.agreed_at)}${rctiAgreement.ends_at ? `, ends ${auDate(rctiAgreement.ends_at)}` : ''}.`
            : <>No current RCTI agreement with this claimant. <Link href="/finance/rcti" style={{ color: 'var(--brand)' }}>Add one in RCTI agreements</Link>.</>}
        </div>
        {canApprove && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!claim.rcti_issued} disabled={!!busy || (!claim.rcti_issued && !rctiAgreement)}
              onChange={(e) => run('rcti', () => commercialApi.setClaimRcti(projectId, claim.id, e.target.checked))} />
            We issue the tax invoice for this claim (RCTI)
          </label>
        )}
      </div>
    </div>
  );
}

const REASONS = [
  { k: 'practical_completion', label: 'Practical completion' },
  { k: 'dlp_end', label: 'End of defects liability period' },
  { k: 'other', label: 'Other' },
];
const reasonLabel = (k) => REASONS.find((r) => r.k === k)?.label || k;

/** GET /projects/:id/retention, plus the release form (money.write). */
export function RetentionCard({ projectId, retention, canRelease, onDone }) {
  const [form, setForm] = useState({ contract_id: '', amount: '', reason: 'practical_completion', released_at: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const contracts = retention?.contracts || [];
  const releases = retention?.releases || [];
  const held = contracts.filter((c) => c.held > 0);
  const name = (cid) => { const c = contracts.find((x) => x.contract_id === cid); return c ? (c.title || c.party_name || c.party_type) : '—'; };

  const release = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await commercialApi.releaseRetention(projectId, { contract_id: form.contract_id, amount: Number(form.amount), reason: form.reason,
        released_at: form.released_at || undefined, note: form.note.trim() || undefined });
      setForm((f) => ({ ...f, amount: '', note: '' }));
      await onDone();
    } catch (e2) { setErr(errText(e2)); }
    finally { setBusy(false); }
  };

  return (
    <PortalCard title="Retention">
      {contracts.length === 0 ? <PortalEmpty message="No retention on this project's contracts." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: 'var(--dim)', fontSize: 11, textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Contract</th><th style={{ padding: 6 }}>%</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Withheld</th><th style={{ padding: 6, textAlign: 'right' }}>Released</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Held</th>
            </tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.contract_id} style={{ borderTop: '1px solid var(--b2)', color: 'var(--text)' }}>
                  <td style={{ padding: 6 }}>{c.title || c.party_name || '—'} <span style={{ color: 'var(--muted)' }}>({c.party_type})</span></td>
                  <td style={{ padding: 6 }}>{c.retention_pct}%</td>
                  <td style={{ padding: 6, textAlign: 'right', fontFamily: 'var(--fm)' }}>{money(c.withheld)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontFamily: 'var(--fm)' }}>{money(c.released)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontFamily: 'var(--fm)', fontWeight: 700 }}>{money(c.held)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {releases.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          {releases.map((r) => (
            <div key={r.id}>{auDate(r.released_at)}: released {money(r.amount)} on {name(r.contract_id)} ({reasonLabel(r.reason)}){r.note ? `, ${r.note}` : ''}</div>
          ))}
        </div>
      )}
      {canRelease && held.length > 0 && (
        <form onSubmit={release} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <label style={lbl}>Release on</label>
            <select className="input" required value={form.contract_id} onChange={(e) => setForm((f) => ({ ...f, contract_id: e.target.value }))}>
              <option value="">Pick a contract</option>
              {held.map((c) => <option key={c.contract_id} value={c.contract_id}>{c.title || c.party_name} (held {money(c.held)})</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Amount</label>
            <input className="input" type="number" min="0.01" step="0.01" required value={form.amount} style={{ width: 130 }}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Reason</label>
            <select className="input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}>
              {REASONS.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Date (optional)</label>
            <input className="input" type="date" value={form.released_at} onChange={(e) => setForm((f) => ({ ...f, released_at: e.target.value }))} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={lbl}>Note (optional)</label>
            <input className="input" maxLength={300} value={form.note} style={{ width: '100%' }} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !form.contract_id || !form.amount}>{busy ? 'Releasing…' : 'Release retention'}</button>
        </form>
      )}
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </PortalCard>
  );
}

/**
 * Client claims (x43 R3): SOP + retention on a draft (PATCH /client-claims/:id), shown read-only
 * once issued. SOP only when the project's client is not an owner-occupier (SOP_OWNER_OCCUPIER);
 * the statement and due dates are set at issue. Retention is against the client contract (with
 * none picked, the project's sole client contract is used, else CONTRACT_REQUIRED).
 * save(body) runs the PATCH and reloads the claim.
 */
export function ClientClaimCompliance({ inv, canWrite, save, busy }) {
  const [ctx, setCtx] = useState(null); // { ownerOcc, siteState, templates, contracts }
  const [edit, setEdit] = useState(null);
  const isDraft = inv.status === 'draft';

  useEffect(() => {
    if (!isDraft || !canWrite) return;
    let live = true;
    Promise.all([
      projectsApi.detail(inv.project_id).catch(() => null),
      sopApi.templates().catch(() => null),
      commercialApi.contracts(inv.project_id).catch(() => null),
    ]).then(([d, t, c]) => {
      if (!live) return;
      const p = d?.data?.data?.project || {};
      setCtx({
        ownerOcc: p.client_is_owner_occupier == null ? true : !!Number(p.client_is_owner_occupier),
        siteState: inv.site_state || p.site_state || null,
        templates: t?.data?.data?.sop_templates || [],
        contracts: (c?.data?.data?.contracts || []).filter((x) => x.party_type === 'client'),
      });
    });
    return () => { live = false; };
  }, [inv.project_id, inv.site_state, isDraft, canWrite]);

  const hasSop = !!inv.sop_state;
  const hasRet = Number(inv.retention_withheld) > 0;
  const box = { fontSize: 13, color: 'var(--text)', background: 'var(--s2)', borderRadius: 8, padding: '10px 12px', margin: '12px 0' };

  const start = () => setEdit({
    sop: { sop_state: inv.sop_state || '', work_description: inv.work_description || '', reference_date: inv.reference_date || '',
      supporting_statement_document_id: inv.supporting_statement_document_id || null,
      supporting_statement_name: inv.supporting_statement_document_id ? 'already attached' : '' },
    ret: { contract_id: inv.contract_id || '', retention_withheld: hasRet ? String(inv.retention_withheld) : '' },
  });
  const submit = async () => {
    const { sop, ret } = edit;
    const ok = await save({
      sop_state: sop.sop_state || '', work_description: sop.work_description.trim(),
      reference_date: sop.reference_date || '', supporting_statement_document_id: sop.supporting_statement_document_id || '',
      contract_id: ret.contract_id || '', retention_withheld: ret.retention_withheld === '' ? 0 : Number(ret.retention_withheld),
    });
    if (ok) setEdit(null);
  };

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Security of Payment and retention</div>
      {hasSop ? (
        <>
          <div>SOP template: {inv.sop_state} (unverified)</div>
          <SopNotice />
          {inv.sop_statement && <div><em>“{inv.sop_statement}”</em></div>}
          {inv.work_description && <div><span style={{ color: 'var(--dim)' }}>Work:</span> {inv.work_description}</div>}
          <div><span style={{ color: 'var(--dim)' }}>Reference date:</span> {auDate(inv.reference_date)}</div>
          {inv.schedule_due_at
            ? <div><span style={{ color: 'var(--dim)' }}>Payment schedule due:</span> {auDate(inv.schedule_due_at)} · <span style={{ color: 'var(--dim)' }}>Payment due:</span> {auDate(inv.payment_due_at)} <span style={{ color: 'var(--amber)' }}>(unverified periods, a guide only)</span></div>
            : <div style={{ color: 'var(--muted)' }}>The statement and due dates are added when the claim is issued.</div>}
        </>
      ) : <div style={{ color: 'var(--muted)' }}>Not an SOP claim.</div>}
      <div style={{ marginTop: 6 }}>
        {hasRet ? `Retention withheld: ${money(inv.retention_withheld)} (ex GST), held against the client contract.` : <span style={{ color: 'var(--muted)' }}>No retention withheld.</span>}
      </div>

      {canWrite && isDraft && !edit && (
        <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy || !ctx} onClick={start}>
          {ctx ? 'Edit SOP and retention' : 'Loading…'}
        </button>
      )}
      {edit && ctx && (
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          {ctx.ownerOcc ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              SOP templates are off: this project's client is set as an owner-occupier, and the Security of Payment Acts
              don't apply to residential contracts with one. If the client is a developer, investor or business, change it
              in <Link href={`/projects/${inv.project_id}/edit`} style={{ color: 'var(--brand)' }}>project edit → Contract</Link>.
            </div>
          ) : (
            <SopFields templates={ctx.templates} siteState={ctx.siteState} value={edit.sop} projectId={inv.project_id}
              onChange={(sop) => setEdit((e) => ({ ...e, sop }))} />
          )}
          {ctx.contracts.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={lbl}>Client contract</label>
                <select className="input" value={edit.ret.contract_id} onChange={(e) => setEdit((x) => ({ ...x, ret: { ...x.ret, contract_id: e.target.value } }))}>
                  <option value="">{ctx.contracts.length === 1 ? 'The client contract' : 'Pick one'}</option>
                  {ctx.contracts.map((c) => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Retention withheld (ex GST)</label>
                <input className="input" type="number" min="0" step="0.01" value={edit.ret.retention_withheld} style={{ width: 150 }} placeholder="0.00"
                  onChange={(e) => setEdit((x) => ({ ...x, ret: { ...x.ret, retention_withheld: e.target.value } }))} />
              </div>
            </div>
          ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>No client contract on this project, so no retention can be withheld.</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={submit}>Save draft</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
