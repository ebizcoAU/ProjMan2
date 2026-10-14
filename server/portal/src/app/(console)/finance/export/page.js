// /finance/export — Accounting export (xprojman-43 §13.4; live since v055, contract §15 R4).
// ProjMan keeps the construction money records; this hands them to the org's accounting system
// as a CSV import. Pick a kind and format, filter, preview the rows, download. Preview marks
// nothing; the download stamps the rows exported, so by default the next run skips them (the
// double-post guard). Including them warns EXPORT_INCLUDES_EXPORTED. The Xero preset is
// UNVERIFIED until the Owner test-imports it (EXPORT_FORMAT_UNVERIFIED), so it carries a
// prominent warning. Needs accounts.read.
'use client';

import { useEffect, useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi } from '@/lib/api';
import { seedMockProjects } from '@/lib/clientClaims';
import { accountingExportApi, ACCOUNTING_EXPORT_MOCK, EXPORT_KINDS, EXPORT_FORMATS } from '@/lib/accountingExport';
import { money } from '@/components/portal/ClientClaimViews';

const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '8px 12px', color: 'var(--text)', fontSize: 13, borderTop: '1px solid var(--b1)' };
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--fm)' };
const lbl = { display: 'block', fontSize: 11, color: 'var(--dim)', fontWeight: 700, marginBottom: 4 };
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const localDate = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toLocaleDateString('en-CA');
const auDate = (v) => (v ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)}` : '—');
const kindLabel = (k) => EXPORT_KINDS.find((x) => x.k === k)?.label || k;

// Shown on every Xero export (preview and after download) until the Owner confirms a test import.
function UnverifiedFormatBanner({ label, message }) {
  return (
    <div role="alert" style={{ fontSize: 13, color: 'var(--text)', background: 'var(--s2)', border: '2px solid var(--amber)',
      borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontWeight: 800, color: 'var(--amber)', marginBottom: 4 }}>Warning: the {label} format is unverified</div>
      {message || `This file follows ${label}'s published import template, but nobody has test-imported it yet.`}
      {' '}Import into a {label} demo company first, or check the first import carefully before relying on it.
      {label === 'Xero' && ' Choose "Tax exclusive" when importing.'}
    </div>
  );
}

