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
//
// xprojman-43 R3 (v054) adds three opt-ins to a claim:
//   * SOP       sop_state (NSW|QLD|ACT) makes it a Security of Payment claim: the template's fields
//               are required (SOP_TEMPLATE_INCOMPLETE), its statement is rendered on, and the
//               schedule/payment due dates are computed and returned with SOP_PERIOD_UNVERIFIED.
//               The respondent answers with a payment schedule (scheduled_amount + reason).
//   * RCTI      rcti_issued, only while a current agreement with the claimant exists.
//   * retention contract_id + retention_withheld (default amount × retention_pct); the payment
//               recorded is amount − retention, released later via RetentionService.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');
const stageHooks = require('./stageHooks');
const OrgFinanceService = require('./OrgFinanceService');
const SopService = require('./SopService');
const RctiService = require('./RctiService');
const RetentionService = require('./RetentionService');
const { nowWallClock } = require('../lib/datetime');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Contract + retention for a claim: explicit retention wins, else the contract's percentage. */
async function resolveRetention({ orgId, projectId, contractId, retention, amount }) {
  const contract = contractId ? await RetentionService.loadContract(orgId, projectId, contractId, 'payee') : null;
  const value = retention !== undefined && retention !== null
    ? retention
    : (contract ? round2((Number(amount) * contract.retention_pct) / 100) : 0);
  return { contractId: contract ? contract.id : null, retention: RetentionService.checkRetention({ retention: value, amount, contract }) };
}

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
async function submit({ orgId, projectId, actor, stageId, amount, note, sop = {}, contractId, retentionWithheld }) {
  if (!access.hasPermission(actor.role, 'claims.submit')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.submit', 403);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!(Number(amount) > 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a positive number', 400);
  if (stageId) await stageHooks.assertClaimAllowed(pool, { orgId, stageId }); // §10.6 freeze

  const { contractId: cId, retention } = await resolveRetention({
    orgId, projectId, contractId, retention: retentionWithheld, amount });

  // Opt-in SOP: the claim is served now, so the due dates run from now.
  let sopCols = {};
  let warnings = [];
  if (sop.sop_state) {
    if (sop.reference_date && !DATE.test(String(sop.reference_date))) {
      throw new ServiceError('VALIDATION_ERROR', 'reference_date must be a date (YYYY-MM-DD)', 400);
    }
    await SopService.assertDocumentInOrg(orgId, sop.supporting_statement_document_id);
    const [[proj]] = await pool.query(
      `SELECT COALESCE(p.site_state, o.state) AS site_state FROM projects p JOIN organisations o ON o.id = p.org_id
        WHERE p.id = ? AND p.org_id = ?`, [projectId, orgId]);
    const prepared = await SopService.prepare({
      state: sop.sop_state, servedAt: nowWallClock(), siteState: proj?.site_state,
      claim: { ...sop, amount },
    });
    sopCols = prepared.columns;
    warnings = prepared.warnings;
  }

  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(claim_number), 0) + 1 AS next FROM progress_claims WHERE project_id = ? AND org_id = ?',
    [projectId, orgId]
  );
  const id = uuidv4();
  await pool.query(
    `INSERT INTO progress_claims
       (id, org_id, project_id, stage_id, claim_number, amount, note, submitted_by,
        work_description, sop_state, reference_date, supporting_statement_document_id,
        sop_statement, schedule_due_at, payment_due_at, contract_id, retention_withheld)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, stageId || null, next, amount, note || null, actor.userId,
     sop.work_description || null, sop.sop_state || null, sop.reference_date || null,
     sop.supporting_statement_document_id || null, sopCols.sop_statement || null,
     sopCols.schedule_due_at || null, sopCols.payment_due_at || null, cId, retention]
  );
  return {
    data: {
      id, claim_number: next, status: 'submitted', sop_state: sop.sop_state || null,
      sop_statement: sopCols.sop_statement || null, schedule_due_at: sopCols.schedule_due_at || null,
      payment_due_at: sopCols.payment_due_at || null, contract_id: cId, retention_withheld: retention,
    },
    warnings,
  };
}

/** POST /projects/:id/progress-claims/:claimId/approve (claims.approve). */
async function approve({ orgId, projectId, claimId, actor, accept = true, contractId, retentionWithheld }) {
  if (!access.hasPermission(actor.role, 'claims.approve')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.approve', 403);
  }
  const claim = await loadClaim({ orgId, projectId, claimId });
  if (claim.status !== 'submitted') {
    throw new ServiceError('ALREADY_RESOLVED', `This claim is already ${claim.status}`, 409);
  }
  const status = accept ? 'approved' : 'declined';
  // The approver may set or correct what is held back (R3 retention) as part of approving.
  let { contract_id: cId, retention_withheld: retention } = claim;
  if (accept && (contractId !== undefined || retentionWithheld !== undefined)) {
    ({ contractId: cId, retention } = await resolveRetention({
      orgId, projectId, contractId: contractId !== undefined ? contractId : claim.contract_id,
      retention: retentionWithheld, amount: claim.amount }));
  }
  await pool.query(
    `UPDATE progress_claims SET status = ?, approved_by = ?, approved_at = NOW(), contract_id = ?, retention_withheld = ?
      WHERE id = ? AND org_id = ?`,
    [status, actor.userId, cId, retention, claimId, orgId]
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

  // Retention (R3) is held back now and paid on release (RetentionService.release).
  const net = round2(Number(claim.amount) - Number(claim.retention_withheld || 0));
  const paymentId = uuidv4();
  await pool.query(
    `INSERT INTO project_payments
       (id, org_id, project_id, payee_user_id, amount, purpose, reference, recorded_by)
     VALUES (?, ?, ?, ?, ?, 'progress_claim', ?, ?)`,
    [paymentId, orgId, projectId, claim.submitted_by, net,
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
      orgId, projectId, debitAccountId, creditAccountId, amount: net,
      refType: 'progress_claim', refId: claimId, memo: `Progress claim #${claim.claim_number}`,
    }))
    .catch((err) => console.warn('[ORG_JOURNAL] progress_claim pay posting failed (non-fatal):', err.message));

  return { id: claimId, status: 'paid', payment_id: paymentId, paid_amount: net,
    retention_withheld: Number(claim.retention_withheld || 0) };
}

