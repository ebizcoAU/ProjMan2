// ClientInvoiceViews.js — Client Billing building blocks (xprojman-43 §6), shared by the
// global /finance/client-invoices list, its detail page and the project Invoices tab.
// Reads are money.read; drafting, issuing, recording a payment, voiding and the payment
// schedule are money.write (x43 §3 Parameters). Revenue posting (x43 §4) is server-side:
// the Portal only shows the journal link the server returns.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PortalKpi }   from '@/components/portal/PortalKpi';
import { PortalEmpty } from '@/components/portal/PortalEmpty';
import { PortalError } from '@/components/portal/PortalError';
import { usePortalDialog } from '@/components/portal/PortalDialog';
import {
  clientInvoicesApi, CLIENT_INVOICES_MOCK, MILESTONES, MILESTONE_LABEL, MILESTONE_TRIGGER,
} from '@/lib/clientInvoices';

export const money = (v) => (v == null || v === '' ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }));
// The API returns DATETIMEs as 'YYYY-MM-DD HH:MM:SS' wall-clock strings; the 'T' makes
// every browser parse them as local time.
const d = (v) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleDateString('en-AU') : '—');
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const localDate = () => new Date().toLocaleDateString('en-CA');

const STATUS_COLOR = { draft: 'var(--muted)', issued: 'var(--amber)', paid: 'var(--green)', void: 'var(--red)' };
function StatusPill({ inv }) {
  const overdue = inv.status === 'issued' && inv.days_overdue > 0;
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color: '#fff', background: overdue ? 'var(--red)' : (STATUS_COLOR[inv.status] || 'var(--muted)') }}>
      {overdue ? `overdue ${inv.days_overdue}d` : inv.status}
    </span>
  );
}
const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '8px 12px', color: 'var(--text)', fontSize: 13, borderTop: '1px solid var(--b1)' };
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--fm)' };
const lbl = { display: 'block', fontSize: 11, color: 'var(--dim)', fontWeight: 700, marginBottom: 4 };

export function ClientInvoicesMockBanner() {
  if (!CLIENT_INVOICES_MOCK) return null;
  return (
    <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--s2)', border: '1px dashed var(--b2)',
      borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>
      Design mockup: sample invoices on your real projects, nothing is saved. Goes live when Server builds
      client billing (xprojman-43 Steps 1–3).
    </div>
  );
}

export function InvoiceTotals({ totals }) {
  if (!totals) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
      <PortalKpi label="Drafts to issue" value={totals.draft_count} color="var(--text)" />
      <PortalKpi label="Outstanding (inc GST)" value={money(totals.outstanding_inc_gst)} color="var(--amber)" />
      <PortalKpi label="Overdue (inc GST)" value={money(totals.overdue_inc_gst)}
        color={totals.overdue_inc_gst > 0 ? 'var(--red)' : 'var(--dim)'} />
      <PortalKpi label="Received (inc GST)" value={money(totals.paid_inc_gst)} color="var(--green)" />
    </div>
  );
}

