// Authentication and authorisation.
//
// Ported from Nexus `middleware/auth.js`. Three things changed:
//
//   1. The staff/subscriber/secondary token trichotomy collapses to ONE token type.
//      ProjMan2 has one kind of principal: a user in an org, on a device, holding a
//      role. Nexus's secondary-token branch existed because a paired POS terminal
//      had no user of its own; here a paired device always resolves to a user row.
//   2. `req.auth.orgId` comes from the TOKEN, and every query filters on it. Tenant
//      isolation is a server guarantee — the app must not be able to reach another
//      builder's data even if a client bug asks for it.
//   3. Role checks are explicit guards rather than a rank ladder, because
//      `tradie` and `customer` are different audiences, not lower ranks.

const jwt    = require('jsonwebtoken');
const pool   = require('../db/pool');
const config = require('../config');
const { FINANCIAL_ROLES } = require('../lib/roles');

const deny = (res, status, message, code) =>
  res.status(status).json({ success: false, message, code });

/**
 * Verify the bearer token and load the live user, org and device.
 * Populates `req.auth` = { userId, orgId, role, deviceUid, deviceId, jti, user, org }.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return deny(res, 401, 'No token provided', 'NO_TOKEN');
  }

  let decoded;
  try {
    decoded = jwt.verify(header.slice(7), config.jwt.secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return deny(res, 401, 'Token expired', 'TOKEN_EXPIRED');
    }
    return deny(res, 401, 'Invalid token', 'INVALID_TOKEN');
  }

  try {
    const [[user]] = await pool.query(
      `SELECT u.id, u.org_id, u.email, u.full_name, u.mobile, u.mobile_verified,
              u.role, u.status, u.onboarding_complete,
              u.security_version, u.force_logout_flag, u.disabled_reason,
              o.name AS org_name, o.status AS org_status, o.timezone, o.currency
         FROM users u
         JOIN organisations o ON o.id = u.org_id
        WHERE u.id = ? AND u.is_deleted = 0
        LIMIT 1`,
      [decoded.sub]
    );

    if (!user) return deny(res, 401, 'User not found', 'NO_USER');

    // The token's org must still be the user's org. A token minted before a user was
    // moved between orgs must not keep reaching into the old tenant.
    if (decoded.org_id && decoded.org_id !== user.org_id) {
      return deny(res, 403, 'Token organisation mismatch', 'ORG_MISMATCH');
    }
    if (user.org_status !== 'active') {
      return deny(res, 403, 'Organisation is not active', 'ORG_INACTIVE');
    }
    if (user.status === 'disabled') {
      return deny(res, 403, 'Account disabled', 'DISABLED');
    }
    if (user.status === 'suspended') {
      return deny(res, 403, 'Account suspended', 'SUSPENDED');
    }
    if (user.force_logout_flag) {
      return deny(res, 401, 'Remote logout triggered', 'FORCE_LOGOUT');
    }
    // A password reset bumps security_version, invalidating every token minted
    // before it without having to hunt down session rows.
    if (decoded.version && user.security_version > decoded.version) {
      return deny(res, 401, 'Security settings changed. Please log in again.', 'FORCE_LOGOUT');
    }

    // Session revocation. `jti` is the session's refresh_token UUID.
    if (decoded.jti) {
      const [[session]] = await pool.query(
        `SELECT id, revoked_at, is_authoritative FROM sessions
          WHERE refresh_token = ? AND user_id = ? LIMIT 1`,
        [decoded.jti, user.id]
      );
      if (session?.revoked_at) {
        return deny(res, 401, 'Session revoked. Please log in again.', 'SESSION_REVOKED');
      }
      req.session = session || null;
    }

    // Device revocation. This is what makes "revoke a lost site tablet" actually
    // stop that tablet on its next call rather than whenever its token expires.
    let device = null;
    if (decoded.device_id) {
      const [[row]] = await pool.query(
        `SELECT id, role, status FROM devices
          WHERE org_id = ? AND device_uid = ? AND is_deleted = 0 LIMIT 1`,
        [user.org_id, decoded.device_id]
      );
      if (row && row.status !== 'active') {
        return deny(res, 401, 'This device has been revoked', 'DEVICE_REVOKED');
      }
      device = row || null;

      // Keep last_seen_at current — the device list is only useful if it is.
      if (device) {
        pool.query(`UPDATE devices SET last_seen_at = NOW() WHERE id = ?`, [device.id])
          .catch((e) => console.warn('[AUTH] last_seen update failed (non-fatal):', e.message));
      }
    }

    // The device's role wins when the session came from a pairing: that is the point
    // of binding role to the device. Fall back to the token, then the user row.
    const role = device?.role || decoded.role || user.role;

    req.auth = {
      userId: user.id,
      orgId: user.org_id,
      role,
      userRole: user.role,
      deviceUid: decoded.device_id || null,
      deviceId: device?.id || null,
      jti: decoded.jti || null,
      user,
    };

    return next();
  } catch (err) {
    console.error('[AUTH] Unexpected error:', err.message);
    return deny(res, 500, 'Authentication failed', 'AUTH_ERROR');
  }
}

/** Allow only the named roles. */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.auth) return deny(res, 401, 'Not authenticated', 'NO_AUTH');
    if (!allowed.includes(req.auth.role)) {
      return deny(res, 403, `Requires one of: ${allowed.join(', ')}`, 'FORBIDDEN_ROLE');
    }
    next();
  };
}

const requireOrgAdmin = requireRole('org_admin');

/** Anything that exposes money. Supervisors and tradies never see it. */
function requireFinancial(req, res, next) {
  if (!req.auth) return deny(res, 401, 'Not authenticated', 'NO_AUTH');
  if (!FINANCIAL_ROLES.has(req.auth.role)) {
    return deny(res, 403, 'Financial access required', 'FORBIDDEN_ROLE');
  }
  next();
}

module.exports = { authenticate, requireRole, requireOrgAdmin, requireFinancial };
