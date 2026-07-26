// ComplianceService — NCC + structural completion gates (projman-03 R2/R3,
// servdesignspecification §12.10). The projman-03 "ComplianceService pattern" the
// stage engine's own doc comment (§10.4) already names: every rule that gates a
// stage's completion lives in one place, called from
// StageProgressionService.checkTransition — which is itself already invoked from
// BOTH the REST `/advance` endpoint and the sync-push path (§10.4), so wiring these
// two checks in there gives REST/sync parity for free. No separate sync wiring here.
//
// Neither check is a new gating table lookup keyed to "does this stage need NCC/
// structural at all" — a stage with no ncc_register rows or no structural inspection
// is vacuously compliant (nothing raised, nothing to block on). The gate only bites
// once something has actually been raised against the stage and left open/unmet —
// exactly the "open hold point blocks its stage" shape the rest of the engine uses.

const pool = require('../db/pool');

/** True unless this stage has an OPEN ncc_register item (projman-03 R2). */
async function checkNccCompliance(orgId, stageId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS open_count FROM ncc_register
      WHERE stage_id = ? AND org_id = ? AND is_deleted = 0 AND status = 'open'`,
    [stageId, orgId]
  );
  return Number(row.open_count) === 0;
}

/**
 * True unless the MOST RECENT structural inspection (type='structural') against
 * this stage is not a pass. "Largely expressible as a hold-point inspection of
 * type='structural'" per §12.10 — this reuses the existing `inspections` table
 * rather than a new one. The latest result governs (not "has one ever failed") —
 * same as re-inspecting a hold point: a later pass supersedes an earlier fail. No
 * structural inspection at all on this stage is vacuously compliant.
 */
async function checkStructuralCompliance(orgId, stageId) {
  // `server_updated_at` (DATETIME(3), bumped on every write incl. `complete()`'s
  // UPDATE) is the tiebreaker — `completed_at`/`created_at` are whole-second DATETIME
  // and two inspections created+completed inside the same second (routine in an
  // automated test, plausible for a fast re-inspection in real use) sort ambiguously
  // on those, which let a stale fail outrank a fresh pass in practice.
  const [[latest]] = await pool.query(
    `SELECT result FROM inspections
      WHERE stage_id = ? AND org_id = ? AND is_deleted = 0 AND type = 'structural'
      ORDER BY server_updated_at DESC LIMIT 1`,
    [stageId, orgId]
  );
  return !latest || latest.result === 'pass';
}

module.exports = { checkNccCompliance, checkStructuralCompliance };
