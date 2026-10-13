// accountingExport.js — the Accounting export client the screen uses (xprojman-43 §13.4).
//
// ProjMan keeps the construction money records and exports them; the accounting system
// (Xero/MYOB/QuickBooks) issues the tax invoice and keeps the books. ACCOUNTING_EXPORT_MOCK
// stays true until Server's R4 (AccountingExportService). The mock follows §13.4's row shape
// and double-post guard exactly; `sales` rows are the Client Invoices mock's issued claims,
// the other kinds are sample rows on the org's real projects. Nothing is persisted.
import { accountingExportApiReal } from './api';
import { mockStore } from './clientInvoices';

export const ACCOUNTING_EXPORT_MOCK = true;

export const EXPORT_KINDS = [
  { k: 'sales', label: 'Client claims (sales)', hint: 'Issued client claims, raised as sales invoices in your accounting system. A void exports as a credit.' },
  { k: 'bills', label: 'Bills', hint: 'Approved Builder progress claims and approved supplier invoices.' },
  { k: 'purchase_orders', label: 'Purchase orders', hint: 'Issued purchase orders.' },
  { k: 'contractor_payments', label: 'Contractor payments (TPAR)', hint: 'Payments to contractors for your Taxable Payments Annual Report.' },
];
// Generic ships first, then Xero (§13.4, O4). MYOB/QBO wait for their import templates to be checked.
export const EXPORT_FORMATS = [
  { k: 'generic', label: 'Generic CSV' },
  { k: 'xero', label: 'Xero (preset, template not yet checked)' },
];
export const ROW_COLUMNS = ['kind', 'source_type', 'source_id', 'reference', 'date', 'due_date', 'contact_name', 'contact_abn',
  'description', 'amount_ex_gst', 'gst_amount', 'amount_inc_gst', 'gst_code', 'account_code', 'tracking', 'project_id', 'rcti', 'sop_state'];

// ── mock ─────────────────────────────────────────────────────────────────────
const ok = (data, warnings) => Promise.resolve({ data: { success: true, data, ...(warnings?.length ? { warnings } : {}) } });
const fail = (status, code, message) => {
  const err = new Error(message);
  err.code = code;
  err.response = { status, data: { success: false, code, message } };
  return Promise.reject(err);
};
const round2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const dayStr = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const exported = {}; // `${source_type}:${source_id}` → { exported_at, export_id }
let samples = null;  // non-sales sample rows, built once from the seeded projects
let exportSeq = 0;

function sampleRows() {
  if (samples) return samples;
  samples = [];
  Object.values(mockStore.projects).forEach((p, i) => {
    const tracking = `${p.code} ${p.name}`;
    const row = (kind, source_type, n, daysAgo, contact, abn, description, exGst, extra = {}) => {
      const gst = round2(exGst * 0.1);
      samples.push({ kind, source_type, source_id: `${source_type}-${p.id}-${n}`, reference: extra.reference || `${source_type.slice(0, 3).toUpperCase()}-${p.code}-${n}`,
        date: dayStr(daysAgo), due_date: kind === 'purchase_orders' ? null : dayStr(daysAgo - 14), contact_name: contact, contact_abn: abn,
        description, amount_ex_gst: exGst, gst_amount: gst, amount_inc_gst: round2(exGst + gst), gst_code: 'GST',
        account_code: extra.account_code ?? '', tracking, project_id: p.id, rcti: extra.rcti || 0, sop_state: extra.sop_state || null });
    };
    row('bills', 'progress_claim', 1, 20 + i, 'Coastline Builders Pty Ltd', '51 824 753 556', 'Progress claim 3: frame', 84000 + i * 5000, { account_code: '310', sop_state: 'NSW' });
    row('bills', 'supplier_invoice', 1, 12 + i, 'Hardware Direct', '33 102 417 032', 'Framing timber, supplied to site', 12650, { account_code: '320' });
    row('bills', 'supplier_invoice', 2, 5 + i, 'Sparkies Electrical', '74 001 225 610', 'Rough-in, levels 1-2', 9800, { rcti: 1 });
    row('purchase_orders', 'purchase_order', 1, 8 + i, 'Roof Right Pty Ltd', '19 620 554 118', 'Colorbond roofing, supply and fix', 26400, { account_code: '310' });
    row('contractor_payments', 'project_payment', 1, 15 + i, 'Sparkies Electrical', '74 001 225 610', 'Payment for rough-in', 9800);
  });
  return samples;
}

