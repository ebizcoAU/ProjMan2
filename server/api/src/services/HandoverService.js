// HandoverService — the S18.13 handover pack and the S18.14 client final sign-off
// (xprojman-51, Server response §6; migration v050).
//
// PACK: every non-deleted document on the project whose kind is a handover kind. The manifest
// is those documents sorted by id; pack_hash = SHA-256 of the lines "<id>:<sha256>" joined by
// "\n". Only the server computes it. handover_packs keeps one row per project, recomputed
// whenever a handover-kind document is uploaded or deleted, and pulled by the App so the
// sign-off can be taken offline at the house.
//
// SIGN-OFF: client_signoffs rows are frozen on arrival — the DB refuses every UPDATE/DELETE.
//   * sync (App, method assisted_device): create-only; the guard stamps witnessed_by/frozen_at/
//     counted/manifest into the INSERT itself (the trigger would refuse a later UPDATE).
//   * REST (Portal): paper_upload (verified by the short hash the PM types) or client_self
//     (handover.signoff — granted to no role until xprojman-50 pairing).
//   * a row whose pack_hash isn't the current pack is STORED with counted = 0 (it's evidence of
//     what the client signed) and answered PACK_CHANGED, so the device asks for a new signature.
//
// REQUIREMENT: Stage 18's S18.14 hold_point_requirements row (auto_source 'client_signoff') is
// satisfied by the server when the latest counted sign-off is `accepted` on the current pack,
// and re-opened if the pack changes afterwards (until the stage is complete). Stage completion
// then runs through the existing allBlockingSatisfied gate — no new completion path.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { toWallClock, nowWallClock } = require('../lib/datetime');
const ProjectService = require('./ProjectService');

const HANDOVER_KINDS = ['occupation_certificate', 'ba3', 'manual', 'warranty', 'as_built', 'certificate'];
const STEP_CODE = 'S18.14';
const SYNC_TABLES = new Set(['client_signoffs']);

const isHandoverOps = (wireName) => SYNC_TABLES.has(wireName);

// ── Pack ─────────────────────────────────────────────────────────────────────────

/** Compute the current pack from the documents table (no write). */
async function computePack(orgId, projectId) {
  const [docs] = await pool.query(
    `SELECT id AS document_id, kind, original_filename AS file_name, sha256 FROM documents
      WHERE org_id = ? AND project_id = ? AND is_deleted = 0
        AND kind IN (${HANDOVER_KINDS.map(() => '?').join(',')})
      ORDER BY id`,
    [orgId, projectId, ...HANDOVER_KINDS]
  );
  const canonical = docs.map((d) => `${d.document_id}:${d.sha256}`).join('\n');
  const packHash = docs.length ? crypto.createHash('sha256').update(canonical).digest('hex') : null;
  return { pack_hash: packHash, manifest: docs, document_count: docs.length };
}

/**
 * Recompute and store the project's pack, then re-evaluate the S18.14 requirement (a changed
 * pack re-opens it). Called after any handover-kind document is uploaded or deleted.
 */
async function refreshPack(orgId, projectId) {
  if (!projectId) return null;
  const pack = await computePack(orgId, projectId);
  await pool.query(
    `INSERT INTO handover_packs (id, org_id, project_id, pack_hash, manifest, document_count, computed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE pack_hash = VALUES(pack_hash), manifest = VALUES(manifest),
       document_count = VALUES(document_count), computed_at = NOW(), updated_at = VALUES(updated_at)`,
    [projectId, orgId, projectId, pack.pack_hash, JSON.stringify(pack.manifest), pack.document_count, Date.now()]
  );
  await evaluateRequirement(orgId, projectId);
  return pack;
}

// ── Requirement ──────────────────────────────────────────────────────────────────

