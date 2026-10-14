// AccountingExportService — the construction money records, exported to the builder's accounting
// package (xprojman-43 R4, §13.4; package order §14 O4: Xero first, then MYOB, then QuickBooks).
//
// ProjMan posts no ledger and issues no tax invoice: the package does that from this export.
//
//   kinds    seen from the exporting org's side:
//              sales                client_claims issued/paid (a void of an exported claim → credit row)
//              bills                progress_claims approved/paid + supplier_invoices matched/approved
//              purchase_orders      purchase_orders issued/received
//              contractor_payments  project_payments flagged tpar_reportable
//            Procurement rows are the org's OWN (owner_party = 'pm'); a builder's private cost rows
//            under the §7.2.1 visibility model are never exported by the PM org.
//   formats  pluggable { kinds, verified, header, toRow }. `generic` is ours; `xero` follows Xero's
//            documented sales/bill import templates but is UNVERIFIED until a test import into a
//            Xero demo company (EXPORT_FORMAT_UNVERIFIED). Xero imports no POs or payments.
//   guard    every source row gets exported_at/by + export_id the first time it goes out in a CSV.
//            only_new=1 (the default) skips exported rows; only_new=0 repeats them and says so
//            (EXPORT_INCLUDES_EXPORTED). Each run writes accounting_exports (filters, count, sha256).
//            The preview never marks anything.
//   codes    account_code: the cost centre's export_account_code, else the org default for the
//            direction, else blank ("unmapped", counted in EXPORT_UNMAPPED_ACCOUNTS). gst_code: the
//            org's gst_code_map for the direction, else the format's default names.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');

const KINDS = ['sales', 'bills', 'purchase_orders', 'contractor_payments'];
const TREATMENTS = ['gst', 'gst_free', 'input_taxed', 'out_of_scope'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const day = (v) => (v == null ? '' : String(v).slice(0, 10));
const directionOf = (kind) => (kind === 'sales' ? 'sales' : 'bills');

const canExport = (actor) => access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'accounts.read');
const canWriteSettings = (actor) => access.hasPermission(actor.role, 'money.write');

function assertExport(actor) {
  if (!canExport(actor)) throw new ServiceError('FORBIDDEN', 'Requires permission: accounts.read', 403);
}

// ── Formats ─────────────────────────────────────────────────────────────────────

const GENERIC_HEADER = ['kind', 'source_type', 'source_id', 'reference', 'date', 'due_date', 'contact_name', 'contact_abn',
  'description', 'amount_ex_gst', 'gst_amount', 'amount_inc_gst', 'gst_code', 'account_code', 'tracking', 'project_id',
  'rcti', 'sop_state', 'retention_withheld', 'exported_at'];

// Xero shows AU dates as DD/MM/YYYY; its importer reads the org's regional format.
const auDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const PO_ADDRESS = ['', '', '', '', '', '', '', ''];

const XERO_SALES_HEADER = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3',
  'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', 'Reference', '*InvoiceDate',
  '*DueDate', 'Total', 'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount', '*AccountCode',
  '*TaxType', 'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme'];
const XERO_BILLS_HEADER = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3',
  'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', '*InvoiceDate', '*DueDate',
  'Total', 'InventoryItemCode', 'Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'TaxAmount',
  'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency'];

