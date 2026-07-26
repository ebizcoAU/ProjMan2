// QualityOpsService — the rules for the P6/P6b quality tables' /sync/push path
// (servdesignspec §12, §12.10). Same split as SiteOpsService (§11):
//
//   guardPush(...)  — BEFORE the write: the one uniform rule (§12.7) — writing ANY
//                     of the five quality tables through sync needs `quality.write`;
//                     plus, for `ncc_register`, the R3 qualification-scope CHECK
//                     (projman-03) with a clean error rather than a raw SQL 500.
//   afterPush(...)  — AFTER the write: stamp the server-owned columns a device may
//                     not set — `raised_by`/`raised_at` on create, and
//                     `closed_at`/`closed_by` the moment `status` reads `closed`
//                     (defects AND ncc_register share this shape exactly).
//
// `inspections.inspector_id`/`completed_at` are NOT stamped here — those are set
// exclusively by InspectionService.complete's REST-mediated path (§12.4); a bare
// sync-push of an inspection (the QA/fail case) never touches them. Project-
// membership scope is NOT re-implemented here: SyncService's generic projectColumn/
// projectViaTable block already refuses a non-member's push (§9.4/§12.9).

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');

// The five tables this service governs. A push for anything else is a no-op here.
const QUALITY_TABLES = new Set([
  'inspections', 'inspection_items', 'defects', 'certificates', 'ncc_register',
]);

// The tables whose raise/close provenance is stamped identically (§12.5 / §12.10).
const PROVENANCE_TABLES = new Set(['defects', 'ncc_register']);

const isQualityOps = (wireName) => QUALITY_TABLES.has(wireName);

// R3 (projman-03): residential (1, 10) takes no building_type; commercial (2..9)
// must carry one of B/C. Mirrors the DB `chk_ncc_scope` CHECK — validated here too
// so a bad combo gets a clean 422, not a raw constraint-violation 500.
const RESIDENTIAL_CLASSES = new Set(['1', '10']);
const COMMERCIAL_CLASSES = new Set(['2', '3', '4', '5', '6', '7', '8', '9']);

function assertNccScope(safe) {
  if (safe.ncc_class === undefined) return;
  const cls = String(safe.ncc_class);
  if (RESIDENTIAL_CLASSES.has(cls)) {
    if (safe.building_type) {
      throw new ServiceError('VALIDATION_ERROR',
        `ncc_class ${cls} is residential and takes no building_type`, 422);
    }
  } else if (COMMERCIAL_CLASSES.has(cls)) {
    if (!['B', 'C'].includes(safe.building_type)) {
      throw new ServiceError('VALIDATION_ERROR',
        `ncc_class ${cls} is commercial and needs building_type B or C`, 422);
    }
  } else {
    throw new ServiceError('VALIDATION_ERROR', `Unknown ncc_class "${cls}"`, 422);
  }
}

/**
 * BEFORE the write. Throws unless this push is allowed.
 *
 * @param {object} p
 * @param {string} p.wireName  inspections | inspection_items | defects | certificates | ncc_register
 * @param {string} p.operation create | update | delete
 * @param {object} p.safe      the sanitised, app-writable columns about to be written
 * @param {object} p.actor     { orgId, userId, role }
 */
async function guardPush({ wireName, operation, safe, actor }) {
  if (!isQualityOps(wireName)) return;
  // One uniform gate (§12.7) — schedule/fill an inspection, raise/close a defect or
  // NCC item, or record a certificate all need the same capability; only the
  // hold-point PASS (InspectionService.complete, not a bare sync push) additionally
  // needs quality.validate.
  if (!access.hasPermission(actor.role, 'quality.write')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: quality.write', 403);
  }
  if (wireName === 'ncc_register' && operation === 'create') {
    assertNccScope(safe || {});
  }
}

/**
 * AFTER the write. Stamps the server-controlled columns a device may not set.
 *
 * @param {object} p  { wireName, operation, id, safe, actor }
 */
async function afterPush({ wireName, operation, id, safe, actor }) {
  if (!PROVENANCE_TABLES.has(wireName) || operation === 'delete') return;
  const table = wireName;
  const orgId = actor.orgId;

  // First-write provenance: who raised it, stamped once (sticky), same pattern as
  // site_diary's author_id.
  if (operation === 'create') {
    await pool.query(
      `UPDATE \`${table}\`
          SET raised_by = COALESCE(raised_by, ?), raised_at = COALESCE(raised_at, NOW())
        WHERE id = ? AND org_id = ?`,
      [actor.userId, id, orgId]
    );
  }
  // Closing stamp: set the moment `status` reads 'closed' and isn't yet stamped —
  // covers both create-already-closed (unlikely, but symmetric) and an update.
  if (safe.status === 'closed') {
    await pool.query(
      `UPDATE \`${table}\`
          SET closed_at = COALESCE(closed_at, NOW()), closed_by = COALESCE(closed_by, ?)
        WHERE id = ? AND org_id = ?`,
      [actor.userId, id, orgId]
    );
  }
}

module.exports = { isQualityOps, guardPush, afterPush, QUALITY_TABLES };
