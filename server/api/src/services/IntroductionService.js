// IntroductionService — the QR business-card swap (DIRECTIVE 1 Step B,
// servdesignspecification.md §7.3). Deliberately low-friction: no job implied, no
// project required, any two already-registered users in the same org, any time —
// "the same primitive as a 'connect' action works elsewhere" (devroadmap.md §3).
// Not gated by `panel.manage` — that permission gates Job Award (the later, formal,
// project-specific step), not this peer-to-peer contact-book entry.
//
// Contract (confirmed with the App Team, xprojman-03/-04 §A) — a two-tap QR swap that
// rides each party's OWN session, no out-of-band PIN (spec v3.4 §1.1's resolution):
//   POST /introductions/code   → the issuer mints a short-lived SIGNED code (a JWT,
//                                 not a stored row — stateless, forgery-resistant) and
//                                 renders it as a QR.
//   POST /introductions/scan   → the other party posts the scanned code; the server
//                                 verifies signature+TTL, extracts the issuer, and
//                                 records the introduction. This is the ONLY create
//                                 path: you cannot introduce yourself to a user whose
//                                 code you did not physically scan — which is exactly
//                                 what gives the `job_awards` cold-stranger constraint
//                                 its teeth (a fabricated introduction would otherwise
//                                 defeat it).
//   GET  /introductions        → the caller's contact book.

const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { ServiceError } = require('./errors');

// A scanned code is only useful in the moment two people are face to face; a short
// life keeps a leaked QR photo from being replayed later.
const CODE_TTL_SECONDS = 300;

/** True if an introduction already exists between these two users (either direction). */
async function exists({ orgId, userAId, userBId }) {
  const [[row]] = await pool.query(
    `SELECT id FROM introductions
      WHERE org_id = ? AND ((party_a_id = ? AND party_b_id = ?) OR (party_a_id = ? AND party_b_id = ?))
      LIMIT 1`,
    [orgId, userAId, userBId, userBId, userAId]
  );
  return !!row;
}

/**
 * POST /introductions/code — the issuer's own session mints a signed, short-lived
 * code carrying its identity. Stateless (a JWT typed `intro`), so there is no row to
 * clean up and nothing to leak at rest; the signature is what a scanner trusts.
 */
function issueCode({ orgId, userId }) {
  const code = jwt.sign(
    { typ: 'intro', sub: userId, org_id: orgId },
    config.jwt.secret,
    { expiresIn: CODE_TTL_SECONDS }
  );
  return { code, expires_in: CODE_TTL_SECONDS };
}

/** Writer for the in-person QR-scan path (same-org only — see `crossOrgEngage` below
 * for VeriTrade's separate, deliberately cross-org path). Idempotent. */
