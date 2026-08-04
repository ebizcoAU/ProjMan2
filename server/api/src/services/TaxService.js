// TaxService — P8b GST & BAS (serverdesignspec §11.2, migration v023, decisions #12/#13/#15).
//
// The org-level half of P8: classify the GST on the commercial money rows, roll a BAS quarter up
// to G1/1A/1B/net, cache it on `tax_periods`, and export the worksheet + transaction listing the
// accountant lodges. Export-first (decision #6 = (B)+(b1)) — the facts and the file live here;
// no Xero/MYOB API sync.
//
//   prepareBas(orgId, periodStart)  classify + roll up + cache, status → 'prepared'
//   lodgeBas(periodId)              the `tax.approve` lock, status → 'lodged'
//   exportBas(periodId)             the CSV the accountant lodges from
//
// ── THE CONVENTION (decision #12, pinned by v023) ────────────────────────────────────────────
// `amount` = the GST-EXCLUSIVE base. `gst_amount` = the GST sitting on top. The GST-inclusive
// gross that BAS G1 wants = `amount + gst_amount`. No P7 row is re-interpreted.
//
// ── WHAT COUNTS, AND WHAT DELIBERATELY DOES NOT ──────────────────────────────────────────────
// SALES (G1, 1A)      `progress_claims` in status ('approved','paid'). A claim becomes a tax
//                     invoice when it is certified/approved — a merely 'submitted' claim is not
//                     yet a supply, and 'declined' never was.
// PURCHASES (1B)      `supplier_invoices` in status ('matched','approved'). 'received' has not
//                     been verified against its PO yet; 'disputed' is not a claimable credit.
// NOT IN THE BAS:
//   `project_payments` — classified for GST (TPAR/P8c needs it) but NEVER rolled into 1B: these
//     are payments AGAINST the same supplier invoices already counted, so including both would
//     double-count every credit.
//   `estimate_lines` — forecasts, not transactions. A budget line is not a supply and has no
//     tax point. Its v023 gst columns are reserved for GST-inclusive quoting, not the BAS.
//
// ── BASIS (decision #15) ─────────────────────────────────────────────────────────────────────
// `accrual` is built and is the default. `cash` is REFUSED rather than approximated: a cash BAS
// needs the date each purchase was PAID, and `supplier_invoices` carries no payment date (v019
// has created_at only). Emitting a cash BAS off accrual dates would be a quietly wrong lodgement,
// so the column stays (an org can elect cash once the data exists) and the code says so out loud.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');

const GST_RATE = 0.10;
const SALE_STATUSES     = ['approved', 'paid'];
const PURCHASE_STATUSES = ['matched', 'approved'];

const canReadAccounts = (actor) =>
  access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'accounts.read');
const canApproveTax = (actor) =>
  access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'tax.approve');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);

function assertAccounts(actor) {
  if (!canReadAccounts(actor)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: accounts.read', 403);
  }
}

/**
 * The BAS quarter containing / starting at `periodStart`. AU quarters are Jul–Sep, Oct–Dec,
 * Jan–Mar, Apr–Jun; anything else is a caller error rather than something to snap silently,
 * because a mis-dated period would produce a plausible-looking but wrong lodgement.
 */
