// DepreciationService — P8a Fixed assets & depreciation (serverdesignspec §11.2, migration v022).
//
// The first slice of P8 Accounting/Tax, and the natural first one because its permission gate
// already existed with nothing to point at: `tax.approve` (accountant, v012) and the S18.12
// blocks_progress hold point (v016).
//
//   S18.11  prepareDraft()  — the SYSTEM prepares the draft: for every draft asset on the job it
//                             computes the per-financial-year depreciation lines. Nothing is
//                             transmitted anywhere; a draft is an internal working artifact.
//   S18.12  approveAsset()  — the accountant's `tax.approve` write flips draft → approved and
//                             stamps who/when. Only an approved asset is eligible for the
//                             depreciation export / accountant hand-off (decision #6 = (B)+(b1)).
//
// REST-mediated (not sync-registry) — office/desk artifacts, like the P7 commercial tables.
// NO matrix bump: `tax.approve` is reused verbatim (§11.3, decision #14).
//
// ── ASSET-ENTRY PATH — decision recorded here (the directive left it open) ───────────────────
// Two candidates were considered:
//   (A) an explicit create endpoint — a human declares the asset;
//   (B) derive assets automatically from capital `supplier_invoices` at prepare time.
// **(A) is what this builds, and (B) is not buildable on v022 as applied.** Two reasons:
//   1. `supplier_invoices` (v019) carries NO capital/expense flag — there is no column that
//      distinguishes a depreciable plant purchase from a consumable, so a derive pass would have
//      to guess. Adding that flag is a schema change, i.e. P8b territory, outside this slice.
//   2. The depreciation inputs proper — `method`, `effective_life_years`, ATO `category` — are
//      human/accountant judgements that exist nowhere on an invoice. Even a perfect capital flag
//      could not populate them.
// (B) is preserved as a LATER additive path, not designed out: `source_supplier_invoice_id` is a
// soft provenance ref (per the v022 comment), so a future "derive candidates from capital
// invoices" pass can pre-fill draft assets pointing at the invoice they came from, and everything
// downstream here (schedule, approve, export) works unchanged.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');

const canWriteMoney = (role) => access.hasPermission(role, 'money.write');
const canReadMoney  = (role) => access.hasPermission(role, 'money.read');
const canApproveTax = (role) => access.hasPermission(role, 'tax.approve');

const METHODS = ['prime_cost', 'diminishing_value'];

// Guard against a silly effective life spinning the generator: 40y is past any ATO life in
// practice, and the loop also stops as soon as the written-down value rounds to nothing.
const MAX_FY_LINES = 42;

