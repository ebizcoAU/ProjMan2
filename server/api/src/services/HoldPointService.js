// HoldPointService — the per-stage checklist (DIRECTIVE 1 Step D2,
// servdesignspecification.md §8, 18-Stage spec v3.4 §1.5: "hold_point_requirements
// is a list per stage, not a single flag"). Additive to the existing whole-stage
// `is_hold_point`/`is_validated` gate (StageProgressionService) — never replaces it.
// See migration_v016's header for the full scope decision (why this isn't the
// entire S10.1…S18.16 sub-step model).
//
// `SEED_DEFINITIONS` is the one place the concrete named patches live: S10.5
// (survey set-out — NEW blocking hold point, verifier is Site Supervisor, not an
// Inspector), S11.9 (electrician/plumber/PC certs — informational split,
// non-blocking, since Stage 11 already blocks correctly via the existing
// is_validated gate and tests/quality.test.js exercises exactly that path), S12.8/9
// (compression/compaction — informational; no Stage-2 hazard-audit table exists yet
// to auto-trigger from, so it can never be more than a manual flag today), S16.7
// (energisation certificate — NEW blocking, jurisdiction-specific), S17.2
// (driveway/crossover — PM-checked, non-blocking, same jurisdiction field), S18.11/
// S18.12 (the accountant tax.approve gate — NEW blocking, additional to Stage 18's
// existing Inspector-driven is_validated check, not instead of it).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { isProjectMember } = require('../lib/scope');

// seq -> [{ label, required_role, inspection_type, blocks_progress, jurisdiction }]
// `jurisdiction: true` means "resolve from the org's own state at seed time".
const SEED_DEFINITIONS = {
  10: [
    { label: 'Survey set-out — building position (surveyor pegs)', required_role: 'siteSupervisor',
      inspection_type: 'statutory', blocks_progress: true },
  ],
  11: [
    { label: "Electrician's compliance certificate (rough-in)", required_role: 'inspector',
      inspection_type: 'statutory', blocks_progress: false },
    { label: "Plumber's compliance certificate (rough-in)", required_role: 'inspector',
      inspection_type: 'statutory', blocks_progress: false },
    { label: "Principal Certifier's overall verification", required_role: 'inspector',
      inspection_type: 'statutory', blocks_progress: false },
  ],
  12: [
    { label: 'Core compression test results', required_role: 'inspector',
      inspection_type: 'internal_qa', blocks_progress: false },
    { label: 'Compaction test log', required_role: 'inspector',
      inspection_type: 'internal_qa', blocks_progress: false },
  ],
  16: [
    { label: 'Mains energisation certificate', required_role: 'inspector',
      inspection_type: 'statutory', blocks_progress: true, jurisdiction: true },
  ],
  17: [
    { label: 'Driveway/crossover council sign-off', required_role: 'projectManager',
      inspection_type: 'internal_qa', blocks_progress: false, jurisdiction: true },
  ],
  18: [
    { label: 'Fixed-asset/depreciation draft approval (S18.12)', required_role: 'accountant',
      inspection_type: 'statutory', blocks_progress: true },
  ],
};

const PERMISSION_BY_ROLE = {
  inspector: 'quality.validate',
  siteSupervisor: 'progress.verify',
  accountant: 'tax.approve',
  projectManager: 'programme.write',
};

/** Called from StageTemplateService.instantiate for each newly-created stage. */
async function seedForStage({ conn, orgId, projectId, stageId, seq, orgState }) {
  const defs = SEED_DEFINITIONS[seq];
  if (!defs) return;
  for (const def of defs) {
    await conn.query(
      `INSERT INTO hold_point_requirements
         (id, org_id, project_id, stage_id, label, required_role, inspection_type, jurisdiction, blocks_progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), orgId, projectId, stageId, def.label, def.required_role, def.inspection_type,
       def.jurisdiction ? (orgState || null) : null, def.blocks_progress ? 1 : 0]
    );
  }
}

async function listForStage({ orgId, projectId, stageId }) {
  const [rows] = await pool.query(
    `SELECT * FROM hold_point_requirements WHERE stage_id = ? AND project_id = ? AND org_id = ? ORDER BY created_at`,
    [stageId, projectId, orgId]
  );
  return { requirements: rows };
}

/** True unless a stage has an OPEN, blocking requirement — the additive gate check. */
async function allBlockingSatisfied(orgId, stageId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS unmet FROM hold_point_requirements
      WHERE stage_id = ? AND org_id = ? AND blocks_progress = 1 AND status = 'open'`,
    [stageId, orgId]
  );
  return Number(row.unmet) === 0;
}

/** POST .../hold-points/:reqId/satisfy — the one server-mediated action per row. */
async function satisfy({ orgId, projectId, stageId, requirementId, actor }) {
  const [[req]] = await pool.query(
    `SELECT * FROM hold_point_requirements WHERE id = ? AND stage_id = ? AND project_id = ? AND org_id = ? LIMIT 1`,
    [requirementId, stageId, projectId, orgId]
  );
  if (!req) throw new ServiceError('NOT_FOUND', 'Hold-point requirement not found', 404);
  if (req.status === 'satisfied') {
    throw new ServiceError('ALREADY_SATISFIED', 'This requirement is already satisfied', 409);
  }

  const perm = PERMISSION_BY_ROLE[req.required_role];
  if (!perm || !access.hasPermission(actor.role, perm)) {
    throw new ServiceError('FORBIDDEN', `Requires the ${req.required_role} role's authority for this item`, 403);
  }
  if (access.scopeClassFor(actor.role) !== 'portfolio') {
    const member = await isProjectMember(pool, { orgId, userId: actor.userId, projectId });
    if (!member) throw new ServiceError('NOT_FOUND', 'Hold-point requirement not found', 404);
  }

  await pool.query(
    `UPDATE hold_point_requirements SET status = 'satisfied', satisfied_by = ?, satisfied_at = NOW() WHERE id = ?`,
    [actor.userId, requirementId]
  );
  return { id: requirementId, status: 'satisfied' };
}

module.exports = { seedForStage, listForStage, allBlockingSatisfied, satisfy, SEED_DEFINITIONS };
