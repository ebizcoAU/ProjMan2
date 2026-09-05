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

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { isProjectMember } = require('../lib/scope');
const AttestationService = require('./AttestationService');

const OFFICE_STATUSES = ['not_started', 'in_progress', 'complete', 'cancelled', 'n_a'];

/**
 * BEFORE the write. Only fires when `completion` is actually changing — a pure
 * date/assignee/other-field push is untouched, same precedent as
 * StageProgressionService's own status-only gate.
 *
 * xprojman-38 §1: `status` is derived from `completion` here — going forward the
 * two columns never drift, and a device never sets `status` itself (not in the
 * sync-registry `columns` set for `tasks`, same "server sets it, device can't"
 * posture as `verified_by`/`is_validated`). A task the office has marked
 * 'cancelled'/'n_a' silently drops an incoming completion tick instead of
 * rejecting it — the office decision is authoritative, and a field device
 * queued the tick before it could possibly know about that decision; same
 * "don't wedge the whole queue behind one row" posture `sanitise()` already
 * uses for a field it doesn't recognise.
 */
async function guardPush({ wireName, operation, id, safe, actor }) {
  if (wireName !== 'tasks' || safe.completion === undefined) return;

  let current;
  if (operation !== 'create') {
    const [[row]] = await pool.query(
      'SELECT status, assigned_to FROM tasks WHERE id = ? AND org_id = ? LIMIT 1',
      [id, actor.orgId]
    );
    current = row;
  }
  if (current && (current.status === 'cancelled' || current.status === 'n_a')) {
    delete safe.completion;
    return;
  }

  // A create declaring the default untouched state (completion: 0) isn't ticking
  // anything — nothing to compare against yet, so nothing has "changed". Only a
  // create that arrives already-ticked, or any update touching completion, gates.
  if (!(operation === 'create' && Number(safe.completion) === 0)) {
    if (!access.hasPermission(actor.role, 'progress.tick')) {
      throw new ServiceError('FORBIDDEN', 'Requires permission: progress.tick', 403);
    }
    // `self` scope (tradie): may tick only a task assigned to themselves — the
    // sync-push project-membership check already ran; this narrows to row-ownership,
    // the same additional step site_attendance's own-vs-site split uses.
    if (access.scopeClassFor(actor.role) === 'self') {
      let assignedTo = safe.assigned_to;
      if (assignedTo === undefined) assignedTo = current?.assigned_to;
      if (String(assignedTo || '') !== String(actor.userId)) {
        throw new ServiceError('FORBIDDEN', 'You may only tick your own tasks', 403);
      }
    }
  }

  const completion = Number(safe.completion);
  safe.status = completion >= 100 ? 'complete' : completion > 0 ? 'in_progress' : 'not_started';
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

/**
 * PATCH /projects/:id/tasks/:taskId — office-side edit of `output_note` (xprojman-32
 * §2/§4) and, since xprojman-38, `status` — the ONLY path that may set 'cancelled'/
 * 'n_a' (a device push never can, see guardPush). `projects.write`, not
 * `progress.tick`/`progress.verify` — plain task metadata/office correction, not the
 * tick-then-verify chain. Both fields optional but at least one required; either can
 * be set alone or together in one call. Fully reversible — the office may set
 * `status` to any of the 5 values at any time (including back OUT of 'n_a'/
 * 'cancelled'), there is no terminal-state lock: nothing in this app's ask requires
 * one, and adding an irreversible guard nobody asked for would just be a way to get
 * "oops, wrong button" wrong later.
 */
async function updateOfficeFields({ orgId, projectId, taskId, actor, outputNote, status }) {
  if (outputNote === undefined && status === undefined) {
    throw new ServiceError('NO_FIELDS', 'Nothing to update', 400);
  }
  if (status !== undefined && !OFFICE_STATUSES.includes(status)) {
    throw new ServiceError('VALIDATION_ERROR', `status must be one of ${OFFICE_STATUSES.join(', ')}`, 422);
  }
  if (!access.hasPermission(actor.role, 'projects.write')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: projects.write', 403);
  }
  const [[task]] = await pool.query(
    'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [taskId, projectId, orgId]
  );
  if (!task) throw new ServiceError('NOT_FOUND', 'Task not found', 404);

  if (access.scopeClassFor(actor.role) !== 'portfolio') {
    const member = await isProjectMember(pool, { orgId, userId: actor.userId, projectId });
    if (!member) throw new ServiceError('NOT_FOUND', 'Task not found', 404);
  }

  const fields = {};
  if (outputNote !== undefined) fields.output_note = outputNote;
  if (status !== undefined) fields.status = status;
  const columns = Object.keys(fields);
  await pool.query(
    `UPDATE tasks SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')}, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ?`,
    [...Object.values(fields), taskId, orgId]
  );
  return { id: taskId, ...fields };
}

/**
 * POST /projects/:id/tasks — a hand-added, ad-hoc task under a stage (xprojman-38
 * §3; confirmed via a full route audit that this never existed — the 18-Stage
 * spec's own assumption that it did was wrong). `seq` continues the SAME Sx.y
 * numbering the template already seeded (§2) — `MAX(seq)+1` within the stage, so
 * the owner's own example (seeded tasks end at S1.7, PM adds S1.8/S1.9/S1.10) is
 * exactly what falls out of this, no separate numbering scheme. `template_item_id`
 * stays NULL — this task has no template row, by definition. Same permission tier
 * and Stage-range scoping as adding a STAGE itself (`assertProgrammeWriteScope`,
 * ProjectService) — a hand-added task is the same class of programme-shaping
 * action as a hand-added stage, so it goes through the identical PM-Stages-1-8-vs-
 * engaged-Builder-Stages-9-18 split rather than a new rule.
 */
async function createTask({ orgId, projectId, actor, stageId, name, predecessorId, assignedTo, budgetHours }) {
  if (!name || !String(name).trim()) throw new ServiceError('VALIDATION_ERROR', 'name is required', 400);
  if (!stageId) throw new ServiceError('VALIDATION_ERROR', 'stage_id is required', 400);

  const [[stage]] = await pool.query(
    'SELECT id, seq FROM project_stages WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [stageId, projectId, orgId]
  );
  if (!stage) throw new ServiceError('VALIDATION_ERROR', 'stage_id not found on this project', 422);

  // Lazy require — ProjectService requires this module back (createStage calls
  // assertProgrammeWriteScope too), same cycle-break already used elsewhere here.
  const ProjectService = require('./ProjectService');
  await ProjectService.assertProgrammeWriteScope({ orgId, projectId, actor, seq: stage.seq });

  if (predecessorId) {
    const [[pred]] = await pool.query(
      'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [predecessorId, projectId, orgId]
    );
    if (!pred) throw new ServiceError('VALIDATION_ERROR', 'predecessor_id not found on this project', 422);
  }

  const [[{ nextSeq }]] = await pool.query(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM tasks WHERE stage_id = ? AND org_id = ? AND is_deleted = 0',
    [stageId, orgId]
  );

  const id = uuidv4();
  await pool.query(
    `INSERT INTO tasks
       (id, org_id, project_id, stage_id, name, seq, status, predecessor_id, assigned_to, budget_hours,
        updated_at, server_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, NOW(3))`,
    [id, orgId, projectId, stageId, name.trim(), nextSeq, predecessorId || null, assignedTo || null,
     budgetHours || null, Date.now()]
  );
  return { id, seq: nextSeq, code: `S${stage.seq}.${nextSeq}` };
}

module.exports = { guardPush, verify, updateOfficeFields, createTask };
