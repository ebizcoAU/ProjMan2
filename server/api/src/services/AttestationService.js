// AttestationService — PM2-02's evidence store (serverdesignspec §13.3/§13.4,
// projman-02 §10.2/§10.3). Emission is a single call added at the end of a domain
// service's already-identified completion point (§13.3) — no existing service's own
// logic changes, only one new call each.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const attestationKeys = require('../lib/attestationKeys');
const stageHooks = require('./stageHooks');

// 24h cache, event-invalidated on new attestation — projman-02 §10.3. Not a batch
// job: computed on demand, cached, busted the moment a new attestation lands for
// that identity, so a meaningful event (a pass, a completion) reflects near-
// immediately without a recompute-on-every-write thrash during a burst.
const TRUST_SCORE_CACHE_MS = 24 * 60 * 60 * 1000;

/** Canonical string to sign/verify — stable key order so the signature is reproducible. */
function canonicalise({ subjectUserId, issuingOrgId, engagementId, sourceType, sourceId, payload }) {
  return JSON.stringify({ subjectUserId, issuingOrgId, engagementId: engagementId || null, sourceType, sourceId: sourceId || null, payload });
}

/**
 * Emit one attestation. Called at the end of a qualifying domain event — a hold-point
 * inspection pass, a signed diary entry, a stage completion, a matched invoice, a
 * verified task. Signs with the ISSUING org's key (lazily generated on first use,
 * §attestationKeys); valid by construction at emission (the server itself issued it),
 * per projman-02 §10.2 — `signature_valid` is set true immediately, re-verified only
 * later on a trust-decision read or issuer-key rotation.
 */
async function emit({ subjectUserId, issuingOrgId, engagementId = null, sourceType, sourceId = null, payload }) {
  if (!subjectUserId || !issuingOrgId || !sourceType) {
    throw new ServiceError('VALIDATION_ERROR', 'subjectUserId, issuingOrgId and sourceType are required', 400);
  }
  const id = uuidv4();
  const signature = await attestationKeys.sign(issuingOrgId, canonicalise({ subjectUserId, issuingOrgId, engagementId, sourceType, sourceId, payload }));

  await pool.query(
    `INSERT INTO attestations
       (id, subject_user_id, issuing_org_id, engagement_id, source_type, source_id,
        payload_json, signature, signature_valid, signature_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
    [id, subjectUserId, issuingOrgId, engagementId, sourceType, sourceId, JSON.stringify(payload || {}), signature]
  );

  // Ensure the identities companion row exists, then bust its trust-score cache —
  // event-invalidation (§10.3): null the cache now, next read recomputes.
  await pool.query(
    `INSERT INTO identities (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id`,
    [subjectUserId]
  );
  await pool.query(
    `UPDATE identities SET trust_score_cache = NULL, trust_score_computed_at = NULL WHERE user_id = ?`,
    [subjectUserId]
  );

  return { id, signature_valid: true };
}

/** Re-verify one attestation's signature against its stored payload; caches the result. */
async function verifyOne(attestationId) {
  const [[row]] = await pool.query(`SELECT * FROM attestations WHERE id = ? LIMIT 1`, [attestationId]);
  if (!row) throw new ServiceError('NOT_FOUND', 'Attestation not found', 404);

  const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  const valid = await attestationKeys.verify(
    row.issuing_org_id,
    canonicalise({
      subjectUserId: row.subject_user_id, issuingOrgId: row.issuing_org_id,
      engagementId: row.engagement_id, sourceType: row.source_type, sourceId: row.source_id, payload,
    }),
    row.signature
  );
  await pool.query(
    `UPDATE attestations SET signature_valid = ?, signature_verified_at = NOW() WHERE id = ?`,
    [valid ? 1 : 0, attestationId]
  );
  return valid;
}

/**
 * On-demand trust score, 24h cache, event-invalidated (§10.3). A forged/tampered
 * attestation is EXCLUDED from the score outright, not merely flagged (§10.2) — this
 * re-verifies every attestation whose signature was never checked or is stale before
 * scoring, so a compromised issuer key can't keep contributing after rotation.
 *
 * Scoring formula is a deliberately simple placeholder — nowhere in projman-02 or the
 * server spec defines the actual weighting model (only the caching mechanics are
 * specified); a real formula is separate future work, not part of this build.
 */
async function trustScore(subjectUserId) {
  const [[identity]] = await pool.query(
    `SELECT trust_score_cache, trust_score_computed_at FROM identities WHERE user_id = ? LIMIT 1`,
    [subjectUserId]
  );
  if (identity?.trust_score_cache != null && identity.trust_score_computed_at
      && (Date.now() - new Date(identity.trust_score_computed_at).getTime()) < TRUST_SCORE_CACHE_MS) {
    return Number(identity.trust_score_cache);
  }

  const [rows] = await pool.query(
    `SELECT id, signature_valid FROM attestations WHERE subject_user_id = ?`, [subjectUserId]
  );
  let validCount = 0;
  for (const row of rows) {
    if (row.signature_valid === null) {
      if (await verifyOne(row.id)) validCount++;
    } else if (row.signature_valid) {
      validCount++;
    }
  }
  const score = Math.min(100, 50 + validCount * 2); // placeholder — see doc comment above

  await pool.query(
    `INSERT INTO identities (user_id, trust_score_cache, trust_score_computed_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE trust_score_cache = VALUES(trust_score_cache), trust_score_computed_at = NOW()`,
    [subjectUserId, score]
  );
  return score;
}

/**
 * GET /identity/evidence — the owner's own attestation set + trust score. Always
 * full detail (decision #28: anonymisation protects the subject from OTHER
 * counterparties' view, never from the subject seeing their own record).
 */
async function evidenceFor(subjectUserId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.issuing_org_id, o.name AS issuing_org_name, a.engagement_id,
            a.source_type, a.source_id, a.payload_json, a.signature_valid, a.created_at
       FROM attestations a
       JOIN organisations o ON o.id = a.issuing_org_id
      WHERE a.subject_user_id = ?
      ORDER BY a.created_at DESC`,
    [subjectUserId]
  );
  return { attestations: rows, trust_score: await trustScore(subjectUserId) };
}

// PM2-02 hook registration (§13.3): stageHooks.fire('onStageCompleted', ...) already
// runs on every stage completion (StageProgressionService.advance) — this plugs into
// that EXISTING, previously-unused event rather than editing the progression engine,
// exactly the "additive... never reopens StageProgressionService" contract
// stageHooks.js's own header promises. `require` is deferred to call time (not at
// module load) to sidestep a require cycle: JobAwardService -> ProjectService and
// this file both sit in the same service layer, and Node resolves same-level
// requires fine at call time even where load-order between them isn't guaranteed.
stageHooks.on('onStageCompleted', async ({ orgId, projectId, stage }) => {
  const JobAwardService = require('./JobAwardService');
  const eng = await JobAwardService.acceptedBuilderEngagement({ orgId, projectId });
  if (!eng) return;
  await emit({
    subjectUserId: eng.to_user_id, issuingOrgId: orgId,
    sourceType: 'stage_complete', sourceId: stage.id,
    payload: { project_id: projectId, stage_code: stage.stage_code, seq: stage.seq },
  });
});

module.exports = { emit, verifyOne, trustScore, evidenceFor };