export function InvoiceTable({ rows, showProject }) {
  if (!rows.length) return <PortalEmpty message="No client invoices yet. A draft appears when a billing milestone is reached." />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {showProject && <th style={th}>Project</th>}
            <th style={th}>Milestone</th><th style={th}>Invoice #</th><th style={th}>Status</th>
            <th style={thR}>Amount (inc GST)</th><th style={th}>Issued</th><th style={th}>Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((inv) => (
            <tr key={inv.id}>
              {showProject && (
                <td style={td}><span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{inv.project_code}</span>{' '}{inv.project_name}</td>
              )}
              <td style={td}>
                <Link href={`/finance/client-invoices/${inv.id}`} style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {MILESTONE_LABEL[inv.milestone]}
                </Link>
                <span style={{ color: 'var(--dim)', fontSize: 12 }}> · {Number(inv.percentage_of_contract)}%</span>
              </td>
              <td style={{ ...td, fontFamily: 'var(--fm)' }}>{inv.invoice_number || '—'}</td>
              <td style={td}><StatusPill inv={inv} /></td>
              <td style={tdR}>{money(inv.amount_inc_gst)}</td>
              <td style={td}>{d(inv.issued_at)}</td>
              <td style={td}>{d(inv.due_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The project's milestone percentages (x43 §5). Seeded with the jurisdiction default;
// the PM confirms or edits it at Job Award. It must sum to 100%, and the deposit is
// capped by the site's state (x43 §2.1). A milestone that has been invoiced is locked:
// its invoice froze the percentage it was billed at.
export function PaymentScheduleCard({ projectId, canWrite, onSaved }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await clientInvoicesApi.schedule(projectId);
      const s = res?.data?.data;
      setData(s);
      setDraft(Object.fromEntries((s?.schedule || []).map((r) => [r.milestone, String(r.percentage)])));
    } catch (e) { setErr(errMsg(e)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (err && !data) return <PortalError message={err} />;
  if (!data || !draft) return <PortalEmpty message="Loading…" />;

  const total = MILESTONES.reduce((s, m) => s + (Number(draft[m]) || 0), 0);
  const dirty = data.schedule.some((r) => String(r.percentage) !== draft[r.milestone]);
  const depositOver = data.deposit_cap_pct != null && Number(draft.deposit) > data.deposit_cap_pct;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await clientInvoicesApi.saveSchedule(projectId, MILESTONES.map((m) => ({ milestone: m, percentage: Number(draft[m]) })));
      await load();
      onSaved?.();
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 10 }}>
        Contract {money(data.contract_value)} ex GST · site in {data.site_state || '—'}
        {data.deposit_cap_pct != null && <> · deposit capped at {data.deposit_cap_pct}%</>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Milestone</th><th style={th}>Fires on</th><th style={thR}>%</th><th style={thR}>Amount (ex GST)</th></tr></thead>
        <tbody>
          {data.schedule.map((r) => {
            const locked = r.invoiced || !canWrite;
            return (
              <tr key={r.milestone}>
                <td style={td}>{MILESTONE_LABEL[r.milestone]}{r.invoiced && <span style={{ color: 'var(--dim)', fontSize: 11 }}> · invoiced</span>}</td>
                <td style={{ ...td, color: 'var(--dim)', fontSize: 12 }}>{MILESTONE_TRIGGER[r.milestone]}</td>
                <td style={tdR}>
                  {locked ? `${r.percentage}%` : (
                    <input className="input" type="number" min="0" max="100" step="0.5" value={draft[r.milestone]}
                      style={{ width: 80, textAlign: 'right', borderColor: r.milestone === 'deposit' && depositOver ? 'var(--red)' : undefined }}
                      onChange={(e) => setDraft((x) => ({ ...x, [r.milestone]: e.target.value }))} />
                  )}
                </td>
                <td style={tdR}>{money((data.contract_value * (Number(draft[r.milestone]) || 0)) / 100)}</td>
              </tr>
            );
          })}
          <tr>
            <td style={{ ...td, fontWeight: 700 }} colSpan={2}>Total</td>
            <td style={{ ...tdR, fontWeight: 700, color: Math.abs(total - 100) > 0.001 ? 'var(--red)' : 'var(--green)' }}>{Math.round(total * 100) / 100}%</td>
            <td style={tdR}>{money((data.contract_value * total) / 100)}</td>
          </tr>
        </tbody>
      </table>
      {depositOver && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
        The deposit is over the {data.site_state} cap of {data.deposit_cap_pct}%.</div>}
      {err && <div style={{ marginTop: 8 }}><PortalError message={err} /></div>}
      {canWrite && dirty && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy || Math.abs(total - 100) > 0.001 || depositOver} onClick={save}>Save schedule</button>
          <button className="btn btn-ghost" disabled={busy} onClick={load}>Discard</button>
        </div>
      )}
    </div>
  );
}

// One invoice: the tax-invoice facts (x43 §2.4), and the PM's actions by status:
// draft → edit amount (variation) / issue; issued → record payment / void; paid, void → read-only.
export function InvoiceDetail({ invoiceId, canWrite }) {
  const { confirm } = usePortalDialog();
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);       // { amount_ex_gst, variation_note } while editing a draft
  const [pay, setPay] = useState(null);         // { paid_at, payment_reference } while recording
  const [voidReason, setVoidReason] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await clientInvoicesApi.detail(invoiceId);
      setInv(res?.data?.data?.client_invoice || null);
    } catch (e) { setErr(errMsg(e)); }
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true); setActionErr(null);
    try { await fn(); setEdit(null); setPay(null); setVoidReason(null); await load(); }
    catch (e) { setActionErr(errMsg(e)); }
    finally { setBusy(false); }
  };

  if (err) return <PortalError message={err} />;
  if (!inv) return <PortalEmpty message="Loading…" />;

  const fact = (label, value) => (
    <div><span style={lbl}>{label}</span><div style={{ fontSize: 14, color: 'var(--text)' }}>{value}</div></div>
  );
  const issue = async () => {
    if (!(await confirm(
      `Issue this ${MILESTONE_LABEL[inv.milestone]} invoice for ${money(inv.amount_inc_gst)}? An issued invoice is a tax invoice: it can't be edited afterwards, only voided and re-issued.`,
      { title: 'Issue invoice', confirmLabel: 'Issue' }))) return;
    run(() => clientInvoicesApi.issue(inv.id));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--fh)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
          {MILESTONE_LABEL[inv.milestone]} · {inv.invoice_number || 'Draft'}
        </div>
        <StatusPill inv={inv} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 18 }}>
        {fact('Project', <Link href={`/projects/${inv.project_id}/invoices`} style={{ color: 'var(--text)' }}>
          <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{inv.project_code}</span> {inv.project_name}</Link>)}
        {fact('Supplier', `${inv.supplier?.name || '—'} · ABN ${inv.supplier?.abn || '—'}`)}
        {fact('Billed', `${Number(inv.percentage_of_contract)}% of ${money(inv.contract_value)}`)}
        {fact('Fires on', MILESTONE_TRIGGER[inv.milestone])}
        {fact('Issued', d(inv.issued_at))}
        {fact('Due', d(inv.due_at))}
      </div>

      <table style={{ width: '100%', maxWidth: 420, borderCollapse: 'collapse', marginBottom: 18 }}>
        <tbody>
          <tr><td style={td}>Amount ex GST</td><td style={tdR}>{money(inv.amount_ex_gst)}</td></tr>
          <tr><td style={td}>GST</td><td style={tdR}>{money(inv.gst_amount)}</td></tr>
          <tr><td style={{ ...td, fontWeight: 700 }}>Total inc GST</td><td style={{ ...tdR, fontWeight: 700 }}>{money(inv.amount_inc_gst)}</td></tr>
        </tbody>
      </table>
      {inv.variation_note && <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 12 }}>Variation: {inv.variation_note}</div>}

      {inv.status === 'paid' && (
        <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
          Paid {d(inv.paid_at)}{inv.payment_reference && <> · ref {inv.payment_reference}</>}
          {inv.recorded_by && <> · recorded by {inv.recorded_by.name}</>}
        </div>
      )}
      {inv.status === 'void' && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>Voided: {inv.void_reason}</div>}
      {inv.journal_entry_id && inv.status !== 'draft' && (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>
          Revenue posted to the journal on issue (accrual). See <Link href="/finance/sales" style={{ color: 'var(--brand)' }}>Sales</Link>.
        </div>
      )}

      {actionErr && <div style={{ marginBottom: 12 }}><PortalError message={actionErr} /></div>}

      {canWrite && inv.status === 'draft' && !edit && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={issue}>Issue invoice</button>
          <button className="btn btn-ghost" disabled={busy}
            onClick={() => setEdit({ amount_ex_gst: String(inv.amount_ex_gst), variation_note: inv.variation_note || '' })}>Adjust amount</button>
        </div>
      )}
      {edit && (
        <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <label><span style={lbl}>Amount ex GST (GST is added at 10%)</span>
            <input className="input" type="number" min="0" step="0.01" value={edit.amount_ex_gst}
              onChange={(e) => setEdit((x) => ({ ...x, amount_ex_gst: e.target.value }))} /></label>
          <label><span style={lbl}>Variation note (why the amount differs from the schedule)</span>
            <input className="input" value={edit.variation_note} maxLength={200}
              onChange={(e) => setEdit((x) => ({ ...x, variation_note: e.target.value }))} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy || !(Number(edit.amount_ex_gst) > 0)}
              onClick={() => run(() => clientInvoicesApi.patch(inv.id, {
                amount_ex_gst: Number(edit.amount_ex_gst), variation_note: edit.variation_note.trim() || null }))}>Save draft</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}

      {canWrite && inv.status === 'issued' && !pay && voidReason == null && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={busy}
            onClick={() => setPay({ paid_at: localDate(), payment_reference: '' })}>Record payment</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setVoidReason('')}>Void</button>
        </div>
      )}
      {pay && (
        <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <label><span style={lbl}>Date received</span>
            <input className="input" type="date" value={pay.paid_at} max={localDate()}
              onChange={(e) => setPay((x) => ({ ...x, paid_at: e.target.value }))} /></label>
          <label><span style={lbl}>Bank reference (optional)</span>
            <input className="input" value={pay.payment_reference} maxLength={60}
              onChange={(e) => setPay((x) => ({ ...x, payment_reference: e.target.value }))} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy || !pay.paid_at}
              onClick={() => run(() => clientInvoicesApi.recordPayment(inv.id, {
                paid_at: `${pay.paid_at} 00:00:00`, payment_reference: pay.payment_reference.trim() || null }))}>Mark paid</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setPay(null)}>Cancel</button>
          </div>
        </div>
      )}
      {voidReason != null && (
        <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <label><span style={lbl}>Why is this invoice being voided?</span>
            <input className="input" value={voidReason} maxLength={200} onChange={(e) => setVoidReason(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ background: 'var(--red)' }} disabled={busy || !voidReason.trim()}
              onClick={() => run(() => clientInvoicesApi.void(inv.id, voidReason.trim()))}>Void invoice</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setVoidReason(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