function quarterFor(periodStart) {
  const d = new Date(`${periodStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new ServiceError('VALIDATION_ERROR', 'period_start must be a date (YYYY-MM-DD)', 400);
  }
  const m = d.getUTCMonth();
  if (d.getUTCDate() !== 1 || ![0, 3, 6, 9].includes(m)) {
    throw new ServiceError('VALIDATION_ERROR',
      'period_start must be the first day of a BAS quarter (1 Jul, 1 Oct, 1 Jan or 1 Apr)', 400);
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), m, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), m + 3, 0));   // day 0 of next+3 = last day
  return { start, end };
}

/** GST on a row: 10% of the ex-GST base, but only where it is a taxable supply AND the org is
 *  actually registered. An unregistered sole trader charges none, whatever the treatment says. */
const gstFor = (amount, treatment, gstRegistered) =>
  (treatment === 'gst' && gstRegistered ? round2(Number(amount) * GST_RATE) : 0);

/**
 * Classify one table's in-period rows, writing `gst_amount`. Returns the rows for the roll-up.
 * The write is what makes the figures reproducible: a re-prepare recomputes from the same base.
 */
async function classify(conn, { table, orgId, start, end, statuses, dateCol, gstRegistered }) {
  const [rows] = await conn.query(
    `SELECT id, amount, gst_treatment FROM \`${table}\`
      WHERE org_id = ? AND ${dateCol} >= ? AND ${dateCol} < DATE_ADD(?, INTERVAL 1 DAY)
        ${statuses ? `AND status IN (${statuses.map(() => '?').join(',')})` : ''}
        ${table === 'project_payments' ? '' : 'AND is_deleted = 0'}
      ORDER BY ${dateCol}`,
    [orgId, iso(start), iso(end), ...(statuses || [])]
  );

  for (const r of rows) {
    const gst = gstFor(r.amount, r.gst_treatment, gstRegistered);
    if (Number(r.gst_amount) !== gst) {
      await conn.query(`UPDATE \`${table}\` SET gst_amount = ? WHERE id = ?`, [gst, r.id]);
    }
    r.gst_amount = gst;
  }
  return rows;
}

/**
 * POST /accounts/bas/prepare — classify the quarter and cache its roll-up.
 *
 * Idempotent: re-preparing an open/prepared period recomputes it in place. A LODGED period is
 * refused (409) — the cached figures are the record of what was actually lodged, and silently
 * moving them under a lodgement is exactly the failure the cache exists to prevent.
 */
