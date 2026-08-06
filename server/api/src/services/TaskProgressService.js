// TaskProgressService — the tick-then-verify chain on `tasks` (Manager DIRECTIVE 1
// Step A, servdesignspecification.md §7.2, 18-Stage spec §1.3). Same shape as
// SiteOpsService/QualityOpsService: a guard invoked from SyncService.pushRecord on
// the ONE field that actually needs it, plus the one server-mediated action
// (`verify`) that a bare sync write can never perform because `verified_by`/
// `verified_at` are protected columns.
//
// Scope decision (documented in migration_v012's header too): this gates `tasks`
// only — the proven stage-advance gate (`progress.write` on `project_stages`,
// `StageProgressionService`) is untouched. `tasks` previously had NO permission
// check at all on push; this closes that gap rather than reopening the stage engine.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { isProjectMember } = require('../lib/scope');
const AttestationService = require('./AttestationService');

/**
 * BEFORE the write. Only fires when `completion` is actually changing — a pure
 * date/assignee/other-field push is untouched, same precedent as
 * StageProgressionService's own status-only gate.
 */
async function guardPush({ wireName, operation, id, safe, actor }) {
  if (wireName !== 'tasks' || safe.completion === undefined) return;
  // A create declaring the default untouched state (completion: 0) isn't ticking
  // anything — nothing to compare against yet, so nothing has "changed". Only a
  // create that arrives already-ticked, or any update touching completion, gates.
  if (operation === 'create' && Number(safe.completion) === 0) return;
  if (!access.hasPermission(actor.role, 'progress.tick')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: progress.tick', 403);
  }
  // `self` scope (tradie): may tick only a task assigned to themselves — the
  // sync-push project-membership check already ran; this narrows to row-ownership,
  // the same additional step site_attendance's own-vs-site split uses.
  if (access.scopeClassFor(actor.role) === 'self') {
    let assignedTo = safe.assigned_to;
    if (assignedTo === undefined && operation !== 'create') {
      const [[row]] = await pool.query(
        'SELECT assigned_to FROM tasks WHERE id = ? AND org_id = ? LIMIT 1',
        [id, actor.orgId]
      );
      assignedTo = row?.assigned_to;
    }
    if (String(assignedTo || '') !== String(actor.userId)) {
      throw new ServiceError('FORBIDDEN', 'You may only tick your own tasks', 403);
    }
  }
}

/**
 * POST /projects/:id/tasks/:taskId/verify — the one server-mediated action.
 * `progress.verify` only (Site Supervisor); requires the tick to already be complete
 * (verifying nothing is not a verification) and project membership.
 */
async function verify({ orgId, projectId, taskId, actor }) {
  if (!access.hasPermission(actor.role, 'progress.verify')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: progress.verify', 403);
  }
  const [[task]] = await pool.query(
    'SELECT * FROM tasks WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [taskId, projectId, orgId]
  );
  if (!task) throw new ServiceError('NOT_FOUND', 'Task not found', 404);

  if (access.scopeClassFor(actor.role) !== 'portfolio') {
    const member = await isProjectMember(pool, { orgId, userId: actor.userId, projectId });
    if (!member) throw new ServiceError('NOT_FOUND', 'Task not found', 404);
  }
  if (Number(task.completion) < 100) {
    throw new ServiceError('TASK_NOT_TICKED', 'This task is not yet ticked complete', 409);
  }

  await pool.query(
    `UPDATE tasks SET verified_by = ?, verified_at = NOW(), server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ?`,
    [actor.userId, taskId, orgId]
  );

  // PM2-02 evidence emission (§13.3) — the doer's own record, not the verifier's.
  // Best-effort: an attestation failure must never fail a verification that already
  // committed (same posture as stageHooks.fire).
  if (task.assigned_to) {
    AttestationService.emit({
      subjectUserId: task.assigned_to, issuingOrgId: orgId,
      sourceType: 'task_complete', sourceId: taskId,
      payload: { project_id: projectId, task_name: task.name, verified_by: actor.userId },
    }).catch((err) => console.warn('[ATTESTATION] task_complete emit failed (non-fatal):', err.message));
  }

  return { id: taskId, verified_by: actor.userId };
}

module.exports = { guardPush, verify };