/** Satisfy or re-open Stage 18's S18.14 row from the latest counted sign-off. */
async function evaluateRequirement(orgId, projectId) {
  const [[req]] = await pool.query(
    `SELECT h.id, h.status, ps.status AS stage_status FROM hold_point_requirements h
       JOIN project_stages ps ON ps.id = h.stage_id
      WHERE h.org_id = ? AND h.project_id = ? AND h.auto_source = 'client_signoff' LIMIT 1`,
    [orgId, projectId]
  );
  if (!req || req.stage_status === 'complete') return;
  const { pack_hash: current } = await computePack(orgId, projectId);
  const [[latest]] = await pool.query(
    `SELECT decision, pack_hash, witnessed_by, signer_user_id FROM client_signoffs
      WHERE org_id = ? AND project_id = ? AND step_code = ? AND counted = 1
      ORDER BY frozen_at DESC, server_updated_at DESC LIMIT 1`,
    [orgId, projectId, STEP_CODE]
  );
  const met = !!(current && latest && latest.decision === 'accepted' && latest.pack_hash === current);
  if (met && req.status !== 'satisfied') {
    await pool.query(
      `UPDATE hold_point_requirements SET status = 'satisfied', satisfied_by = ?, satisfied_at = NOW() WHERE id = ?`,
      [latest.witnessed_by || latest.signer_user_id, req.id]);
    await require('./TaskCodeService').autoTick(orgId, projectId, 'client_signoff'); // the S18.14 task (xprojman-56)
  } else if (!met && req.status === 'satisfied') {
    await pool.query(
      `UPDATE hold_point_requirements SET status = 'open', satisfied_by = NULL, satisfied_at = NULL WHERE id = ?`,
      [req.id]);
    await require('./TaskCodeService').autoTick(orgId, projectId, 'client_signoff', { done: false });
  }
}

// ── Sign-off validation (shared by sync and REST) ────────────────────────────────

async function assertOcValidated(orgId, projectId) {
  const [[stage]] = await pool.query(
    `SELECT is_validated FROM project_stages WHERE org_id = ? AND project_id = ? AND seq = 18 AND is_deleted = 0 LIMIT 1`,
    [orgId, projectId]);
  if (!stage || !stage.is_validated) {
    throw new ServiceError('OC_NOT_VALIDATED',
      'The client signs off after the Occupation Certificate (S18.3) is validated', 409);
  }
}

/**
 * Validate a new sign-off and return the server-owned columns to write with it. Throws on any
 * refusal; a pack mismatch is NOT a throw here — the row is kept with counted = 0.
 */
