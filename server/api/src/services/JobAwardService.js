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
async function create({ orgId, projectId, actor, toUserId, roleOffered, builderEngagementType, tradeOffered }) {
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
  if (roleOffered === 'subcontractor' && !(tradeOffered && String(tradeOffered).trim())) {
    throw new ServiceError('VALIDATION_ERROR',
      "trade_offered is required for role_offered='subcontractor'", 400);
  }
  // Appointer ≠ appointed (xprojman-08 §3, owner 2026-07-30). One identity = one
  // fixed role, so a PM can never also be the Builder — no self-award. This was
  // already blocked indirectly (an award needs a prior introduction; self-introduction
  // is rejected), but the single-role decision makes it an explicit invariant rather
  // than an emergent side-effect.
  if (String(actor.userId) === String(toUserId)) {
    throw new ServiceError('SELF_AWARD',
      'A Job Award cannot name the same person as both awarder and awardee', 400);
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
       (id, org_id, project_id, from_user_id, to_user_id, role_offered, document_hash, builder_engagement_type, trade_offered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, actor.userId, toUserId, roleOffered, documentHash,
     roleOffered === 'builder' ? builderEngagementType : null,
     roleOffered === 'subcontractor' ? tradeOffered : null]
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
    // S9.10 activation (xprojman-45 Option B): the first accepted builder award is when
    // the programme goes live. First one wins; StageProgressionService gates on the award.
    if (award.role_offered === 'builder') {
      await pool.query(
        `UPDATE projects SET programme_activated_at = COALESCE(programme_activated_at, NOW())
          WHERE id = ? AND org_id = ?`,
        [projectId, orgId]
      );
    }
    // xprojman-44 Module C: the actual writer subcontractor_engagements (migration_v014)
    // never had. Consent defaults FALSE per that table's own column default — never
    // auto-true just because the award was accepted.
    if (award.role_offered === 'subcontractor') {
      await pool.query(
        `INSERT INTO subcontractor_engagements
           (id, org_id, project_id, job_award_id, subcontractor_user_id, trade)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), orgId, projectId, jobAwardId, actor.userId, award.trade_offered]
      );
    }
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
 * GET /job-awards/pending — the invitee's identity-level inbox (xprojman-11).
 * The cold-stranger/chicken-and-egg fix: an invited person is NOT a `project_members`
 * row until they accept (that write happens inside `respond`), so the project-scoped
 * `list()` above — which goes through `assertProjectReachable` — can never surface an
 * award TO them. This read is scoped to `to_user_id = caller`, so it needs no project
 * membership and no permission beyond being authenticated (same posture as
 * `GET /introductions`). Still org-bounded — cross-company invitations are PM2-02.
 *
 * Returns the app's proposed xprojman-11 §3 shape verbatim; the two display names it
 * flagged as guesses map to `users.full_name` (→ `from_name`) and `projects.name`
 * (→ `project_name`).
 */
async function pending({ orgId, userId }) {
  const [rows] = await pool.query(
    `SELECT ja.id,
            ja.project_id,
            p.name       AS project_name,
            ja.from_user_id,
            u.full_name  AS from_name,
            ja.role_offered,
            ja.builder_engagement_type,
            ja.trade_offered,
            ja.sent_at
       FROM job_awards ja
       LEFT JOIN projects p ON p.id = ja.project_id  AND p.org_id = ja.org_id
       LEFT JOIN users    u ON u.id = ja.from_user_id AND u.org_id = ja.org_id
      WHERE ja.to_user_id = ? AND ja.org_id = ? AND ja.status = 'sent'
      ORDER BY ja.sent_at DESC`,
    [userId, orgId]
  );
  return { pending: rows };
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

/**
 * GET /projects/:id/subcontractor-engagements — the Builder's OWN line-level list
 * (xprojman-44 Module C), distinct from PM's `ProcurementService.subcontractorRegister`
 * (aggregate-only by design, §1.4). Scoped to engagements whose job_award was SENT by
 * this caller — never another Builder's, no separate permission needed since
 * `panel.manage` already gates who could have sent the award in the first place.
 */
async function listSubcontractorEngagements({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const [rows] = await pool.query(
    `SELECT se.* FROM subcontractor_engagements se
       JOIN job_awards ja ON ja.id = se.job_award_id
      WHERE se.project_id = ? AND se.org_id = ? AND ja.from_user_id = ?
      ORDER BY se.created_at DESC`,
    [projectId, orgId, actor.userId]
  );
  return { subcontractor_engagements: rows };
}

/**
 * POST /projects/:id/subcontractor-engagements/:engId/consent — records the
 * subcontractor's signed pass-through-consent clause (xprojman-44 Module C §3), a
 * separate explicit action from the engagement's creation since the consent document
 * has its own timing. Only the Builder who sent the underlying award may record it,
 * against a document already uploaded through the generic Documents pipeline
 * (entity_type='subcontractor_engagement'). Idempotent-refusal, not overwrite — same
 * posture as `recordDeposit`, an evidentiary record shouldn't be silently replaced.
 */
async function recordSubcontractorConsent({ orgId, projectId, engagementId, actor, documentId }) {
  const [[engagement]] = await pool.query(
    `SELECT se.*, ja.from_user_id AS builder_user_id
       FROM subcontractor_engagements se
       JOIN job_awards ja ON ja.id = se.job_award_id
      WHERE se.id = ? AND se.project_id = ? AND se.org_id = ? LIMIT 1`,
    [engagementId, projectId, orgId]
  );
  if (!engagement) throw new ServiceError('NOT_FOUND', 'Subcontractor engagement not found', 404);
  if (String(engagement.builder_user_id) !== String(actor.userId)) {
    throw new ServiceError('FORBIDDEN', 'Only the Builder who engaged this subcontractor may record consent', 403);
  }
  if (engagement.consent_document_id) {
    throw new ServiceError('ALREADY_RECORDED', 'Consent is already recorded against this engagement', 409);
  }
  const [[doc]] = await pool.query(
    `SELECT id FROM documents
      WHERE id = ? AND org_id = ? AND entity_type = 'subcontractor_engagement' AND entity_id = ? AND is_deleted = 0
      LIMIT 1`,
    [documentId, orgId, engagementId]
  );
  if (!doc) {
    throw new ServiceError('VALIDATION_ERROR',
      'document_id must reference a document already uploaded for this engagement (entity_type=subcontractor_engagement)', 400);
  }
  await pool.query(
    `UPDATE subcontractor_engagements SET consent_document_id = ?, consent_recorded_at = NOW() WHERE id = ?`,
    [documentId, engagementId]
  );
  return { id: engagementId, consent_document_id: documentId };
}

module.exports = {
  create, list, pending, respond, recordDeposit, acceptedBuilderEngagement,
  listSubcontractorEngagements, recordSubcontractorConsent,
};