/**
 * POST /projects/:id/progress-claims/:claimId/schedule { scheduled_amount, schedule_reason }
 * (claims.approve) — the respondent's payment schedule. Paying less than claimed needs the
 * reason (the SOP Acts require reasons for withholding). Late against an unverified period only warns.
 */
async function schedule({ orgId, projectId, claimId, actor, scheduledAmount, reason }) {
  if (!access.hasPermission(actor.role, 'claims.approve')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.approve', 403);
  }
  const claim = await loadClaim({ orgId, projectId, claimId });
  if (!['submitted', 'approved'].includes(claim.status)) {
    throw new ServiceError('ALREADY_RESOLVED', `This claim is already ${claim.status}`, 409);
  }
  const amt = round2(scheduledAmount);
  if (!Number.isFinite(amt) || amt < 0) throw new ServiceError('VALIDATION_ERROR', 'scheduled_amount must be 0 or more', 400);
  if (amt > Number(claim.amount) + 0.005) throw new ServiceError('VALIDATION_ERROR', 'scheduled_amount is more than the claim', 400);
  const why = String(reason || '').trim();
  if (amt < Number(claim.amount) - 0.005 && !why) {
    throw new ServiceError('SCHEDULE_REASON_REQUIRED', 'Give the reason for scheduling less than the claimed amount', 400);
  }
  const at = nowWallClock();
  await pool.query(
    `UPDATE progress_claims SET scheduled_amount = ?, schedule_reason = ?, scheduled_at = ?, scheduled_by = ?
      WHERE id = ? AND org_id = ?`, [amt, why || null, at, actor.userId, claimId, orgId]);
  const warnings = claim.schedule_due_at && at > String(claim.schedule_due_at) ? [{
    code: 'SOP_SCHEDULE_LATE',
    message: 'This schedule is after the estimated due date. The due periods are unverified, so check with your adviser.',
  }] : [];
  return { data: { id: claimId, scheduled_amount: amt, schedule_reason: why || null, scheduled_at: at }, warnings };
}

/** POST /projects/:id/progress-claims/:claimId/rcti { issued } (claims.approve). */
async function setRcti({ orgId, projectId, claimId, actor, issued }) {
  if (!access.hasPermission(actor.role, 'claims.approve')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: claims.approve', 403);
  }
  const claim = await loadClaim({ orgId, projectId, claimId });
  if (claim.status === 'declined') throw new ServiceError('ALREADY_RESOLVED', 'This claim was declined', 409);
  const agreementId = await RctiService.agreementForFlag(orgId, !!issued, { partyUserId: claim.submitted_by });
  await pool.query('UPDATE progress_claims SET rcti_issued = ?, rcti_agreement_id = ? WHERE id = ? AND org_id = ?',
    [issued ? 1 : 0, agreementId, claimId, orgId]);
  return { id: claimId, rcti_issued: !!issued, rcti_agreement_id: agreementId };
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

module.exports = { submit, approve, pay, schedule, setRcti, list, recomputeStageClaimed };