async function prepareBas({ orgId, actor, periodStart, basis = 'accrual' }) {
  assertAccounts(actor);
  if (basis !== 'accrual') {
    throw new ServiceError('VALIDATION_ERROR',
      'Only the accrual basis is supported: a cash BAS needs the date each purchase was paid, ' +
      'which supplier_invoices does not yet capture. Elect cash once that data exists.', 422);
  }
  const { start, end } = quarterFor(periodStart);

  const [[org]] = await pool.query(
    'SELECT id, gst_registered, abn FROM organisations WHERE id = ? LIMIT 1', [orgId]);
  if (!org) throw new ServiceError('NOT_FOUND', 'Organisation not found', 404);
  const gstRegistered = !!org.gst_registered;

  const [[existing]] = await pool.query(
    'SELECT id, status FROM tax_periods WHERE org_id = ? AND period_start = ? AND is_deleted = 0 LIMIT 1',
    [orgId, iso(start)]);
  if (existing && existing.status === 'lodged') {
    throw new ServiceError('ALREADY_RESOLVED',
      'This BAS period is lodged — its figures are the record of what was lodged and cannot be re-prepared', 409);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const sales = await classify(conn, {
      table: 'progress_claims', orgId, start, end,
      statuses: SALE_STATUSES, dateCol: 'COALESCE(approved_at, submitted_at, created_at)', gstRegistered,
    });
    const purchases = await classify(conn, {
      table: 'supplier_invoices', orgId, start, end,
      statuses: PURCHASE_STATUSES, dateCol: 'created_at', gstRegistered,
    });
    // Classified for TPAR (P8c) — deliberately NOT rolled into 1B, see the header note.
    await classify(conn, {
      table: 'project_payments', orgId, start, end,
      statuses: null, dateCol: 'COALESCE(paid_at, created_at)', gstRegistered,
    });

    const a1 = round2(sales.reduce((t, r) => t + Number(r.gst_amount), 0));
    const g1 = round2(sales.reduce((t, r) => t + Number(r.amount) + Number(r.gst_amount), 0));
    const b1 = round2(purchases.reduce((t, r) => t + Number(r.gst_amount), 0));
    const net = round2(a1 - b1);

    const id = existing ? existing.id : uuidv4();
    if (existing) {
      await conn.query(
        `UPDATE tax_periods SET period_end = ?, basis = ?, g1_total_sales = ?, a1_gst_on_sales = ?,
                b1_gst_on_purchases = ?, net_gst = ?, status = 'prepared', prepared_by = ?, prepared_at = NOW()
          WHERE id = ? AND org_id = ?`,
        [iso(end), basis, g1, a1, b1, net, actor.userId, id, orgId]);
    } else {
      await conn.query(
        `INSERT INTO tax_periods
           (id, org_id, period_start, period_end, basis, g1_total_sales, a1_gst_on_sales,
            b1_gst_on_purchases, net_gst, status, prepared_by, prepared_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, NOW())`,
        [id, orgId, iso(start), iso(end), basis, g1, a1, b1, net, actor.userId]);
    }

    await conn.commit();
    return {
      id,
      period_start: iso(start), period_end: iso(end), basis, status: 'prepared',
      gst_registered: gstRegistered,
      g1_total_sales: g1, a1_gst_on_sales: a1, b1_gst_on_purchases: b1, net_gst: net,
      counted: { sales: sales.length, purchases: purchases.length },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /accounts/bas/:id/lodge — the accountant's lock (decision #14: `tax.approve` covers every
 * tax artifact; there is no separate `tax.lodge` verb). Only a PREPARED period can be lodged —
 * locking an untouched 'open' row would lodge zeroes.
 */
async function lodgeBas({ orgId, periodId, actor }) {
  if (!canApproveTax(actor)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: tax.approve (accountant)', 403);
  }
  const [[p]] = await pool.query(
    'SELECT id, status FROM tax_periods WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [periodId, orgId]);
  if (!p) throw new ServiceError('NOT_FOUND', 'BAS period not found', 404);
  if (p.status === 'lodged') throw new ServiceError('ALREADY_RESOLVED', 'This BAS period is already lodged', 409);
  if (p.status !== 'prepared') {
    throw new ServiceError('VALIDATION_ERROR', 'Prepare this BAS period before lodging it', 422);
  }

  await pool.query(
    `UPDATE tax_periods SET status = 'lodged', lodged_by = ?, lodged_at = NOW() WHERE id = ? AND org_id = ?`,
    [actor.userId, periodId, orgId]);
  return { id: periodId, status: 'lodged' };
}

async function listPeriods({ orgId, actor }) {
  assertAccounts(actor);
  const [rows] = await pool.query(
    `SELECT tp.*, pu.full_name AS prepared_by_name, lu.full_name AS lodged_by_name
       FROM tax_periods tp
       LEFT JOIN users pu ON pu.id = tp.prepared_by
       LEFT JOIN users lu ON lu.id = tp.lodged_by
      WHERE tp.org_id = ? AND tp.is_deleted = 0
      ORDER BY tp.period_start DESC`, [orgId]);
  return { tax_periods: rows };
}

async function getPeriod({ orgId, periodId, actor }) {
  assertAccounts(actor);
  const [[row]] = await pool.query(
    'SELECT * FROM tax_periods WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [periodId, orgId]);
  if (!row) throw new ServiceError('NOT_FOUND', 'BAS period not found', 404);
  return row;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

/**
 * GET /accounts/bas/:id/export — the (b1) deliverable: a BAS worksheet plus the GST transaction
 * listing behind it, as one CSV. The listing is what makes the worksheet auditable — an
 * accountant asked to lodge a net figure needs to see the rows it came from.
 *
 * The transaction listing is recomputed from the same base at export time, so it always agrees
 * with the cached worksheet figures for a prepared period.
 */
async function exportBas({ orgId, periodId, actor }) {
  const period = await getPeriod({ orgId, periodId, actor });

  const [[org]] = await pool.query(
    'SELECT name, abn, gst_registered FROM organisations WHERE id = ? LIMIT 1', [orgId]);

  const [sales] = await pool.query(
    `SELECT pc.claim_number, pc.amount, pc.gst_treatment, pc.gst_amount, pc.status,
            COALESCE(pc.approved_at, pc.submitted_at, pc.created_at) AS tax_point, p.name AS project_name
       FROM progress_claims pc
       LEFT JOIN projects p ON p.id = pc.project_id
      WHERE pc.org_id = ? AND pc.is_deleted = 0 AND pc.status IN (?, ?)
        AND COALESCE(pc.approved_at, pc.submitted_at, pc.created_at) >= ?
        AND COALESCE(pc.approved_at, pc.submitted_at, pc.created_at) < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY tax_point`,
    [orgId, ...SALE_STATUSES, period.period_start, period.period_end]);

  const [purchases] = await pool.query(
    `SELECT si.invoice_number, si.supplier_name, si.amount, si.gst_treatment, si.gst_amount,
            si.status, si.created_at AS tax_point, p.name AS project_name
       FROM supplier_invoices si
       LEFT JOIN projects p ON p.id = si.project_id
      WHERE si.org_id = ? AND si.is_deleted = 0 AND si.status IN (?, ?)
        AND si.created_at >= ? AND si.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY si.created_at`,
    [orgId, ...PURCHASE_STATUSES, period.period_start, period.period_end]);

  const lines = [];
  lines.push(csvRow(['ProjMan2 BAS worksheet']));
  lines.push(csvRow(['Organisation', org?.name || '']));
  lines.push(csvRow(['ABN', org?.abn || '']));
  lines.push(csvRow(['GST registered', org?.gst_registered ? 'yes' : 'no']));
  lines.push(csvRow(['Period', `${iso(new Date(period.period_start))} to ${iso(new Date(period.period_end))}`]));
  lines.push(csvRow(['Basis', period.basis]));
  lines.push(csvRow(['Status', period.status]));
  lines.push('');
  lines.push(csvRow(['Label', 'Description', 'Amount (AUD)']));
  lines.push(csvRow(['G1', 'Total sales (GST inclusive)', period.g1_total_sales]));
  lines.push(csvRow(['1A', 'GST on sales', period.a1_gst_on_sales]));
  lines.push(csvRow(['1B', 'GST on purchases', period.b1_gst_on_purchases]));
  lines.push(csvRow(['', 'Net GST (1A - 1B, positive = payable)', period.net_gst]));
  lines.push('');
  lines.push(csvRow(['GST transaction listing — SALES (progress claims)']));
  lines.push(csvRow(['Tax point', 'Project', 'Claim #', 'Status', 'Treatment', 'Ex-GST', 'GST', 'Inc-GST']));
  for (const r of sales) {
    lines.push(csvRow([iso(new Date(r.tax_point)), r.project_name, r.claim_number, r.status,
      r.gst_treatment, r.amount, r.gst_amount, round2(Number(r.amount) + Number(r.gst_amount))]));
  }
  lines.push('');
  lines.push(csvRow(['GST transaction listing — PURCHASES (supplier invoices)']));
  lines.push(csvRow(['Tax point', 'Project', 'Invoice #', 'Supplier', 'Status', 'Treatment', 'Ex-GST', 'GST', 'Inc-GST']));
  for (const r of purchases) {
    lines.push(csvRow([iso(new Date(r.tax_point)), r.project_name, r.invoice_number, r.supplier_name,
      r.status, r.gst_treatment, r.amount, r.gst_amount, round2(Number(r.amount) + Number(r.gst_amount))]));
  }

  return {
    filename: `bas-${iso(new Date(period.period_start))}-to-${iso(new Date(period.period_end))}.csv`,
    csv: lines.join('\n') + '\n',
  };
}

module.exports = {
  prepareBas, lodgeBas, listPeriods, getPeriod, exportBas,
  quarterFor, gstFor,   // exported for direct unit assertions
};