function salesRows() {
  return mockStore.invoices.filter((inv) => inv.status === 'issued' || inv.status === 'paid' || (inv.status === 'void' && inv.invoice_number))
    .flatMap((inv) => {
      const p = mockStore.projects[inv.project_id];
      const base = { kind: 'sales', source_type: 'client_claim', source_id: inv.id, reference: inv.invoice_number,
        date: inv.issued_at.slice(0, 10), due_date: inv.due_at?.slice(0, 10) || null, contact_name: `Client, ${p.name}`, contact_abn: '',
        description: `${inv.milestone.replace('_', '-')} milestone claim (${Number(inv.percentage_of_contract)}% of contract)`,
        amount_ex_gst: inv.amount_ex_gst, gst_amount: inv.gst_amount, amount_inc_gst: inv.amount_inc_gst,
        gst_code: inv.gst_amount > 0 ? 'GST' : 'FRE', account_code: '200', tracking: `${p.code} ${p.name}`, project_id: p.id, rcti: 0, sop_state: null };
      if (inv.status !== 'void') return [base];
      // A voided issued claim exports as itself plus a credit row reversing it.
      return [base, { ...base, source_type: 'client_claim_void', source_id: `${inv.id}-void`, reference: `${inv.invoice_number}-CR`,
        date: (inv.voided_at || inv.issued_at).slice(0, 10), description: `Credit: ${inv.void_reason || 'voided claim'}`,
        amount_ex_gst: -inv.amount_ex_gst, gst_amount: -inv.gst_amount, amount_inc_gst: -inv.amount_inc_gst }];
    });
}

function selectRows(p) {
  if (!p.kind) return { error: fail(400, 'VALIDATION_ERROR', 'kind is required') };
  let rows = p.kind === 'sales' ? salesRows() : sampleRows().filter((r) => r.kind === p.kind);
  if (p.project_id) rows = rows.filter((r) => r.project_id === p.project_id);
  if (p.from) rows = rows.filter((r) => r.date >= p.from);
  if (p.to) rows = rows.filter((r) => r.date <= p.to);
  rows = rows.map((r) => ({ ...r, ...(exported[`${r.source_type}:${r.source_id}`] || { exported_at: null, export_id: null }) }));
  const onlyNew = String(p.only_new ?? '1') !== '0';
  const already = rows.filter((r) => r.exported_at);
  if (onlyNew) rows = rows.filter((r) => !r.exported_at);
  const warnings = !onlyNew && already.length
    ? [{ code: 'EXPORT_INCLUDES_EXPORTED', message: `${already.length} row(s) were exported before. Importing them again would double-post.` }] : [];
  return { rows: rows.sort((a, b) => a.date.localeCompare(b.date)), warnings };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const auDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
function toCsv(rows, format) {
  if (format === 'xero') {
    // Mock of Xero's invoice/bill import columns. O4: the real template gets checked before this ships.
    const head = ['*ContactName', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'Description', '*Quantity',
      '*UnitAmount', '*AccountCode', '*TaxType', 'TrackingName1', 'TrackingOption1'];
    const tax = (r) => (r.gst_code === 'GST' ? (r.kind === 'sales' ? 'GST on Income' : 'GST on Expenses') : 'GST Free');
    return [head, ...rows.map((r) => [r.contact_name, r.reference, r.source_type, auDate(r.date), auDate(r.due_date || r.date),
      r.description, 1, r.amount_ex_gst, r.account_code, tax(r), 'Project', r.tracking])].map((l) => l.map(csvCell).join(',')).join('\n');
  }
  return [ROW_COLUMNS, ...rows.map((r) => ROW_COLUMNS.map((c) => r[c]))].map((l) => l.map(csvCell).join(',')).join('\n');
}

const mock = {
  preview: (p = {}) => {
    const { rows, warnings, error } = selectRows(p);
    if (error) return error;
    return ok({ rows, row_count: rows.length, totals: { amount_ex_gst: round2(rows.reduce((s, r) => s + r.amount_ex_gst, 0)),
      gst_amount: round2(rows.reduce((s, r) => s + r.gst_amount, 0)), amount_inc_gst: round2(rows.reduce((s, r) => s + r.amount_inc_gst, 0)) } }, warnings);
  },
  // Resolves to a Blob like the real fetchAuthedBlob; marks the rows exported (the double-post guard).
  download: (p = {}) => {
    const { rows, error } = selectRows(p);
    if (error) return error;
    const exportId = `exp-mock-${++exportSeq}`;
    const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    rows.forEach((r) => { exported[`${r.source_type}:${r.source_id}`] = { exported_at: at, export_id: exportId }; });
    return Promise.resolve(new Blob([toCsv(rows, p.format)], { type: 'text/csv' }));
  },
};

export const accountingExportApi = ACCOUNTING_EXPORT_MOCK ? mock : accountingExportApiReal;
