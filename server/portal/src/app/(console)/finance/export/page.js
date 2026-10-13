// /finance/export — Accounting export (xprojman-43 §13.4). ProjMan keeps the construction
// money records; this hands them to the org's accounting system as a CSV import. Pick a
// kind, filter, preview the rows, download. Rows already exported are skipped by default
// (the double-post guard); including them shows EXPORT_INCLUDES_EXPORTED. accounts.read.
'use client';

import { useEffect, useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi } from '@/lib/api';
import { seedMockProjects } from '@/lib/clientInvoices';
import { accountingExportApi, ACCOUNTING_EXPORT_MOCK, EXPORT_KINDS, EXPORT_FORMATS } from '@/lib/accountingExport';
import { money } from '@/components/portal/ClientInvoiceViews';

const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '8px 12px', color: 'var(--text)', fontSize: 13, borderTop: '1px solid var(--b1)' };
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--fm)' };
const lbl = { display: 'block', fontSize: 11, color: 'var(--dim)', fontWeight: 700, marginBottom: 4 };
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const localDate = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toLocaleDateString('en-CA');

export default function AccountingExportPage() {
  const perms = usePortalData(() => authApi.permissions());
  const canRead = (perms.data?.data?.permissions || []).includes('accounts.read');
  const projects = usePortalData(() => projectsApi.list());
  const projectList = projects.data?.data?.projects;

  const [f, setF] = useState({ kind: 'sales', format: 'generic', from: localDate(180), to: localDate(), project_id: '', only_new: '1' });
  const [data, setData] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value }));
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));

  useEffect(() => {
    if (!canRead || !projectList) return;
    seedMockProjects(projectList);
    let live = true;
    setErr(null);
    const { format: _format, ...q } = params;
    accountingExportApi.preview(q)
      .then((res) => { if (live) { setData(res?.data?.data || null); setWarnings(res?.data?.warnings || []); } })
      .catch((e) => { if (live) setErr(errMsg(e)); });
    return () => { live = false; };
  }, [canRead, projectList, f.kind, f.from, f.to, f.project_id, f.only_new, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const blob = await accountingExportApi.download(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `projman-${f.kind}-${f.format}-${localDate()}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setReload((n) => n + 1); // the exported rows now carry exported_at
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  };

  if (perms.loading && !perms.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (!canRead) return <div style={{ padding: 20 }}><PortalError message="The accounting export needs the accounts.read permission." /></div>;
  const kind = EXPORT_KINDS.find((k) => k.k === f.kind);
  const rows = data?.rows || [];

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Accounting export</div>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 14 }}>
        Download your project money records as a CSV to import into Xero, MYOB or QuickBooks. Your accounting
        system issues the tax invoices and keeps the books.
      </div>
      {ACCOUNTING_EXPORT_MOCK && (
        <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--s2)', border: '1px dashed var(--b2)', borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>
          Design mockup: sample rows on your real projects, nothing is saved. Goes live when Server builds the export (xprojman-43 §13.4, R4).
        </div>
      )}

      <PortalCard title="What to export">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label><span style={lbl}>Kind</span>
            <select className="input" value={f.kind} onChange={set('kind')}>
              {EXPORT_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select></label>
          <label><span style={lbl}>Format</span>
            <select className="input" value={f.format} onChange={set('format')}>
              {EXPORT_FORMATS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select></label>
          <label><span style={lbl}>From</span><input className="input" type="date" value={f.from} onChange={set('from')} /></label>
          <label><span style={lbl}>To</span><input className="input" type="date" value={f.to} onChange={set('to')} /></label>
          <label><span style={lbl}>Project</span>
            <select className="input" value={f.project_id} onChange={set('project_id')}>
              <option value="">All projects</option>
              {(projectList || []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
            </select></label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text)', paddingBottom: 8 }}>
            <input type="checkbox" checked={f.only_new === '1'} onChange={set('only_new')} /> Only rows not yet exported
          </label>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10 }}>{kind?.hint}</div>
      </PortalCard>
      <div style={{ height: 16 }} />

      {warnings.map((w) => (
        <div key={w.code} style={{ fontSize: 12, color: 'var(--text)', background: 'var(--s2)', borderLeft: '3px solid var(--amber)',
          borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>{w.message}</div>
      ))}

      <PortalCard title={data ? `${data.row_count} row${data.row_count === 1 ? '' : 's'} · ${money(data.totals?.amount_inc_gst)} inc GST` : 'Preview'}>
        {err ? <PortalError message={err} />
          : !data ? <PortalEmpty message="Loading…" />
          : !rows.length ? <PortalEmpty message={f.only_new === '1' ? 'Nothing new to export for these filters.' : 'No rows for these filters.'} />
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Contact</th><th style={th}>Description</th>
                  <th style={th}>Project</th><th style={th}>Account</th><th style={thR}>Ex GST</th><th style={thR}>GST</th>
                  <th style={thR}>Inc GST</th><th style={th}>Exported</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.source_type}:${r.source_id}`}>
                      <td style={td}>{new Date(`${r.date}T00:00`).toLocaleDateString('en-AU')}</td>
                      <td style={{ ...td, fontFamily: 'var(--fm)' }}>{r.reference}
                        {r.rcti ? <span className="badge" style={{ marginLeft: 6 }}>RCTI</span> : null}
                        {r.sop_state ? <span className="badge" style={{ marginLeft: 6 }}>SOP {r.sop_state}</span> : null}</td>
                      <td style={td}>{r.contact_name}</td>
                      <td style={td}>{r.description}</td>
                      <td style={td}>{r.tracking}</td>
                      <td style={{ ...td, color: r.account_code ? 'var(--text)' : 'var(--amber)' }}>{r.account_code || 'unmapped'}</td>
                      <td style={tdR}>{money(r.amount_ex_gst)}</td>
                      <td style={tdR}>{money(r.gst_amount)}</td>
                      <td style={tdR}>{money(r.amount_inc_gst)}</td>
                      <td style={{ ...td, color: 'var(--dim)', fontSize: 12 }}>{r.exported_at ? new Date(r.exported_at.replace(' ', 'T')).toLocaleDateString('en-AU') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {rows.some((r) => !r.account_code) && (
          <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>
            Some rows have no account code. Map their cost centres to accounts in Finance → Settings, or code them in your accounting system after import.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={busy || !rows.length} onClick={download}>Download CSV</button>
        </div>
      </PortalCard>
    </div>
  );
}