async function prepareSignoff({ orgId, projectId, fields }) {
  await assertOcValidated(orgId, projectId);
  if (!['accepted', 'declined'].includes(fields.decision)) {
    throw new ServiceError('VALIDATION_ERROR', 'decision must be accepted or declined', 400);
  }
  if (fields.decision === 'declined' && !String(fields.decline_reasons || '').trim()) {
    throw new ServiceError('VALIDATION_ERROR', 'decline_reasons is required when the client declines', 400);
  }
  if (!String(fields.signer_name || '').trim()) {
    throw new ServiceError('VALIDATION_ERROR', 'signer_name is required', 400);
  }
  if (fields.step_code && fields.step_code !== STEP_CODE) {
    throw new ServiceError('VALIDATION_ERROR', `step_code must be ${STEP_CODE}`, 400);
  }
  if (fields.signature_document_id) {
    const [[doc]] = await pool.query(
      'SELECT id FROM documents WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [fields.signature_document_id, orgId]);
    if (!doc) {
      throw new ServiceError('SIGNATURE_MISSING',
        'Upload the signature document before the sign-off row', 409);
    }
  }
  const current = await computePack(orgId, projectId);
  if (!current.pack_hash) throw new ServiceError('PACK_EMPTY', 'The handover pack has no documents to sign', 409);
  const signedAt = fields.signed_at ? toWallClock(fields.signed_at, 'signed_at') : nowWallClock();
  return { current, signedAt };
}

// ── Sync (App, assisted_device) ──────────────────────────────────────────────────

/**
 * Before the generic writer. Create-only; everything server-owned is written INTO `safe`
 * because the row can never be updated afterwards. Returns { duplicate: true } for a retried
 * create of a row that already landed, so the push is acknowledged without a second write.
 */
async function guardPush({ wireName, operation, id, safe, actor }) {
  if (!isHandoverOps(wireName)) return null;
  const { orgId, userId, role } = actor;
  const [[existing]] = await pool.query(
    'SELECT id, pack_hash, decision FROM client_signoffs WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  if (existing) {
    if (operation === 'create' && existing.pack_hash === safe.pack_hash && existing.decision === safe.decision) {
      return { duplicate: true };
    }
    throw new ServiceError('SIGNOFF_FROZEN', 'A client sign-off is frozen; take a new one instead', 409);
  }
  if (operation !== 'create') {
    throw new ServiceError('SIGNOFF_FROZEN', 'A client sign-off is frozen; take a new one instead', 409);
  }
  if (!access.hasPermission(role, 'handover.witness')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: handover.witness', 403);
  }
  const { current, signedAt } = await prepareSignoff({ orgId, projectId: safe.project_id, fields: safe });
  const counted = safe.pack_hash === current.pack_hash;
  safe.step_code = STEP_CODE;
  safe.method = 'assisted_device';
  safe.signed_at = signedAt;
  safe.witnessed_by = userId;
  safe.frozen_at = nowWallClock();
  safe.counted = counted ? 1 : 0;
  // A counted row records the server's manifest; a stale one keeps what the device showed.
  safe.manifest = JSON.stringify(counted ? current.manifest : (parseJson(safe.manifest) || []));
  delete safe.signer_user_id;
  return null;
}

/** After the generic writer: re-evaluate the gate, then report a stale pack. */
async function afterPush({ wireName, id, actor }) {
  if (!isHandoverOps(wireName)) return;
  const [[row]] = await pool.query(
    'SELECT project_id, counted FROM client_signoffs WHERE id = ? AND org_id = ? LIMIT 1', [id, actor.orgId]);
  if (!row) return;
  await evaluateRequirement(actor.orgId, row.project_id);
  if (!row.counted) {
    const { pack_hash } = await computePack(actor.orgId, row.project_id);
    throw new ServiceError('PACK_CHANGED',
      'The handover pack changed since it was shown to the client; please take a new sign-off', 409,
      { current_pack_hash: pack_hash });
  }
}

// ── REST (Portal) ────────────────────────────────────────────────────────────────

async function reachable(orgId, projectId, actor) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
}

/** GET /projects/:id/handover-pack */
async function getPack({ orgId, projectId, actor }) {
  await reachable(orgId, projectId, actor);
  const pack = await computePack(orgId, projectId);
  return { ...pack, short: pack.pack_hash ? pack.pack_hash.slice(0, 8) : null };
}

/** GET /projects/:id/client-signoffs — newest first, documents embedded, is_current computed. */
async function listSignoffs({ orgId, projectId, actor }) {
  await reachable(orgId, projectId, actor);
  const [rows] = await pool.query(
    `SELECT s.*, w.full_name AS witnessed_by_name FROM client_signoffs s
       LEFT JOIN users w ON w.id = s.witnessed_by
      WHERE s.org_id = ? AND s.project_id = ? ORDER BY s.frozen_at DESC, s.server_updated_at DESC`,
    [orgId, projectId]);
  const { pack_hash: current } = await computePack(orgId, projectId);
  const docIds = rows.map((r) => r.signature_document_id).filter(Boolean);
  const docs = new Map();
  if (docIds.length) {
    const [d] = await pool.query(
      `SELECT id, kind, original_filename AS file_name, created_at FROM documents
        WHERE org_id = ? AND id IN (${docIds.map(() => '?').join(',')})`, [orgId, ...docIds]);
    for (const x of d) docs.set(x.id, { id: x.id, kind: x.kind, file_name: x.file_name, created_at: x.created_at });
  }
  const latestCountedId = rows.find((r) => r.counted)?.id;
  return {
    client_signoffs: rows.map((r) => ({
      id: r.id, step_code: r.step_code, method: r.method, decision: r.decision,
      decline_reasons: r.decline_reasons, signer_name: r.signer_name, signer_user_id: r.signer_user_id,
      witnessed_by: r.witnessed_by ? { id: r.witnessed_by, name: r.witnessed_by_name } : null,
      pack_hash: r.pack_hash, manifest: parseJson(r.manifest), counted: !!r.counted,
      signed_at: r.signed_at, frozen_at: r.frozen_at, supersedes_id: r.supersedes_id,
      documents: r.signature_document_id && docs.has(r.signature_document_id) ? [docs.get(r.signature_document_id)] : [],
      is_current: !!(r.counted && r.id === latestCountedId && current && r.pack_hash === current),
    })),
    current_pack_hash: current,
  };
}