function HistoryCard({ reload }) {
  const { data, loading, error } = usePortalData(() => accountingExportApi.history(), [reload]);
  const runs = data?.data?.exports || [];
  return (
    <PortalCard title="Past exports">
      {loading && !data ? <PortalEmpty message="Loading…" /> : error ? <PortalError message={error} />
        : !runs.length ? <PortalEmpty message="No exports yet." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>When</th><th style={th}>Kind</th><th style={th}>Format</th><th style={thR}>Rows</th>
                <th style={th}>By</th><th style={th}>Checksum</th>
              </tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{auDate(r.created_at)} {String(r.created_at || '').slice(11, 16)}</td>
                    <td style={td}>{kindLabel(r.kind)}{r.includes_exported && <span style={{ color: 'var(--amber)', fontSize: 11 }}> (repeated rows)</span>}</td>
                    <td style={td}>{r.format}</td>
                    <td style={tdR}>{r.row_count}</td>
                    <td style={td}>{r.created_by?.name || '—'}</td>
                    <td style={{ ...td, fontFamily: 'var(--fm)', fontSize: 11, color: 'var(--dim)' }} title={r.sha256 || ''}>{r.sha256 ? r.sha256.slice(0, 12) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </PortalCard>
  );
}

export default function AccountingExportPage() {
  const perms = usePortalData(() => authApi.permissions());
  const canRead = (perms.data?.data?.permissions || []).includes('accounts.read');
  const projects = usePortalData(() => projectsApi.list());
  const projectList = projects.data?.data?.projects;
  const cfg = usePortalData(() => accountingExportApi.settings().catch(() => null));
  const formats = cfg.data?.data?.formats?.length ? cfg.data.data.formats : EXPORT_FORMATS;

  const [f, setF] = useState({ kind: 'sales', format: 'generic', from: localDate(180), to: localDate(), project_id: '', only_new: '1' });
  const [data, setData] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // the last download's X-Export-* summary
  const [reload, setReload] = useState(0);
  const fmt = formats.find((x) => x.id === f.format) || formats[0];
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value;
    setF((x) => {
      const next = { ...x, [k]: v };
      // A format that can't take the current kind (Xero: sales and bills only) moves the kind to one it can.
      const nf = formats.find((y) => y.id === next.format);
      if (nf && !nf.kinds.includes(next.kind)) next.kind = nf.kinds[0];
      return next;
    });
    setDone(null);
  };
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));

  useEffect(() => {
    if (!canRead || !projectList) return;
    seedMockProjects(projectList);
    let live = true;
    setErr(null);
    accountingExportApi.preview(params)
      .then((res) => { if (live) { setData(res?.data?.data || null); setWarnings(res?.data?.warnings || []); } })
      .catch((e) => { if (live) { setData(null); setWarnings([]); setErr(errMsg(e)); } });
    return () => { live = false; };
  }, [canRead, projectList, f.kind, f.format, f.from, f.to, f.project_id, f.only_new, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const out = await accountingExportApi.download(params);
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url; a.download = out.filename || `projman-${f.kind}-${f.format}-${localDate()}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDone({ ...out, format: f.format });
      setReload((n) => n + 1); // the exported rows now carry exported_at, and the run is in the history
    } catch (e) {
      setErr(e?.response?.data?.code === 'EXPORT_BUSY' ? 'Another export for your organisation is running. Try again in a moment.' : errMsg(e));
    } finally { setBusy(false); }
  };

  if (perms.loading && !perms.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (!canRead) return <div style={{ padding: 20 }}><PortalError message="The accounting export needs the accounts.read permission." /></div>;
  const kind = EXPORT_KINDS.find((k) => k.k === f.kind);
  const rows = data?.rows || [];
  const unverified = warnings.find((w) => w.code === 'EXPORT_FORMAT_UNVERIFIED');
  const otherWarnings = warnings.filter((w) => w.code !== 'EXPORT_FORMAT_UNVERIFIED');
  const showRetention = rows.some((r) => Number(r.retention_withheld) > 0);

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Accounting export</div>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 14 }}>
        Download your project money records as a CSV to import into Xero, MYOB or QuickBooks. Your accounting
        system issues the tax invoices and keeps the books.
      </div>
      {ACCOUNTING_EXPORT_MOCK && (
        <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--s2)', border: '1px dashed var(--b2)', borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>
          Design mockup: sample rows on your real projects, nothing is saved.
        </div>
      )}

      <PortalCard title="What to export">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label><span style={lbl}>Kind</span>
            <select className="input" value={f.kind} onChange={set('kind')}>
              {EXPORT_KINDS.map((k) => <option key={k.k} value={k.k} disabled={!fmt?.kinds?.includes(k.k)}>{k.label}</option>)}
            </select></label>
          <label><span style={lbl}>Format</span>
            <select className="input" value={f.format} onChange={set('format')}>
              {formats.map((x) => <option key={x.id} value={x.id}>{x.label}{x.verified ? '' : ' (unverified)'}</option>)}
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
        {fmt && fmt.kinds.length < EXPORT_KINDS.length && (
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
            {fmt.label} imports {fmt.kinds.map(kindLabel).join(' and ').toLowerCase()} only. Use the generic CSV for the others.
          </div>
        )}
      </PortalCard>
      <div style={{ height: 16 }} />

      {fmt && !fmt.verified && <UnverifiedFormatBanner label={fmt.label} message={unverified?.message} />}
      {otherWarnings.map((w) => (
        <div key={w.code} style={{ fontSize: 12, color: 'var(--text)', background: 'var(--s2)', borderLeft: '3px solid var(--amber)',
          borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>{w.message}</div>
      ))}

      {done && (
        <div style={{ fontSize: 13, color: 'var(--text)', background: 'var(--s2)', borderLeft: '3px solid var(--green)', borderRadius: 4,
          padding: '8px 12px', marginBottom: 12 }}>
          Downloaded {done.rows} row{done.rows === 1 ? '' : 's'}{done.filename ? ` as ${done.filename}` : ''}. They are now marked exported.
          {done.sha256 && <span style={{ color: 'var(--dim)', fontFamily: 'var(--fm)', fontSize: 11 }}> · checksum {done.sha256.slice(0, 12)}</span>}
          {done.warnings.includes('EXPORT_FORMAT_UNVERIFIED') && (
            <div style={{ color: 'var(--amber)', fontWeight: 700, marginTop: 4 }}>
              Unverified format: check this file in a {fmt?.label || done.format} demo company before importing it into your live books.
            </div>
          )}
        </div>
      )}

      <PortalCard title={data ? `${data.row_count} row${data.row_count === 1 ? '' : 's'} · ${money(data.totals?.amount_inc_gst)} inc GST` : 'Preview'}>
        {err ? <PortalError message={err} />
          : !data ? <PortalEmpty message="Loading…" />
          : !rows.length ? <PortalEmpty message={f.only_new === '1' ? 'Nothing new to export for these filters.' : 'No rows for these filters.'} />
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Contact</th><th style={th}>Description</th>
                  <th style={th}>Project</th><th style={th}>Account</th><th style={th}>Tax code</th><th style={thR}>Ex GST</th><th style={thR}>GST</th>
                  <th style={thR}>Inc GST</th>{showRetention && <th style={thR}>Retention</th>}<th style={th}>Exported</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.source_type}:${r.source_id}`} style={r.is_credit ? { color: 'var(--red)' } : undefined}>
                      <td style={td}>{auDate(r.date)}</td>
                      <td style={{ ...td, fontFamily: 'var(--fm)' }}>{r.reference}
                        {r.is_credit ? <span className="badge" style={{ marginLeft: 6 }}>Credit</span> : null}
                        {r.rcti ? <span className="badge" style={{ marginLeft: 6 }}>RCTI</span> : null}
                        {r.sop_state ? <span className="badge" style={{ marginLeft: 6 }}>SOP {r.sop_state}</span> : null}</td>
                      <td style={td}>{r.contact_name}</td>
                      <td style={td}>{r.description}</td>
                      <td style={td}>{r.tracking}</td>
                      <td style={{ ...td, color: r.account_code ? 'var(--text)' : 'var(--amber)' }}>{r.account_code || 'unmapped'}</td>
                      <td style={{ ...td, color: 'var(--dim)', fontSize: 12 }}>{r.gst_code || '—'}</td>
                      <td style={tdR}>{money(r.amount_ex_gst)}</td>
                      <td style={tdR}>{money(r.gst_amount)}</td>
                      <td style={tdR}>{money(r.amount_inc_gst)}</td>
                      {showRetention && <td style={tdR}>{Number(r.retention_withheld) > 0 ? money(r.retention_withheld) : '—'}</td>}
                      <td style={{ ...td, color: 'var(--dim)', fontSize: 12 }}>{r.exported_at ? auDate(r.exported_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {data?.skipped_already_exported > 0 && (
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10 }}>
            {data.skipped_already_exported} row{data.skipped_already_exported === 1 ? ' was' : 's were'} left out because they were exported before.
            Untick &ldquo;Only rows not yet exported&rdquo; to include them (that would double-post them if imported again).
          </div>
        )}
        {rows.some((r) => !r.account_code) && (
          <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>
            Some rows have no account code. Set the defaults or cost-centre codes in Finance → Settings, or code them in your accounting system after import.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={busy || !rows.length} onClick={download}>
            {busy ? 'Exporting…' : `Download ${fmt?.label || ''} CSV`}
          </button>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>Downloading marks these rows exported. The preview marks nothing.</span>
        </div>
      </PortalCard>
      <div style={{ height: 16 }} />
      <HistoryCard reload={reload} />
    </div>
  );
}
