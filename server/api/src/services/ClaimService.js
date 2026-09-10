// ClaimService — P7a progress claims (xprojman-10 §4, servdesignspec §7.2 / §10.6).
// The Builder→PM billing workflow: submit (claims.submit) → approve/decline
// (claims.approve) → pay (records a project_payments row, TPAR-reportable). Submit runs
// the ALREADY-BUILT §10.6 freeze (stageHooks.assertClaimAllowed): a claim against a stage
// that is — or sits behind — an unvalidated hold point is refused (CLAIM_BLOCKED).
// Approved+paid claims roll up into `project_stages.claimed_amount`.
//
// The claim amount is inherently shared (the Builder bills it, the PM approves it), so it
// is not engagement-mode-redacted — that redaction protects a Builder's private cost
// breakdown, which is estimate/ledger territory, not the billed claim figure.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');
const stageHooks = require('./stageHooks');
const OrgFinanceService = require('./OrgFinanceService');

const canRead = (role) => access.hasPermission(role, 'money.read');

async function recomputeStageClaimed({ orgId, projectId, stageId }) {
  if (!stageId) return;
  await pool.query(
    `UPDATE project_stages ps
        SET ps.claimed_amount = (
          SELECT COALESCE(SUM(pc.amount), 0) FROM progress_claims pc
           WHERE pc.stage_id = ps.id AND pc.org_id = ps.org_id
             AND pc.is_deleted = 0 AND pc.status IN ('approved','paid'))
      WHERE ps.id = ? AND ps.project_id = ? AND ps.org_id = ?`,
    [stageId, projectId, orgId]
  );
}

async function loadClaim({ orgId, projectId, claimId }) {
  const [[claim]] = await pool.query(
    'SELECT * FROM progress_claims WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [claimId, projectId, orgId]
  );
  if (!claim) throw new ServiceError('NOT_FOUND', 'Progress claim not found', 404);
  return claim;
}

/**
 * POST /projects/:id/progress-claims — Builder submits (claims.submit). Runs the §10.6
 * freeze via the pre-existing stageHooks.assertClaimAllowed.
 */
async function submit({ orgId, projectId, actor, stageId, amount, note }) {
  if (!access.hasPermission(actor.role, 'claims.submit')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.submit', 403);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!(Number(amount) > 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a positive number', 400);
  if (stageId) await stageHooks.assertClaimAllowed(pool, { orgId, stageId }); // §10.6 freeze

  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(claim_number), 0) + 1 AS next FROM progress_claims WHERE project_id = ? AND org_id = ?',
    [projectId, orgId]
  );
  const id = uuidv4();
  await pool.query(
    `INSERT INTO progress_claims
       (id, org_id, project_id, stage_id, claim_number, amount, note, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, stageId || null, next, amount, note || null, actor.userId]
  );
  return { id, claim_number: next, status: 'submitted' };
}

/** POST /projects/:id/progress-claims/:claimId/approve (claims.approve). */
async function approve({ orgId, projectId, claimId, actor, accept = true }) {
  if (!access.hasPermission(actor.role, 'claims.approve')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.approve', 403);
  }
  const claim = await loadClaim({ orgId, projectId, claimId });
  if (claim.status !== 'submitted') {
    throw new ServiceError('ALREADY_RESOLVED', `This claim is already ${claim.status}`, 409);
  }
  const status = accept ? 'approved' : 'declined';
  await pool.query(
    'UPDATE progress_claims SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ? AND org_id = ?',
    [status, actor.userId, claimId, orgId]
  );
  if (accept) await recomputeStageClaimed({ orgId, projectId, stageId: claim.stage_id });
  return { id: claimId, status };
}

/**
 * POST /projects/:id/progress-claims/:claimId/pay (claims.approve) — records the payment.
 * Idempotent: paying twice is refused. TPAR-reportable (project_payments default).
 */
async function pay({ orgId, projectId, claimId, actor, reference }) {
  if (!access.hasPermission(actor.role, 'claims.approve')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.approve', 403);
  }
  const claim = await loadClaim({ orgId, projectId, claimId });
  if (claim.status === 'paid') throw new ServiceError('ALREADY_PAID', 'This claim is already paid', 409);
  if (claim.status !== 'approved') throw new ServiceError('NOT_APPROVED', 'This claim is not approved yet', 409);

  const paymentId = uuidv4();
  await pool.query(
    `INSERT INTO project_payments
       (id, org_id, project_id, payee_user_id, amount, purpose, reference, recorded_by)
     VALUES (?, ?, ?, ?, ?, 'progress_claim', ?, ?)`,
    [paymentId, orgId, projectId, claim.submitted_by, claim.amount,
     reference || `claim #${claim.claim_number}`, actor.userId]
  );
  await pool.query(
    'UPDATE progress_claims SET status = \'paid\', payment_id = ? WHERE id = ? AND org_id = ?',
    [paymentId, claimId, orgId]
  );
  await recomputeStageClaimed({ orgId, projectId, stageId: claim.stage_id });

  // xprojman-42 §3 auto-posting: real cash out — debit Subcontractor Labour, credit
  // Cash & Bank. Fire-and-forget, same posture as AttestationService.emit elsewhere —
  // a posting failure must never block the payment that actually happened.
  Promise.all([
    OrgFinanceService.accountByCode({ orgId, code: '5020' }),
    OrgFinanceService.accountByCode({ orgId, code: '1000' }),
  ])
    .then(([debitAccountId, creditAccountId]) => OrgFinanceService.postEntry({
      orgId, projectId, debitAccountId, creditAccountId, amount: Number(claim.amount),
      refType: 'progress_claim', refId: claimId, memo: `Progress claim #${claim.claim_number}`,
    }))
    .catch((err) => console.warn('[ORG_JOURNAL] progress_claim pay posting failed (non-fatal):', err.message));

  return { id: claimId, status: 'paid', payment_id: paymentId };
}

/** GET /projects/:id/progress-claims — PM/money.read sees all; a submitter sees own. */
async function list({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (canRead(actor.role)) {
    const [rows] = await pool.query(
      'SELECT * FROM progress_claims WHERE project_id = ? AND org_id = ? AND is_deleted = 0 ORDER BY claim_number DESC',
      [projectId, orgId]
    );
    return { claims: rows };
  }
  if (access.hasPermission(actor.role, 'claims.submit')) {
    const [rows] = await pool.query(
      `SELECT * FROM progress_claims WHERE project_id = ? AND org_id = ? AND is_deleted = 0
         AND submitted_by = ? ORDER BY claim_number DESC`,
      [projectId, orgId, actor.userId]
    );
    return { claims: rows };
  }
  throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or claims.submit', 403);
}

module.exports = { submit, approve, pay, list, recomputeStageClaimed };