async function record({ orgId, actorUserId, otherUserId, initiatedBy = 'app_qr_scan', deviceSignature }) {
  if (String(actorUserId) === String(otherUserId)) {
    throw new ServiceError('VALIDATION_ERROR', 'Cannot introduce a user to themselves', 400);
  }
  const [[other]] = await pool.query(
    'SELECT id, full_name, role FROM users WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [otherUserId, orgId]
  );
  if (!other) throw new ServiceError('NOT_FOUND', 'User not found', 404);

  const contact = { user_id: other.id, full_name: other.full_name, role: other.role };
  if (await exists({ orgId, userAId: actorUserId, userBId: otherUserId })) {
    return { alreadyIntroduced: true, contact };
  }
  const id = uuidv4();
  await pool.query(
    `INSERT INTO introductions (id, org_id, party_a_id, party_b_id, initiated_by, device_signature)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, orgId, actorUserId, otherUserId, initiatedBy, deviceSignature || null]
  );
  return { id, alreadyIntroduced: false, contact };
}

/**
 * POST /introductions/scan — the scanning party posts the code it read off the
 * issuer's QR. The scanner is `party_a` (they initiated the scan); the code's `sub`
 * is `party_b`. Verifies signature, type, TTL and same-org before recording.
 */
async function scanCode({ orgId, scannerUserId, code, deviceSignature }) {
  let payload;
  try {
    payload = jwt.verify(String(code || '').trim(), config.jwt.secret);
  } catch {
    throw new ServiceError('INVALID_CODE', 'This introduction code is invalid or has expired', 400);
  }
  if (payload.typ !== 'intro' || !payload.sub) {
    throw new ServiceError('INVALID_CODE', 'This is not an introduction code', 400);
  }
  if (String(payload.org_id) !== String(orgId)) {
    // Cross-org introductions are a VeriTrade concern (blocked on PM2-02), not this path.
    throw new ServiceError('INVALID_CODE', 'That code belongs to another organisation', 400);
  }
  return record({
    orgId, actorUserId: scannerUserId, otherUserId: payload.sub,
    initiatedBy: 'app_qr_scan', deviceSignature,
  });
}

/** GET /introductions — the caller's own contact book (the other party of each row). */
async function listContacts({ orgId, userId }) {
  const [rows] = await pool.query(
    `SELECT i.id, i.introduced_at, i.initiated_by,
            u.id AS user_id, u.full_name, u.role
       FROM introductions i
       JOIN users u
         ON u.id = (CASE WHEN i.party_a_id = ? THEN i.party_b_id ELSE i.party_a_id END)
      WHERE i.org_id = ? AND (i.party_a_id = ? OR i.party_b_id = ?)
      ORDER BY i.introduced_at DESC`,
    [userId, orgId, userId, userId]
  );
  return { contacts: rows };
}

/**
 * VeriTrade Engage (veritradedesignspecification.md §7) — the remote equivalent of a
 * QR scan. Deliberately the ONE caller allowed to cross the org boundary here: both
 * parties are already App-authenticated (VeriTrade's own login gate, spec §4), so the
 * identity-proving work a QR scan normally does is already satisfied — this is not a
 * bypass of Introduction, it's the same primitive fed from a profile view instead of
 * an in-person scan. `scanCode` above stays same-org-only on purpose (an in-person
 * handshake presumes colleagues); this is a separate, narrow path, not a relaxation
 * of `record()`. Stored under the ENGAGING (searching) party's own org — that's where
 * any later Job Award on the strength of this contact would be raised from.
 *
 * Existence is checked globally (no org_id filter), unlike `exists()` above — a prior
 * introduction from either direction should not spawn a duplicate.
 */
async function crossOrgExists({ userAId, userBId }) {
  const [[row]] = await pool.query(
    `SELECT id FROM introductions
      WHERE (party_a_id = ? AND party_b_id = ?) OR (party_a_id = ? AND party_b_id = ?)
      LIMIT 1`,
    [userAId, userBId, userBId, userAId]
  );
  return row ? row.id : null;
}

async function crossOrgEngage({ actorOrgId, actorUserId, targetUserId }) {
  if (String(actorUserId) === String(targetUserId)) {
    throw new ServiceError('VALIDATION_ERROR', 'Cannot engage yourself', 400);
  }
  const [[other]] = await pool.query(
    'SELECT id, full_name, role FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
    [targetUserId]
  );
  if (!other) throw new ServiceError('NOT_FOUND', 'User not found', 404);

  const contact = { user_id: other.id, full_name: other.full_name, role: other.role };
  const already = await crossOrgExists({ userAId: actorUserId, userBId: targetUserId });
  if (already) return { id: already, alreadyIntroduced: true, contact };

  const id = uuidv4();
  await pool.query(
    `INSERT INTO introductions (id, org_id, party_a_id, party_b_id, initiated_by)
     VALUES (?, ?, ?, ?, 'veritrade_engage')`,
    [id, actorOrgId, actorUserId, targetUserId]
  );
  return { id, alreadyIntroduced: false, contact };
}

module.exports = { exists, issueCode, scanCode, listContacts, record, crossOrgEngage, crossOrgExists };