// ── AU financial-year helpers (1 Jul – 30 Jun) ───────────────────────────────────────────────
/** The FY label a date falls in, e.g. 2025-09-14 → '2025-26', 2025-03-14 → '2024-25'. */
function fyLabel(date) {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 6 ? y : y - 1;   // getUTCMonth: 6 = July
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
const fyStartYear = (label) => Number(label.slice(0, 4));
const nextFy = (label) => {
  const s = fyStartYear(label) + 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
};
/** 30 June closing the FY that `label` names. */
const fyEnd = (label) => new Date(Date.UTC(fyStartYear(label) + 1, 5, 30));

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DAY_MS = 86400000;

/**
 * The depreciation schedule for one asset — pure, so it is unit-testable without a DB.
 *
 * `prime_cost`       straight line: cost / effective_life each year.
 * `diminishing_value` ATO post-2006 rate: 200% / effective_life, applied to the written-down
 *                     (opening) value each year.
 * The acquisition year is apportioned by days held (ATO pro-rata: from `acquired_at` to the
 * 30 June closing that year), which is why the schedule usually runs one FY past the nominal life.
 * A line is never allowed to depreciate past zero.
 *
 * @returns {Array<{fy,opening_value,depreciation,closing_value}>} — [] when inputs can't schedule.
 */
function computeSchedule({ acquisitionCost, acquiredAt, method, effectiveLifeYears }) {
  const cost = Number(acquisitionCost) || 0;
  const life = Number(effectiveLifeYears) || 0;
  if (cost <= 0 || life <= 0 || !acquiredAt) return [];

  const acquired = acquiredAt instanceof Date ? acquiredAt : new Date(acquiredAt);
  if (Number.isNaN(acquired.getTime())) return [];

  // The schedule runs the asset's effective life, plus one FY to carry the pro-rated remainder
  // of an acquisition part-way through a year. Diminishing value approaches zero asymptotically
  // and would otherwise never terminate, so the LAST line writes off whatever is left — the
  // ordinary treatment of a written-down remainder at the end of effective life, and it makes
  // Σ depreciation === acquisition_cost for both methods.
  const maxLines = Math.min(Math.ceil(life) + 1, MAX_FY_LINES);

  const lines = [];
  let fy = fyLabel(acquired);
  let opening = cost;

  for (let i = 0; i < maxLines && opening > 0.005; i++) {
    // Days held in this FY / 365. Full years after the first.
    const factor = i === 0
      ? Math.min(1, Math.max(0, (fyEnd(fy) - acquired) / DAY_MS + 1) / 365)
      : 1;

    const isLast = i === maxLines - 1;
    const gross = isLast
      ? opening
      : (method === 'diminishing_value'
        ? opening * (2 / life) * factor
        : cost * (1 / life) * factor);

    const depreciation = round2(Math.min(gross, opening));
    const closing = round2(opening - depreciation);

    lines.push({ fy, opening_value: round2(opening), depreciation, closing_value: closing });

    if (closing <= 0.005) break;
    opening = closing;
    fy = nextFy(fy);
  }
  return lines;
}

// ── Asset entry (path (A), see the header note) ───────────────────────────────────────────────
/** POST /projects/:id/fixed-assets — declare a depreciable asset (money.write). Always draft. */
async function createAsset({ orgId, projectId, actor, description, category, acquisitionCost,
                             acquiredAt, method, effectiveLifeYears, sourceSupplierInvoiceId }) {
  if (!canWriteMoney(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });

  if (!description || !String(description).trim()) {
    throw new ServiceError('VALIDATION_ERROR', 'description is required', 400);
  }
  const m = method || 'prime_cost';
  if (!METHODS.includes(m)) {
    throw new ServiceError('VALIDATION_ERROR', `method must be one of ${METHODS.join(', ')}`, 400);
  }
  const cost = Number(acquisitionCost) || 0;
  if (cost < 0) throw new ServiceError('VALIDATION_ERROR', 'acquisition_cost cannot be negative', 400);
  const life = effectiveLifeYears == null || effectiveLifeYears === '' ? null : Number(effectiveLifeYears);
  if (life != null && !(life > 0)) {
    throw new ServiceError('VALIDATION_ERROR', 'effective_life_years must be greater than 0', 400);
  }

  // Soft provenance ref — validated in-org when supplied (a cross-org id is an attack), but no
  // hard FK, mirroring the soft supplier/po refs in v019.
  if (sourceSupplierInvoiceId) {
    const [[inv]] = await pool.query(
      'SELECT id FROM supplier_invoices WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [sourceSupplierInvoiceId, orgId]
    );
    if (!inv) throw new ServiceError('VALIDATION_ERROR', 'source_supplier_invoice_id not found in your organisation', 422);
  }

  const id = uuidv4();
  await pool.query(
    `INSERT INTO fixed_assets
       (id, org_id, project_id, description, category, acquisition_cost, acquired_at, method,
        effective_life_years, source_supplier_invoice_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [id, orgId, projectId, String(description).trim(), category || null, cost, acquiredAt || null,
     m, life, sourceSupplierInvoiceId || null, actor.userId]
  );
  return { id, status: 'draft', method: m };
}

// ── S18.11 — the system-prepared draft ───────────────────────────────────────────────────────
/**
 * POST /projects/:id/fixed-assets/prepare-draft
 *
 * Regenerates the depreciation lines for every DRAFT asset on the project. Approved assets are
 * deliberately skipped — re-preparing must never silently rewrite a schedule the accountant has
 * already signed off (that would make the S18.12 stamp meaningless). An asset missing the inputs
 * a schedule needs (`acquired_at` / `effective_life_years` / a cost) is reported in `skipped`
 * rather than failing the whole run — a half-declared asset is a data-entry state, not an error.
 *
 * Idempotent: lines are replaced per asset, so preparing twice yields the same schedule (the
 * `uq_dep_asset_fy` unique key is the backstop).
 *
 * NO EXTERNAL TRANSMISSION happens here — §11.2 is explicit that a draft is internal-only.
 */
async function prepareDraft({ orgId, projectId, actor }) {
  if (!canWriteMoney(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });

  const [assets] = await pool.query(
    `SELECT id, description, acquisition_cost, acquired_at, method, effective_life_years
       FROM fixed_assets
      WHERE project_id = ? AND org_id = ? AND status = 'draft' AND is_deleted = 0
      ORDER BY created_at`,
    [projectId, orgId]
  );

  const prepared = [];
  const skipped = [];

  for (const a of assets) {
    const lines = computeSchedule({
      acquisitionCost: a.acquisition_cost,
      acquiredAt: a.acquired_at,
      method: a.method,
      effectiveLifeYears: a.effective_life_years,
    });

    if (!lines.length) {
      skipped.push({
        id: a.id,
        description: a.description,
        reason: 'needs acquisition_cost > 0, acquired_at and effective_life_years > 0',
      });
      continue;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Replace rather than upsert: a shortened effective life must drop the now-surplus tail
      // FYs, which an upsert alone would leave behind.
      await conn.query('DELETE FROM depreciation_schedule WHERE fixed_asset_id = ? AND org_id = ?', [a.id, orgId]);
      for (const l of lines) {
        await conn.query(
          `INSERT INTO depreciation_schedule
             (id, org_id, fixed_asset_id, fy, opening_value, depreciation, closing_value)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), orgId, a.id, l.fy, l.opening_value, l.depreciation, l.closing_value]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    prepared.push({
      id: a.id,
      description: a.description,
      method: a.method,
      fy_lines: lines.length,
      total_depreciation: round2(lines.reduce((t, l) => t + l.depreciation, 0)),
    });
  }

  return { project_id: projectId, prepared_count: prepared.length, prepared, skipped };
}

