// TparService — P8c Taxable Payments Annual Report (serverdesignspec §11.2, migration v026).
//
// The ATO return a building & construction business lodges each financial year, listing what it
// paid contractors. It needs no new capture: the payment spine (`project_payments`, v013) already
// carries `tpar_reportable` and `payee_user_id`, and v023 added `gst_amount`.
//
//   prepare(orgId, fy)   group the FY's reportable payments by payee, snapshot the lines
//   lodge(reportId)      the `tax.approve` lock (decision #14 — one tax gatekeeper, no new verb)
//   exportTpar(reportId) the CSV the accountant lodges from
//
// ── WHY THE LINES ARE A SNAPSHOT, NOT A VIEW ────────────────────────────────────────────────
// `payee_abn` and `payee_name` are COPIED onto the line at prepare time rather than joined at read
// time. The return records who was paid as at lodgement; if a payee later edits their org profile,
// a lodged TPAR must not retroactively change. `source_payment_ids` keeps the audit trail back to
// the rows each line was built from.
//
// ── ABN RESOLUTION, AND WHY A MISSING ONE IS SURFACED RATHER THAN SWALLOWED ─────────────────
// The payee's ABN comes from THEIR organisation profile (`users.org_id → organisations.abn`), not
// from anything on the payment. A contractor with no ABN recorded still appears on the report with
// a null ABN and is counted in `missing_abn` — because "this payee has no ABN" is exactly the
// problem the preparer must fix BEFORE lodging, and silently dropping them would understate the
// return.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');

const canReadAccounts = (actor) =>
  access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'accounts.read');
const canApproveTax = (actor) =>
  access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'tax.approve');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function assertAccounts(actor) {
  if (!canReadAccounts(actor)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: accounts.read', 403);
  }
}

/**
 * Who to name on the line. TPAR reports payments to contractor BUSINESSES, so the payee's own
 * organisation name is the right label — but ONLY when that organisation is someone else's. A
 * payee sitting in the reporting org (the v1 shape, until cross-org engagement lands with PM2-02)
 * would otherwise be labelled with the payer's own company name on every line, which is useless on
 * a return. In that case fall back to the person's name, which is at least who was paid.
 */
function payeeNameFor(row, reportingOrgId) {
  const isExternalBusiness = row.payee_org_id && row.payee_org_id !== reportingOrgId;
  return (isExternalBusiness ? row.payee_org_name : null) || row.payee_user_name || null;
}

