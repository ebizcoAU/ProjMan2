// StageProgressionService — the stage state machine and its gates (servdesignspec §10.4).
//
// This is the projman-03 R2 "ComplianceService" pattern: every rule that gates a stage
// lives here, and it is called from BOTH the REST /advance endpoint AND SyncService
// when a device pushes a project_stages.status change. Identical rules on both paths —
// a client cannot skip a hold point by using sync instead of REST.
//
// The engine reasons over a small closed status enum:
//   not_started → in_progress → complete   (skipped / blocked are side states)
// The rich, stage-specific workflow labels (WAITING_FOR_CUSTOMER_FEEDBACK, …) ride in
// `milestone` (free text), so the gate logic stays tiny while the app shows the exact
// state.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { isProjectMember } = require('../lib/scope');
const hooks = require('./stageHooks');
const ComplianceService = require('./ComplianceService');

const STATUSES = ['not_started', 'in_progress', 'blocked', 'complete', 'skipped'];

/** Load a stage in the caller's org, or 404 (non-disclosure — same as elsewhere). */
async function loadStage(orgId, projectId, stageId) {
  const [[stage]] = await pool.query(
    `SELECT * FROM project_stages
      WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [stageId, projectId, orgId]
  );
  if (!stage) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);
  return stage;
}

/**
 * The gate. Throws unless `stage` may move to `toStatus` by `actor`. Pure checks —
 * no writes — so it can guard a REST call or a sync push before either mutates.
 *
 * @param {object} p
 * @param {object} p.actor   { orgId, userId, role }
 * @param {object} p.stage   the project_stages row
 * @param {string} p.toStatus
 */
async function checkTransition({ actor, stage, toStatus }) {
  if (!STATUSES.includes(toStatus)) {
    throw new ServiceError('VALIDATION_ERROR', `Unknown status "${toStatus}"`, 400);
  }

  // 1. Permission + scope. progress.write, and membership of the stage's project
  //    unless the role is portfolio (§9.4). Fail as 404 for a non-member, matching
  //    the non-disclosure rule the rest of the project surface uses.
  if (!access.hasPermission(actor.role, 'progress.write')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: progress.write', 403);
  }
  if (access.scopeClassFor(actor.role) !== 'portfolio') {
    const member = await isProjectMember(pool, {
      orgId: actor.orgId, userId: actor.userId, projectId: stage.project_id,
    });
    if (!member) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);
  }

  // 2. Sequential gate — a gate_prev stage cannot START until its predecessor (by seq)
  //    is complete, and validated too if that predecessor is a hold point.
  if (toStatus === 'in_progress' && stage.gate_prev) {
    const [[prev]] = await pool.query(
      `SELECT status, is_hold_point, is_validated FROM project_stages
        WHERE project_id = ? AND org_id = ? AND is_deleted = 0 AND seq < ?
        ORDER BY seq DESC LIMIT 1`,
      [stage.project_id, actor.orgId, stage.seq]
    );
    if (prev && prev.status !== 'complete') {
      throw new ServiceError('STAGE_GATE_PREV',
        'The previous stage must be complete before this one can start', 409);
    }
    if (prev && prev.is_hold_point && !prev.is_validated) {
      throw new ServiceError('STAGE_GATE_PREV',
        'The previous stage is a hold point and must be validated before this one can start', 409);
    }
  }

  // 3. Hold-point gate — a hold-point stage cannot COMPLETE until it is validated
  //    (matrix: "the milestone cannot advance until the independent Inspector …").
  if (toStatus === 'complete' && stage.is_hold_point && !stage.is_validated) {
    throw new ServiceError('STAGE_NOT_VALIDATED',
      'This stage is a hold point — an inspector must validate it before it can be completed', 409);
  }

  // 4. NCC / structural completion gates (P6b, projman-03 R2/R3, §12.10) — the same
  //    posture as the hold-point gate above: checked here so REST /advance and the
  //    sync-push path (which both call checkTransition) share it identically.
  if (toStatus === 'complete') {
    if (!(await ComplianceService.checkNccCompliance(actor.orgId, stage.id))) {
      throw new ServiceError('NCC_OPEN',
        'This stage has an open NCC compliance item — close it before completing the stage', 409);
    }
    if (!(await ComplianceService.checkStructuralCompliance(actor.orgId, stage.id))) {
      throw new ServiceError('STRUCTURAL_INCOMPLETE',
        'This stage has an incomplete or failed structural inspection — resolve it before completing the stage', 409);
    }
  }
}

/**
 * Advance a stage's status via REST, running the gate first. (The sync-push path
 * calls checkTransition directly and applies the update through the sync writer, so
 * this method is the REST twin, not a second rule set.)
 */
async function advance({ orgId, projectId, stageId, actor, toStatus, milestone }) {
  const stage = await loadStage(orgId, projectId, stageId);
  await checkTransition({ actor, stage, toStatus });

  const sets = ['status = ?', 'updated_at = ?', 'server_updated_at = NOW(3)'];
  const params = [toStatus, Date.now()];
  if (milestone !== undefined) { sets.push('milestone = ?'); params.push(milestone || null); }
  // Convenience timestamps — first start and completion, if not already stamped.
  if (toStatus === 'in_progress') sets.push('start_date = COALESCE(start_date, CURDATE())');
  if (toStatus === 'complete')    sets.push('end_date = COALESCE(end_date, CURDATE())');

  await pool.query(
    `UPDATE project_stages SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`,
    [...params, stageId, orgId]
  );

  if (toStatus === 'complete') {
    await hooks.fire('onStageCompleted', { orgId, projectId, stage, actor });
  }
  return { id: stageId, status: toStatus };
}

/**
 * Inspector validation of a hold point (§10.5). Only quality.validate (inspector),
 * scoped to the project. Sets is_validated + provenance — never a device write.
 */
async function validate({ orgId, projectId, stageId, actor, result, reference, note }) {
  if (!access.hasPermission(actor.role, 'quality.validate')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: quality.validate', 403);
  }
  const stage = await loadStage(orgId, projectId, stageId);

  if (access.scopeClassFor(actor.role) !== 'portfolio') {
    const member = await isProjectMember(pool, {
      orgId, userId: actor.userId, projectId: stage.project_id,
    });
    if (!member) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);
  }
  if (!stage.is_hold_point) {
    throw new ServiceError('NOT_HOLD_POINT', 'This stage is not a hold point', 409);
  }

  const pass = result === 'pass';
  await pool.query(
    `UPDATE project_stages
        SET is_validated = ?, validated_by = ?, validated_at = ?,
            updated_at = ?, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ?`,
    [pass ? 1 : 0, pass ? actor.userId : null, pass ? new Date() : null,
     Date.now(), stageId, orgId]
  );

  if (pass) await hooks.fire('onStageValidated', { orgId, projectId, stage, actor, reference });
  return { id: stageId, is_validated: pass, result: pass ? 'pass' : 'fail' };
}

module.exports = { checkTransition, advance, validate, loadStage, STATUSES };
