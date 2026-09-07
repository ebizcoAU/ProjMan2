// ContractService — P7c Variations & Contracts (xprojman-10 §4c, serverdesignspec §7.2).
// Contracts (head + sub/supply) carry the retention anchor (retention_pct); variations are
// the PM-raised, Client-approved change workflow. An approved variation adjusts the contract's
// EFFECTIVE value at read time (contract_value + Σ approved variations) — it never writes the
// project_stages cost columns (those stay P7a/P7b's single read model).
//
// DORMANT until P10: `variations.approve` is held only by the `client` role, which has no
// tenant-portal session path yet — so raise works, approve is reachable only once the Client
// portal exists. Buildable and tested up to that boundary. REST-mediated (not sync).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');

const canWriteMoney = (role) => access.hasPermission(role, 'money.write');
const canReadMoney  = (role) => access.hasPermission(role, 'money.read');
const PARTY_TYPES = ['client', 'subcontractor', 'supplier'];

// ── Contracts ────────────────────────────────────────────────────────────────
async function createContract({ orgId, projectId, actor, partyType, partyUserId, partyName,
                                title, contractValue, retentionPct }) {
  if (!canWriteMoney(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!PARTY_TYPES.includes(partyType)) {
    throw new ServiceError('VALIDATION_ERROR', `party_type must be one of ${PARTY_TYPES.join(', ')}`, 400);
  }
  const pct = Number(retentionPct) || 0;
  if (pct < 0 || pct > 100) throw new ServiceError('VALIDATION_ERROR', 'retention_pct must be between 0 and 100', 400);

  const id = uuidv4();
  await pool.query(
    `INSERT INTO contracts
       (id, org_id, project_id, party_type, party_user_id, party_name, title, contract_value,
        retention_pct, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, orgId, projectId, partyType, partyUserId || null, partyName || null, title || null,
     Number(contractValue) || 0, pct, actor.userId]
  );
  return { id, party_type: partyType, status: 'active' };
}

/** Effective value = base contract_value + Σ approved variations against that contract. */
async function listContracts({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canReadMoney(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  const [rows] = await pool.query(
    `SELECT c.*,
            (c.contract_value + COALESCE((
               SELECT SUM(v.amount) FROM variations v
                WHERE v.contract_id = c.id AND v.org_id = c.org_id
                  AND v.is_deleted = 0 AND v.status = 'approved'), 0)) AS effective_value
       FROM contracts c
      WHERE c.project_id = ? AND c.org_id = ? AND c.is_deleted = 0
      ORDER BY c.created_at`,
    [projectId, orgId]
  );
  return { contracts: rows };
}

/** The retention_pct anchoring the Builder's progress claims (the subcontractor head
 *  contract), for the deferred withholding/release flow. 0 when no such contract exists. */
async function builderRetentionPct({ orgId, projectId }) {
  const [[row]] = await pool.query(
    `SELECT retention_pct FROM contracts
      WHERE project_id = ? AND org_id = ? AND party_type = 'subcontractor'
        AND is_deleted = 0 AND status IN ('active','completed')
      ORDER BY created_at DESC LIMIT 1`,
    [projectId, orgId]
  );
  return row ? Number(row.retention_pct) : 0;
}

// ── Variations ───────────────────────────────────────────────────────────────
/** POST /projects/:id/variations — PM raises a change (variations.raise). */
async function raiseVariation({ orgId, projectId, actor, contractId, description, amount }) {
  if (!access.hasPermission(actor.role, 'variations.raise')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: variations.raise', 403);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!description || !String(description).trim()) {
    throw new ServiceError('VALIDATION_ERROR', 'description is required', 400);
  }
  if (contractId) {
    const [[c]] = await pool.query(
      'SELECT id FROM contracts WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [contractId, projectId, orgId]);
    if (!c) throw new ServiceError('VALIDATION_ERROR', 'contract_id not found on this project', 422);
  }
  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(variation_number), 0) + 1 AS next FROM variations WHERE project_id = ? AND org_id = ?',
    [projectId, orgId]);
  const id = uuidv4();
  await pool.query(
    `INSERT INTO variations
       (id, org_id, project_id, contract_id, variation_number, description, amount, status, raised_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
    [id, orgId, projectId, contractId || null, next, String(description).trim(), Number(amount) || 0, actor.userId]
  );
  return { id, variation_number: next, status: 'submitted' };
}

/**
 * POST /projects/:id/variations/:vid/approve — Client approves/declines (variations.approve).
 * DORMANT until P10: only the `client` role holds variations.approve and no client can reach
 * the tenant portal yet, so in v1 this path is unreachable in practice — the gate is live for
 * when the Client portal ships. A PM (no variations.approve) is correctly refused here.
 */
async function respondVariation({ orgId, projectId, variationId, actor, accept }) {
  if (!access.hasPermission(actor.role, 'variations.approve')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: variations.approve (Client — P10)', 403);
  }
  const [[v]] = await pool.query(
    'SELECT * FROM variations WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [variationId, projectId, orgId]);
  if (!v) throw new ServiceError('NOT_FOUND', 'Variation not found', 404);
  if (v.status !== 'submitted') throw new ServiceError('ALREADY_RESOLVED', `This variation is already ${v.status}`, 409);

  const status = accept ? 'approved' : 'declined';
  await pool.query(
    'UPDATE variations SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ? AND org_id = ?',
    [status, actor.userId, variationId, orgId]);

  // xprojman-41 §3/§9: an approved variation is a fresh point-in-time
  // confirmation between both parties — auto-generate the dated Project
  // Brief snapshot the owner's own workflow calls for, no separate action
  // needed. Best-effort: a PDF failure must never fail an approval that
  // already committed (same posture as AttestationService.emit elsewhere).
  if (status === 'approved') {
    const ProjectBriefService = require('./ProjectBriefService');
    ProjectBriefService.generateFromVariationApproval({ orgId, projectId, actor, variationId })
      .catch((err) => console.warn('[PROJECT_BRIEF] snapshot generation failed (non-fatal):', err.message));
  }

  return { id: variationId, status };
}

async function listVariations({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canReadMoney(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  const [rows] = await pool.query(
    `SELECT * FROM variations WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY variation_number DESC`, [projectId, orgId]);
  return { variations: rows };
}

module.exports = {
  createContract, listContracts, builderRetentionPct,
  raiseVariation, respondVariation, listVariations,
};
