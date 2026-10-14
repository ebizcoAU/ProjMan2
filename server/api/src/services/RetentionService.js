// RetentionService — retention withheld per claim, released in parts (xprojman-43 R3; §14 O5).
//
// contracts.retention_pct (v021) was modelled but never withheld. Now:
//   * withheld  each claim carries contract_id + retention_withheld (ex GST). On a progress claim
//               (Builder → this org) the default is amount × retention_pct; the payment recorded
//               is amount − retention. On a client claim it is set on the draft (residential rarely
//               uses retention, x43 §2.6, so the default there is 0).
//   * held      per contract: withheld on approved/paid progress claims and issued/paid client
//               claims, minus releases.
//   * released  retention_releases, in parts (typically 50% at practical completion, the rest at
//               the end of the defects-liability period). A release can't exceed what is held
//               (RETENTION_EXCEEDS_HELD). Paying a claimant user back writes a project_payments
//               row (TPAR-reportable, like the claim payment it completes).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const ProjectService = require('./ProjectService');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASONS = ['practical_completion', 'dlp_end', 'other'];

/**
 * A contract on this project, on the right side: 'client' for client claims, 'payee' (a
 * subcontractor/supplier contract) for progress claims.
 */
async function loadContract(orgId, projectId, contractId, side) {
  const [[c]] = await pool.query(
    'SELECT * FROM contracts WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [contractId, projectId, orgId]);
  if (!c) throw new ServiceError('NOT_FOUND', 'Contract not found on this project', 404);
  if (side === 'client' && c.party_type !== 'client') {
    throw new ServiceError('VALIDATION_ERROR', 'A client claim needs the client contract', 400);
  }
  if (side === 'payee' && c.party_type === 'client') {
    throw new ServiceError('VALIDATION_ERROR', 'A progress claim needs a subcontractor or supplier contract, not the client contract', 400);
  }
  return { ...c, retention_pct: Number(c.retention_pct) };
}

/** The project's single live client contract, or null (none, or more than one). */
async function soleClientContract(orgId, projectId) {
  const [rows] = await pool.query(
    `SELECT * FROM contracts WHERE project_id = ? AND org_id = ? AND party_type = 'client'
        AND is_deleted = 0 AND status <> 'terminated'`, [projectId, orgId]);
  return rows.length === 1 ? { ...rows[0], retention_pct: Number(rows[0].retention_pct) } : null;
}

/**
 * Validates a retention amount against a claim amount. With no contract the only allowed
 * retention is 0, since a release has to be tied to a contract.
 */
function checkRetention({ retention, amount, contract }) {
  const r = round2(retention);
  if (!Number.isFinite(r) || r < 0) throw new ServiceError('VALIDATION_ERROR', 'retention_withheld must be 0 or more', 400);
  if (r > Number(amount) + 0.005) throw new ServiceError('VALIDATION_ERROR', 'retention_withheld is more than the claim amount', 400);
  if (r > 0 && !contract) {
    throw new ServiceError('CONTRACT_REQUIRED', 'Retention has to be held against a contract: give contract_id', 409);
  }
  return r;
}

async function heldByContract(conn, orgId, projectId) {
  const [rows] = await conn.query(
    `SELECT c.id AS contract_id, c.title, c.party_type, c.party_name, c.party_user_id, c.retention_pct,
            COALESCE((SELECT SUM(pc.retention_withheld) FROM progress_claims pc
                       WHERE pc.contract_id = c.id AND pc.is_deleted = 0 AND pc.status IN ('approved','paid')), 0)
          + COALESCE((SELECT SUM(cc.retention_withheld) FROM client_claims cc
                       WHERE cc.contract_id = c.id AND cc.is_deleted = 0 AND cc.status IN ('issued','paid')), 0) AS withheld,
            COALESCE((SELECT SUM(rr.amount) FROM retention_releases rr WHERE rr.contract_id = c.id), 0) AS released
       FROM contracts c
      WHERE c.project_id = ? AND c.org_id = ? AND c.is_deleted = 0`, [projectId, orgId]);
  return rows.map((r) => ({
    contract_id: r.contract_id, title: r.title, party_type: r.party_type, party_name: r.party_name,
    retention_pct: Number(r.retention_pct), withheld: round2(r.withheld), released: round2(r.released),
    held: round2(Number(r.withheld) - Number(r.released)), party_user_id: r.party_user_id,
  }));
}

/** GET /projects/:id/retention — per contract withheld / released / held, plus the releases. */
async function summary({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const contracts = (await heldByContract(pool, orgId, projectId))
    .filter((c) => c.withheld > 0 || c.retention_pct > 0)
    .map(({ party_user_id, ...c }) => c);
  const [releases] = await pool.query(
    `SELECT rr.id, rr.contract_id, rr.amount, rr.reason, rr.released_at, rr.note, rr.payment_id, rr.created_at,
            u.full_name AS created_by_name, rr.created_by
       FROM retention_releases rr LEFT JOIN users u ON u.id = rr.created_by
      WHERE rr.project_id = ? AND rr.org_id = ? ORDER BY rr.released_at, rr.created_at`, [projectId, orgId]);
  return {
    contracts,
    releases: releases.map((r) => ({
      id: r.id, contract_id: r.contract_id, amount: Number(r.amount), reason: r.reason,
      released_at: String(r.released_at).slice(0, 10), note: r.note, payment_id: r.payment_id,
      created_by: r.created_by ? { id: r.created_by, name: r.created_by_name || null } : null, created_at: r.created_at,
    })),
    totals: {
      withheld: round2(contracts.reduce((s, c) => s + c.withheld, 0)),
      released: round2(contracts.reduce((s, c) => s + c.released, 0)),
      held: round2(contracts.reduce((s, c) => s + c.held, 0)),
    },
  };
}

/** POST /projects/:id/retention-releases { contract_id, amount, reason, released_at?, note? } */
async function release({ orgId, projectId, actor, body }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const amount = round2(body.amount);
  if (!(amount > 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a positive number', 400);
  if (!REASONS.includes(body.reason)) throw new ServiceError('VALIDATION_ERROR', `reason must be one of ${REASONS.join(', ')}`, 400);
  if (body.released_at != null && !DATE.test(String(body.released_at))) {
    throw new ServiceError('VALIDATION_ERROR', 'released_at must be a date (YYYY-MM-DD)', 400);
  }
  if (!body.contract_id) throw new ServiceError('VALIDATION_ERROR', 'contract_id is required', 400);
  const contract = await loadContract(orgId, projectId, body.contract_id, null);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Serialise releases on one contract so two at once can't both pass the held check.
    await conn.query('SELECT id FROM contracts WHERE id = ? FOR UPDATE', [contract.id]);
    const row = (await heldByContract(conn, orgId, projectId)).find((c) => c.contract_id === contract.id);
    if (amount > row.held + 0.005) {
      throw new ServiceError('RETENTION_EXCEEDS_HELD', `Only $${row.held.toFixed(2)} of retention is held on this contract`, 409,
        { held: row.held });
    }
    const releasedAt = body.released_at || new Date().toISOString().slice(0, 10);
    let paymentId = null;
    if (contract.party_type !== 'client' && contract.party_user_id) {
      paymentId = uuidv4();
      await conn.query(
        `INSERT INTO project_payments (id, org_id, project_id, payee_user_id, amount, purpose, reference, paid_at, recorded_by)
         VALUES (?, ?, ?, ?, ?, 'retention_release', ?, ?, ?)`,
        [paymentId, orgId, projectId, contract.party_user_id, amount,
         `retention release (${body.reason})`, `${releasedAt} 00:00:00`, actor.userId]);
    }
    const id = uuidv4();
    await conn.query(
      `INSERT INTO retention_releases (id, org_id, project_id, contract_id, amount, reason, released_at, note, payment_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orgId, projectId, contract.id, amount, body.reason, releasedAt,
       body.note ? String(body.note).slice(0, 300) : null, paymentId, actor.userId]);
    await conn.commit();
    return { id, contract_id: contract.id, amount, reason: body.reason, released_at: releasedAt, payment_id: paymentId,
      held: round2(row.held - amount) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { loadContract, soleClientContract, checkRetention, summary, release };
