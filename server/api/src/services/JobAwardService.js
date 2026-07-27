// JobAwardService — the formal, project-specific invitation (DIRECTIVE 1 Step B,
// servdesignspecification.md §7.3). Sourced only from an existing `introductions`
// row — the server-side teeth behind "PM cannot Job-Award a cold stranger."
// Acceptance itself (`respond`) is a lightweight tap; `recordDeposit` is the separate
// event that actually makes it binding (S9.9 — a TPAR-reportable payment against the
// Builder's own ABN), matching the 18-Stage spec's own sequencing of S9.7 vs S9.9.
//
// Deliberately REST-mediated (see migration_v013's header) — a `sent -> accepted/
// declined` workflow transition, not free-form field editing, so it does not ride
// `/sync/push`; both the App and Portal call these same endpoints.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const IntroductionService = require('./IntroductionService');
const MembershipService = require('./MembershipService');
const ProjectService = require('./ProjectService');

const ROLE_OFFERED = ['builder', 'tradie', 'foreperson', 'subcontractor'];
const ENGAGEMENT_TYPES = ['employee', 'independent_fixed', 'independent_cost_plus'];

/**
 * POST /projects/:id/job-awards — PM sends the formal invitation. Requires
 * `panel.manage` (PM's own Builders panel) and an existing `introductions` row
 * between PM and the invitee — the cold-stranger constraint, enforced here, not
 * just documented.
 */
async function create({ orgId, projectId, actor, toUserId, roleOffered, builderEngagementType }) {
  if (!access.hasPermission(actor.role, 'panel.manage')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: panel.manage', 403);
  }
  if (!ROLE_OFFERED.includes(roleOffered)) {
    throw new ServiceError('VALIDATION_ERROR', `role_offered must be one of ${ROLE_OFFERED.join(', ')}`, 400);
  }
  if (roleOffered === 'builder' && !ENGAGEMENT_TYPES.includes(builderEngagementType)) {
    throw new ServiceError('VALIDATION_ERROR',
      `builder_engagement_type is required for role_offered='builder' and must be one of ${ENGAGEMENT_TYPES.join(', ')}`, 400);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });

  const introduced = await IntroductionService.exists({ orgId, userAId: actor.userId, userBId: toUserId });
  if (!introduced) {
    throw new ServiceError('NO_INTRODUCTION',
      'PM cannot Job-Award a cold stranger — an introduction must exist between these two people first', 409);
  }

  const id = uuidv4();
  const documentHash = crypto.createHash('sha256')
    .update(`${orgId}:${projectId}:${actor.userId}:${toUserId}:${roleOffered}:${Date.now()}`)
    .digest('hex');

  await pool.query(
    `INSERT INTO job_awards
       (id, org_id, project_id, from_user_id, to_user_id, role_offered, document_hash, builder_engagement_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, actor.userId, toUserId, roleOffered, documentHash,
     roleOffered === 'builder' ? builderEngagementType : null]
  );
  return { id, status: 'sent', document_hash: documentHash };
}

/** GET /projects/:id/job-awards — review list (PM/Builder's own panel). */
async function list({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const [rows] = await pool.query(
    `SELECT * FROM job_awards WHERE project_id = ? AND org_id = ? ORDER BY sent_at DESC`,
    [projectId, orgId]
  );
  return { job_awards: rows };
}

/**
 * POST /projects/:id/job-awards/:id/respond — the S9.7 tap. Only the invited person
 * (`to_user_id`) may respond. Accepting a `builder` award auto-enrols them into
 * `project_members` (§9.4's `assigned` scope needs the membership row to reach
 * anything) — same pattern as an app-authored project's creator auto-enrolment.
 */
async function respond({ orgId, projectId, jobAwardId, actor, accept, surface }) {
  const [[award]] = await pool.query(
    `SELECT * FROM job_awards WHERE id = ? AND project_id = ? AND org_id = ? LIMIT 1`,
    [jobAwardId, projectId, orgId]
  );
  if (!award) throw new ServiceError('NOT_FOUND', 'Job Award not found', 404);
  if (String(award.to_user_id) !== String(actor.userId)) {
    throw new ServiceError('FORBIDDEN', 'Only the invited person may respond to this Job Award', 403);
  }
  if (award.status !== 'sent') {
    throw new ServiceError('ALREADY_RESPONDED', `This Job Award was already ${award.status}`, 409);
  }

  const status = accept ? 'accepted' : 'declined';
  await pool.query(
    `UPDATE job_awards SET status = ?, responded_at = NOW(), response_channel = ? WHERE id = ?`,
    [status, surface === 'app' ? 'app' : 'portal', jobAwardId]
  );

  if (accept) {
    await MembershipService.addMember({ orgId, projectId, userId: actor.userId, addedBy: award.from_user_id });
  }
  return { id: jobAwardId, status };
}

/**
 * POST /projects/:id/job-awards/:id/deposit — S9.9, the event that actually makes
 * acceptance binding (a TPAR-reportable payment against the Builder's own ABN, not
 * the tap alone). Only meaningful on an accepted award; idempotent — recording twice
 * is refused, not double-charged.
 */
async function recordDeposit({ orgId, projectId, jobAwardId, actor, amount, reference }) {
  const [[award]] = await pool.query(
    `SELECT * FROM job_awards WHERE id = ? AND project_id = ? AND org_id = ? LIMIT 1`,
    [jobAwardId, projectId, orgId]
  );
  if (!award) throw new ServiceError('NOT_FOUND', 'Job Award not found', 404);
  if (award.status !== 'accepted') {
    throw new ServiceError('NOT_ACCEPTED', 'This Job Award has not been accepted yet', 409);
  }
  if (award.deposit_payment_id) {
    throw new ServiceError('ALREADY_RECORDED', 'A deposit is already recorded against this Job Award', 409);
  }

  const paymentId = uuidv4();
  await pool.query(
    `INSERT INTO project_payments
       (id, org_id, project_id, payee_user_id, amount, purpose, reference, recorded_by)
     VALUES (?, ?, ?, ?, ?, 'deposit', ?, ?)`,
    [paymentId, orgId, projectId, award.to_user_id, amount, reference || null, actor.userId]
  );
  await pool.query(`UPDATE job_awards SET deposit_payment_id = ? WHERE id = ?`, [paymentId, jobAwardId]);
  return { id: jobAwardId, deposit_payment_id: paymentId };
}

/**
 * The one accepted `builder` engagement for a project, if any — the resolver every
 * `programme.write`/`money.*` scope check (Step A code, Step A2) reads from. A
 * single-Builder-per-project v1 default (devroadmap.md Open Decision #7).
 */
async function acceptedBuilderEngagement({ orgId, projectId }) {
  const [[row]] = await pool.query(
    `SELECT * FROM job_awards
      WHERE project_id = ? AND org_id = ? AND role_offered = 'builder' AND status = 'accepted'
      ORDER BY responded_at DESC LIMIT 1`,
    [projectId, orgId]
  );
  return row || null;
}

module.exports = { create, list, respond, recordDeposit, acceptedBuilderEngagement };
