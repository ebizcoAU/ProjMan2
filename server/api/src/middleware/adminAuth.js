// Admin (System Admin) authentication — the /admin/* gate (dashboardspec §2/§3).
//
// The dashboard is a SINGLE-TIER platform surface: access is membership of the
// `platform_admins` allowlist, full stop — not a tenant role, not a tenant permission.
// So this composes the normal token `authenticate` (verify JWT, load the live user)
// with one extra check: is this user on the allowlist? Everyone else — including a
// `projectManager` who administers their own org in the portal — gets 403 here.
//
// Crucially, `/admin/*` is cross-tenant BY DESIGN: it does NOT apply the tenant
// `org_id`-from-token filter. Containment is the allowlist + the account/billing-only
// scope of the services (they never read construction content) + auditing of writes.

const pool = require('../db/pool');
const { authenticate } = require('./auth');

async function requirePlatformAdmin(req, res, next) {
  if (!req.auth?.userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated', code: 'NO_AUTH' });
  }
  try {
    const [[row]] = await pool.query(
      'SELECT id FROM platform_admins WHERE user_id = ? LIMIT 1',
      [req.auth.userId]
    );
    if (!row) {
      // Do not leak that this surface exists to non-admins beyond a plain 403.
      return res.status(403).json({ success: false, message: 'Platform administration access required', code: 'FORBIDDEN' });
    }
    req.admin = { userId: req.auth.userId };
    return next();
  } catch (err) {
    console.error('[ADMIN AUTH] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Admin authentication failed', code: 'ADMIN_AUTH_ERROR' });
  }
}

// The mount uses both, in order: verify the token, then require the allowlist.
const adminAuthenticate = [authenticate, requirePlatformAdmin];

module.exports = { adminAuthenticate, requirePlatformAdmin };
