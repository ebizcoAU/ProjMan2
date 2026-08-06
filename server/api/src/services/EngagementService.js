// EngagementService — PM2-02's cross-org bridge (serverdesignspec §13, architecture
// approved 2026-07-22 in projman-02.md). Grants an EXISTING home-org `users.id` a
// scoped slice of a DIFFERENT org's project, without ever creating a second `users`
// row for that person — `users.email` is globally unique and `users.org_id` is
// NOT NULL, so a second-org account for the same person is impossible by
// construction. This is `job_awards`' cross-org sibling: same QR-handshake shape as
// `IntroductionService` (stateless signed code, no row until someone scans it), but
// where Introduction/Job Award deliberately stay same-org, this is the one place
// that boundary is meant to be crossed (xprojman-18 Q2).
//
// Two-step handshake, same shape as Job Award's sent->accepted, not Introduction's
// one-shot swap: `request()` (the scan) creates a `pending` row; `confirm()` (the
// engaging-org principal) is the separate act that makes it `active`. A pending
// request is not yet a grant — nothing is served off it until confirmed.

const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');
const { issueSession } = require('../lib/tokens');

const ROLE = ['builder', 'tradie', 'foreperson', 'subcontractor', 'inspector'];
const CODE_TTL_SECONDS = 300; // same reasoning as IntroductionService — a QR is a face-to-face primitive

function requirePanelManage(role) {
  if (!access.hasPermission(role, 'panel.manage')) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: panel.manage', 403);
  }
}

/**
 * POST /engagements/initiate — the engaging org's principal mints a signed,
 * short-lived QR code (no row yet — identical reasoning to IntroductionService: the
 * server doesn't know WHO will scan it). Payload shape per projman-02 §5:
 * {v,org,project,id,nonce,role,expires} — `id` here is the nonce itself (there is no
 * DB row to reference yet, so the historical field name is repurposed as the code's
 * own identifier for idempotency/logging, not a foreign key).
 */
async function initiate({ orgId, projectId, actor, role, scopeJson }) {
  requirePanelManage(actor.role);
  if (!ROLE.includes(role)) {
    throw new ServiceError('VALIDATION_ERROR', `role must be one of ${ROLE.join(', ')}`, 400);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });

  const nonce = uuidv4();
  const code = jwt.sign(
    {
      typ: 'engagement', v: 1,
      org: orgId, project: projectId, id: nonce,
      role, scope_json: scopeJson || { project_id: projectId },
      initiated_by: actor.userId,
    },
    config.jwt.secret,
    { expiresIn: CODE_TTL_SECONDS }
  );
  return { code, expires_in: CODE_TTL_SECONDS };
}

/**
 * POST /engagements/request — the scanning party (an existing users.id in ANY org,
 * that's the whole point) posts the code they read off the engaging org's QR. Verifies
 * signature+TTL+type, then creates the `pending` row. Rejects a role mismatch — one
 * identity holds one fixed role (xprojman-08), so a code offering `tradie` is only
 * meaningful to someone who actually IS a tradie.
 */
async function request({ actorUserId, code }) {
  let payload;
  try {
    payload = jwt.verify(String(code || '').trim(), config.jwt.secret);
  } catch {
    throw new ServiceError('INVALID_CODE', 'This engagement code is invalid or has expired', 400);
  }
  if (payload.typ !== 'engagement' || !payload.org || !payload.project) {
    throw new ServiceError('INVALID_CODE', 'This is not an engagement code', 400);
  }

  const [[actorUser]] = await pool.query(
    `SELECT id, role, org_id FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [actorUserId]
  );
  if (!actorUser) throw new ServiceError('NOT_FOUND', 'User not found', 404);
  if (actorUser.role !== payload.role) {
    throw new ServiceError('ROLE_MISMATCH',
      `This engagement was offered to a ${payload.role}; your account is a ${actorUser.role}`, 409);
  }
  // Self-engagement makes no sense (the engaging org's own principal scanning their
  // own code) — same guard shape as JobAwardService's SELF_AWARD.
  if (String(payload.initiated_by) === String(actorUserId)) {
    throw new ServiceError('SELF_ENGAGEMENT', 'Cannot engage yourself', 400);
  }
  // This mechanism exists to cross the org boundary (§13.0) — a same-org grant has
  // `project_members`/Job Award for exactly that already, and letting one through
  // here would mean `revoke()`'s session-teardown below (scoped to `identity_user_id`
  // + this `org_id`) could revoke the person's HOME-org sessions instead of an
  // engagement-only one, since the two would be indistinguishable.
  if (String(actorUser.org_id) === String(payload.org)) {
    throw new ServiceError('SAME_ORG', 'Engagements are for cross-organisation grants — use Job Award for within your own organisation', 400);
  }

  const [[existing]] = await pool.query(
    `SELECT id, status FROM engagements WHERE org_id = ? AND project_id = ? AND identity_user_id = ? LIMIT 1`,
    [payload.org, payload.project, actorUserId]
  );
  if (existing) {
    return { id: existing.id, status: existing.status, alreadyRequested: true };
  }

  const id = uuidv4();
  await pool.query(
    `INSERT INTO engagements
       (id, org_id, project_id, identity_user_id, role, scope_json, status, initiated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, payload.org, payload.project, actorUserId, payload.role,
     JSON.stringify(payload.scope_json || { project_id: payload.project }), payload.initiated_by]
  );
  return { id, status: 'pending', alreadyRequested: false };
}