/** '2025-26' → { start: 2025-07-01, end: 2026-06-30 }. Rejects anything that is not an AU FY. */
function fyRange(fy) {
  if (!/^\d{4}-\d{2}$/.test(String(fy || ''))) {
    throw new ServiceError('VALIDATION_ERROR', "fy must be an AU financial year like '2025-26'", 400);
  }
  const startYear = Number(String(fy).slice(0, 4));
  const declaredEnd = Number(String(fy).slice(5, 7));
  if ((startYear + 1) % 100 !== declaredEnd) {
    throw new ServiceError('VALIDATION_ERROR',
      `fy '${fy}' is not a consecutive AU financial year (expected ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')})`, 400);
  }
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` };
}

/**
 * POST /accounts/tpar/prepare — group the FY's reportable payments by payee and snapshot.
 *
 * Idempotent for an open/prepared report (lines are replaced). A LODGED report is refused — the
 * snapshot is the record of what was lodged.
 */
async function prepare({ orgId, actor, fy }) {
  assertAccounts(actor);
  const { start, end } = fyRange(fy);

  const [[existing]] = await pool.query(
    'SELECT id, status FROM tpar_reports WHERE org_id = ? AND fy = ? AND is_deleted = 0 LIMIT 1',
    [orgId, fy]);
  if (existing && existing.status === 'lodged') {
    throw new ServiceError('ALREADY_RESOLVED',
      'This TPAR is lodged — its lines are the record of what was lodged and cannot be re-prepared', 409);
  }

  // tpar_reportable is the flag the payment spine already carries; payee ABN/name come from the
  // payee's OWN organisation, which is why this joins users → organisations rather than reading
  // anything off the payment.
  const [rows] = await pool.query(
    `SELECT pp.payee_user_id,
            u.full_name              AS payee_user_name,
            po.id                    AS payee_org_id,
            po.name                  AS payee_org_name,
            po.abn                   AS payee_abn,
            SUM(pp.amount)           AS gross_paid,
            SUM(pp.gst_amount)       AS gst_paid,
            COUNT(*)                 AS payment_count,
            JSON_ARRAYAGG(pp.id)     AS source_payment_ids
       FROM project_payments pp
       LEFT JOIN users u          ON u.id  = pp.payee_user_id
       LEFT JOIN organisations po ON po.id = u.org_id
      WHERE pp.org_id = ? AND pp.tpar_reportable = 1
        AND COALESCE(pp.paid_at, pp.created_at) >= ?
        AND COALESCE(pp.paid_at, pp.created_at) < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY pp.payee_user_id, u.full_name, po.id, po.name, po.abn
      ORDER BY gross_paid DESC`,
    [orgId, start, end]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const id = existing ? existing.id : uuidv4();
    if (!existing) {
      await conn.query(
        `INSERT INTO tpar_reports (id, org_id, fy, status) VALUES (?, ?, ?, 'open')`, [id, orgId, fy]);
    }
    // Replace rather than upsert: a payee whose payments were all voided since the last prepare
    // must DISAPPEAR, which an upsert alone would leave behind.
    await conn.query('DELETE FROM tpar_lines WHERE tpar_report_id = ? AND org_id = ?', [id, orgId]);

    let totalGross = 0, totalGst = 0, missingAbn = 0;
    for (const r of rows) {
      const gross = round2(r.gross_paid);
      const gst = round2(r.gst_paid);
      totalGross = round2(totalGross + gross);
      totalGst = round2(totalGst + gst);
      if (!r.payee_abn) missingAbn++;

      await conn.query(
        `INSERT INTO tpar_lines
           (id, org_id, tpar_report_id, payee_user_id, payee_abn, payee_name, gross_paid, gst_paid,
            payment_count, source_payment_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), orgId, id, r.payee_user_id, r.payee_abn || null,
         payeeNameFor(r, orgId), gross, gst, r.payment_count,
         // JSON_ARRAYAGG already returns JSON; mysql2 hands it back parsed, so re-stringify.
         JSON.stringify(r.source_payment_ids)]);
    }

    await conn.query(
      `UPDATE tpar_reports SET total_gross = ?, total_gst = ?, payee_count = ?, status = 'prepared',
              prepared_by = ?, prepared_at = NOW() WHERE id = ? AND org_id = ?`,
      [totalGross, totalGst, rows.length, actor.userId, id, orgId]);

    await conn.commit();
    return {
      id, fy, status: 'prepared', payee_count: rows.length,
      total_gross: totalGross, total_gst: totalGst,
      missing_abn: missingAbn,
      period: { start, end },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** POST /accounts/tpar/:id/lodge — `tax.approve` (decision #14). Only a PREPARED report locks. */
async function lodge({ orgId, reportId, actor }) {
  if (!canApproveTax(actor)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: tax.approve (accountant)', 403);
  }
  const [[r]] = await pool.query(
    'SELECT id, status FROM tpar_reports WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [reportId, orgId]);
  if (!r) throw new ServiceError('NOT_FOUND', 'TPAR report not found', 404);
  if (r.status === 'lodged') throw new ServiceError('ALREADY_RESOLVED', 'This TPAR is already lodged', 409);
  if (r.status !== 'prepared') {
    throw new ServiceError('VALIDATION_ERROR', 'Prepare this TPAR before lodging it', 422);
  }

  await pool.query(
    `UPDATE tpar_reports SET status = 'lodged', lodged_by = ?, lodged_at = NOW() WHERE id = ? AND org_id = ?`,
    [actor.userId, reportId, orgId]);
  return { id: reportId, status: 'lodged' };
}

async function listReports({ orgId, actor }) {
  assertAccounts(actor);
  const [rows] = await pool.query(
    `SELECT tr.*, pu.full_name AS prepared_by_name, lu.full_name AS lodged_by_name
       FROM tpar_reports tr
       LEFT JOIN users pu ON pu.id = tr.prepared_by
       LEFT JOIN users lu ON lu.id = tr.lodged_by
      WHERE tr.org_id = ? AND tr.is_deleted = 0
      ORDER BY tr.fy DESC`, [orgId]);
  return { tpar_reports: rows };
}

async function getReport({ orgId, reportId, actor }) {
  assertAccounts(actor);
  const [[report]] = await pool.query(
    'SELECT * FROM tpar_reports WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [reportId, orgId]);
  if (!report) throw new ServiceError('NOT_FOUND', 'TPAR report not found', 404);
  const [lines] = await pool.query(
    'SELECT * FROM tpar_lines WHERE tpar_report_id = ? AND org_id = ? ORDER BY gross_paid DESC',
    [reportId, orgId]);
  return { ...report, lines };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

/** GET /accounts/tpar/:id/export — the contractor-payments listing, as CSV. */
async function exportTpar({ orgId, reportId, actor }) {
  const report = await getReport({ orgId, reportId, actor });
  const [[org]] = await pool.query(
    'SELECT name, abn FROM organisations WHERE id = ? LIMIT 1', [orgId]);

  const out = [];
  out.push(csvRow(['Taxable Payments Annual Report (TPAR)']));
  out.push(csvRow(['Reporting organisation', org?.name || '']));
  out.push(csvRow(['ABN', org?.abn || '']));
  out.push(csvRow(['Financial year', report.fy]));
  out.push(csvRow(['Status', report.status]));
  out.push(csvRow(['Payees', report.payee_count]));
  out.push(csvRow(['Total gross paid', report.total_gross]));
  out.push(csvRow(['Total GST paid', report.total_gst]));
  const missing = report.lines.filter((l) => !l.payee_abn).length;
  if (missing) {
    // Surfaced in the file itself, not just the API response: whoever opens this to lodge it needs
    // to see that N payees have no ABN before they submit it.
    out.push(csvRow([`WARNING: ${missing} payee(s) have no ABN recorded — resolve before lodging`]));
  }
  out.push('');
  out.push(csvRow(['Payee name', 'ABN', 'Gross paid (incl GST)', 'GST paid', 'Payments']));
  for (const l of report.lines) {
    out.push(csvRow([l.payee_name, l.payee_abn, l.gross_paid, l.gst_paid, l.payment_count]));
  }

  return { filename: `tpar-${report.fy}.csv`, csv: out.join('\n') + '\n' };
}

module.exports = { prepare, lodge, listReports, getReport, exportTpar, fyRange };
