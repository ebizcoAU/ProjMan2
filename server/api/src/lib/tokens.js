// Token minting and session issue.
//
// Ported from Nexus `auth.js` with the variant axis removed (there is no BANOI/MAOI
// split here) and `business_id` replaced by `org_id`.
//
// The access token carries `jti` = the session's refresh_token UUID, so the auth
// middleware can look a live session up and reject one that has been revoked. Nexus
// learned this the hard way: without a jti, revoking a lost device did nothing until
// its access token expired on its own.

const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool   = require('../db/pool');
const config = require('../config');

/**
 * Mint an access token.
 * `role` is the effective role — the DEVICE's role when the session came from a
 * pairing, otherwise the user's own. The two can differ deliberately: a project
 * manager signing in on a shared site tablet gets the tablet's supervisor scope.
 */
function signAccess({ userId, orgId, role, deviceUid, securityVersion, jti }) {
  return jwt.sign(
    {
      sub: userId,
      org_id: orgId,
      role,
      type: 'user',
      device_id: deviceUid || null,
      version: securityVersion,
      ...(jti ? { jti } : {}),
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function signRefresh(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
}

/** Decode without verifying — for reading org/device off a token we already trust. */
function peek(token) {
  try {
    return jwt.decode(String(token || '').replace(/^Bearer\s+/i, '')) || null;
  } catch {
    return null;
  }
}

/**
 * Create a session row and return the token pair.
 *
 * `grantAuthority` implements the single-writer contract (ftpos XF-27): exactly one
 * session per user may push offline work. A new device logging in while another
 * holds authority gets `handoffPending` and waits — see routes/recovery.js.
 */
async function issueSession({
  user,
  device = {},
  ip = null,
  userAgent = null,
  role = null,
  grantAuthority = true,
}) {
  const refreshToken = uuidv4();
  const effectiveRole = role || user.role;

  const accessToken = signAccess({
    userId: user.id,
    orgId: user.org_id,
    role: effectiveRole,
    deviceUid: device.device_uid || null,
    securityVersion: user.security_version,
    jti: refreshToken,
  });

  // Clear any stale authoritative rows before granting. Nexus accumulated these
  // across failed handoff cycles (O-086) until handoff-complete started picking the
  // wrong session and devices ended up permanently non-authoritative.
  if (grantAuthority) {
    await pool.query(
      `UPDATE sessions SET is_authoritative = 0
        WHERE user_id = ? AND is_authoritative = 1`,
      [user.id]
    );
  }

  const sessionId = uuidv4();
  await pool.query(
    `INSERT INTO sessions
       (id, org_id, user_id, device_id, access_token, refresh_token,
        ip_address, user_agent, expires_at, is_authoritative, authority_since)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)`,
    [
      sessionId,
      user.org_id,
      user.id,
      device.device_uid || 'unknown',
      accessToken,
      refreshToken,
      ip,
      userAgent,
      grantAuthority ? 1 : 0,
      grantAuthority ? new Date() : null,
    ]
  );

  return {
    sessionId,
    accessToken,
    refreshToken,
    role: effectiveRole,
    authoritative: grantAuthority,
  };
}

/** Register or refresh the device row for a login. Returns devices.id. */
async function upsertDevice({ orgId, userId, device, role, ip }) {
  if (!device?.device_uid) return null;

  const id = uuidv4();
  await pool.query(
    `INSERT INTO devices
       (id, org_id, user_id, device_uid, device_name, platform, model,
        os_version, app_version, role, status, last_seen_at, last_seen_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), ?)
     ON DUPLICATE KEY UPDATE
       user_id      = COALESCE(VALUES(user_id), user_id),
       device_name  = COALESCE(VALUES(device_name), device_name),
       platform     = COALESCE(VALUES(platform), platform),
       model        = COALESCE(VALUES(model), model),
       os_version   = COALESCE(VALUES(os_version), os_version),
       app_version  = COALESCE(VALUES(app_version), app_version),
       last_seen_at = NOW(),
       last_seen_ip = VALUES(last_seen_ip)`,
    [
      id, orgId, userId || null, device.device_uid,
      device.device_name || null, device.platform || null, device.model || null,
      device.os_version || null, device.app_version || null,
      role, ip || null,
    ]
  );

  const [[row]] = await pool.query(
    `SELECT id, role, status FROM devices WHERE org_id = ? AND device_uid = ? LIMIT 1`,
    [orgId, device.device_uid]
  );
  return row || null;
}

/** Normalise the device fields the app may send in camelCase or snake_case. */
function readDevice(body = {}) {
  return {
    device_uid:  body.device_uid  || body.deviceId    || body.device_id  || null,
    device_name: body.device_name || body.deviceName  || null,
    platform:    body.platform    || body.devicePlatform || null,
    model:       body.model       || body.deviceModel || null,
    os_version:  body.os_version  || body.osVersion   || null,
    app_version: body.app_version || body.appVersion  || null,
  };
}

module.exports = { signAccess, signRefresh, peek, issueSession, upsertDevice, readDevice };
