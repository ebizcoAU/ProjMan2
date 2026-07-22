// AuthService — the shared session-issuance logic.
//
// "Log this user in on this device" was duplicated across password login and OAuth
// sign-in: upsert the device, refuse a revoked one, check whether another session
// already holds the single-writer authority, then issue tokens granting authority
// only if nobody else has it. That one paragraph is the single-writer contract
// (ftpos XF-27) at the session layer, and it now lives once, here.
//
// Low-level token minting stays in lib/tokens.js (signAccess/signRefresh/issueSession);
// this service is the policy on top of it. register / recovery / pairing issue
// sessions with simpler, fixed authority rules and will migrate through here per
// module, as the review's "the rest can emerge per module" allows.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const { issueSession, upsertDevice } = require('../lib/tokens');

/**
 * Log `user` in on `device`, honouring the single-writer handoff.
 *
 * @returns {Promise<{session, deviceRow, handoffPending:boolean}>}
 *   session      = { accessToken, refreshToken, role, authoritative }
 *   handoffPending = another device already holds authority; this session waits.
 * @throws {ServiceError} DEVICE_REVOKED
 */
async function startSession({ user, device, ip, userAgent }) {
  // A paired device carries its own role — a project manager signing in on the shared
  // site tablet gets the tablet's supervisor scope, not their own.
  const deviceRow = await upsertDevice({
    orgId: user.org_id, userId: user.id, device, role: user.role, ip,
  });
  if (deviceRow && deviceRow.status !== 'active') {
    throw new ServiceError('DEVICE_REVOKED', 'This device has been revoked', 403);
  }

  // If another session already holds authority for this user, this one is issued
  // WITHOUT it and must run the handoff. The same device re-logging in (reinstall,
  // token expiry) is not a handoff — it is the same writer coming back — so we
  // exclude the current device_uid.
  const [[holder]] = await pool.query(
    `SELECT id, device_id FROM sessions
      WHERE user_id = ? AND is_authoritative = 1 AND revoked_at IS NULL
        AND expires_at > NOW() AND device_id != ?
      LIMIT 1`,
    [user.id, device.device_uid || 'unknown']
  );

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  const session = await issueSession({
    user, device, ip, userAgent,
    role: deviceRow?.role || user.role,
    grantAuthority: !holder,
  });

  return { session, deviceRow, handoffPending: !!holder };
}

module.exports = { startSession };