/** GET /engagements/pending — the engaging org's principal, inbound requests awaiting confirm. */
async function pending({ orgId, actor }) {
  requirePanelManage(actor.role);
  const [rows] = await pool.query(
    `SELECT e.id, e.project_id, p.name AS project_name, e.identity_user_id,
            u.full_name AS identity_name, e.role, e.scope_json, e.created_at
       FROM engagements e
       LEFT JOIN projects p ON p.id = e.project_id AND p.org_id = e.org_id
       LEFT JOIN users    u ON u.id = e.identity_user_id
      WHERE e.org_id = ? AND e.status = 'pending' AND e.is_deleted = 0
      ORDER BY e.created_at DESC`,
    [orgId]
  );
  return { pending: rows };
}

/**
 * POST /engagements/:id/confirm — the engaging org's principal activates the grant.
 * `scopeJson`, if passed, narrows what was requested (e.g. a stage-range restriction)
 * — it can only narrow, never widen beyond what the code originally offered, since
 * widening here would let the confirming principal grant more than the QR promised.
 */
async function confirm({ orgId, engagementId, actor, scopeJson }) {
  requirePanelManage(actor.role);
  const [[eng]] = await pool.query(
    `SELECT * FROM engagements WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [engagementId, orgId]
  );
  if (!eng) throw new ServiceError('NOT_FOUND', 'Engagement not found', 404);
  if (eng.status !== 'pending') {
    throw new ServiceError('ALREADY_RESOLVED', `This engagement is already ${eng.status}`, 409);
  }
  await ProjectService.assertProjectReachable(orgId, eng.project_id, { role: actor.role, userId: actor.userId });

  await pool.query(
    `UPDATE engagements SET status = 'active', granted_at = NOW(), scope_json = COALESCE(?, scope_json)
      WHERE id = ?`,
    [scopeJson ? JSON.stringify(scopeJson) : null, engagementId]
  );
  return { id: engagementId, status: 'active' };
}

/**
 * POST /engagements/:id/activate — the engaged person, self. Mints a SECOND,
 * short-lived token scoped to the engaging org, alongside (not replacing) whatever
 * session they already hold. Device-agnostic here (no `upsertDevice` call, no
 * pairing) — it is the SAME physical device gaining a second token, not a new one
 * registering (§13.2).
 */
async function activate({ engagementId, actor, device = {}, ip, userAgent }) {
  const [[eng]] = await pool.query(
    `SELECT * FROM engagements WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [engagementId]
  );
  if (!eng) throw new ServiceError('NOT_FOUND', 'Engagement not found', 404);
  if (String(eng.identity_user_id) !== String(actor.userId)) {
    throw new ServiceError('FORBIDDEN', 'Only the engaged person may activate this engagement', 403);
  }
  if (eng.status !== 'active') {
    throw new ServiceError('NOT_ACTIVE', 'This engagement is not active (pending or already revoked)', 409);
  }

  const [[user]] = await pool.query(
    `SELECT id, org_id, role, security_version FROM users WHERE id = ? LIMIT 1`,
    [actor.userId]
  );
  const session = await issueSession({
    user,
    device,
    ip,
    userAgent,
    role: eng.role,
    orgId: eng.org_id,               // the ENGAGING org, not the person's home org
    engagementId: eng.id,
    scopeJson: eng.scope_json,
    // decision #27: engagement tokens are short-lived, same TTL as a normal session
    // (config.jwt.expiresIn/refreshExpiresIn) — no separate expiry knob, deliberately;
    // a longer-lived grant would keep serving a stale scope_json between revocation
    // checks longer than necessary.
    grantAuthority: true,            // scoped by (user_id, org_id) — decision #29, does not
  });                                 // contest the person's home-org session's authority
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    engagement_id: eng.id,
    org_id: eng.org_id,
    role: eng.role,
    scope_json: eng.scope_json,
  };
}

/**
 * POST /engagements/:id/revoke — server-driven tombstone (projman-02 §10.4). Scope
 * resolution stops serving immediately (the row itself is the check — SyncService
 * reads `status='active'`), and every live session minted under this engagement is
 * invalidated outright. The person's own locally-authored evidence still flows to
 * their identity store (attestations are keyed to `subject_user_id`, not torn down
 * here) — only the engaging org's scoped project data stops being served.
 */
async function revoke({ orgId, engagementId, actor }) {
  requirePanelManage(actor.role);
  const [[eng]] = await pool.query(
    `SELECT * FROM engagements WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [engagementId, orgId]
  );
  if (!eng) throw new ServiceError('NOT_FOUND', 'Engagement not found', 404);
  if (eng.status === 'revoked') {
    return { id: engagementId, status: 'revoked', alreadyRevoked: true };
  }

  await pool.query(`UPDATE engagements SET status = 'revoked', revoked_at = NOW() WHERE id = ?`, [engagementId]);
  // Kill every session this engagement ever minted — identified by the engagement_id
  // claim embedded at issue time (§13.2). Sessions carry no engagement_id COLUMN
  // (only the JWT does), so this revokes by the one server-side fact that IS
  // queryable: any session in that (user_id, org_id) authority slot for this person,
  // in the engaging org, is this engagement's — nothing else could have put a
  // foreign-org session there for a person whose home org is elsewhere.
  await pool.query(
    `UPDATE sessions SET revoked_at = NOW()
      WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL`,
    [eng.identity_user_id, orgId]
  );
  return { id: engagementId, status: 'revoked', alreadyRevoked: false };
}

module.exports = { initiate, request, pending, confirm, activate, revoke };