const FORMATS = {
  generic: {
    label: 'Generic CSV', verified: true, kinds: KINDS,
    gstDefaults: { sales: Object.fromEntries(TREATMENTS.map((t) => [t, t])), bills: Object.fromEntries(TREATMENTS.map((t) => [t, t])) },
    header: () => GENERIC_HEADER,
    toRow: (r) => [r.kind, r.source_type, r.source_id, r.reference, r.date, r.due_date, r.contact_name, r.contact_abn,
      r.description, r.amount_ex_gst, r.gst_amount, r.amount_inc_gst, r.gst_code, r.account_code, r.tracking, r.project_id,
      r.rcti ? 1 : 0, r.sop_state || '', r.retention_withheld, r.exported_at || ''],
  },
  xero: {
    label: 'Xero', verified: false, kinds: ['sales', 'bills'],
    gstDefaults: {
      sales: { gst: 'GST on Income', gst_free: 'GST Free Income', input_taxed: 'Input Taxed', out_of_scope: 'BAS Excluded' },
      bills: { gst: 'GST on Expenses', gst_free: 'GST Free Expenses', input_taxed: 'Input Taxed', out_of_scope: 'BAS Excluded' },
    },
    header: (kind) => (kind === 'sales' ? XERO_SALES_HEADER : XERO_BILLS_HEADER),
    // One line per document, amounts tax-exclusive (choose "Tax exclusive" on import). A credit
    // row (a voided claim) carries negative amounts.
    toRow: (r, kind, settings) => {
      const tracking = settings.xero_tracking_category && r.project_code
        ? [settings.xero_tracking_category, r.project_code] : ['', ''];
      const due = auDate(r.due_date || r.date);
      if (kind === 'sales') {
        return [r.contact_name, r.contact_email || '', ...PO_ADDRESS, r.reference, r.project_code || '', auDate(r.date), due,
          '', '', r.description, 1, r.amount_ex_gst, '', r.account_code, r.gst_code, r.gst_amount, ...tracking, '', '', 'AUD', ''];
      }
      return [r.contact_name, r.contact_email || '', ...PO_ADDRESS, r.reference, auDate(r.date), due,
        '', '', r.description, 1, r.amount_ex_gst, r.account_code, r.gst_code, r.gst_amount, ...tracking, '', '', 'AUD'];
    },
  },
};

// ── Settings ────────────────────────────────────────────────────────────────────

async function loadSettings(orgId) {
  const [[row]] = await pool.query('SELECT * FROM accounting_export_settings WHERE org_id = ? LIMIT 1', [orgId]);
  const map = row?.gst_code_map ? (typeof row.gst_code_map === 'string' ? JSON.parse(row.gst_code_map) : row.gst_code_map) : {};
  return {
    sales_account_code: row?.sales_account_code || null,
    bills_account_code: row?.bills_account_code || null,
    gst_code_map: { sales: map.sales || {}, bills: map.bills || {} },
    xero_tracking_category: row?.xero_tracking_category || null,
    updated_at: row?.updated_at || null,
  };
}

const formatList = () => Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, kinds: f.kinds, verified: f.verified }));

/** GET /accounting-export/settings */
async function getSettings({ orgId, actor }) {
  if (!canExport(actor) && !access.hasPermission(actor.role, 'money.read')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: accounts.read or money.read', 403);
  }
  const [centres] = await pool.query(
    'SELECT id, code, name, export_account_code FROM cost_centres WHERE org_id = ? AND is_deleted = 0 ORDER BY code', [orgId]);
  return { settings: await loadSettings(orgId), cost_centres: centres, formats: formatList(),
    format_gst_defaults: Object.fromEntries(Object.entries(FORMATS).map(([id, f]) => [id, f.gstDefaults])) };
}

const codeOrNull = (v, field, max = 20) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (s.length > max) throw new ServiceError('VALIDATION_ERROR', `${field} is at most ${max} characters`, 400);
  return s;
};