// ── S18.12 — the accountant's approval ───────────────────────────────────────────────────────
/**
 * POST /projects/:id/fixed-assets/:assetId/approve — the one protected S18.12 write.
 *
 * Gated on the EXISTING `tax.approve` (accountant only, v012) — no new permission, no matrix
 * bump (§11.3, decision #14: the accountant is the single tax gatekeeper for every tax artifact).
 * An accountant is `assigned` scope, so they must be a `project_members` row on the job they are
 * reviewing — the v012 compromise — which `assertProjectReachable` enforces.
 */
async function approveAsset({ orgId, projectId, assetId, actor }) {
  if (!canApproveTax(actor.role)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: tax.approve (accountant)', 403);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });

  const [[asset]] = await pool.query(
    `SELECT id, status FROM fixed_assets
      WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [assetId, projectId, orgId]
  );
  if (!asset) throw new ServiceError('NOT_FOUND', 'Fixed asset not found', 404);
  if (asset.status === 'approved') {
    throw new ServiceError('ALREADY_RESOLVED', 'This asset is already approved', 409);
  }

  // An asset with no prepared schedule has nothing to approve — approving it would produce an
  // "approved" artifact with no content, and the export would silently emit nothing for it.
  // NB: `lines` is reserved in MySQL 8 — the alias must not be that word.
  const [[{ line_count: lineCount }]] = await pool.query(
    'SELECT COUNT(*) AS line_count FROM depreciation_schedule WHERE fixed_asset_id = ? AND org_id = ?',
    [assetId, orgId]
  );
  if (!lineCount) {
    throw new ServiceError('VALIDATION_ERROR',
      'This asset has no depreciation schedule yet — run the S18.11 draft preparation first', 422);
  }

  await pool.query(
    `UPDATE fixed_assets SET status = 'approved', approved_by = ?, approved_at = NOW()
      WHERE id = ? AND org_id = ?`,
    [actor.userId, assetId, orgId]
  );
  return { id: assetId, status: 'approved', fy_lines: lineCount };
}

// ── Read ─────────────────────────────────────────────────────────────────────────────────────
/**
 * GET /projects/:id/fixed-assets — the register, each asset with its schedule lines.
 *
 * `money.read` OR `tax.approve`. The directive specified money.read "like other financial reads";
 * `tax.approve` is included because the accountant holds ONLY that permission (v012) and would
 * otherwise be unable to SEE the asset they are required to approve — an approve-blind gate.
 * This matches the established shape of the neighbouring reads rather than inventing one:
 * `GET /:id/progress-claims` is money.read OR claims.submit, `/:id/subcontractor-register` is
 * money.read OR po.write. The proper long-term home is the org-level `accounts.read` landing in
 * P8b (matrix v9→v10, decision #13); this is the P8a-shaped stand-in until then.
 */
async function listAssets({ orgId, projectId, actor, status }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canReadMoney(actor.role) && !canApproveTax(actor.role)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or tax.approve', 403);
  }

  const params = [projectId, orgId];
  let where = 'fa.project_id = ? AND fa.org_id = ? AND fa.is_deleted = 0';
  if (status) {
    if (!['draft', 'approved'].includes(status)) {
      throw new ServiceError('VALIDATION_ERROR', 'status must be draft or approved', 400);
    }
    where += ' AND fa.status = ?';
    params.push(status);
  }

  const [assets] = await pool.query(
    `SELECT fa.*, u.full_name AS approved_by_name
       FROM fixed_assets fa
       LEFT JOIN users u ON u.id = fa.approved_by
      WHERE ${where}
      ORDER BY fa.created_at`,
    params
  );
  if (!assets.length) return { fixed_assets: [] };

  const [lines] = await pool.query(
    `SELECT fixed_asset_id, fy, opening_value, depreciation, closing_value
       FROM depreciation_schedule
      WHERE org_id = ? AND fixed_asset_id IN (${assets.map(() => '?').join(', ')})
      ORDER BY fy`,
    [orgId, ...assets.map((a) => a.id)]
  );
  const byAsset = new Map();
  for (const l of lines) {
    if (!byAsset.has(l.fixed_asset_id)) byAsset.set(l.fixed_asset_id, []);
    byAsset.get(l.fixed_asset_id).push(l);
  }

  return {
    fixed_assets: assets.map((a) => ({ ...a, depreciation_schedule: byAsset.get(a.id) || [] })),
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

/**
 * GET /accounts/depreciation/export?fy= — the (b1) export-first deliverable for P8a.
 *
 * ORG-level and `accounts.read`-gated (not the project-level `money.read | tax.approve` the asset
 * register uses): a depreciation schedule handed to an accountant is a whole-of-entity artifact,
 * which is exactly the distinction `accounts.read` was minted for (decision #13).
 *
 * **APPROVED assets only.** §11.2 is explicit that only an approved asset is eligible for the
 * export / hand-off — a draft is an internal working artifact that has never been transmitted, and
 * putting one in the accountant's file would defeat the S18.12 gate entirely.
 *
 * `fy` optionally narrows to one financial year's schedule lines; omitted, the whole schedule of
 * every approved asset is exported.
 */
async function exportDepreciation({ orgId, actor, fy }) {
  if (!access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'accounts.read')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: accounts.read', 403);
  }
  if (fy && !/^\d{4}-\d{2}$/.test(String(fy))) {
    throw new ServiceError('VALIDATION_ERROR', "fy must be an AU financial year like '2025-26'", 400);
  }

  const [[org]] = await pool.query('SELECT name, abn FROM organisations WHERE id = ? LIMIT 1', [orgId]);
  const params = [orgId];
  let lineFilter = '';
  if (fy) { lineFilter = ' AND ds.fy = ?'; params.push(fy); }

  const [rows] = await pool.query(
    `SELECT fa.id, fa.description, fa.category, fa.acquisition_cost, fa.acquired_at, fa.method,
            fa.effective_life_years, fa.approved_at, p.name AS project_name,
            u.full_name AS approved_by_name,
            ds.fy, ds.opening_value, ds.depreciation, ds.closing_value
       FROM fixed_assets fa
       JOIN depreciation_schedule ds ON ds.fixed_asset_id = fa.id
       LEFT JOIN projects p ON p.id = fa.project_id
       LEFT JOIN users u    ON u.id = fa.approved_by
      WHERE fa.org_id = ? AND fa.status = 'approved' AND fa.is_deleted = 0${lineFilter}
      ORDER BY fa.description, ds.fy`,
    params);

  const out = [];
  out.push(csvRow(['Depreciation schedule — approved fixed assets']));
  out.push(csvRow(['Organisation', org?.name || '']));
  out.push(csvRow(['ABN', org?.abn || '']));
  out.push(csvRow(['Financial year', fy || 'all']));
  out.push(csvRow(['Assets', new Set(rows.map((r) => r.id)).size]));
  out.push(csvRow(['Total depreciation', round2(rows.reduce((t, r) => t + Number(r.depreciation), 0))]));
  out.push('');
  out.push(csvRow(['Asset', 'Category', 'Project', 'Method', 'Cost', 'Acquired', 'Effective life (y)',
    'FY', 'Opening', 'Depreciation', 'Closing', 'Approved by', 'Approved at']));
  for (const r of rows) {
    out.push(csvRow([r.description, r.category, r.project_name, r.method, r.acquisition_cost,
      r.acquired_at ? new Date(r.acquired_at).toISOString().slice(0, 10) : '',
      r.effective_life_years, r.fy, r.opening_value, r.depreciation, r.closing_value,
      r.approved_by_name, r.approved_at ? new Date(r.approved_at).toISOString().slice(0, 10) : '']));
  }

  return { filename: `depreciation-${fy || 'all'}.csv`, csv: out.join('\n') + '\n' };
}

module.exports = {
  createAsset, prepareDraft, approveAsset, listAssets, exportDepreciation,
  computeSchedule, fyLabel,   // exported for direct unit assertions
};