/**
 * POST /projects/:id/client-signoffs — paper_upload (handover.witness; pack verified by the
 * 8-hex short hash the PM typed from the printed form) or client_self (handover.signoff).
 */
async function createSignoff({ orgId, projectId, actor, body }) {
  await reachable(orgId, projectId, actor);
  const method = body.method;
  if (method === 'paper_upload') {
    if (!access.hasPermission(actor.role, 'handover.witness')) {
      throw new ServiceError('FORBIDDEN', 'Requires permission: handover.witness', 403);
    }
  } else if (method === 'client_self') {
    if (!access.hasPermission(actor.role, 'handover.signoff')) {
      throw new ServiceError('FORBIDDEN', 'Requires permission: handover.signoff', 403);
    }
  } else {
    throw new ServiceError('VALIDATION_ERROR',
      'method must be paper_upload or client_self (assisted sign-offs come from the App)', 400);
  }
  if (method === 'paper_upload' && !body.signature_document_id) {
    throw new ServiceError('VALIDATION_ERROR', 'signature_document_id (the scan) is required for a paper sign-off', 400);
  }
  const id = body.id || uuidv4();
  const [[existing]] = await pool.query('SELECT id FROM client_signoffs WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  if (existing) throw new ServiceError('SIGNOFF_FROZEN', 'A client sign-off is frozen; take a new one instead', 409);

  const { current, signedAt } = await prepareSignoff({ orgId, projectId, fields: body });
  let packHash = body.pack_hash;
  if (method === 'paper_upload') {
    const short = String(body.pack_hash_short || '').toLowerCase();
    if (!/^[0-9a-f]{8}$/.test(short)) {
      throw new ServiceError('VALIDATION_ERROR', 'pack_hash_short must be the 8 hex characters printed on the form', 400);
    }
    if (!current.pack_hash.startsWith(short)) {
      throw new ServiceError('PACK_CHANGED',
        'The printed form is for a different handover pack; print the current form and sign again', 409,
        { current_pack_hash: current.pack_hash });
    }
    packHash = current.pack_hash;
  }
  if (!packHash) throw new ServiceError('VALIDATION_ERROR', 'pack_hash is required', 400);
  const counted = packHash === current.pack_hash;

  await pool.query(
    `INSERT INTO client_signoffs
       (id, org_id, project_id, step_code, method, pack_hash, manifest, decision, decline_reasons,
        signer_user_id, signer_name, witnessed_by, signature_document_id, signed_at, counted, frozen_at,
        supersedes_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, STEP_CODE, method, packHash, JSON.stringify(current.manifest), body.decision,
     body.decline_reasons || null, method === 'client_self' ? actor.userId : null, String(body.signer_name).trim(),
     method === 'client_self' ? null : actor.userId, body.signature_document_id || null, signedAt,
     counted ? 1 : 0, nowWallClock(), body.supersedes_id || null, Date.now()]);
  await evaluateRequirement(orgId, projectId);
  if (!counted) {
    throw new ServiceError('PACK_CHANGED',
      'The handover pack changed since it was shown to the client; please take a new sign-off', 409,
      { current_pack_hash: current.pack_hash });
  }
  const { client_signoffs } = await listSignoffs({ orgId, projectId, actor });
  return { client_signoff: client_signoffs.find((r) => r.id === id) };
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

module.exports = {
  HANDOVER_KINDS, isHandoverOps, computePack, refreshPack, evaluateRequirement,
  guardPush, afterPush, getPack, listSignoffs, createSignoff,
};