/** PUT /accounting-export/settings { sales_account_code?, bills_account_code?, gst_code_map?, xero_tracking_category? } */
async function putSettings({ orgId, actor, body }) {
  if (!canWriteSettings(actor)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  const cur = await loadSettings(orgId);
  const sales = codeOrNull(body.sales_account_code, 'sales_account_code');
  const bills = codeOrNull(body.bills_account_code, 'bills_account_code');
  const tracking = codeOrNull(body.xero_tracking_category, 'xero_tracking_category', 60);
  let map = cur.gst_code_map;
  if (body.gst_code_map !== undefined) {
    const m = body.gst_code_map || {};
    if (typeof m !== 'object' || Array.isArray(m)) throw new ServiceError('VALIDATION_ERROR', 'gst_code_map must be an object', 400);
    map = { sales: {}, bills: {} };
    for (const [dir, codes] of Object.entries(m)) {
      if (!['sales', 'bills'].includes(dir)) throw new ServiceError('VALIDATION_ERROR', `gst_code_map: unknown direction '${dir}' (sales, bills)`, 400);
      for (const [t, code] of Object.entries(codes || {})) {
        if (!TREATMENTS.includes(t)) throw new ServiceError('VALIDATION_ERROR', `gst_code_map.${dir}: unknown key '${t}'`, 400);
        const c = codeOrNull(code, `gst_code_map.${dir}.${t}`, 40);
        if (c) map[dir][t] = c;
      }
    }
  }
  await pool.query(
    `INSERT INTO accounting_export_settings (org_id, sales_account_code, bills_account_code, gst_code_map, xero_tracking_category, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE sales_account_code = VALUES(sales_account_code), bills_account_code = VALUES(bills_account_code),
       gst_code_map = VALUES(gst_code_map), xero_tracking_category = VALUES(xero_tracking_category), updated_by = VALUES(updated_by)`,
    [orgId, sales === undefined ? cur.sales_account_code : sales, bills === undefined ? cur.bills_account_code : bills,
     JSON.stringify(map), tracking === undefined ? cur.xero_tracking_category : tracking, actor.userId]);
  return getSettings({ orgId, actor });
}

/** PATCH /cost-centres/:id { export_account_code } (money.write) */
async function setCostCentreCode({ orgId, actor, costCentreId, code }) {
  if (!canWriteSettings(actor)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  const value = codeOrNull(code, 'export_account_code');
  const [r] = await pool.query('UPDATE cost_centres SET export_account_code = ? WHERE id = ? AND org_id = ? AND is_deleted = 0',
    [value ?? null, costCentreId, orgId]);
  if (!r.affectedRows) throw new ServiceError('NOT_FOUND', 'Cost centre not found', 404);
  return { id: costCentreId, export_account_code: value ?? null };
}

// ── Source rows ─────────────────────────────────────────────────────────────────

// The counterparty name for a payee user: their business when it is someone else's org, else the person.
const PAYEE_SQL = `
  LEFT JOIN users pu ON pu.id = %COL%
  LEFT JOIN organisations po ON po.id = pu.org_id AND po.id <> %ORG%`;
const payeeName = (r) => r.payee_org_name || r.payee_user_name || '';

function filterSql({ dateCol, alias, filters, params }) {
  let sql = '';
  if (filters.from) { sql += ` AND DATE(${dateCol}) >= ?`; params.push(filters.from); }
  if (filters.to) { sql += ` AND DATE(${dateCol}) <= ?`; params.push(filters.to); }
  if (filters.projectId) { sql += ` AND ${alias}.project_id = ?`; params.push(filters.projectId); }
  return sql;
}

async function collectSales(orgId, filters) {
  const params = [orgId];
  const where = filterSql({ dateCol: 'COALESCE(c.voided_at, c.issued_at)', alias: 'c', filters, params });
  const [rows] = await pool.query(
    `SELECT c.*, p.code AS project_code, p.name AS project_name, cu.name AS contact_name, cu.abn AS contact_abn, cu.email AS contact_email
       FROM client_claims c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN customers cu ON cu.id = p.customer_id
      WHERE c.org_id = ? AND c.is_deleted = 0 AND c.claim_number IS NOT NULL
        AND (c.status IN ('issued','paid') OR (c.status = 'void' AND c.exported_at IS NOT NULL))${where}
      ORDER BY c.claim_year, c.claim_seq`, params);
  const out = [];
  for (const c of rows) {
    const base = {
      kind: 'sales', source_type: 'client_claim', source_id: c.id, project_id: c.project_id,
      project_code: c.project_code, project_name: c.project_name,
      contact_name: c.contact_name || '', contact_abn: c.contact_abn || '', contact_email: c.contact_email || '',
      gst_treatment: Number(c.gst_amount) > 0 ? 'gst' : 'gst_free', rcti: false, sop_state: c.sop_state,
      retention_withheld: Number(c.retention_withheld || 0), costCentreCode: null,
    };
    const desc = `Progress claim: ${c.milestone.replace('_', ' ')} (${c.project_code} ${c.project_name})${c.variation_note ? `. ${c.variation_note}` : ''}`;
    // Issued and paid claims are invoices. A void only reaches here once its invoice went out; then
    // the invoice row is history and a credit row reverses it.
    out.push({ ...base, reference: c.claim_number, date: day(c.issued_at), due_date: day(c.due_at), description: desc,
      amount_ex_gst: Number(c.amount_ex_gst), gst_amount: Number(c.gst_amount), amount_inc_gst: Number(c.amount_inc_gst),
      exported_at: c.exported_at, guard: { table: 'client_claims', column: 'exported_at' }, isCredit: false,
      skip: c.status === 'void' });
    if (c.status === 'void') {
      out.push({ ...base, reference: `${c.claim_number}-CR`, date: day(c.voided_at), due_date: day(c.voided_at),
        description: `Credit: ${c.claim_number} voided${c.void_reason ? ` (${c.void_reason})` : ''}`,
        amount_ex_gst: -Number(c.amount_ex_gst), gst_amount: -Number(c.gst_amount), amount_inc_gst: -Number(c.amount_inc_gst),
        exported_at: c.void_exported_at, guard: { table: 'client_claims', column: 'void_exported_at' }, isCredit: true });
    }
  }
  return out.filter((r) => !r.skip);
}

async function collectBills(orgId, filters) {
  const p1 = [orgId, orgId];
  const w1 = filterSql({ dateCol: 'COALESCE(pc.approved_at, pc.submitted_at)', alias: 'pc', filters, params: p1 });
  const [claims] = await pool.query(
    `SELECT pc.*, p.code AS project_code, p.name AS project_name, ct.party_name AS contract_party,
            pu.full_name AS payee_user_name, pu.email AS contact_email, po.name AS payee_org_name, po.abn AS payee_abn
       FROM progress_claims pc
       JOIN projects p ON p.id = pc.project_id
       LEFT JOIN contracts ct ON ct.id = pc.contract_id
       ${PAYEE_SQL.replace('%COL%', 'pc.submitted_by').replace('%ORG%', '?')}
      WHERE pc.org_id = ? AND pc.is_deleted = 0 AND pc.status IN ('approved','paid')${w1}
      ORDER BY pc.approved_at`, p1); // the payee join's org first, then WHERE
  const p2 = [orgId];
  const w2 = filterSql({ dateCol: 'si.created_at', alias: 'si', filters, params: p2 });
  const [invoices] = await pool.query(
    `SELECT si.*, p.code AS project_code, p.name AS project_name, s.name AS supplier_master_name, s.abn AS supplier_abn,
            s.email AS contact_email, cc.export_account_code
       FROM supplier_invoices si
       JOIN projects p ON p.id = si.project_id
       LEFT JOIN suppliers s ON s.id = si.supplier_id
       LEFT JOIN tasks t ON t.id = si.task_id
       LEFT JOIN cost_centres cc ON cc.id = t.cost_centre_id AND cc.is_deleted = 0
      WHERE si.org_id = ? AND si.is_deleted = 0 AND si.owner_party = 'pm' AND si.status IN ('matched','approved')${w2}
      ORDER BY si.created_at`, p2);
  return [
    ...claims.map((c) => ({
      kind: 'bills', source_type: 'progress_claim', source_id: c.id, project_id: c.project_id,
      project_code: c.project_code, project_name: c.project_name,
      reference: `${c.project_code}-PC${c.claim_number}`, date: day(c.approved_at || c.submitted_at), due_date: day(c.payment_due_at),
      contact_name: c.contract_party || payeeName(c), contact_abn: c.payee_abn || '', contact_email: c.contact_email || '',
      description: c.work_description || c.note || `Progress claim #${c.claim_number} (${c.project_code})`,
      amount_ex_gst: Number(c.amount), gst_amount: Number(c.gst_amount), amount_inc_gst: round2(Number(c.amount) + Number(c.gst_amount)),
      gst_treatment: c.gst_treatment, rcti: !!c.rcti_issued, sop_state: c.sop_state,
      retention_withheld: Number(c.retention_withheld || 0), costCentreCode: null,
      exported_at: c.exported_at, guard: { table: 'progress_claims', column: 'exported_at' },
    })),
    ...invoices.map((i) => ({
      kind: 'bills', source_type: 'supplier_invoice', source_id: i.id, project_id: i.project_id,
      project_code: i.project_code, project_name: i.project_name,
      reference: i.invoice_number, date: day(i.created_at), due_date: '',
      contact_name: i.supplier_master_name || i.supplier_name || '', contact_abn: i.supplier_abn || '', contact_email: i.contact_email || '',
      description: `Supplier invoice ${i.invoice_number} (${i.project_code})`,
      amount_ex_gst: Number(i.amount), gst_amount: Number(i.gst_amount), amount_inc_gst: round2(Number(i.amount) + Number(i.gst_amount)),
      gst_treatment: i.gst_treatment, rcti: !!i.rcti_issued, sop_state: null, retention_withheld: 0,
      costCentreCode: i.export_account_code || null,
      exported_at: i.exported_at, guard: { table: 'supplier_invoices', column: 'exported_at' },
    })),
  ];
}

async function collectPurchaseOrders(orgId, filters) {
  const params = [orgId];
  const where = filterSql({ dateCol: 'po.created_at', alias: 'po', filters, params });
  const [rows] = await pool.query(
    `SELECT po.*, p.code AS project_code, p.name AS project_name, s.name AS supplier_master_name, s.abn AS supplier_abn,
            s.email AS contact_email, cc.export_account_code
       FROM purchase_orders po
       JOIN projects p ON p.id = po.project_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN tasks t ON t.id = po.task_id
       LEFT JOIN cost_centres cc ON cc.id = t.cost_centre_id AND cc.is_deleted = 0
      WHERE po.org_id = ? AND po.is_deleted = 0 AND po.owner_party = 'pm' AND po.status IN ('issued','received')${where}
      ORDER BY po.created_at`, params);
  // POs carry no GST columns (v023 covered four other tables): the amount is the committed figure as raised.
  return rows.map((o) => ({
    kind: 'purchase_orders', source_type: 'purchase_order', source_id: o.id, project_id: o.project_id,
    project_code: o.project_code, project_name: o.project_name,
    reference: `${o.project_code}-PO${o.po_number}`, date: day(o.created_at), due_date: '',
    contact_name: o.supplier_master_name || o.supplier_name || '', contact_abn: o.supplier_abn || '', contact_email: o.contact_email || '',
    description: o.description || `Purchase order ${o.po_number} (${o.project_code})`,
    amount_ex_gst: Number(o.amount), gst_amount: 0, amount_inc_gst: Number(o.amount), gst_treatment: null,
    rcti: false, sop_state: null, retention_withheld: 0, costCentreCode: o.export_account_code || null,
    exported_at: o.exported_at, guard: { table: 'purchase_orders', column: 'exported_at' },
  }));
}

async function collectContractorPayments(orgId, filters) {
  const params = [orgId, orgId];
  const where = filterSql({ dateCol: 'pp.paid_at', alias: 'pp', filters, params });
  const [rows] = await pool.query(
    `SELECT pp.*, p.code AS project_code, p.name AS project_name,
            pu.full_name AS payee_user_name, pu.email AS contact_email, po.name AS payee_org_name, po.abn AS payee_abn
       FROM project_payments pp
       JOIN projects p ON p.id = pp.project_id
       ${PAYEE_SQL.replace('%COL%', 'pp.payee_user_id').replace('%ORG%', '?')}
      WHERE pp.org_id = ? AND pp.tpar_reportable = 1${where}
      ORDER BY pp.paid_at`, params);
  return rows.map((pay) => ({
    kind: 'contractor_payments', source_type: 'project_payment', source_id: pay.id, project_id: pay.project_id,
    project_code: pay.project_code, project_name: pay.project_name,
    reference: pay.reference || pay.purpose, date: day(pay.paid_at), due_date: '',
    contact_name: payeeName(pay), contact_abn: pay.payee_abn || '', contact_email: pay.contact_email || '',
    description: `Payment: ${String(pay.purpose).replace(/_/g, ' ')} (${pay.project_code})`,
    amount_ex_gst: Number(pay.amount), gst_amount: Number(pay.gst_amount), amount_inc_gst: round2(Number(pay.amount) + Number(pay.gst_amount)),
    gst_treatment: pay.gst_treatment, rcti: false, sop_state: null, retention_withheld: 0, costCentreCode: null,
    exported_at: pay.exported_at, guard: { table: 'project_payments', column: 'exported_at' },
  }));
}

const COLLECTORS = { sales: collectSales, bills: collectBills, purchase_orders: collectPurchaseOrders, contractor_payments: collectContractorPayments };

// ── Build ───────────────────────────────────────────────────────────────────────

function parseFilters(q) {
  const kind = q.kind;
  if (!KINDS.includes(kind)) throw new ServiceError('VALIDATION_ERROR', `kind must be one of ${KINDS.join(', ')}`, 400);
  const format = q.format || 'generic';
  const fmt = FORMATS[format];
  if (!fmt) throw new ServiceError('VALIDATION_ERROR', `format must be one of ${Object.keys(FORMATS).join(', ')}`, 400);
  if (!fmt.kinds.includes(kind)) {
    throw new ServiceError('EXPORT_KIND_UNSUPPORTED', `${fmt.label} doesn't import ${kind.replace('_', ' ')}; use the generic CSV`, 400,
      { format, kind, supported: fmt.kinds });
  }
  for (const k of ['from', 'to']) {
    if (q[k] && !DATE.test(String(q[k]))) throw new ServiceError('VALIDATION_ERROR', `${k} must be a date (YYYY-MM-DD)`, 400);
  }
  const onlyNew = !['0', 'false'].includes(String(q.only_new ?? '1'));
  return { kind, format, fmt, from: q.from || null, to: q.to || null, projectId: q.project_id || null, onlyNew };
}

async function build({ orgId, query }) {
  const f = parseFilters(query);
  const settings = await loadSettings(orgId);
  const dir = directionOf(f.kind);
  const all = await COLLECTORS[f.kind](orgId, f);
  const already = all.filter((r) => r.exported_at);
  const rows = (f.onlyNew ? all.filter((r) => !r.exported_at) : all).map((r) => {
    const t = r.gst_treatment;
    const gstCode = t ? (settings.gst_code_map[dir][t] || f.fmt.gstDefaults[dir][t] || t) : '';
    const fallback = dir === 'sales' ? settings.sales_account_code : settings.bills_account_code;
    return {
      ...r, gst_code: gstCode, account_code: r.costCentreCode || fallback || '',
      tracking: r.project_code ? `${r.project_code} ${r.project_name}` : '',
      amount_ex_gst: round2(r.amount_ex_gst), gst_amount: round2(r.gst_amount), amount_inc_gst: round2(r.amount_inc_gst),
    };
  });
  const warnings = [];
  if (!f.fmt.verified) {
    warnings.push({ code: 'EXPORT_FORMAT_UNVERIFIED',
      message: `The ${f.fmt.label} layout follows ${f.fmt.label}'s published import template but hasn't been test-imported yet. Check the first import in ${f.fmt.label} before relying on it.` });
  }
  const repeated = rows.filter((r) => r.exported_at).length;
  if (repeated) {
    warnings.push({ code: 'EXPORT_INCLUDES_EXPORTED', count: repeated,
      message: `${repeated} row(s) were exported before. Importing them again would double-post them in your accounting system.` });
  }
  const unmapped = rows.filter((r) => !r.account_code).length;
  if (unmapped) {
    warnings.push({ code: 'EXPORT_UNMAPPED_ACCOUNTS', count: unmapped,
      message: `${unmapped} row(s) have no account code. Set the default ${dir} account (or a cost-centre code) in the export settings.` });
  }
  return { f, settings, rows, warnings, skippedExported: f.onlyNew ? already.length : 0 };
}

const publicRow = (r) => ({
  kind: r.kind, source_type: r.source_type, source_id: r.source_id, reference: r.reference, date: r.date,
  due_date: r.due_date || null, contact_name: r.contact_name, contact_abn: r.contact_abn || null, description: r.description,
  amount_ex_gst: r.amount_ex_gst, gst_amount: r.gst_amount, amount_inc_gst: r.amount_inc_gst, gst_code: r.gst_code,
  account_code: r.account_code || null, tracking: r.tracking, project_id: r.project_id, rcti: !!r.rcti,
  sop_state: r.sop_state || null, retention_withheld: r.retention_withheld, exported_at: r.exported_at || null,
  is_credit: !!r.isCredit,
});

/** GET /accounting-export/preview — the rows as JSON, nothing marked. */
async function preview({ orgId, actor, query }) {
  assertExport(actor);
  const { f, rows, warnings, skippedExported } = await build({ orgId, query });
  return {
    data: {
      kind: f.kind, format: f.format, only_new: f.onlyNew, rows: rows.map(publicRow), row_count: rows.length,
      skipped_already_exported: skippedExported,
      totals: {
        amount_ex_gst: round2(rows.reduce((s, r) => s + r.amount_ex_gst, 0)),
        gst_amount: round2(rows.reduce((s, r) => s + r.gst_amount, 0)),
        amount_inc_gst: round2(rows.reduce((s, r) => s + r.amount_inc_gst, 0)),
      },
    },
    warnings,
  };
}

// CSV: every cell quoted. A TEXT cell starting with = + - @ (or tab/CR) gets a leading apostrophe so a
// spreadsheet doesn't run it as a formula; numbers (incl. negative credit amounts) go out as numbers.
function cell(v) {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'number') return `"${v}"`;
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const toCsv = (lines) => `${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;

/**
 * GET /accounting-export — the CSV. Marks the rows exported (first export wins the timestamp) and
 * records the run. One export per org at a time (a named lock), so two clicks can't both take the
 * same "new" rows.
 */
async function exportCsv({ orgId, actor, query }) {
  assertExport(actor);
  const conn = await pool.getConnection();
  const lockName = `projman2:acctexp:${orgId}`;
  try {
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [lockName]);
    if (got !== 1) throw new ServiceError('EXPORT_BUSY', 'Another export for this organisation is running. Try again shortly.', 409);
    const { f, settings, rows, warnings } = await build({ orgId, query });
    const csv = toCsv([f.fmt.header(f.kind), ...rows.map((r) => f.fmt.toRow(r, f.kind, settings))]);
    const sha256 = crypto.createHash('sha256').update(csv).digest('hex');
    const exportId = uuidv4();
    if (rows.length) {
      await conn.beginTransaction();
      try {
        await conn.query(
          `INSERT INTO accounting_exports (id, org_id, kind, format, filters, row_count, sha256, includes_exported, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [exportId, orgId, f.kind, f.format,
           JSON.stringify({ from: f.from, to: f.to, project_id: f.projectId, only_new: f.onlyNew }),
           rows.length, sha256, warnings.some((w) => w.code === 'EXPORT_INCLUDES_EXPORTED') ? 1 : 0, actor.userId]);
        const byGuard = {};
        for (const r of rows) {
          const key = `${r.guard.table}.${r.guard.column}`;
          (byGuard[key] ||= { ...r.guard, ids: [] }).ids.push(r.source_id);
        }
        for (const g of Object.values(byGuard)) {
          // The credit guard has no by/id columns of its own: export_id/by stay with the invoice export.
          const extra = g.column === 'exported_at' ? ', exported_by = ?, export_id = ?' : '';
          await conn.query(
            `UPDATE ${g.table} SET ${g.column} = NOW()${extra} WHERE org_id = ? AND ${g.column} IS NULL AND id IN (?)`,
            g.column === 'exported_at' ? [actor.userId, exportId, orgId, g.ids] : [orgId, g.ids]);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }
    return {
      csv, filename: `projman-${f.kind}-${f.format}-${new Date().toISOString().slice(0, 10)}.csv`,
      export_id: rows.length ? exportId : null, row_count: rows.length, sha256, warnings,
    };
  } finally {
    try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { /* connection gone */ }
    conn.release();
  }
}

/** GET /accounting-export/history — the runs, newest first. */
async function history({ orgId, actor }) {
  assertExport(actor);
  const [rows] = await pool.query(
    `SELECT e.id, e.kind, e.format, e.filters, e.row_count, e.sha256, e.includes_exported, e.created_at,
            e.created_by, u.full_name AS created_by_name
       FROM accounting_exports e LEFT JOIN users u ON u.id = e.created_by
      WHERE e.org_id = ? ORDER BY e.created_at DESC LIMIT 200`, [orgId]);
  return {
    exports: rows.map((r) => ({
      id: r.id, kind: r.kind, format: r.format,
      filters: typeof r.filters === 'string' ? JSON.parse(r.filters) : r.filters,
      row_count: r.row_count, sha256: r.sha256, includes_exported: !!r.includes_exported, created_at: r.created_at,
      created_by: r.created_by ? { id: r.created_by, name: r.created_by_name || null } : null,
    })),
  };
}

module.exports = { KINDS, FORMATS, getSettings, putSettings, setCostCentreCode, preview, exportCsv, history, toCsv };
